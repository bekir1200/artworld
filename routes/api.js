const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db/pool');
const { hashPassword, verifyPassword } = require('../auth/password');
const { allowAdEvent } = require('./ad-rate-limit');
const newAdminModules = [
  require('./columns'), require('./galleries'), require('./videos'), require('./comments'), require('./polls'),
  require('./static-pages'), require('./footer-links'), require('./visitor-posts'), require('./bots'),
  require('./public-api'), require('./dashboard-widgets'), require('./announcements'), require('./horoscope-movies'),
  require('./settings-ext'), require('./password-reset')
];
// Shared helpers handed to route modules that live outside this file (function declarations are hoisted).
const moduleCtx = { sendGmail, gmailCredentials, gmailAccessToken, checkSameOrigin };

const SESSION_HOURS = 8;
const REMEMBER_SESSION_HOURS = 24 * 30;
const loginAttempts = new Map();
const newsletterAttempts = new Map();
let briefingWidgetCache = { expiresAt: 0, value: null };
const roles = {
  admin: 'Yönetici',
  editor_in_chief: 'Yazı işleri müdürü',
  editor: 'Editör',
  reporter: 'Muhabir',
  ad_sales: 'Reklam satış',
  crm_manager: 'CRM sorumlusu'
};
const editors = new Set(['admin', 'editor_in_chief', 'editor']);
const publishers = new Set(['admin', 'editor_in_chief']);
const writers = new Set([...editors, 'reporter']);
const staff = new Set(Object.keys(roles));
const articleStatuses = new Set(['draft', 'in_review', 'approved', 'scheduled', 'published', 'archived']);
const integrationRoles = new Set(['admin']);
const adRoles = new Set(['admin', 'ad_sales']);
const crmRoles = new Set(['admin', 'crm_manager']);
const mediaDir = path.join(__dirname, '..', 'storage', 'media');
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(value === null ? '' : JSON.stringify(value));
}

async function briefingWidgetData() {
  if (briefingWidgetCache.expiresAt > Date.now() && briefingWidgetCache.value) return briefingWidgetCache.value;
  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.search = new URLSearchParams({
    latitude: '36.8969', longitude: '30.7133',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min', timezone: 'Europe/Istanbul', forecast_days: '1'
  }).toString();
  const marketUrl = new URL('https://api.frankfurter.dev/v2/rates');
  marketUrl.search = new URLSearchParams({ base: 'EUR', quotes: 'USD,TRY' }).toString();
  const fetchJson = async (url) => {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`External data source returned ${response.status}`);
    return response.json();
  };
  const [weatherResult, marketResult] = await Promise.allSettled([fetchJson(weatherUrl), fetchJson(marketUrl)]);
  let weather = null;
  if (weatherResult.status === 'fulfilled') {
    const source = weatherResult.value;
    const current = source.current || {};
    const daily = source.daily || {};
    const values = [current.temperature_2m, current.apparent_temperature, current.relative_humidity_2m, current.weather_code, daily.temperature_2m_min?.[0], daily.temperature_2m_max?.[0]];
    if (values.every((value) => Number.isFinite(Number(value)))) {
      weather = {
        temperature: Number(current.temperature_2m), apparentTemperature: Number(current.apparent_temperature),
        humidity: Number(current.relative_humidity_2m), weatherCode: Number(current.weather_code),
        temperatureMin: Number(daily.temperature_2m_min[0]), temperatureMax: Number(daily.temperature_2m_max[0]),
        date: String(current.time || '').slice(0, 10)
      };
    }
  }
  let market = null;
  if (marketResult.status === 'fulfilled' && Array.isArray(marketResult.value)) {
    const rates = marketResult.value;
    const eurTry = rates.find((item) => String(item.quote).toUpperCase() === 'TRY');
    const eurUsd = rates.find((item) => String(item.quote).toUpperCase() === 'USD');
    if (Number(eurTry?.rate) > 0 && Number(eurUsd?.rate) > 0) {
      market = { eurTry: Number(eurTry.rate), usdTry: Number(eurTry.rate) / Number(eurUsd.rate), date: String(eurTry.date || eurUsd.date || '') };
    }
  }
  const value = { weather, market };
  briefingWidgetCache = { expiresAt: Date.now() + (weather || market ? 10 * 60_000 : 60_000), value };
  return value;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

function setSessionCookie(res, token, hours = SESSION_HOURS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `artworld_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${hours * 3600}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `artworld_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function checkSameOrigin(req) {
  // Origin tercih edilir; yoksa Referer kullanılır. İkisi de yoksa istek reddedilir.
  const source = req.headers.origin || req.headers.referer;
  if (!source) throw new HttpError(403, 'İstek kaynağı doğrulanamadı.');
  let sourceHost = '';
  try { sourceHost = new URL(source).host; } catch { sourceHost = ''; }
  if (!sourceHost || sourceHost !== req.headers.host) throw new HttpError(403, 'İstek kaynağı doğrulanamadı.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Çapraz site isteği reddedildi.');
}

function checkNewsletterRateLimit(req, email) {
  const now = Date.now();
  for (const [key, bucket] of newsletterAttempts) if (bucket.expiresAt <= now) newsletterAttempts.delete(key);
  const keys = [
    [`ip:${req.socket.remoteAddress || 'unknown'}`, 5, 15 * 60_000],
    [`email:${createHash('sha256').update(email).digest('hex')}`, 3, 60 * 60_000]
  ];
  if (keys.some(([key, limit]) => (newsletterAttempts.get(key)?.count || 0) >= limit)) throw new HttpError(429, 'Çok fazla istek gönderildi. Daha sonra tekrar deneyin.');
  if (newsletterAttempts.size + keys.filter(([key]) => !newsletterAttempts.has(key)).length > 10000) throw new HttpError(429, 'Çok fazla istek gönderildi. Daha sonra tekrar deneyin.');
  for (const [key, , window] of keys) {
    const bucket = newsletterAttempts.get(key) || { count: 0, expiresAt: now + window };
    bucket.count += 1;
    newsletterAttempts.set(key, bucket);
  }
}

async function readJson(req, maxBytes = 100_000) {
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

async function getSession(req) {
  const token = cookieValue(req, 'artworld_session');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

function requireRole(user, allowed) {
  if (!user) throw new HttpError(401, 'Oturum açmanız gerekiyor.');
  if (!allowed.has(user.role)) throw new HttpError(403, 'Bu işlem için yetkiniz yok.');
}

function settingsEncryptionKey() {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new HttpError(503, 'API anahtarı kasasını kullanmak için SETTINGS_ENCRYPTION_KEY ayarlayın. Kurulum adımları README dosyasında.');
  return Buffer.from(secret, 'hex');
}

function encryptSetting(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', settingsEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSetting(value) {
  const [version, ivHex, tagHex, dataHex] = String(value || '').split(':');
  if (version !== 'v1' || !/^[a-f0-9]{24}$/i.test(ivHex || '') || !/^[a-f0-9]{32}$/i.test(tagHex || '') || !/^(?:[a-f0-9]{2})+$/i.test(dataHex || '')) throw new HttpError(503, 'E-posta entegrasyon bilgisi açılamadı.');
  const decipher = createDecipheriv('aes-256-gcm', settingsEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

async function gmailCredentials() {
  const { rows } = await pool.query(`SELECT field_key, ciphertext FROM integration_credentials WHERE integration_key = 'google-gmail'`);
  const credentials = Object.fromEntries(rows.map((row) => [row.field_key, decryptSetting(row.ciphertext)]));
  if (!credentials['oauth-client-id'] || !credentials['oauth-client-secret'] || !credentials['oauth-refresh-token'] || !credentials['sender-email']) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials['sender-email'])) throw new HttpError(503, 'Google Gmail gönderen adresi geçersiz.');
  return credentials;
}

async function gmailAccessToken(credentials) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials['oauth-client-id'], client_secret: credentials['oauth-client-secret'], refresh_token: credentials['oauth-refresh-token'], grant_type: 'refresh_token' })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new HttpError(502, 'Google Gmail erişim tokenı alınamadı. Admin entegrasyon bilgilerini kontrol edin.');
  return data.access_token;
}

async function sendGmail(credentials, accessToken, to, subject, body) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const mime = `To: ${to}\r\nFrom: ${credentials['sender-email']}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}`;
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') })
  });
  if (!response.ok) throw new HttpError(502, 'Gmail iletisi gönderilemedi. Google API yetkisini kontrol edin.');
}

function normalizeIntegrationKey(value, label) {
  const key = String(value || '').trim().toLocaleLowerCase('en-US').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!key || key.length > 60) throw new HttpError(400, `${label} 1-60 karakter olmalı; İngilizce harf, rakam ve tire kullanın.`);
  return key;
}

