const { createHash, randomBytes } = require('node:crypto');
const pool = require('../db/pool');
const { clientIp } = require('./client-ip');
const { hashPassword } = require('../auth/password');

const MIN_PASSWORD = 14;
const MAX_PASSWORD = 256;
const MAX_BODY_BYTES = 10 * 1024;
const TOKEN_TTL_MS = 60 * 60_000;
const INVALID_LINK = 'Bağlantı geçersiz veya süresi dolmuş.';
const TOO_MANY = 'Çok fazla istek gönderildi. Daha sonra tekrar deneyin.';
const FORGOT_MESSAGE = 'Bu e-posta kayıtlıysa parola sıfırlama bağlantısı gönderildi.';

const limits = { forgot: 5, reset: 10 };
const attempts = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(value === null ? '' : JSON.stringify(value));
}

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'İstek JSON biçiminde olmalı.');
  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize > maxBytes) throw new HttpError(413, 'İstek boyutu sınırı aşıldı.');
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new HttpError(413, 'İstek boyutu sınırı aşıldı.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'Geçerli JSON gönderin.'); }
}

function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw new HttpError(403, 'İstek kaynağı doğrulanamadı.');
  try {
    if (new URL(origin).host !== req.headers.host) throw new HttpError(403, 'İstek kaynağı doğrulanamadı.');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, 'İstek kaynağı doğrulanamadı.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Çapraz site isteği reddedildi.');
}

// IP başına bellek içi saatlik sayaç. Sınır aşılınca 429 döner.
function consumeRateLimit(req, bucket) {
  const now = Date.now();
  if (attempts.size > 10000) {
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
  }
  const key = `${bucket}:${clientIp(req)}`;
  let entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 60 * 60_000 };
    attempts.set(key, entry);
  }
  if (entry.count >= limits[bucket]) throw new HttpError(429, TOO_MANY);
  entry.count += 1;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) {
    throw new HttpError(400, `Parola ${MIN_PASSWORD}-${MAX_PASSWORD} karakter olmalı.`);
  }
  return value;
}

// E-posta gönderimi için Gmail yapılandırması ve HTTPS SITE_URL gerekir.
async function resolveEmailConfig(ctx) {
  const site = process.env.SITE_URL || '';
  if (!/^https:\/\//i.test(site)) return null;
  try {
    const creds = await ctx.gmailCredentials();
    if (!creds || !isValidEmail(String(creds['sender-email'] || ''))) return null;
    return { creds, siteUrl: site.replace(/\/+$/, '') };
  } catch {
    return null;
  }
}

async function handleForgot(req, res, ctx) {
  checkSameOrigin(req);
  consumeRateLimit(req, 'forgot');
  const input = await readJson(req);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 254) : '';

  const config = await resolveEmailConfig(ctx);
  const response = { ok: true, message: FORGOT_MESSAGE, emailEnabled: Boolean(config) };

  if (config && isValidEmail(email)) {
    const { rows } = await pool.query(
      'SELECT id, email, display_name FROM users WHERE LOWER(email) = $1 AND is_active = TRUE',
      [email]
    );
    const user = rows[0];
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await pool.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      await pool.query(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, hashToken(token), new Date(Date.now() + TOKEN_TTL_MS)]
      );
      const link = `${config.siteUrl}/sifre-sifirla.html?token=${token}`;
      const body = `Merhaba ${user.display_name},\n\n`
        + `Art World TV yönetim hesabınız için parola sıfırlama talebi alındı.\n\n`
        + `Yeni parolanızı belirlemek için bağlantıyı açın:\n${link}\n\n`
        + `Bu bağlantı 1 saat geçerlidir. Bu talebi siz istemediyseniz bu e-postayı dikkate almayın.`;
      // Yanıt süresinin hesabın varlığını ele vermemesi için gönderim arka planda yapılır.
      Promise.resolve()
        .then(async () => ctx.sendGmail(config.creds, await ctx.gmailAccessToken(config.creds), user.email, 'Art World TV parola sıfırlama', body))
        .catch((error) => console.error('Parola sıfırlama e-postası gönderilemedi:', error.message));
    }
  }
  return sendJson(res, 200, response);
}

async function handleReset(req, res) {
  checkSameOrigin(req);
  consumeRateLimit(req, 'reset');
  const input = await readJson(req);
  const token = typeof input.token === 'string' ? input.token : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, INVALID_LINK);
  const password = validatePassword(input.password);

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT pr.id, pr.user_id
         FROM password_resets pr
         JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > NOW() AND u.is_active = TRUE
        FOR UPDATE OF pr`,
      [hashToken(token)]
    );
    const reset = rows[0];
    if (!reset) throw new HttpError(400, INVALID_LINK);

    await client.query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [reset.user_id, passwordHash]);
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [reset.user_id]);
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data)
       VALUES ($1, 'auth.password_reset', 'user', $1, '{}'::jsonb)`,
      [reset.user_id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return sendJson(res, 200, { ok: true });
}

async function handleAdminSetPassword(user, req, res, id) {
  if (!user) throw new HttpError(401, 'Oturum açmanız gerekiyor.');
  if (user.role !== 'admin') throw new HttpError(403, 'Bu işlem için yetkiniz yok.');
  if (id.length > 18 || Number(id) <= 0) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  checkSameOrigin(req);
  const input = await readJson(req);
  const password = validatePassword(input.password);
  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  let sessionsRevoked = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id, passwordHash]
    );
    if (!rows[0]) throw new HttpError(404, 'Kullanıcı bulunamadı.');
    const sessions = await client.query('DELETE FROM user_sessions WHERE user_id = $1', [id]);
    sessionsRevoked = sessions.rowCount;
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [id]);
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data)
       VALUES ($1, 'auth.password_set_by_admin', 'user', $2, $3::jsonb)`,
      [user.id, id, JSON.stringify({ sessionsRevoked })]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return sendJson(res, 200, { ok: true, selfChanged: Number(id) === Number(user.id), sessionsRevoked });
}

async function handle(user, req, res, method, pathname, url, ctx) {
  let run = null;
  let match = null;
  if (pathname === '/api/auth/forgot') {
    if (method !== 'POST') return false;
    run = () => handleForgot(req, res, ctx);
  } else if (pathname === '/api/auth/reset') {
    if (method !== 'POST') return false;
    run = () => handleReset(req, res);
  } else if ((match = pathname.match(/^\/api\/admin\/user-password\/(\d+)$/))) {
    if (method !== 'POST') return false;
    const id = match[1];
    run = () => handleAdminSetPassword(user, req, res, id);
  } else {
    return false;
  }

  try {
    await run();
  } catch (error) {
    if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
    else {
      console.error('Parola işlemi hatası:', error.message);
      sendJson(res, 500, { error: 'İşlem sırasında beklenmeyen bir hata oluştu.' });
    }
  }
  return true;
}

module.exports = { handle };
