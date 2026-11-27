const { createHash, randomBytes } = require('node:crypto');
const pool = require('../db/pool');
const { clientIp } = require('./client-ip');

const MAX_BODY_BYTES = 20 * 1024;
const MAX_INT = 2147483647;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bellek ici hiz siniri: anahtar = kural + IP, deger = zaman damgalari (ms).
const RATE_RULES = {
  comment: { windowMs: 10 * 60 * 1000, max: 5 },
  visitorPost: { windowMs: 60 * 60 * 1000, max: 3 },
  vote: { windowMs: 60 * 60 * 1000, max: 20 }
};
const rateBuckets = new Map();
const RATE_BUCKET_LIMIT = 50000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data, extraHeaders = {}) {
  if (res.headersSent) return true;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
  return true;
}

function readJson(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let finished = false;

    const fail = (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (finished) return;
      total += chunk.length;
      if (total > limit) {
        fail(new HttpError(413, 'Gönderilen veri çok büyük.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      if (total === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, 'Geçersiz istek gövdesi.'));
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Geçersiz JSON gönderildi.'));
      }
    });
    req.on('error', () => fail(new HttpError(400, 'İstek okunamadı.')));
  });
}

// Tarayici Origin basligini kendisi ekler; yoksa veya farkliysa reddet (CSRF).
function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw new HttpError(403, 'Geçersiz istek kaynağı.');
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Geçersiz istek kaynağı.');
  }
  if (originHost !== req.headers.host) throw new HttpError(403, 'Geçersiz istek kaynağı.');
}


// Sayfa acildiginda eski zaman damgalarini temizlemek icin basit budama.
function pruneRateBuckets(now) {
  if (rateBuckets.size < RATE_BUCKET_LIMIT) return;
  for (const [key, stamps] of rateBuckets) {
    const kind = key.split('|', 1)[0];
    const rule = RATE_RULES[kind];
    const fresh = stamps.filter((stamp) => now - stamp < rule.windowMs);
    if (fresh.length) rateBuckets.set(key, fresh);
    else rateBuckets.delete(key);
  }
}

// consume=false: yalnizca kontrol eder. consume=true: istek dogrulamadan gectikten sonra sayaci artirir.
function checkRateLimit(kind, ip, { consume = false } = {}) {
  const rule = RATE_RULES[kind];
  const now = Date.now();
  const key = `${kind}|${ip}`;
  const stamps = (rateBuckets.get(key) || []).filter((stamp) => now - stamp < rule.windowMs);
  if (stamps.length >= rule.max) {
    rateBuckets.set(key, stamps);
    throw new HttpError(429, 'Çok fazla deneme yaptınız. Lütfen biraz sonra tekrar deneyin.');
  }
  if (!consume) return;
  stamps.push(now);
  rateBuckets.set(key, stamps);
  pruneRateBuckets(now);
}

// Ayar okuma: hata veya eksik anahtar durumunda modul acik sayilir.
async function isModuleOn(key) {
  try {
    const { getSettings } = require('./settings-store');
    const settings = await getSettings();
    return !(settings && settings[key] === 'off');
  } catch (error) {
    console.error('Ayarlar okunamadı, modül açık varsayıldı:', error.message);
    return true;
  }
}

function requireModule(on, message) {
  if (!on) throw new HttpError(403, message);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validName(value) {
  const name = text(value);
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Ad soyad 2 ile 80 karakter arasında olmalıdır.');
  return name;
}

function validEmail(value, required) {
  const email = text(value);
  if (!email) {
    if (required) throw new HttpError(400, 'Geçerli bir e-posta adresi girin.');
    return null;
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, 'Geçerli bir e-posta adresi girin.');
  }
  return email;
}

function validText(value, min, max, message) {
  const result = text(value);
  if (result.length < min || result.length > max) throw new HttpError(400, message);
  return result;
}

function parsePositiveInt(value) {
  let number = NaN;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) number = Number(value.trim());
  if (!Number.isInteger(number) || number <= 0 || number > MAX_INT) return null;
  return number;
}

// Honeypot ve onay kontrolleri: bot doldurduysa sessizce basarili don.
function passesHoneypot(input) {
  return typeof input.website === 'string' && input.website.trim() !== '';
}