async function adminIntegrations(user, req, res, method, pathname) {
  requireRole(user, integrationRoles);
  if (method === 'GET' && pathname === '/api/admin/integrations') {
    const { rows } = await pool.query(
      `SELECT id, integration_key, integration_name, field_key, field_name, updated_at
         FROM integration_credentials ORDER BY integration_name, field_name`
    );
    return sendJson(res, 200, { encryptionReady: /^[a-f0-9]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY || ''), credentials: rows });
  }
  if (method === 'PUT' && pathname === '/api/admin/integrations') {
    checkSameOrigin(req);
    const input = await readJson(req, 160_000);
    const integrationName = typeof input.integrationName === 'string' ? input.integrationName.trim().slice(0, 100) : '';
    const integrationKey = normalizeIntegrationKey(input.integration || integrationName, 'Entegrasyon anahtarı');
    const credentialsInput = Array.isArray(input.credentials)
      ? input.credentials
      : [{ field: input.field, fieldName: input.fieldName, value: input.value }];
    if (!integrationName || integrationName.length > 100) throw new HttpError(400, 'Entegrasyon adı 1-100 karakter olmalı.');
    if (!credentialsInput.length || credentialsInput.length > 20) throw new HttpError(400, 'Bir seferde 1-20 bilgi kaydedin.');
    const seenFields = new Set();
    const credentials = credentialsInput.map((credential) => {
      if (!credential || typeof credential !== 'object') throw new HttpError(400, 'Entegrasyon bilgisi biçimi geçersiz.');
      const fieldKey = normalizeIntegrationKey(credential.fieldKey || credential.field, 'Alan anahtarı');
      const fieldName = typeof credential.fieldName === 'string' ? credential.fieldName.trim().slice(0, 100) : '';
      const value = typeof credential.value === 'string' ? credential.value : '';
      if (!fieldName || !value || value.length > 50_000) throw new HttpError(400, 'Alan adı ve gizli değer gerekli; değer 50.000 karakteri aşamaz.');
      if (seenFields.has(fieldKey)) throw new HttpError(400, 'Aynı bilgi alanı bir istekte iki kez gönderilemez.');
      seenFields.add(fieldKey);
      return { fieldKey, fieldName, ciphertext: encryptSetting(value) };
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saved = [];
      for (const credential of credentials) {
        const { rows } = await client.query(
          `INSERT INTO integration_credentials (integration_key, integration_name, field_key, field_name, ciphertext, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (integration_key, field_key) DO UPDATE SET
             integration_name = EXCLUDED.integration_name, field_name = EXCLUDED.field_name,
             ciphertext = EXCLUDED.ciphertext, updated_by = EXCLUDED.updated_by, updated_at = NOW()
           RETURNING id, integration_key, integration_name, field_key, field_name, updated_at`,
          [integrationKey, integrationName, credential.fieldKey, credential.fieldName, credential.ciphertext, user.id]
        );
        saved.push(rows[0]);
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, after_data)
         VALUES ($1, 'integration.credentials.saved', 'integration_credential', $2::jsonb)`,
        [user.id, JSON.stringify({ integration: integrationName, fields: saved.map(({ field_name: fieldName }) => fieldName) })]
      );
      await client.query('COMMIT');
      return sendJson(res, 200, { credentials: saved });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  const match = pathname.match(/^\/api\/admin\/integrations\/(\d+)$/);
  if (method === 'DELETE' && match) {
    checkSameOrigin(req);
    const id = Number(match[1]);
    const { rows } = await pool.query(
      'DELETE FROM integration_credentials WHERE id = $1 RETURNING id, integration_name, field_name', [id]
    );
    if (!rows[0]) throw new HttpError(404, 'API bilgisi bulunamadı.');
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data)
       VALUES ($1, 'integration.credential.deleted', 'integration_credential', $2, $3::jsonb)`,
      [user.id, rows[0].id, JSON.stringify({ integration: rows[0].integration_name, field: rows[0].field_name })]
    );
    return sendJson(res, 200, { ok: true });
  }
  return false;
}

function validateStaff(input, { creating = false } = {}) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  const role = typeof input.role === 'string' ? input.role : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (creating && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Geçerli bir e-posta adresi girin.');
  if (creating && (displayName.length < 1 || displayName.length > 100)) throw new HttpError(400, 'Ad 1-100 karakter olmalı.');
  if (creating && !Object.hasOwn(roles, role)) throw new HttpError(400, 'Geçerli bir personel rolü seçin.');
  if (creating && (password.length < 14 || password.length > 256)) throw new HttpError(400, 'Parola 14-256 karakter olmalı.');
  return { email, displayName, role, password };
}

