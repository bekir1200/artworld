const pool = require('../db/pool');

// Resmi ilanlar: /api/admin/announcements
const BASE = '/api/admin/announcements';
const ALLOWED_ROLES = ['admin', 'editor_in_chief', 'editor'];
const STATUSES = ['draft', 'published', 'archived'];
const TITLE_MAX = 200;
const ILAN_NO_MAX = 100;
const BODY_MAX = 50000;
const URL_MAX = 2000;
const BODY_LIMIT = 100 * 1024;

const SELECT_COLUMNS = 'id, title, slug, ilan_no, body, attachment_url, status, publish_at, ends_at, created_by, created_at, updated_at';
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function readJson(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, 'İstek gövdesi çok büyük.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(httpError(400, 'Geçersiz JSON.'));
      }
    });
    req.on('error', reject);
  });
}

// Same-origin kontrolü: Origin yoksa ya da host eşleşmiyorsa reddedilir.
function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw httpError(403, 'İstek kaynağı doğrulanamadı.');
  try {
    if (new URL(origin).host !== req.headers.host) throw httpError(403, 'İstek kaynağı doğrulanamadı.');
  } catch (err) {
    if (err.status) throw err;
    throw httpError(403, 'İstek kaynağı doğrulanamadı.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Çapraz site isteği reddedildi.');
}

// Türkçe karakterleri sadeleştirip URL uyumlu slug üretir.
const TR_CHARS = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };
function slugify(text) {
  const slug = String(text || '')
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (ch) => TR_CHARS[ch])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return slug || 'ilan';
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Geçersiz ilan kimliği.');
  return id;
}

// Metin alanını doğrular: string'e çevirir, kırpar ve sınırları kontrol eder.
function textField(value, name, max, required) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw httpError(400, `${name} metin olmalıdır.`);
  const text = value.trim();
  if (required && !text) throw httpError(400, `${name} zorunludur.`);
  if (text.length > max) throw httpError(400, `${name} en fazla ${max} karakter olabilir.`);
  return text;
}

function nullable(text) {
  return text ? text : null;
}

// Ek dosya URL'i: boş, http(s):// veya / ile başlayan yol. Protokol-göreli "//" adresleri kabul edilmez.
function urlField(value) {
  const text = textField(value, 'Ek dosya URL', URL_MAX, false);
  if (!text) return null;
  if (!/^(https?:\/\/|\/(?!\/))/i.test(text)) {
    throw httpError(400, 'Ek dosya URL http:// veya https:// ile ya da / ile başlamalıdır.');
  }
  return text;
}

// Tarih alanı: ISO biçimi veya boş (boş = null). Geçersizse 400.
function dateField(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, `${name} geçerli bir tarih olmalıdır.`);
  const text = value.trim();
  if (!text) return null;
  const ms = DATE_RE.test(text) ? Date.parse(text) : NaN;
  if (Number.isNaN(ms)) throw httpError(400, `${name} geçerli bir ISO tarihi olmalıdır.`);
  return new Date(ms);
}

function statusField(value) {
  if (!STATUSES.includes(value)) throw httpError(400, 'Geçersiz durum.');
  return value;
}

// POST için (current = null) tüm alanlar doğrulanır; PATCH için yalnızca gönderilen alanlar değişir.
function resolveFields(data, current) {
  const has = (key) => data[key] !== undefined;
  const keep = (key, fallback) => (current ? current[key] : fallback);

  const title = has('title') || !current
    ? textField(data.title, 'Başlık', TITLE_MAX, true)
    : current.title;
  const ilanNo = has('ilanNo')
    ? nullable(textField(data.ilanNo, 'İlan no', ILAN_NO_MAX, false))
    : keep('ilan_no', null);
  const body = has('body')
    ? nullable(textField(data.body, 'Metin', BODY_MAX, false))
    : keep('body', null);
  const attachmentUrl = has('attachmentUrl')
    ? urlField(data.attachmentUrl)
    : keep('attachment_url', null);
  const status = has('status')
    ? statusField(data.status)
    : keep('status', 'draft');
  const publishAt = has('publishAt')
    ? dateField(data.publishAt, 'Yayın başlangıcı')
    : keep('publish_at', null);
  const endsAt = has('endsAt')
    ? dateField(data.endsAt, 'Bitiş tarihi')
    : keep('ends_at', null);

  if (publishAt && endsAt && endsAt.getTime() <= new Date(publishAt).getTime()) {
    throw httpError(400, 'Bitiş tarihi yayın başlangıcından sonra olmalıdır.');
  }

  return { title, ilanNo, body, attachmentUrl, status, publishAt, endsAt };
}

