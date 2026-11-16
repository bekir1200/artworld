const pool = require('../db/pool');

// Burçlar: /api/admin/horoscopes  |  Vizyondaki filmler: /api/admin/movies
const HOROSCOPE_BASE = '/api/admin/horoscopes';
const MOVIE_BASE = '/api/admin/movies';
const ALLOWED_ROLES = ['admin', 'editor_in_chief', 'editor'];
const BODY_LIMIT = 100 * 1024;
const URL_MAX = 2000;
const MOVIE_STATUSES = ['draft', 'published'];

const HOROSCOPE_COLUMNS = 'sign_key, sign_name, date_range, symbol, daily_text, sort_order, updated_at';
// DATE ve NUMERIC tipleri JSON'a güvenli biçimde çevrilir (tarih saat dilimi kaymaz, puan sayı olur).
const MOVIE_COLUMNS = `id, title, genre, duration_min, release_date::text AS release_date, rating::float8 AS rating,
  poster_url, summary, status, created_at, updated_at`;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// Sayısal alan: boş ya da null → null; aksi halde sayı olmalı (sayı veya sayısal metin kabul edilir).
function numberField(value, name, min, max, { integer = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  if (!Number.isFinite(n)) throw httpError(400, `${name} sayı olmalıdır.`);
  if (integer && !Number.isInteger(n)) throw httpError(400, `${name} tam sayı olmalıdır.`);
  if (n < min || n > max) throw httpError(400, `${name} ${min} ile ${max} arasında olmalıdır.`);
  return n;
}

function urlField(value, name) {
  const text = textField(value, name, URL_MAX, false);
  if (!text) return null;
  if (!/^(https?:\/\/|\/(?!\/))/i.test(text)) {
    throw httpError(400, `${name} http:// veya https:// ile ya da / ile başlamalıdır.`);
  }
  return text;
}

function dateOnlyField(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) {
    throw httpError(400, 'Vizyon tarihi YYYY-MM-DD biçiminde olmalıdır.');
  }
  // Takvimde var olmayan tarihleri (örn. 2026-02-30) reddeder.
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw httpError(400, 'Vizyon tarihi geçerli bir tarih olmalıdır.');
  }
  return value;
}

function ratingField(value) {
  const n = numberField(value, 'Puan', 0, 10);
  if (n === null) return null;
  // NUMERIC(3,1) için en fazla bir ondalık basamak.
  if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) {
    throw httpError(400, 'Puan en fazla bir ondalık basamak içerebilir.');
  }
  return Math.round(n * 10) / 10;
}

function statusField(value) {
  if (!MOVIE_STATUSES.includes(value)) throw httpError(400, 'Geçersiz durum.');
  return value;
}

// ---------- Burçlar ----------

async function listHoroscopes(res) {
  const { rows } = await pool.query(
    `SELECT ${HOROSCOPE_COLUMNS} FROM horoscopes ORDER BY sort_order ASC, sign_key ASC`
  );
  sendJson(res, 200, { horoscopes: rows });
}

async function updateHoroscope(req, res, signKey) {
  const data = await readJson(req);
  const dailyText = data.dailyText !== undefined
    ? textField(data.dailyText, 'Günlük yorum', 2000, false)
    : null;
  const dateRange = data.dateRange !== undefined
    ? textField(data.dateRange, 'Tarih aralığı', 60, true)
    : null;
  if (dailyText === null && dateRange === null) {
    throw httpError(400, 'Güncellenecek alan belirtilmedi.');
  }

  // null gönderilen alan COALESCE ile mevcut değerde kalır.
  const { rows } = await pool.query(
    `UPDATE horoscopes
        SET daily_text = COALESCE($1, daily_text),
            date_range = COALESCE($2, date_range),
            updated_at = NOW()
      WHERE sign_key = $3
      RETURNING ${HOROSCOPE_COLUMNS}`,
    [dailyText, dateRange, signKey]
  );
  if (!rows.length) throw httpError(404, 'Burç bulunamadı.');
  sendJson(res, 200, { horoscope: rows[0] });
}

// ---------- Vizyondaki filmler ----------

async function listMovies(res) {
  const { rows } = await pool.query(
    `SELECT ${MOVIE_COLUMNS} FROM movies ORDER BY created_at DESC, id DESC`
  );
  sendJson(res, 200, { movies: rows });
}