async function adminUsers(user, req, res, method, pathname) {
  requireRole(user, integrationRoles);
  if (method === 'GET' && pathname === '/api/admin/users') {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, is_active, last_login_at, created_at
         FROM users ORDER BY is_active DESC, display_name, id`
    );
    return sendJson(res, 200, { roles: Object.entries(roles).map(([key, label]) => ({ key, label })), users: rows });
  }
  if (method === 'POST' && pathname === '/api/admin/users') {
    checkSameOrigin(req);
    const input = validateStaff(await readJson(req), { creating: true });
    const passwordHash = await hashPassword(input.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, display_name, role, is_active, last_login_at, created_at`,
        [input.email, passwordHash, input.displayName, input.role]
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data)
         VALUES ($1, 'user.created', 'user', $2, $3::jsonb)`,
        [user.id, rows[0].id, JSON.stringify({ email: rows[0].email, role: rows[0].role, is_active: rows[0].is_active })]
      );
      await client.query('COMMIT');
      return sendJson(res, 201, { user: rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new HttpError(409, 'Bu e-posta adresi zaten kayıtlı.');
      throw error;
    } finally { client.release(); }
  }
  const match = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (method === 'PATCH' && match) {
    checkSameOrigin(req);
    const targetId = Number(match[1]);
    const input = await readJson(req);
    if (targetId === Number(user.id) && (input.role !== undefined || input.isActive === false)) {
      throw new HttpError(400, 'Kendi yöneticilik rolünüzü kaldıramaz veya hesabınızı kapatamazsınız.');
    }
    const allowedFields = new Set(['role', 'displayName', 'isActive', 'password']);
    if (!Object.keys(input).some((key) => allowedFields.has(key)) || Object.keys(input).some((key) => !allowedFields.has(key))) {
      throw new HttpError(400, 'Güncellenecek personel alanı geçersiz.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(724190382)');
      const { rows } = await client.query(
        'SELECT id, email, display_name, role, is_active FROM users WHERE id = $1 FOR UPDATE', [targetId]
      );
      const before = rows[0];
      if (!before) throw new HttpError(404, 'Personel hesabı bulunamadı.');
      const nextRole = input.role === undefined ? before.role : input.role;
      const nextActive = input.isActive === undefined ? before.is_active : input.isActive;
      const nextName = input.displayName === undefined ? before.display_name : String(input.displayName).trim();
      if (!Object.hasOwn(roles, nextRole)) throw new HttpError(400, 'Geçerli bir rol seçin.');
      if (typeof nextActive !== 'boolean') throw new HttpError(400, 'Hesap durumu geçersiz.');
      if (!nextName || nextName.length > 100) throw new HttpError(400, 'Ad 1-100 karakter olmalı.');
      if ((nextRole !== 'admin' || !nextActive) && before.role === 'admin' && before.is_active) {
        const { rows: admins } = await client.query(
          `SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin' AND is_active = TRUE AND id <> $1`, [targetId]
        );
        if (!admins[0].total) throw new HttpError(409, 'Sistemde en az bir etkin yönetici kalmalı.');
      }
      let passwordHash = null;
      if (input.password !== undefined) {
        if (typeof input.password !== 'string' || input.password.length < 14 || input.password.length > 256) throw new HttpError(400, 'Parola 14-256 karakter olmalı.');
        passwordHash = await hashPassword(input.password);
      }
      const { rows: updated } = await client.query(
        `UPDATE users SET display_name = $2, role = $3, is_active = $4,
                password_hash = COALESCE($5, password_hash), updated_at = NOW()
          WHERE id = $1
          RETURNING id, email, display_name, role, is_active, last_login_at, created_at`,
        [targetId, nextName, nextRole, nextActive, passwordHash]
      );
      if (input.password !== undefined || !nextActive || nextRole !== before.role) {
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [targetId]);
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
         VALUES ($1, 'user.updated', 'user', $2, $3::jsonb, $4::jsonb)`,
        [user.id, targetId,
          JSON.stringify({ role: before.role, is_active: before.is_active, display_name: before.display_name }),
          JSON.stringify({ role: updated[0].role, is_active: updated[0].is_active, display_name: updated[0].display_name })]
      );
      await client.query('COMMIT');
      return sendJson(res, 200, { user: updated[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  return false;
}

async function adminAdvertising(user, req, res, method, pathname) {
  requireRole(user, adRoles);
  if (method === 'GET' && pathname === '/api/admin/advertising/report') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
    const rangeStart = new Date(`${today}T12:00:00+03:00`); rangeStart.setDate(rangeStart.getDate() - 29);
    const defaultFrom = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(rangeStart);
    const from = url.searchParams.get('from') || defaultFrom;
    const to = url.searchParams.get('to') || today;
    const placementRaw = url.searchParams.get('placementId') || '';
    const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!isDate(from) || !isDate(to) || from > to) throw new HttpError(400, 'Geçerli bir rapor tarih aralığı seçin.');
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 366) throw new HttpError(400, 'Rapor aralığı en fazla 366 gün olabilir.');
    const placementId = placementRaw ? Number(placementRaw) : null;
    if (placementRaw && (!Number.isSafeInteger(placementId) || placementId < 1)) throw new HttpError(400, 'Reklam alanı filtresi geçersiz.');
    const report = await pool.query(
      `SELECT c.id AS campaign_id, c.name AS campaign_name, a.company_name,
              p.id AS placement_id, p.placement_key, p.display_name AS placement_name, p.page_area,
              COUNT(*) FILTER (WHERE d.event_type = 'impression')::int AS impressions,
              COUNT(*) FILTER (WHERE d.event_type = 'click')::int AS clicks
         FROM ad_delivery_events d
         JOIN ad_campaigns c ON c.id = d.campaign_id
         JOIN advertisers a ON a.id = c.advertiser_id
         JOIN ad_placements p ON p.id = d.placement_id
        WHERE d.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Istanbul')
          AND d.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
          AND ($3::bigint IS NULL OR p.id = $3)
        GROUP BY c.id, c.name, a.company_name, p.id, p.placement_key, p.display_name, p.page_area
        ORDER BY impressions DESC, clicks DESC, c.name, p.display_name`, [from, to, placementId]
    );
    const totals = report.rows.reduce((sum, row) => ({
      impressions: sum.impressions + Number(row.impressions),
      clicks: sum.clicks + Number(row.clicks)
    }), { impressions: 0, clicks: 0 });
    return sendJson(res, 200, {
      from, to, placementId,
      totals: { ...totals, ctr: totals.impressions ? totals.clicks / totals.impressions : 0 },
      rows: report.rows
    });
  }
  if (method === 'GET' && pathname === '/api/admin/advertising') {
    const [campaigns, advertisers, placements, creatives] = await Promise.all([
      pool.query(`SELECT c.id, c.name, c.status, c.starts_at, c.ends_at, c.budget, c.regulatory_reference, a.company_name,
                         COALESCE(string_agg(p.display_name, ', ' ORDER BY p.display_name), '') AS placements,
                         COALESCE(string_agg(DISTINCT p.format, ' · ' ORDER BY p.format), '') AS formats,
                         COUNT(DISTINCT d.id) FILTER (WHERE d.event_type = 'impression')::int AS impressions,
                         COUNT(DISTINCT d.id) FILTER (WHERE d.event_type = 'click')::int AS clicks
                    FROM ad_campaigns c JOIN advertisers a ON a.id = c.advertiser_id
                    LEFT JOIN ad_campaign_placements cp ON cp.campaign_id = c.id
                    LEFT JOIN ad_placements p ON p.id = cp.placement_id
                    LEFT JOIN ad_delivery_events d ON d.campaign_id = c.id
                   GROUP BY c.id, a.company_name ORDER BY c.created_at DESC LIMIT 100`),
      pool.query('SELECT id, company_name, contact_name, email, phone, is_active FROM advertisers ORDER BY company_name'),
      pool.query('SELECT id, placement_key, display_name, page_area, format, supported_sizes, is_active FROM ad_placements ORDER BY display_name'),
      pool.query(`SELECT cr.id, cr.campaign_id, cr.headline, cr.target_url, cr.status, cr.created_at,
                         c.name AS campaign_name, m.storage_key AS media_key, m.width, m.height, m.original_name
                    FROM ad_creatives cr JOIN ad_campaigns c ON c.id = cr.campaign_id
                    LEFT JOIN media_assets m ON m.id = cr.media_id
                   ORDER BY cr.created_at DESC LIMIT 100`)
    ]);
    return sendJson(res, 200, { campaigns: campaigns.rows, advertisers: advertisers.rows, placements: placements.rows, creatives: creatives.rows });
  }
  if (method === 'POST' && pathname === '/api/admin/advertising/creatives') {
    checkSameOrigin(req);
    const input = await readJson(req);
    const campaignId = Number(input.campaignId); const mediaId = Number(input.mediaId);
    const headline = String(input.headline || '').trim().slice(0, 180);
    const targetUrl = String(input.targetUrl || '').trim().slice(0, 2000);
    let target;
    try { target = new URL(targetUrl); } catch { throw new HttpError(400, 'Geçerli reklam hedef adresi girin.'); }
    if (!Number.isSafeInteger(campaignId) || campaignId < 1 || !Number.isSafeInteger(mediaId) || mediaId < 1 || headline.length < 2 || target.protocol !== 'https:') throw new HttpError(400, 'Kampanya, görsel, başlık ve HTTPS hedef adresi gerekli.');
    const campaign = await pool.query('SELECT 1 FROM ad_campaigns WHERE id = $1', [campaignId]);
    if (!campaign.rowCount) throw new HttpError(404, 'Kampanya bulunamadı.');
    const media = await pool.query('SELECT id, width, height FROM media_assets WHERE id = $1 AND ($2::boolean OR uploaded_by = $3)', [mediaId, user.role === 'admin', user.id]);
    if (!media.rowCount) throw new HttpError(404, 'Reklam görseli bulunamadı.');
    const placement = await pool.query(
      `SELECT p.display_name, p.supported_sizes FROM ad_campaign_placements cp
         JOIN ad_placements p ON p.id = cp.placement_id WHERE cp.campaign_id = $1 ORDER BY p.display_name`, [campaignId]
    );
    if (!placement.rowCount) throw new HttpError(400, 'Kampanyanın reklam alanı tanımlanmamış.');
    const dimensions = media.rows[0];
    const supportedSizes = [...new Map(placement.rows.flatMap((item) => Object.values(item.supported_sizes || {}).flat())
      .map(([width, height]) => [`${width}x${height}`, [width, height]])).values()];
    const sizeAllowed = supportedSizes.some(([width, height]) => Number(width) === Number(dimensions.width) && Number(height) === Number(dimensions.height));
    if (!sizeAllowed) {
      const available = supportedSizes.map(([width, height]) => `${width}×${height}`).join(', ');
      const placementNames = placement.rows.map((item) => item.display_name).join(', ');
      throw new HttpError(400, `Görsel ölçüsü ${dimensions.width && dimensions.height ? `${dimensions.width}×${dimensions.height}` : 'okunamadı'}. Kampanyanın (${placementNames}) reklam alanlarında kabul edilen ölçüler: ${available}.`);
    }
    const { rows } = await pool.query(`INSERT INTO ad_creatives (campaign_id, media_id, headline, target_url) VALUES ($1, $2, $3, $4) RETURNING id, campaign_id, headline, target_url, status, created_at`, [campaignId, mediaId, headline, target.href]);
    await pool.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, 'ad.creative.created', 'ad_creative', $2, $3::jsonb)`, [user.id, rows[0].id, JSON.stringify({ campaignId, headline })]);
    return sendJson(res, 201, { creative: rows[0] });
  }
  const creativeMatch = pathname.match(/^\/api\/admin\/advertising\/creatives\/(\d+)$/);
  if (method === 'PATCH' && creativeMatch) {
    checkSameOrigin(req);
    requireRole(user, integrationRoles);
    const { status } = await readJson(req);
    if (!['approved', 'rejected', 'retired'].includes(status)) throw new HttpError(400, 'Reklam kreatifi durumu geçersiz.');
    const expectedStatus = status === 'approved' || status === 'rejected' ? 'pending' : 'approved';
    const { rows } = await pool.query('UPDATE ad_creatives SET status = $2 WHERE id = $1 AND status = $3 RETURNING id, campaign_id, status', [creativeMatch[1], status, expectedStatus]);
    if (!rows[0]) throw new HttpError(404, 'Bekleyen veya yayındaki reklam kreatifi bulunamadı.');
    await pool.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, 'ad.creative.status_changed', 'ad_creative', $2, $3::jsonb)`, [user.id, rows[0].id, JSON.stringify({ status })]);
    return sendJson(res, 200, rows[0]);
  }
  if (method === 'POST' && pathname === '/api/admin/advertising/campaigns') {
    checkSameOrigin(req);
    const input = await readJson(req);
    const name = String(input.name || '').trim().slice(0, 180);
    const company = String(input.companyName || '').trim().slice(0, 180);
    const contact = String(input.contactName || '').trim().slice(0, 120);
    const email = String(input.email || '').trim().slice(0, 254);
    const phone = String(input.phone || '').trim().slice(0, 40);
    const regulatoryReference = String(input.regulatoryReference || '').trim().slice(0, 80);
    const placementId = Number(input.placementId);
    const budget = input.budget === '' || input.budget == null ? null : Number(input.budget);
    const startsAt = input.startsAt ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.startsAt) ? `${input.startsAt}T00:00:00+03:00` : input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(input.endsAt) ? `${input.endsAt}T23:59:59.999+03:00` : input.endsAt) : null;
    if (name.length < 2 || company.length < 2) throw new HttpError(400, 'Kampanya ve reklamveren adı gerekli.');
    if (!Number.isSafeInteger(placementId) || placementId < 1) throw new HttpError(400, 'Reklam alanı seçin.');
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) throw new HttpError(400, 'Bütçe sıfır veya daha büyük olmalı.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-posta adresini kontrol edin.');
    if (startsAt && Number.isNaN(startsAt.valueOf()) || endsAt && Number.isNaN(endsAt.valueOf()) || startsAt && endsAt && endsAt <= startsAt) throw new HttpError(400, 'Kampanya tarih aralığını kontrol edin.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const placement = await client.query('SELECT id FROM ad_placements WHERE id = $1 AND is_active = TRUE', [placementId]);
      if (!placement.rowCount) throw new HttpError(400, 'Seçilen reklam alanı etkin değil.');
      const existingAdvertiser = await client.query(`SELECT id FROM advertisers WHERE LOWER(company_name) = LOWER($1) ORDER BY id LIMIT 1 FOR UPDATE`, [company]);
      const advertiser = existingAdvertiser.rows[0]
        ? await client.query(`UPDATE advertisers SET contact_name=$2,email=$3,phone=$4,is_active=TRUE,updated_at=NOW() WHERE id=$1 RETURNING id`, [existingAdvertiser.rows[0].id, contact, email, phone])
        : await client.query(`INSERT INTO advertisers (company_name, contact_name, email, phone) VALUES ($1,$2,$3,$4) RETURNING id`, [company, contact, email, phone]);
      const campaign = await client.query(
        `INSERT INTO ad_campaigns (advertiser_id, name, status, starts_at, ends_at, budget, regulatory_reference, sales_owner_id, created_by)
         VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $7) RETURNING id`,
        [advertiser.rows[0].id, name, startsAt?.toISOString() || null, endsAt?.toISOString() || null, budget, regulatoryReference, user.id]
      );
      await client.query('INSERT INTO ad_campaign_placements (campaign_id, placement_id) VALUES ($1, $2)', [campaign.rows[0].id, placementId]);
      await client.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, 'ad.campaign.created', 'ad_campaign', $2, $3::jsonb)`, [user.id, campaign.rows[0].id, JSON.stringify({ name, company, placementId, budget, regulatoryReference })]);
      await client.query('COMMIT');
      return sendJson(res, 201, { id: campaign.rows[0].id });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const match = pathname.match(/^\/api\/admin\/advertising\/campaigns\/(\d+)$/);
  if (method === 'PATCH' && match) {
    checkSameOrigin(req);
    const { status } = await readJson(req);
    if (!['draft', 'awaiting_approval', 'scheduled', 'active', 'paused', 'completed', 'cancelled'].includes(status)) throw new HttpError(400, 'Kampanya durumu geçersiz.');
    if (user.role === 'ad_sales' && ['active', 'completed', 'cancelled', 'paused'].includes(status)) throw new HttpError(403, 'Bu kampanya durumunu yalnız yönetici değiştirebilir.');
    const current = await pool.query('SELECT status FROM ad_campaigns WHERE id = $1', [match[1]]);
    if (!current.rowCount) throw new HttpError(404, 'Kampanya bulunamadı.');
    const allowedTransitions = {
      draft: ['awaiting_approval', 'cancelled'],
      awaiting_approval: ['draft', 'scheduled', 'active', 'cancelled'],
      scheduled: ['awaiting_approval', 'active', 'paused', 'cancelled'],
      active: ['paused', 'completed', 'cancelled'],
      paused: ['awaiting_approval', 'active', 'completed', 'cancelled'],
      completed: [], cancelled: []
    };
    if (!allowedTransitions[current.rows[0].status]?.includes(status)) throw new HttpError(400, 'Bu kampanya durum geçişine izin verilmiyor.');
    if (status === 'active' && current.rows[0].status !== 'awaiting_approval' && user.role !== 'admin') throw new HttpError(403, 'Yalnızca yönetici, onay bekleyen kampanyayı etkinleştirebilir.');
    const { rows } = await pool.query('UPDATE ad_campaigns SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id, status', [match[1], status]);
    if (!rows[0]) throw new HttpError(404, 'Kampanya bulunamadı.');
    await pool.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, 'ad.campaign.status_changed', 'ad_campaign', $2, $3::jsonb)`, [user.id, rows[0].id, JSON.stringify({ status })]);
    return sendJson(res, 200, rows[0]);
  }
  if (method === 'DELETE' && match) {
    checkSameOrigin(req);
    requireRole(user, integrationRoles);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: campaignRows } = await client.query('SELECT id, name, status FROM ad_campaigns WHERE id = $1 FOR UPDATE', [match[1]]);
      const campaign = campaignRows[0];
      if (!campaign) throw new HttpError(404, 'Kampanya bulunamadı.');
      // Gösterim geçmişi olan kampanya silinmez (ad_delivery_events ve günlük arşiv RESTRICT ile bağlı).
      const { rows: history } = await client.query(
        `SELECT (EXISTS (SELECT 1 FROM ad_delivery_events WHERE campaign_id = $1)
              OR EXISTS (SELECT 1 FROM ad_delivery_daily_archive WHERE campaign_id = $1)) AS has_history`, [campaign.id]
      );
      if (history[0].has_history) throw new HttpError(409, 'Gösterim kaydı olan kampanya silinemez; iptal edin.');
      await client.query('DELETE FROM ad_creatives WHERE campaign_id = $1', [campaign.id]);
      await client.query('DELETE FROM ad_campaign_placements WHERE campaign_id = $1', [campaign.id]);
      await client.query('DELETE FROM ad_campaigns WHERE id = $1', [campaign.id]);
      await client.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data) VALUES ($1, 'ad.campaign.deleted', 'ad_campaign', $2, $3::jsonb)`, [user.id, campaign.id, JSON.stringify({ name: campaign.name, status: campaign.status })]);
      await client.query('COMMIT');
      return sendJson(res, 200, { ok: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return false;
}

async function adminCrm(user, req, res, method, pathname, url) {
  requireRole(user, crmRoles);
  if (method === 'GET' && pathname === '/api/admin/crm/export.csv') {
    const { rows } = await pool.query(
      `SELECT c.email, c.display_name, c.contact_type, c.status, c.source, c.notes, u.display_name AS assigned_name, c.created_at
         FROM crm_contacts c LEFT JOIN users u ON u.id = c.assigned_to ORDER BY c.created_at DESC LIMIT 10000`
    );
    const cell = (value) => {
      let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = ['E-posta,Ad,Tür,Durum,Kaynak,Not,Sorumlu,Oluşturma', ...rows.map((row) => [row.email,row.display_name,row.contact_type,row.status,row.source,row.notes,row.assigned_name,row.created_at].map(cell).join(','))].join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="art-world-crm.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(`\uFEFF${csv}`);
    return true;
  }
  if (method === 'POST' && pathname === '/api/admin/crm/newsletter/send') {
    checkSameOrigin(req);
    const input = await readJson(req, 30_000);
    const subject = String(input.subject || '').trim().slice(0, 180);
    const body = String(input.body || '').trim().slice(0, 20_000);
    if (subject.length < 2 || body.length < 5) throw new HttpError(400, 'E-posta konusu ve metni gerekli.');
    const site = process.env.SITE_URL || '';
    if (!/^https:\/\//i.test(site)) throw new HttpError(503, 'E-posta içindeki abonelikten ayrılma bağlantısı için .env dosyasına HTTPS SITE_URL girin.');
    const credentials = await gmailCredentials();
    if (!credentials) throw new HttpError(503, 'Bülten göndermek için yönetici Google Gmail entegrasyonunu ayarlamalı.');
    const accessToken = await gmailAccessToken(credentials);
    const { rows: contacts } = await pool.query(
      `SELECT c.id, c.email FROM crm_contacts c
        WHERE c.contact_type = 'newsletter' AND c.status <> 'unsubscribed'
          AND (SELECT ce.action FROM crm_consent_events ce WHERE ce.contact_id = c.id AND ce.purpose = 'newsletter' ORDER BY ce.recorded_at DESC LIMIT 1) = 'granted'
        ORDER BY c.created_at LIMIT 250`
    );
    let sent = 0; let failed = 0;
    for (let index = 0; index < contacts.length; index += 1) {
      const contact = contacts[index];
      const rawToken = randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO newsletter_tokens (contact_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'unsubscribe', NOW() + INTERVAL '10 years')`, [contact.id, createHash('sha256').update(rawToken).digest('hex')]);
      const unsubscribeUrl = `${site.replace(/\/$/, '')}/bulten/ayril?token=${encodeURIComponent(rawToken)}`;
      try { await sendGmail(credentials, accessToken, contact.email, subject, `${body}\n\nBülten aboneliğinden ayrıl: ${unsubscribeUrl}`); sent += 1; }
      catch (error) { failed = contacts.length - sent; console.error(`Bülten e-postası gönderilemedi (${contact.id}):`, error.message); break; }
    }
    await pool.query(`INSERT INTO audit_logs (actor_id, action, entity_type, after_data) VALUES ($1, 'newsletter.sent', 'newsletter', $2::jsonb)`, [user.id, JSON.stringify({ sent, failed, total: contacts.length, subject })]);
    return sendJson(res, 200, { sent, failed, total: contacts.length });
  }
  if (method === 'GET' && pathname === '/api/admin/crm') {
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    const status = String(url.searchParams.get('status') || '').trim();
    const type = String(url.searchParams.get('type') || '').trim();
    const filters = []; const values = [];
    if (query) { values.push(`%${query}%`); filters.push(`(c.email ILIKE $${values.length} OR c.display_name ILIKE $${values.length} OR c.notes ILIKE $${values.length})`); }
    if (['open', 'in_progress', 'resolved', 'unsubscribed'].includes(status)) { values.push(status); filters.push(`c.status = $${values.length}`); }
    if (['newsletter', 'advertising_lead', 'reader_feedback', 'correction_request'].includes(type)) { values.push(type); filters.push(`c.contact_type = $${values.length}`); }
    const [contacts, summary, staffList] = await Promise.all([
      pool.query(
        `SELECT c.id, c.email, c.display_name, c.contact_type, c.status, c.source, c.notes, c.created_at, c.assigned_to,
                u.display_name AS assigned_name,
                (SELECT ce.action FROM crm_consent_events ce WHERE ce.contact_id = c.id ORDER BY ce.recorded_at DESC LIMIT 1) AS consent_status
           FROM crm_contacts c LEFT JOIN users u ON u.id = c.assigned_to
           ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
          ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 200`, values
      ),
      pool.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int AS open,
        COUNT(*) FILTER (WHERE contact_type = 'advertising_lead')::int AS advertising_leads,
        (SELECT COUNT(*)::int FROM crm_contacts c WHERE c.contact_type = 'newsletter' AND (SELECT ce.action FROM crm_consent_events ce WHERE ce.contact_id = c.id AND ce.purpose = 'newsletter' ORDER BY ce.recorded_at DESC LIMIT 1) = 'granted') AS newsletter_consents
        FROM crm_contacts`),
      pool.query(`SELECT id, display_name FROM users WHERE is_active = TRUE AND role IN ('admin', 'crm_manager') ORDER BY display_name`)
    ]);
    return sendJson(res, 200, { contacts: contacts.rows, summary: summary.rows[0], staff: staffList.rows });
  }
  if (method === 'POST' && pathname === '/api/admin/crm') {
    checkSameOrigin(req);
    const input = await readJson(req);
    const email = String(input.email || '').trim().toLowerCase();
    const displayName = String(input.displayName || '').trim().slice(0, 120);
    const type = String(input.contactType || 'reader_feedback');
    const notes = String(input.notes || '').trim().slice(0, 5000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Geçerli e-posta adresi girin.');
    if (!['newsletter', 'advertising_lead', 'reader_feedback', 'correction_request'].includes(type)) throw new HttpError(400, 'Kayıt türü geçersiz.');
    const { rows } = await pool.query(`INSERT INTO crm_contacts (email, display_name, contact_type, source, notes, assigned_to) VALUES ($1, $2, $3, 'admin', $4, $5) RETURNING id, email, display_name, contact_type, status, source, notes, created_at`, [email, displayName, type, notes, user.id]);
    if (type === 'newsletter' && input.consent === true) await pool.query(`INSERT INTO crm_consent_events (contact_id, purpose, action, notice_version, source) VALUES ($1, 'newsletter', 'granted', $2, 'admin')`, [rows[0].id, String(input.noticeVersion || 'v1').slice(0, 40)]);
    await pool.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, 'crm.contact.created', 'crm_contact', $2, $3::jsonb)`, [user.id, rows[0].id, JSON.stringify({ email, contactType: type })]);
    return sendJson(res, 201, { contact: rows[0] });
  }
  const match = pathname.match(/^\/api\/admin\/crm\/(\d+)$/);
  if (method === 'PATCH' && match) {
    checkSameOrigin(req);
    const input = await readJson(req);
    const status = String(input.status || '');
    if (!['open', 'in_progress', 'resolved', 'unsubscribed'].includes(status)) throw new HttpError(400, 'CRM durumu geçersiz.');
    let assignedTo = null;
    const hasAssignee = Object.hasOwn(input, 'assignedTo');
    if (hasAssignee && input.assignedTo !== null && input.assignedTo !== '') {
      assignedTo = Number(input.assignedTo);
      if (!Number.isSafeInteger(assignedTo) || assignedTo < 1) throw new HttpError(400, 'Atanan kullanıcı seçimi geçersiz.');
      const assignee = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND is_active = TRUE AND role IN ('admin', 'crm_manager')`, [assignedTo]);
      if (!assignee.rowCount) throw new HttpError(400, 'Seçilen kullanıcı CRM kaydı almaya uygun değil.');
    }
    const { rows } = await pool.query('UPDATE crm_contacts SET status = $2, notes = COALESCE($3, notes), assigned_to = CASE WHEN $4 THEN $5 ELSE assigned_to END, updated_at = NOW() WHERE id = $1 RETURNING id, status, notes, assigned_to', [match[1], status, typeof input.notes === 'string' ? input.notes.trim().slice(0, 5000) : null, hasAssignee, assignedTo]);
    if (!rows[0]) throw new HttpError(404, 'CRM kaydı bulunamadı.');
    if (status === 'unsubscribed') {
      await pool.query(`INSERT INTO crm_consent_events (contact_id, purpose, action, notice_version, source) SELECT $1, 'newsletter', 'withdrawn', 'v1', 'admin' WHERE EXISTS (SELECT 1 FROM crm_contacts WHERE id = $1 AND contact_type = 'newsletter') AND (SELECT action FROM crm_consent_events WHERE contact_id = $1 AND purpose = 'newsletter' ORDER BY recorded_at DESC LIMIT 1) = 'granted'`, [rows[0].id]);
      await pool.query(`UPDATE newsletter_tokens SET consumed_at = NOW() WHERE contact_id = $1 AND consumed_at IS NULL`, [rows[0].id]);
    }
    await pool.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, 'crm.contact.updated', 'crm_contact', $2, $3::jsonb)`, [user.id, rows[0].id, JSON.stringify({ status })]);
    return sendJson(res, 200, rows[0]);
  }
  if (method === 'DELETE' && match) {
    // KVKK veri silme: yalnız yönetici. Çocuk kayıtlar önce silinir; e-posta denetim kaydına yazılmaz.
    checkSameOrigin(req);
    requireRole(user, integrationRoles);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: contactRows } = await client.query('SELECT id, contact_type, status FROM crm_contacts WHERE id = $1 FOR UPDATE', [match[1]]);
      const contact = contactRows[0];
      if (!contact) throw new HttpError(404, 'CRM kaydı bulunamadı.');
      await client.query('DELETE FROM newsletter_tokens WHERE contact_id = $1', [contact.id]);
      await client.query('DELETE FROM crm_consent_events WHERE contact_id = $1', [contact.id]);
      await client.query('DELETE FROM crm_contacts WHERE id = $1', [contact.id]);
      await client.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data) VALUES ($1, 'crm.contact.deleted', 'crm_contact', $2, $3::jsonb)`, [user.id, contact.id, JSON.stringify({ contactType: contact.contact_type, status: contact.status })]);
      await client.query('COMMIT');
      return sendJson(res, 200, { ok: true });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return false;
}