const MUTABLE_KEYS = ['title', 'ilanNo', 'body', 'attachmentUrl', 'status', 'publishAt', 'endsAt'];

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Aynı başlıktan doğan slug çakışmalarında sonuna -2, -3 ... eklenir.
async function uniqueSlug(client, title, excludeId) {
  const base = slugify(title);
  const { rows } = await client.query(
    'SELECT slug FROM announcements WHERE (slug = $1 OR slug LIKE $2) AND id <> $3',
    [base, `${base}-%`, excludeId || 0]
  );
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Eşzamanlı yazmalarda slug UNIQUE çakışırsa işlem birkaç kez yeniden denenir.
async function retryOnSlugConflict(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === '23505' && attempt < 3) continue;
      throw err;
    }
  }
}

async function audit(client, user, action, entityId, afterData) {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data)
     VALUES ($1, $2, 'announcement', $3, $4::jsonb)`,
    [user.id, action, entityId, JSON.stringify(afterData)]
  );
}

function auditSnapshot(row) {
  return {
    title: row.title,
    slug: row.slug,
    ilan_no: row.ilan_no,
    status: row.status,
    publish_at: row.publish_at,
    ends_at: row.ends_at
  };
}

async function listAnnouncements(res) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM announcements ORDER BY created_at DESC, id DESC`
  );
  sendJson(res, 200, { announcements: rows });
}

async function createAnnouncement(user, req, res) {
  const data = await readJson(req);
  const fields = resolveFields(data, null);

  const announcement = await retryOnSlugConflict(() => withTransaction(async (client) => {
    const slug = await uniqueSlug(client, fields.title, null);
    const { rows } = await client.query(
      `INSERT INTO announcements (title, slug, ilan_no, body, attachment_url, status, publish_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${SELECT_COLUMNS}`,
      [fields.title, slug, fields.ilanNo, fields.body, fields.attachmentUrl, fields.status,
        fields.publishAt, fields.endsAt, user.id]
    );
    await audit(client, user, 'announcement.created', rows[0].id, auditSnapshot(rows[0]));
    return rows[0];
  }));

  sendJson(res, 201, { announcement });
}

async function updateAnnouncement(user, req, res, id) {
  const data = await readJson(req);
  if (!MUTABLE_KEYS.some((key) => data[key] !== undefined)) {
    throw httpError(400, 'Güncellenecek alan belirtilmedi.');
  }

  const announcement = await retryOnSlugConflict(() => withTransaction(async (client) => {
    const current = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM announcements WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current.rows.length) throw httpError(404, 'İlan bulunamadı.');
    const row = current.rows[0];

    const fields = resolveFields(data, row);
    // Başlık değişirse slug yeniden üretilir (diğer kayıtlarla çakışmasız).
    const slug = fields.title === row.title
      ? row.slug
      : await uniqueSlug(client, fields.title, id);

    const { rows } = await client.query(
      `UPDATE announcements
          SET title = $1, slug = $2, ilan_no = $3, body = $4, attachment_url = $5, status = $6,
              publish_at = $7, ends_at = $8, updated_at = NOW()
        WHERE id = $9
        RETURNING ${SELECT_COLUMNS}`,
      [fields.title, slug, fields.ilanNo, fields.body, fields.attachmentUrl, fields.status,
        fields.publishAt, fields.endsAt, id]
    );
    await audit(client, user, 'announcement.updated', id, auditSnapshot(rows[0]));
    return rows[0];
  }));

  sendJson(res, 200, { announcement });
}

async function deleteAnnouncement(user, res, id) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      'DELETE FROM announcements WHERE id = $1 RETURNING title, slug',
      [id]
    );
    if (!rows.length) throw httpError(404, 'İlan bulunamadı.');
    await audit(client, user, 'announcement.deleted', id, { title: rows[0].title, slug: rows[0].slug, deleted: true });
  });
  sendJson(res, 200, { ok: true });
}

async function handle(user, req, res, method, pathname) {
  if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return false;

  try {
    if (!user || !ALLOWED_ROLES.includes(user.role)) {
      sendJson(res, 403, { error: 'Bu işlem için yetkiniz yok.' });
      return true;
    }
    if (method !== 'GET') checkSameOrigin(req);

    const rest = pathname.slice(BASE.length);
    if (rest === '' || rest === '/') {
      if (method === 'GET') { await listAnnouncements(res); return true; }
      if (method === 'POST') { await createAnnouncement(user, req, res); return true; }
    } else {
      const match = /^\/(\d+)$/.exec(rest);
      if (match) {
        const id = parseId(match[1]);
        if (method === 'PATCH') { await updateAnnouncement(user, req, res, id); return true; }
        if (method === 'DELETE') { await deleteAnnouncement(user, res, id); return true; }
      }
    }

    sendJson(res, 404, { error: 'Adres bulunamadı.' });
    return true;
  } catch (err) {
    if (err.status) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('[announcements]', err);
      sendJson(res, 500, { error: 'Beklenmeyen bir hata oluştu.' });
    }
    return true;
  }
}

module.exports = { handle };