function requireConsent(input) {
  if (input.consent !== true) throw new HttpError(400, 'Devam etmek için onay kutusunu işaretleyin.');
}

// Oy kaydi anahtari: yalnizca IP (User-Agent degistirilerek oy tekrari engellenemesin).
// Not: eski IP+UA hash'leri artik eslesmez; bu nedenle onceki oylayanlar bir kez daha oy verebilir.
function voterHash(pollId, ip) {
  const key = process.env.SETTINGS_ENCRYPTION_KEY || 'artworld-analytics';
  return createHash('sha256').update(key + 'poll' + pollId + ip).digest('hex');
}

// aw_pv cerezi icin: ayni poll_votes tablosunda (poll_id, voter_hash) PK'si ile ayri bir satir.
// Yeni kolon/migration gerektirmez; 'c:' oneki IP hash'iyle cakismaz.
const VOTE_COOKIE = 'aw_pv';
const VOTE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const VOTE_COOKIE_PATTERN = /^[0-9a-f]{32}$/;

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function voteCookieValue(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${VOTE_COOKIE}=${token}; Path=/; Max-Age=${VOTE_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

function cookieVoterHash(pollId, token) {
  const key = process.env.SETTINGS_ENCRYPTION_KEY || 'artworld-analytics';
  return 'c:' + createHash('sha256').update(key + 'pollcookie' + pollId + token).digest('hex');
}

async function loadPollResult(db, pollId) {
  const { rows: pollRows } = await db.query('SELECT id, question FROM polls WHERE id = $1', [pollId]);
  if (!pollRows.length) return null;
  const { rows: options } = await db.query(
    'SELECT id, label, votes FROM poll_options WHERE poll_id = $1 ORDER BY sort_order, id',
    [pollId]
  );
  const mapped = options.map((option) => ({ id: option.id, label: option.label, votes: Number(option.votes) }));
  return {
    id: pollRows[0].id,
    question: pollRows[0].question,
    totalVotes: mapped.reduce((sum, option) => sum + option.votes, 0),
    options: mapped
  };
}

async function handleComment(req, res) {
  checkSameOrigin(req);
  const ip = clientIp(req);
  checkRateLimit('comment', ip);
  const input = await readJson(req);
  requireModule(await isModuleOn('module.comments'), 'Yorumlar şu an kapalı.');
  if (passesHoneypot(input)) {
    // Bot doldurdu: sessiz 201, ama kota tuketilir.
    checkRateLimit('comment', ip, { consume: true });
    return sendJson(res, 201, { ok: true, message: 'Yorumunuz alındı, editör onayından sonra yayımlanacak.' });
  }
  requireConsent(input);

  const articleId = parsePositiveInt(input.articleId);
  if (!articleId) throw new HttpError(400, 'Geçersiz haber kimliği.');
  const name = validName(input.name);
  const email = validEmail(input.email, false);
  const body = validText(input.body, 3, 2000, 'Yorum 3 ile 2000 karakter arasında olmalıdır.');

  const { rows } = await pool.query(
    `SELECT headline FROM articles WHERE id = $1 AND status = 'published'`,
    [articleId]
  );
  if (!rows.length) throw new HttpError(404, 'Haber bulunamadı.');

  checkRateLimit('comment', ip, { consume: true });
  await pool.query(
    `INSERT INTO comments (article_id, article_title, author_name, author_email, body, status, ip_address)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [articleId, rows[0].headline, name, email, body, ip]
  );
  return sendJson(res, 201, { ok: true, message: 'Yorumunuz alındı, editör onayından sonra yayımlanacak.' });
}

async function handleVote(req, res, pollId) {
  checkSameOrigin(req);
  const ip = clientIp(req);
  checkRateLimit('vote', ip);
  const input = await readJson(req);
  requireModule(await isModuleOn('module.polls'), 'Anketler şu an kapalı.');

  const optionId = parsePositiveInt(input.optionId);
  if (!optionId) throw new HttpError(400, 'Lütfen bir seçenek seçin.');

  const { rows: pollRows } = await pool.query('SELECT id, status FROM polls WHERE id = $1', [pollId]);
  if (!pollRows.length) throw new HttpError(404, 'Anket bulunamadı.');
  if (pollRows[0].status !== 'active') throw new HttpError(404, 'Bu anket şu an oylamaya açık değil.');

  const { rows: optionRows } = await pool.query(
    'SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2',
    [optionId, pollId]
  );
  if (!optionRows.length) throw new HttpError(400, 'Geçersiz anket seçeneği.');

  // Dogrulama gecti: kota burada tuketilir.
  checkRateLimit('vote', ip, { consume: true });

  // Cerez: yoksa veya gecersizse yeni token uretilir ve Set-Cookie ile verilir.
  const presentedToken = readCookie(req, VOTE_COOKIE);
  const hasValidCookie = VOTE_COOKIE_PATTERN.test(presentedToken || '');
  const cookieToken = hasValidCookie ? presentedToken : randomBytes(16).toString('hex');
  const extraHeaders = hasValidCookie ? {} : { 'Set-Cookie': voteCookieValue(cookieToken) };

  // Iki anahtar ayni transaction'da yazilir: IP ve cerez. Herhangi biri cakisirsa 409.
  const hashes = [voterHash(pollId, ip), cookieVoterHash(pollId, cookieToken)];

  let alreadyVoted = false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      for (const hash of hashes) {
        await client.query(
          'INSERT INTO poll_votes (poll_id, option_id, voter_hash) VALUES ($1, $2, $3)',
          [pollId, optionId, hash]
        );
      }
      await client.query('UPDATE poll_options SET votes = votes + 1 WHERE id = $1', [optionId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code !== '23505') throw error;
      alreadyVoted = true;
    }
  } finally {
    client.release();
  }

  const poll = await loadPollResult(pool, pollId);
  if (alreadyVoted) {
    return sendJson(res, 409, { error: 'Bu ankette zaten oy kullandınız.', poll }, extraHeaders);
  }
  return sendJson(res, 200, { ok: true, poll }, extraHeaders);
}

async function handleVisitorPost(req, res) {
  checkSameOrigin(req);
  const ip = clientIp(req);
  checkRateLimit('visitorPost', ip);
  const input = await readJson(req);
  requireModule(await isModuleOn('module.visitorPosts'), 'Okur haberleri şu an kapalı.');
  if (passesHoneypot(input)) {
    // Bot doldurdu: sessiz 201, ama kota tuketilir.
    checkRateLimit('visitorPost', ip, { consume: true });
    return sendJson(res, 201, { ok: true, message: 'Haberiniz alındı, editörlerimiz inceleyecek.' });
  }
  requireConsent(input);

  const name = validName(input.name);
  const email = validEmail(input.email, true);
  const title = validText(input.title, 5, 200, 'Haber başlığı 5 ile 200 karakter arasında olmalıdır.');
  const body = validText(input.body, 20, 10000, 'Haber metni 20 ile 10000 karakter arasında olmalıdır.');

  checkRateLimit('visitorPost', ip, { consume: true });
  await pool.query(
    `INSERT INTO visitor_posts (submitter_name, submitter_email, title, body, status, ip_address)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [name, email, title, body, ip]
  );
  return sendJson(res, 201, { ok: true, message: 'Haberiniz alındı, editörlerimiz inceleyecek.' });
}

async function handle(user, req, res, method, pathname, url, ctx) {
  try {
    if (method === 'POST' && pathname === '/api/public/comments') {
      return await handleComment(req, res);
    }
    if (method === 'POST' && pathname === '/api/public/visitor-posts') {
      return await handleVisitorPost(req, res);
    }
    const voteMatch = pathname.match(/^\/api\/public\/polls\/(\d+)\/vote$/);
    if (method === 'POST' && voteMatch) {
      const pollId = parsePositiveInt(voteMatch[1]);
      if (!pollId) return sendJson(res, 404, { error: 'Anket bulunamadı.' });
      return await handleVote(req, res, pollId);
    }
    return false;
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(res, error.status, { error: error.message });
    }
    console.error('Halka açık API hatası:', error);
    return sendJson(res, 500, { error: 'Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.' });
  }
}

module.exports = { handle };