function slugify(text) {
  return text.toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180) || 'haber';
}

function validateArticle(input) {
  const headline = typeof input.headline === 'string' ? input.headline.trim() : '';
  const standfirst = typeof input.standfirst === 'string' ? input.standfirst.trim() : '';
  const bodyText = typeof input.body === 'string' ? input.body.trim() : '';
  if (headline.length < 8 || headline.length > 220) throw new HttpError(400, 'Başlık 8-220 karakter olmalı.');
  if (standfirst.length > 500) throw new HttpError(400, 'Spot en fazla 500 karakter olabilir.');
  if (bodyText.length > 50_000) throw new HttpError(400, 'Haber metni en fazla 50.000 karakter olabilir.');
  let coverMediaId = null;
  if (input.coverMediaId !== undefined && input.coverMediaId !== null && input.coverMediaId !== '') {
    coverMediaId = Number(input.coverMediaId);
    if (!Number.isSafeInteger(coverMediaId) || coverMediaId < 1) throw new HttpError(400, 'Kapak görseli seçimi geçersiz.');
  }
  let categoryId = null;
  if (input.categoryId !== undefined && input.categoryId !== null && input.categoryId !== '') {
    categoryId = Number(input.categoryId);
    if (!Number.isSafeInteger(categoryId) || categoryId < 1) throw new HttpError(400, 'Kategori seçimi geçersiz.');
  }
  const categoryIds = [...new Set((Array.isArray(input.categoryIds) ? input.categoryIds : []).map((id) => Number(id)))];
  if (categoryIds.some((id) => !Number.isSafeInteger(id) || id < 1) || categoryIds.length > 12) throw new HttpError(400, 'Ek kategori seçimi geçersiz.');
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',')).map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 10);
  if (tags.some((tag) => tag.length > 60)) throw new HttpError(400, 'Etiketler en fazla 60 karakter olabilir.');
  const homepageSliderSlot = ['auto', 'main', 'side_top', 'side_bottom', 'none'].includes(input.homepageSliderSlot) ? input.homepageSliderSlot : 'auto';
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.scheduledAt && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw new HttpError(400, 'Planlanan yayın tarihi geçersiz.');
  for (const [key, max] of [['sourceName', 180], ['sourceUrl', 1000], ['seoTitle', 220], ['seoDescription', 320], ['coverAltText', 240]]) {
    if (typeof input[key] === 'string' && input[key].length > max) throw new HttpError(400, `${key} alanı çok uzun.`);
  }
  const status = input.status === undefined ? 'draft' : input.status;
  if (!['draft', 'in_review'].includes(status)) throw new HttpError(400, 'Yeni haber taslağı yalnızca taslakta veya incelemede başlayabilir.');
  return { headline, standfirst, bodyText, categoryId, categoryIds: categoryIds.filter((id) => id !== categoryId), tags,
    coverMediaId, coverAltText: String(input.coverAltText || '').trim(), homepageSliderSlot,
    isBreaking: input.isBreaking === true, isInBriefing: input.isInBriefing !== false, isInLatest: input.isInLatest !== false,
    scheduledAt, sourceName: String(input.sourceName || '').trim(), sourceUrl: String(input.sourceUrl || '').trim(),
    seoTitle: String(input.seoTitle || '').trim(), seoDescription: String(input.seoDescription || '').trim(), status };
}