// POST için (current = null) zorunlu alanlar doğrulanır; PATCH için yalnızca gönderilen alanlar değişir.
function resolveMovieFields(data, current) {
  const has = (key) => data[key] !== undefined;
  const keep = (key, fallback) => (current ? current[key] : fallback);

  return {
    title: has('title') || !current
      ? textField(data.title, 'Film adı', 200, true)
      : current.title,
    genre: has('genre')
      ? nullable(textField(data.genre, 'Tür', 60, false))
      : keep('genre', null),
    durationMin: has('durationMin')
      ? numberField(data.durationMin, 'Süre', 1, 600, { integer: true })
      : keep('duration_min', null),
    releaseDate: has('releaseDate')
      ? dateOnlyField(data.releaseDate)
      : keep('release_date', null),
    rating: has('rating')
      ? ratingField(data.rating)
      : keep('rating', null),
    posterUrl: has('posterUrl')
      ? urlField(data.posterUrl, 'Afiş URL')
      : keep('poster_url', null),
    summary: has('summary')
      ? nullable(textField(data.summary, 'Özet', 2000, false))
      : keep('summary', null),
    status: has('status')
      ? statusField(data.status)
      : keep('status', 'draft')
  };
}

const MOVIE_KEYS = ['title', 'genre', 'durationMin', 'releaseDate', 'rating', 'posterUrl', 'summary', 'status'];

async function createMovie(req, res) {
  const data = await readJson(req);
  const f = resolveMovieFields(data, null);
  const { rows } = await pool.query(
    `INSERT INTO movies (title, genre, duration_min, release_date, rating, poster_url, summary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${MOVIE_COLUMNS}`,
    [f.title, f.genre, f.durationMin, f.releaseDate, f.rating, f.posterUrl, f.summary, f.status]
  );
  sendJson(res, 201, { movie: rows[0] });
}

async function updateMovie(req, res, id) {
  const data = await readJson(req);
  if (!MOVIE_KEYS.some((key) => data[key] !== undefined)) {
    throw httpError(400, 'Güncellenecek alan belirtilmedi.');
  }

  const current = await pool.query(`SELECT ${MOVIE_COLUMNS} FROM movies WHERE id = $1`, [id]);
  if (!current.rows.length) throw httpError(404, 'Film bulunamadı.');

  const f = resolveMovieFields(data, current.rows[0]);
  const { rows } = await pool.query(
    `UPDATE movies
        SET title = $1, genre = $2, duration_min = $3, release_date = $4, rating = $5,
            poster_url = $6, summary = $7, status = $8, updated_at = NOW()
      WHERE id = $9
      RETURNING ${MOVIE_COLUMNS}`,
    [f.title, f.genre, f.durationMin, f.releaseDate, f.rating, f.posterUrl, f.summary, f.status, id]
  );
  if (!rows.length) throw httpError(404, 'Film bulunamadı.');
  sendJson(res, 200, { movie: rows[0] });
}

async function deleteMovie(res, id) {
  const { rowCount } = await pool.query('DELETE FROM movies WHERE id = $1', [id]);
  if (!rowCount) throw httpError(404, 'Film bulunamadı.');
  sendJson(res, 200, { ok: true });
}

function parseMovieId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Geçersiz film kimliği.');
  return id;
}

function matchesBase(pathname, base) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

async function handle(user, req, res, method, pathname) {
  const isHoroscope = matchesBase(pathname, HOROSCOPE_BASE);
  const isMovie = matchesBase(pathname, MOVIE_BASE);
  if (!isHoroscope && !isMovie) return false;

  try {
    if (!user || !ALLOWED_ROLES.includes(user.role)) {
      sendJson(res, 403, { error: 'Bu işlem için yetkiniz yok.' });
      return true;
    }
    if (method !== 'GET') checkSameOrigin(req);

    if (isHoroscope) {
      const rest = pathname.slice(HOROSCOPE_BASE.length);
      if (rest === '' || rest === '/') {
        if (method === 'GET') { await listHoroscopes(res); return true; }
      } else {
        const match = /^\/([a-z_]{1,40})$/.exec(rest);
        if (match && method === 'PATCH') { await updateHoroscope(req, res, match[1]); return true; }
      }
    }

    if (isMovie) {
      const rest = pathname.slice(MOVIE_BASE.length);
      if (rest === '' || rest === '/') {
        if (method === 'GET') { await listMovies(res); return true; }
        if (method === 'POST') { await createMovie(req, res); return true; }
      } else {
        const match = /^\/(\d+)$/.exec(rest);
        if (match) {
          const id = parseMovieId(match[1]);
          if (method === 'PATCH') { await updateMovie(req, res, id); return true; }
          if (method === 'DELETE') { await deleteMovie(res, id); return true; }
        }
      }
    }

    sendJson(res, 404, { error: 'Adres bulunamadı.' });
    return true;
  } catch (err) {
    if (err.status) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('[horoscope-movies]', err);
      sendJson(res, 500, { error: 'Beklenmeyen bir hata oluştu.' });
    }
    return true;
  }
}

module.exports = { handle };