function articleSnapshot(article) {
  return {
    headline: article.headline,
    standfirst: article.standfirst,
    body: article.body,
    status: article.status,
    primary_category_id: article.primary_category_id,
    cover_media_id: article.cover_media_id,
    homepage_slider_slot: article.homepage_slider_slot, is_breaking: article.is_breaking,
    is_in_briefing: article.is_in_briefing, is_in_latest: article.is_in_latest, scheduled_at: article.scheduled_at,
    source_name: article.source_name, source_url: article.source_url, seo_title: article.seo_title, seo_description: article.seo_description
  };
}

function imageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

function imageDimensions(buffer, mime) {
  if (mime === 'image/png' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (mime === 'image/jpeg') {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 1; continue; }
      if (offset + 3 >= buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset + 1);
      if (segmentLength < 2 || offset + 1 + segmentLength > buffer.length) break;
      if (startOfFrame.has(marker) && segmentLength >= 7) return { height: buffer.readUInt16BE(offset + 4), width: buffer.readUInt16BE(offset + 6) };
      offset += 1 + segmentLength;
    }
  }
  if (mime === 'image/webp' && buffer.length >= 30) {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && buffer[20] === 0x2f) {
      const b1 = buffer[21]; const b2 = buffer[22]; const b3 = buffer[23]; const b4 = buffer[24];
      return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
    }
  }
  return { width: null, height: null };
}

async function uploadMedia(user, req) {
  requireRole(user, new Set([...writers, ...adRoles]));
  checkSameOrigin(req);
  const input = await readJson(req, 8_500_000);
  const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : '';
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new HttpError(400, 'PNG, JPEG veya WebP biçiminde geçerli bir görsel seçin.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES || bytes.toString('base64') !== match[2]) {
    throw new HttpError(413, 'Görsel 6 MB sınırını aşmamalı ve geçerli olmalı.');
  }
  const detected = imageType(bytes);
  if (!detected || detected.mime !== `image/${match[1]}`) throw new HttpError(400, 'Dosya içeriği seçilen görsel türüyle eşleşmiyor.');

  const safeName = (typeof input.originalName === 'string' ? input.originalName : 'kapak-gorseli')
    .replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '-').trim().slice(0, 160) || 'kapak-gorseli';
  const storageKey = `${randomBytes(20).toString('hex')}.${detected.extension}`;
  await fs.mkdir(mediaDir, { recursive: true });
  const filePath = path.join(mediaDir, storageKey);
  await fs.writeFile(filePath, bytes, { flag: 'wx', mode: 0o640 });
  try {
    const { width, height } = imageDimensions(bytes, detected.mime);
    const { rows } = await pool.query(
      `INSERT INTO media_assets (storage_key, original_name, mime_type, byte_size, width, height, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, storage_key, original_name, mime_type, byte_size, width, height, created_at`,
      [storageKey, safeName, detected.mime, bytes.length, width, height, user.id]
    );
    return rows[0];
  } catch (error) {
    await fs.unlink(filePath).catch(() => {});
    throw error;
  }
}

function loginBucket(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + 15 * 60_000 };
    loginAttempts.set(ip, fresh);
    return fresh;
  }
  return current;
}

async function login(req, res) {
  checkSameOrigin(req);
  const ip = req.socket.remoteAddress || 'unknown';
  const bucket = loginBucket(ip);
  if (bucket.count >= 8) throw new HttpError(429, 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.');
  bucket.count += 1;

  const input = await readJson(req);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const result = await pool.query(
    'SELECT id, email, display_name, role, password_hash FROM users WHERE LOWER(email) = $1 AND is_active = TRUE',
    [email]
  );
  const user = result.rows[0];
  const passwordHash = user?.password_hash || await dummyPasswordHash;
  const validPassword = password.length <= 256 && await verifyPassword(password, passwordHash);
  const valid = Boolean(user && validPassword);
  if (!valid) throw new HttpError(401, 'E-posta veya parola hatalı.');

  bucket.count = 0;
  // "Beni hatırla": 30 günlük oturum; aksi halde varsayılan kısa oturum.
  const sessionHours = input.remember === true ? REMEMBER_SESSION_HOURS : SESSION_HOURS;
  const token = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  await pool.query(
    'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + ($3 * INTERVAL \'1 hour\'))',
    [user.id, hashToken(token), sessionHours]
  );
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  setSessionCookie(res, token, sessionHours);
  sendJson(res, 200, { user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role, roleLabel: roles[user.role] } });
}

async function articleList(user, url) {
  requireRole(user, writers);
  const status = url.searchParams.get('status');
  if (status && !articleStatuses.has(status)) throw new HttpError(400, 'Durum filtresi geçersiz.');
  const filters = [];
  const values = [];
  if (status) { values.push(status); filters.push(`a.status = $${values.length}`); }
  if (user.role === 'reporter') {
    values.push(user.id);
    filters.push(`(a.author_id = $${values.length} OR a.created_by = $${values.length})`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.headline, a.standfirst, a.status, a.is_breaking,
            a.created_at, a.updated_at, a.published_at,
            u.display_name AS author_name, c.name AS category_name
       FROM articles a
       LEFT JOIN users u ON u.id = a.author_id
       LEFT JOIN categories c ON c.id = a.primary_category_id
       ${where}
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 500`, values
  );
  return rows;
}

async function createArticle(user, req) {
  requireRole(user, writers);
  checkSameOrigin(req);
  const input = validateArticle(await readJson(req));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryIds = [...new Set([input.categoryId, ...input.categoryIds].filter(Boolean))];
    if (categoryIds.length) {
      const category = await client.query('SELECT id FROM categories WHERE id = ANY($1::bigint[]) AND is_active = TRUE', [categoryIds]);
      if (category.rowCount !== categoryIds.length) throw new HttpError(400, 'Seçilen kategorilerden biri kullanılamıyor.');
    }
    if (input.coverMediaId) {
      const media = await client.query('SELECT 1 FROM media_assets WHERE id = $1 AND ($2::boolean OR uploaded_by = $3)', [input.coverMediaId, editors.has(user.role), user.id]);
      if (!media.rowCount) throw new HttpError(400, 'Kapak görseli bulunamadı veya bu görseli kullanma yetkiniz yok.');
    }
    const baseSlug = slugify(input.headline);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`article-slug:${baseSlug}`]);
    let slug = baseSlug;
    let suffix = 2;
    while ((await client.query('SELECT 1 FROM articles WHERE slug = $1', [slug])).rowCount) {
      slug = `${baseSlug.slice(0, 175)}-${suffix++}`;
    }
    const body = input.bodyText ? [{ type: 'paragraph', text: input.bodyText }] : [];
    const created = await client.query(
      `INSERT INTO articles
        (slug, headline, standfirst, body, status, primary_category_id, cover_media_id, author_id, created_by, updated_by,
         homepage_slider_slot, is_breaking, is_in_briefing, is_in_latest, scheduled_at, source_name, source_url, seo_title, seo_description)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $8, $8, $9, $10, $11, $12, NULL, $13, $14, $15, $16)
       RETURNING id, slug, headline, standfirst, status, created_at, updated_at`,
      [slug, input.headline, input.standfirst, JSON.stringify(body), input.status, input.categoryId, input.coverMediaId, user.id,
        input.homepageSliderSlot, input.isBreaking, input.isInBriefing, input.isInLatest, input.sourceName, input.sourceUrl, input.seoTitle, input.seoDescription]
    );
    const article = created.rows[0];
    if (categoryIds.length) await client.query('INSERT INTO article_categories (article_id, category_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [article.id, categoryIds]);
    for (const tag of input.tags) {
      const tagSlug = slugify(tag);
      const { rows: tagRows } = await client.query('INSERT INTO tags (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id', [tag, tagSlug === 'haber' ? `haber-${Date.now()}` : tagSlug]);
      await client.query('INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [article.id, tagRows[0].id]);
    }
    if (input.coverMediaId && input.coverAltText) await client.query('UPDATE media_assets SET alt_text = $2 WHERE id = $1', [input.coverMediaId, input.coverAltText]);
    await client.query(
      'INSERT INTO article_workflow_events (article_id, to_status, note, actor_id) VALUES ($1, $2, $3, $4)',
      [article.id, input.status, input.status === 'in_review' ? 'Editör incelemesine gönderildi' : 'Taslak oluşturuldu', user.id]
    );
    await client.query(
      'INSERT INTO article_revisions (article_id, revision_number, snapshot, change_note, created_by) VALUES ($1, 1, $2::jsonb, $3, $4)',
      [article.id, JSON.stringify({ headline: input.headline, standfirst: input.standfirst, body, status: input.status, primary_category_id: input.categoryId, cover_media_id: input.coverMediaId, ...input }), 'İlk taslak', user.id]
    );
    await client.query(
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [user.id, 'article.created', 'article', article.id, JSON.stringify({ headline: article.headline, status: article.status })]
    );
    await client.query('COMMIT');
    return article;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function articleIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/articles\/(\d+)$/);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) throw new HttpError(404, 'Haber bulunamadı.');
  return match[1];
}

async function getArticle(user, articleId) {
  requireRole(user, writers);
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.headline, a.standfirst, a.body, a.status,
            a.primary_category_id, a.cover_media_id, m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text,
            a.homepage_slider_slot, a.is_breaking, a.is_in_briefing, a.is_in_latest, a.scheduled_at,
            a.source_name, a.source_url, a.seo_title, a.seo_description,
            a.created_at, a.updated_at, a.published_at,
            u.display_name AS author_name, c.name AS category_name
       FROM articles a
       LEFT JOIN media_assets m ON m.id = a.cover_media_id
       LEFT JOIN users u ON u.id = a.author_id
       LEFT JOIN categories c ON c.id = a.primary_category_id
      WHERE a.id = $1 AND ($2::boolean OR a.author_id = $3 OR a.created_by = $3)`,
    [articleId, editors.has(user.role), user.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Haber bulunamadı.');
  const article = rows[0];
  const [{ rows: categoryRows }, { rows: tagRows }] = await Promise.all([
    pool.query('SELECT category_id FROM article_categories WHERE article_id = $1 ORDER BY category_id', [articleId]),
    pool.query('SELECT t.name FROM article_tags at JOIN tags t ON t.id = at.tag_id WHERE at.article_id = $1 ORDER BY t.name', [articleId])
  ]);
  const { rows: revisions } = await pool.query(
    `SELECT r.revision_number, r.change_note, r.created_at, u.display_name AS author_name
       FROM article_revisions r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.article_id = $1 ORDER BY r.revision_number DESC LIMIT 10`, [articleId]
  );
  const body = Array.isArray(article.body)
    ? article.body.map((block) => typeof block?.text === 'string' ? block.text : '').filter(Boolean).join('\n\n')
    : typeof article.body === 'string' ? article.body : '';
  return { ...article, category_ids: categoryRows.map((row) => Number(row.category_id)), tags: tagRows.map((row) => row.name), body, cover_url: article.cover_storage_key ? `/media/${article.cover_storage_key}` : '', revisions };
}

async function updateArticle(user, req, articleId) {
  requireRole(user, writers);
  checkSameOrigin(req);
  const input = await readJson(req);
  if (!articleStatuses.has(input.status)) throw new HttpError(400, 'Yeni yayın durumu geçersiz.');
  // Validate content here; update transitions and scheduling permissions are checked below.
  const validated = validateArticle({ ...input, status: 'draft' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, slug, headline, standfirst, body, status, primary_category_id, cover_media_id, author_id, created_by, published_at,
              homepage_slider_slot, is_breaking, is_in_briefing, is_in_latest, scheduled_at, source_name, source_url, seo_title, seo_description
         FROM articles WHERE id = $1 FOR UPDATE`, [articleId]
    );
    const before = result.rows[0];
    if (!before || (!editors.has(user.role) && before.author_id !== user.id && before.created_by !== user.id)) {
      throw new HttpError(404, 'Haber bulunamadı.');
    }

    const isPublisher = publishers.has(user.role);
    const allowedTransitions = isPublisher ? {
      draft: ['draft', 'in_review'],
      in_review: ['in_review', 'draft', 'approved', 'scheduled'],
      approved: ['approved', 'draft', 'published', 'scheduled'],
      scheduled: ['scheduled', 'approved', 'published', 'archived'],
      published: ['published', 'archived'],
      archived: ['archived', 'draft']
    } : editors.has(user.role) ? {
      draft: ['draft', 'in_review'],
      in_review: ['in_review', 'draft'],
      approved: ['in_review'],
      scheduled: ['in_review'],
      published: ['in_review'],
      archived: ['draft', 'in_review']
    } : {
      draft: ['draft', 'in_review'],
      in_review: ['draft']
    };
    if (!allowedTransitions[before.status]?.includes(input.status)) {
      throw new HttpError(409, isPublisher ? 'Bu yayın durumu geçişine izin verilmiyor.' : 'Bu içerik için editör onayı gerekiyor.');
    }
    if (input.status === 'scheduled' && (!isPublisher || !validated.scheduledAt || validated.scheduledAt <= new Date())) throw new HttpError(400, 'Planlı yayın için gelecekteki bir tarih ve yayın yetkisi gerekli.');
    if (input.status !== 'scheduled' && validated.scheduledAt && !['admin', 'editor_in_chief'].includes(user.role)) throw new HttpError(403, 'Yayın planını yalnızca yayın yetkili editör değiştirebilir.');
    if (input.status === 'approved' || input.status === 'published' || input.status === 'archived') {
      requireRole(user, publishers);
    }
    const categoryIds = [...new Set([validated.categoryId, ...validated.categoryIds].filter(Boolean))];
    if (categoryIds.length) {
      const category = await client.query('SELECT id FROM categories WHERE id = ANY($1::bigint[]) AND is_active = TRUE', [categoryIds]);
      if (category.rowCount !== categoryIds.length) throw new HttpError(400, 'Seçilen kategorilerden biri kullanılamıyor.');
    }
    if (validated.coverMediaId) {
      const media = await client.query('SELECT 1 FROM media_assets WHERE id = $1 AND ($2::boolean OR uploaded_by = $3)', [validated.coverMediaId, editors.has(user.role), user.id]);
      if (!media.rowCount) throw new HttpError(400, 'Kapak görseli bulunamadı veya bu görseli kullanma yetkiniz yok.');
    }

    const snapshot = articleSnapshot(before);
    const { rows: revisionRows } = await client.query(
      'SELECT COALESCE(MAX(revision_number), 0)::int + 1 AS next_revision FROM article_revisions WHERE article_id = $1', [articleId]
    );
    const revisionNumber = revisionRows[0].next_revision;
    await client.query(
      `INSERT INTO article_revisions (article_id, revision_number, snapshot, change_note, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [articleId, revisionNumber, JSON.stringify(snapshot), String(input.changeNote || '').trim().slice(0, 300) || 'Düzenleme öncesi sürüm', user.id]
    );
    const body = validated.bodyText ? [{ type: 'paragraph', text: validated.bodyText }] : [];
    const { rows: updatedRows } = await client.query(
      `UPDATE articles
          SET headline = $2, standfirst = $3, body = $4::jsonb,
              primary_category_id = $5, cover_media_id = $6, status = $7, updated_by = $8, updated_at = NOW(),
              homepage_slider_slot = $9, is_breaking = $10, is_in_briefing = $11, is_in_latest = $12,
              scheduled_at = CASE WHEN $7 = 'scheduled' THEN $13::timestamptz ELSE NULL END,
              source_name = $14, source_url = $15, seo_title = $16, seo_description = $17,
              published_at = CASE WHEN $7 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
              archived_at = CASE WHEN $7 = 'archived' THEN NOW() WHEN $7 = 'draft' THEN NULL ELSE archived_at END
        WHERE id = $1
        RETURNING id, slug, headline, standfirst, status, created_at, updated_at, published_at`,
      [articleId, validated.headline, validated.standfirst, JSON.stringify(body), validated.categoryId, validated.coverMediaId, input.status, user.id,
        validated.homepageSliderSlot, validated.isBreaking, validated.isInBriefing, validated.isInLatest, validated.scheduledAt,
        validated.sourceName, validated.sourceUrl, validated.seoTitle, validated.seoDescription]
    );
    await client.query('DELETE FROM article_categories WHERE article_id = $1', [articleId]);
    if (categoryIds.length) await client.query('INSERT INTO article_categories (article_id, category_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [articleId, categoryIds]);
    await client.query('DELETE FROM article_tags WHERE article_id = $1', [articleId]);
    for (const tag of validated.tags) {
      const tagSlug = slugify(tag);
      const { rows: tagRows } = await client.query('INSERT INTO tags (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id', [tag, tagSlug === 'haber' ? `haber-${Date.now()}` : tagSlug]);
      await client.query('INSERT INTO article_tags (article_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [articleId, tagRows[0].id]);
    }
    if (validated.coverMediaId) await client.query('UPDATE media_assets SET alt_text = $2 WHERE id = $1', [validated.coverMediaId, validated.coverAltText]);
    if (before.status !== input.status) {
      const note = String(input.changeNote || '').trim().slice(0, 300);
      await client.query(
        'INSERT INTO article_workflow_events (article_id, from_status, to_status, note, actor_id) VALUES ($1, $2, $3, $4, $5)',
        [articleId, before.status, input.status, note || 'Yayın durumu güncellendi', user.id]
      );
    }
    await client.query(
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)',
      [user.id, 'article.updated', 'article', articleId, JSON.stringify({ ...snapshot, slug: before.slug }), JSON.stringify({ headline: validated.headline, status: input.status, primary_category_id: validated.categoryId })]
    );
    await client.query('COMMIT');
    return updatedRows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function publishScheduledArticles() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status FROM articles WHERE status = 'scheduled' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 50 FOR UPDATE SKIP LOCKED`
    );
    for (const article of rows) {
      await client.query("UPDATE articles SET status = 'published', published_at = COALESCE(published_at, scheduled_at, NOW()), scheduled_at = NULL, updated_at = NOW() WHERE id = $1", [article.id]);
      await client.query("INSERT INTO article_workflow_events (article_id, from_status, to_status, note) VALUES ($1, 'scheduled', 'published', 'Planlanan saatte otomatik yayımlandı')", [article.id]);
      await client.query("INSERT INTO audit_logs (action, entity_type, entity_id, after_data) VALUES ('article.scheduled_published', 'article', $1, $2::jsonb)", [article.id, JSON.stringify({ status: 'published' })]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function summary(user) {
  requireRole(user, staff);
  const canSeeArticles = writers.has(user.role);
  const ownOnly = user.role === 'reporter';
  const canSeeAds = ['admin', 'ad_sales'].includes(user.role);
  const canSeeCrm = ['admin', 'crm_manager'].includes(user.role);
  const params = ownOnly ? [user.id] : [];
  const articleWhere = ownOnly ? 'WHERE author_id = $1 OR created_by = $1' : '';
  const { rows: articleRows } = canSeeArticles
    ? await pool.query(`SELECT status, COUNT(*)::int AS count FROM articles ${articleWhere} GROUP BY status`, params)
    : { rows: [] };
  const articleCounts = Object.fromEntries(articleRows.map((row) => [row.status, row.count]));
  const [{ rows: otherRows }, categoriesResult] = await Promise.all([
    pool.query(`SELECT
      ${canSeeArticles ? `(SELECT COUNT(*)::int FROM articles WHERE created_at >= CURRENT_DATE${ownOnly ? ' AND (author_id = $1 OR created_by = $1)' : ''})` : '0::int'} AS today_articles,
      ${canSeeAds ? "(SELECT COUNT(*)::int FROM ad_campaigns WHERE status = 'active')" : 'NULL::int'} AS active_campaigns,
      ${canSeeAds ? "(SELECT COUNT(*)::int FROM ad_campaigns WHERE status = 'awaiting_approval')" : 'NULL::int'} AS pending_campaigns,
      ${canSeeAds ? '(SELECT COUNT(*)::int FROM ad_placements WHERE is_active = TRUE)' : 'NULL::int'} AS active_placements,
      ${canSeeCrm ? '(SELECT COUNT(*)::int FROM crm_contacts)' : 'NULL::int'} AS crm_contacts,
      ${canSeeCrm ? "(SELECT COUNT(*)::int FROM crm_contacts WHERE status IN ('open', 'in_progress'))" : 'NULL::int'} AS open_contacts`, params),
    canSeeArticles
      ? pool.query('SELECT id, name FROM categories WHERE is_active = TRUE ORDER BY sort_order, name')
      : Promise.resolve({ rows: [] })
  ]);
  return {
    articles: canSeeArticles ? { ...articleCounts, today: otherRows[0].today_articles } : null,
    advertising: canSeeAds ? { active: otherRows[0].active_campaigns, pending: otherRows[0].pending_campaigns, placements: otherRows[0].active_placements } : null,
    crm: canSeeCrm ? { total: otherRows[0].crm_contacts, open: otherRows[0].open_contacts } : null,
    categories: categoriesResult.rows
  };
}

async function recordAdDelivery(ad, eventType) {
  const client = await pool.connect();
  const impression = eventType === 'impression' ? 1 : 0;
  const click = eventType === 'click' ? 1 : 0;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO ad_delivery_events (campaign_id, placement_id, creative_id, event_type)
       VALUES ($1, $2, $3, $4)`, [ad.campaign_id, ad.placement_id, ad.creative_id, eventType]
    );
    await client.query(
      `INSERT INTO ad_delivery_daily_archive
         (archive_date, campaign_id, placement_id, creative_id, regulatory_reference,
          campaign_name, advertiser_name, placement_key, placement_name, placement_format,
          creative_headline, target_url, storage_key, media_width, media_height, impressions, clicks)
       VALUES ((NOW() AT TIME ZONE 'Europe/Istanbul')::date, $1, $2, $3, $4,
               $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (archive_date, campaign_id, placement_id, creative_id) DO UPDATE SET
         impressions = ad_delivery_daily_archive.impressions + EXCLUDED.impressions,
         clicks = ad_delivery_daily_archive.clicks + EXCLUDED.clicks,
         last_seen_at = NOW()`,
      [ad.campaign_id, ad.placement_id, ad.creative_id, ad.regulatory_reference || '', ad.campaign_name,
        ad.advertiser_name, ad.placement_key, ad.placement_name, ad.placement_format, ad.creative_headline,
        ad.target_url, ad.storage_key, ad.media_width, ad.media_height, impression, click]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function handleApi(req, res, pathname, url) {
  try {
    if (req.method === 'GET' && pathname === '/api/public/briefing-widgets') {
      return sendJson(res, 200, await briefingWidgetData());
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') return await login(req, res);
    if (req.method === 'POST' && pathname === '/api/newsletter/subscribe') {
      checkSameOrigin(req);
      const input = await readJson(req);
      const email = String(input.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Geçerli e-posta adresi girin.');
      if (input.consent !== true) throw new HttpError(400, 'Bültene kaydolmak için veri işleme iznini onaylayın.');
      checkNewsletterRateLimit(req, email);
      const site = process.env.SITE_URL || '';
      const credentials = /^https:\/\//i.test(site) ? await gmailCredentials() : null;
      if (!credentials || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials['sender-email'])) throw new HttpError(503, 'Bülten doğrulama e-postası şu anda kullanılamıyor.');
      const accessToken = await gmailAccessToken(credentials);
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const client = await pool.connect();
      let contact;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`newsletter:${email}`]);
        const existing = await client.query(`SELECT id FROM crm_contacts WHERE LOWER(email) = $1 AND contact_type = 'newsletter' ORDER BY id LIMIT 1 FOR UPDATE`, [email]);
        if (existing.rows[0]) {
          contact = existing.rows[0];
        } else {
          const inserted = await client.query(`INSERT INTO crm_contacts (email, contact_type, source, status) VALUES ($1, 'newsletter', 'public-site', 'unsubscribed') RETURNING id`, [email]);
          contact = inserted.rows[0];
        }
        await client.query(`INSERT INTO newsletter_tokens (contact_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'confirm', NOW() + INTERVAL '24 hours')`, [contact.id, tokenHash]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      try {
        const confirmUrl = `${site.replace(/\/$/, '')}/bulten/onayla?token=${encodeURIComponent(rawToken)}`;
        await sendGmail(credentials, accessToken, email, 'Art World TV bülten aboneliğini doğrulayın', `Bülten aboneliğinizi doğrulamak için bağlantıyı açın:\n\n${confirmUrl}\n\nİstek size ait değilse bu e-postayı dikkate almayın.`);
      } catch (error) {
        await pool.query('DELETE FROM newsletter_tokens WHERE token_hash = $1', [tokenHash]);
        console.error('Bülten doğrulama e-postası gönderilemedi:', error.message);
        throw new HttpError(503, 'Doğrulama e-postası gönderilemedi. Lütfen daha sonra tekrar deneyin.');
      }
      return sendJson(res, 202, { ok: true });
    }
    if (req.method === 'POST' && ['/api/newsletter/confirm', '/api/newsletter/unsubscribe'].includes(pathname)) {
      checkSameOrigin(req);
      const input = await readJson(req);
      const token = String(input.token || '');
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new HttpError(400, 'Bağlantı geçersiz veya süresi dolmuş.');
      const purpose = pathname.endsWith('/confirm') ? 'confirm' : 'unsubscribe';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT id, contact_id FROM newsletter_tokens WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > NOW() FOR UPDATE`, [createHash('sha256').update(token).digest('hex'), purpose]);
        if (!rows[0]) throw new HttpError(400, 'Bağlantı geçersiz veya süresi dolmuş.');
        const contactId = rows[0].contact_id;
        await client.query('SELECT id FROM crm_contacts WHERE id = $1 FOR UPDATE', [contactId]);
        await client.query('UPDATE crm_contacts SET status = $2, updated_at = NOW() WHERE id = $1', [contactId, purpose === 'confirm' ? 'open' : 'unsubscribed']);
        await client.query(`INSERT INTO crm_consent_events (contact_id, purpose, action, notice_version, source) VALUES ($1, 'newsletter', $2, 'newsletter-v1', $3)`, [contactId, purpose === 'confirm' ? 'granted' : 'withdrawn', purpose === 'confirm' ? 'confirmation-link' : 'unsubscribe-link']);
        await client.query(`UPDATE newsletter_tokens SET consumed_at = NOW() WHERE contact_id = $1 AND consumed_at IS NULL AND (purpose = 'confirm' OR $2 = 'unsubscribe')`, [contactId, purpose]);
        await client.query(`INSERT INTO audit_logs (action, entity_type, entity_id, after_data) VALUES ($1, 'crm_contact', $2, $3::jsonb)`, [purpose === 'confirm' ? 'newsletter.subscribed' : 'newsletter.unsubscribed', contactId, JSON.stringify({ source: purpose + '-link' })]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return sendJson(res, 200, { ok: true });
    }
    const adClick = pathname.match(/^\/api\/ads\/(\d+)\/click$/);
    if (req.method === 'GET' && adClick) {
      const { rows } = await pool.query(
        `SELECT cr.id AS creative_id, cr.target_url, cr.headline AS creative_headline, cr.campaign_id,
                cp.placement_id, c.name AS campaign_name, c.regulatory_reference,
                a.company_name AS advertiser_name, p.placement_key, p.display_name AS placement_name,
                p.format AS placement_format, m.storage_key, m.width AS media_width, m.height AS media_height
           FROM ad_creatives cr JOIN ad_campaigns c ON c.id = cr.campaign_id
           JOIN advertisers a ON a.id = c.advertiser_id
           JOIN ad_campaign_placements cp ON cp.campaign_id = c.id
           JOIN ad_placements p ON p.id = cp.placement_id
           JOIN media_assets m ON m.id = cr.media_id
          WHERE cr.id = $1 AND cr.status = 'approved' AND p.placement_key = $2 AND c.status = 'active'
            AND (c.starts_at IS NULL OR c.starts_at <= NOW()) AND (c.ends_at IS NULL OR c.ends_at > NOW()) LIMIT 1`, [adClick[1], String(url.searchParams.get('placement') || '')]
      );
      if (!rows[0] || !rows[0].target_url.startsWith('https://')) throw new HttpError(404, 'Reklam bulunamadı.');
      if (allowAdEvent(req.socket.remoteAddress, 'click', adClick[1], rows[0].placement_key)) {
        await recordAdDelivery(rows[0], 'click');
      }
      res.writeHead(302, { Location: rows[0].target_url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return res.end();
    }
    const adImpression = pathname.match(/^\/api\/ads\/(\d+)\/impression$/);
    if (req.method === 'GET' && adImpression) {
      const placementKey = String(url.searchParams.get('placement') || '');
      const { rows } = await pool.query(
        `SELECT cr.id AS creative_id, cr.campaign_id, cr.headline AS creative_headline, cr.target_url, c.name AS campaign_name,
                c.regulatory_reference, a.company_name AS advertiser_name, p.id AS placement_id,
                p.placement_key, p.display_name AS placement_name, p.format AS placement_format,
                m.storage_key, m.width AS media_width, m.height AS media_height
           FROM ad_creatives cr
           JOIN ad_campaigns c ON c.id=cr.campaign_id JOIN ad_campaign_placements cp ON cp.campaign_id=c.id
           JOIN advertisers a ON a.id=c.advertiser_id JOIN ad_placements p ON p.id=cp.placement_id
           JOIN media_assets m ON m.id=cr.media_id
          WHERE cr.id=$1 AND cr.status='approved' AND p.placement_key=$2 AND p.is_active=TRUE AND c.status='active'
            AND (c.starts_at IS NULL OR c.starts_at<=NOW()) AND (c.ends_at IS NULL OR c.ends_at>NOW()) LIMIT 1`, [adImpression[1], placementKey]
      );
      if (rows[0] && allowAdEvent(req.socket.remoteAddress, 'impression', adImpression[1], placementKey)) {
        await recordAdDelivery(rows[0], 'impression');
      }
      res.writeHead(rows[0] ? 204 : 404, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end();
    }
    if (req.method === 'GET' && pathname === '/api/auth/session') {
      const user = await getSession(req);
      return sendJson(res, 200, { authenticated: Boolean(user), user: user ? { id: user.id, email: user.email, displayName: user.display_name, role: user.role, roleLabel: roles[user.role] } : null });
    }
    const user = await getSession(req);
    if (!user && pathname.startsWith('/api/admin/')) return sendJson(res, 401, { error: 'Oturum açmanız gerekiyor.' });
    // Tüm yönetim yazma işlemleri (modül dosyaları dahil) tek noktadan kaynak doğrulamasından geçer.
    if (pathname.startsWith('/api/admin/') && !['GET', 'HEAD'].includes(req.method)) checkSameOrigin(req);
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      checkSameOrigin(req);
      const token = cookieValue(req, 'artworld_session');
      if (token) await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/admin/integrations')) {
      const result = await adminIntegrations(user, req, res, req.method, pathname);
      if (result !== false) return result;
    }
    if (pathname === '/api/admin/site-identity') {
      requireRole(user, integrationRoles);
      if (req.method === 'GET') {
        const { rows } = await pool.query('SELECT setting_key, setting_value FROM site_settings');
        return sendJson(res, 200, Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])));
      }
      if (req.method === 'PUT') {
        checkSameOrigin(req);
        const input = await readJson(req, 20_000);
        const allowed = { slogan: 180, logoUrl: 1000, publisher: 240, representative: 140, editorInChief: 140, address: 300, phone: 60, emails: 320, website: 240, uets: 80, hostingProvider: 180, hostingAddress: 300, corporateLinks: 1000 };
        const values = {};
        for (const [key, maxLength] of Object.entries(allowed)) {
          if (typeof input[key] !== 'string') throw new HttpError(400, 'Tüm site kimliği alanları metin olmalı.');
          const value = input[key].trim();
          if (value.length > maxLength) throw new HttpError(400, `Bir alan ${maxLength} karakteri aşamaz.`);
          values[key] = value;
        }
        if (values.phone && !/^[+\d\s().-]{7,60}$/.test(values.phone)) throw new HttpError(400, 'Telefon numarasını kontrol edin.');
        if (values.emails && values.emails.split(',').map((email) => email.trim()).filter(Boolean).some((email) => !/^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(email))) throw new HttpError(400, 'E-posta adreslerini virgülle ayırıp kontrol edin.');
        if (values.website) { let url; try { url = new URL(values.website); } catch {} if (!url || !['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Web sitesi http veya https adresi olmalı.'); }
        if (values.logoUrl && !/^\/media\/[A-Za-z0-9._-]+$/.test(values.logoUrl)) throw new HttpError(400, 'Logo, yüklenmiş bir medya dosyası olmalı.');
        if (values.corporateLinks.split('\n').some((line) => {
          if (!line.trim()) return false;
          const [label, href] = line.split('|').map((part) => part.trim());
          if (!label || !href || /[\s\\\x00-\x1f\x7f<>"']/.test(href)) return true;
          if (href.startsWith('/') && !href.startsWith('//')) return false;
          try { const url = new URL(href); return url.protocol !== 'https:' || Boolean(url.username || url.password); }
          catch { return true; }
        })) throw new HttpError(400, 'Bağlantıları Görünen ad | /site-yolu biçiminde girin.');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { rows: beforeRows } = await client.query('SELECT setting_key, setting_value FROM site_settings');
          const before = Object.fromEntries(beforeRows.map((row) => [row.setting_key, row.setting_value]));
          for (const [key, value] of Object.entries(values)) await client.query(
            `INSERT INTO site_settings (setting_key, setting_value, updated_by) VALUES ($1, $2, $3)
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [key, value, user.id]
          );
          await client.query(`INSERT INTO audit_logs (actor_id, action, entity_type, after_data, before_data) VALUES ($1, 'site.identity.updated', 'site_settings', $2::jsonb, $3::jsonb)`, [user.id, JSON.stringify(values), JSON.stringify(before)]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
        return sendJson(res, 200, { ok: true });
      }
    }
    if (pathname.startsWith('/api/admin/users')) {
      const result = await adminUsers(user, req, res, req.method, pathname);
      if (result !== false) return result;
    }
    if (pathname.startsWith('/api/admin/advertising')) {
      const result = await adminAdvertising(user, req, res, req.method, pathname);
      if (result !== false) return result;
    }
    if (pathname.startsWith('/api/admin/crm')) {
      const result = await adminCrm(user, req, res, req.method, pathname, url);
      if (result !== false) return result;
    }
    for (const mod of newAdminModules) {
      if (await mod.handle(user, req, res, req.method, pathname, url, moduleCtx)) return;
    }
    if (req.method === 'GET' && pathname === '/api/admin/activity') {
      requireRole(user, integrationRoles);
      const { rows } = await pool.query(
        `SELECT l.id, l.action, l.entity_type, l.entity_id, l.after_data, l.created_at, u.display_name AS actor_name
           FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
          ORDER BY l.created_at DESC, l.id DESC LIMIT 100`
      );
      return sendJson(res, 200, { events: rows });
    }
    if (req.method === 'GET' && pathname === '/api/dashboard') return sendJson(res, 200, await summary(user));
    if (req.method === 'GET' && pathname === '/api/categories') {
      requireRole(user, writers);
      const { rows } = await pool.query('SELECT id, name FROM categories WHERE is_active = TRUE ORDER BY sort_order, name');
      return sendJson(res, 200, rows);
    }
    if (req.method === 'GET' && pathname === '/api/articles') return sendJson(res, 200, await articleList(user, url));
    if (req.method === 'POST' && pathname === '/api/media') {
      const media = await uploadMedia(user, req);
      return sendJson(res, 201, { media: { ...media, url: `/media/${media.storage_key}` } });
    }
    if (req.method === 'GET' && /^\/api\/articles\/\d+$/.test(pathname)) {
      return sendJson(res, 200, { article: await getArticle(user, articleIdFromPath(pathname)) });
    }
    if (req.method === 'POST' && pathname === '/api/articles') {
      const article = await createArticle(user, req);
      return sendJson(res, 201, { article });
    }
    if (req.method === 'PATCH' && /^\/api\/articles\/\d+$/.test(pathname)) {
      const article = await updateArticle(user, req, articleIdFromPath(pathname));
      return sendJson(res, 200, { article });
    }
    throw new HttpError(404, 'API adresi bulunamadı.');
  } catch (error) {
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
    console.error('API hatası:', error.message);
    return sendJson(res, 500, { error: 'İşlem sırasında beklenmeyen bir hata oluştu.' });
  }
}

async function isAuthenticated(req) {
  return Boolean(await getSession(req));
}

module.exports = { handleApi, isAuthenticated, getSession, publishScheduledArticles };
