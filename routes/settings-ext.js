const pool = require('../db/pool');
const { DEFAULTS, PENDING_MODULE_KEYS, CITIES, getSettings, invalidate } = require('./settings-store');

const SETTINGS_PATH = '/api/admin/settings-ext';
const ABOUT_PATH = '/api/admin/settings-ext/about';
const META_PATH = '/api/admin/settings-ext/meta';
const ABOUT_SLUG = 'hakkimizda';
const ABOUT_TITLE = 'Hakkımızda';
const ABOUT_MAX_CONTENT = 100000;
const ABOUT_STATUSES = ['draft', 'published'];
const MAX_BODY = 300000;

const ON_OFF_KEYS = [
  'module.comments', 'module.polls', 'module.visitorPosts', 'module.horoscope', 'module.movies',
  'module.breaking', 'module.strip', 'module.featured', 'module.fx', 'module.columnists',
  'module.photos', 'module.videos', 'module.announcements', 'module.weather', 'module.prayer',
  'module.local', 'module.popup',
  'theme.defaultDark', 'cron.botsEnabled'
];
const BLOG_KEYS = ['blog.1', 'blog.2'];
const SLUG_KEYS = [...BLOG_KEYS, 'numbered.category', 'tabs.categories'];
const LEAGUES = ['super-lig', 'tff-1', 'tff-2', 'tff-3'];
const TAB_MAX = 8;
const COLOR_KEYS = ['theme.primary', 'theme.accent'];
const INTERVAL_KEY = 'cron.botIntervalMinutes';
const POPUP_HOURS_KEY = 'popup.hours';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const LABELS = {
  'module.breaking': 'Son Dakika', 'module.strip': 'Yatay Manşet', 'module.featured': 'Spot',
  'module.fx': 'Döviz Kurları', 'module.columnists': 'Yazarlar', 'module.photos': 'Foto Galeri',
  'module.videos': 'Video Galeri', 'module.announcements': 'Resmi İlanlar', 'module.weather': 'Hava Durumu',
  'module.prayer': 'Namaz Vakitleri', 'module.local': 'Yerel Haberler', 'module.popup': 'Popup Reklam',
  'module.horoscope': 'Burç Yorumları', 'module.movies': 'Vizyondaki Filmler', 'module.comments': 'Yorumlar',
  'module.polls': 'Anketler', 'module.visitorPosts': 'Ziyaretçi Haberleri',
  'module.pharmacy': 'Nöbetçi Eczaneler', 'module.papers': 'Gazete Manşetleri', 'module.standings': 'Puan Durumu',
  'module.onlinePaper': 'Online Gazete', 'module.lottery': 'Şans Oyunları', 'module.directory': 'Firma Rehberi',
  'module.traffic': 'Trafik Durumu', 'module.city': 'Modül Şehir', 'league.default': 'Default Lig',
  'blog.1': '1. Blog', 'blog.2': '2. Blog', 'numbered.category': 'Numaralı Haberler',
  'tabs.categories': 'Tab Menü', 'popup.hours': 'Popup Reklam Süresi',
  'theme.defaultDark': 'Koyu tema', 'cron.botsEnabled': 'İçerik botları', 'cron.botIntervalMinutes': 'Çekme aralığı',
  'theme.primary': 'Ana renk', 'theme.accent': 'Vurgu rengi'
};

function labelOf(key) {
  return LABELS[key] || key;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        req.destroy();
        reject(httpError(413, 'Gövde çok büyük.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(httpError(400, 'Geçersiz JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function ensureObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Geçersiz istek gövdesi.');
  return body;
}

function requireAdmin(user) {
  if (!user || user.role !== 'admin') throw httpError(403, 'Bu işlem için yetkiniz yok.');
}

function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw httpError(403, 'İstek kaynağı doğrulanamadı.');
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw httpError(403, 'İstek kaynağı doğrulanamadı.');
  }
  if (host !== req.headers.host) throw httpError(403, 'İstek kaynağı doğrulanamadı.');
}

async function loadActiveCategories() {
  const { rows } = await pool.query(
    'SELECT slug, name FROM categories WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC'
  );
  return rows;
}

function requireActiveSlug(raw, activeSlugs, key, allowEmpty) {
  if (raw === null || raw === undefined) raw = '';
  if (typeof raw !== 'string') throw httpError(400, `${labelOf(key)} için geçersiz değer.`);
  const value = raw.trim();
  if (value === '') {
    if (allowEmpty) return '';
    throw httpError(400, `${labelOf(key)} için bir kategori seçmelisiniz.`);
  }
  if (!activeSlugs.has(value)) throw httpError(400, `${labelOf(key)} için seçilen kategori aktif değil.`);
  return value;
}

function parseTabCategories(raw, activeSlugs) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') throw httpError(400, 'Tab Menü için geçersiz değer.');
  const slugs = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) return '';
  if (slugs.length > TAB_MAX) throw httpError(400, `Tab Menü en fazla ${TAB_MAX} kategori içerebilir.`);
  if (new Set(slugs).size !== slugs.length) throw httpError(400, 'Tab Menü kategorileri benzersiz olmalıdır.');
  for (const slug of slugs) {
    if (!activeSlugs.has(slug)) throw httpError(400, `Tab Menü için seçilen kategori aktif değil: ${slug}`);
  }
  return slugs.join(',');
}

function parseWholeInteger(raw, min, max, key, message) {
  let number = NaN;
  if (typeof raw === 'number') number = raw;
  else if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) number = Number(raw);
  if (!Number.isInteger(number) || number < min || number > max) throw httpError(400, message || `${labelOf(key)} ${min}-${max} arasında tam sayı olmalıdır.`);
  return String(number);
}

function normalizeSettingValue(key, raw, activeSlugs) {
  if (ON_OFF_KEYS.includes(key)) {
    if (raw !== 'on' && raw !== 'off') throw httpError(400, `${labelOf(key)} için değer 'on' veya 'off' olmalıdır.`);
    return raw;
  }

  if (PENDING_MODULE_KEYS.includes(key)) {
    if (raw !== 'off') throw httpError(400, `${labelOf(key)} henüz veri kaynağına bağlı değil; yalnızca pasif olabilir.`);
    return 'off';
  }

  if (BLOG_KEYS.includes(key)) return requireActiveSlug(raw, activeSlugs, key, false);
  if (key === 'numbered.category') return requireActiveSlug(raw, activeSlugs, key, true);
  if (key === 'tabs.categories') return parseTabCategories(raw, activeSlugs);

  if (key === 'module.city') {
    if (typeof raw !== 'string' || !CITIES.includes(raw.trim())) throw httpError(400, 'Modül Şehir geçerli bir il olmalıdır.');
    return raw.trim();
  }

  if (key === 'league.default') {
    if (!LEAGUES.includes(raw)) throw httpError(400, `Default Lig için geçerli değerler: ${LEAGUES.join(', ')}.`);
    return raw;
  }

  if (key === POPUP_HOURS_KEY) {
    return parseWholeInteger(raw, 1, 720, key, 'Popup Reklam Süresi 1-720 saat arasında tam sayı olmalıdır.');
  }

  if (COLOR_KEYS.includes(key)) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw !== 'string') throw httpError(400, 'Renk değeri metin olmalıdır.');
    const value = raw.trim();
    if (value !== '' && !HEX_COLOR.test(value)) throw httpError(400, 'Renk #RRGGBB biçiminde olmalıdır.');
    return value;
  }

  if (key.startsWith('social.')) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw !== 'string') throw httpError(400, 'Sosyal medya bağlantısı https:// ile başlayan geçerli bir adres olmalı.');
    const value = raw.trim();
    if (value === '') return '';
    const invalid = httpError(400, 'Sosyal medya bağlantısı https:// ile başlayan geçerli bir adres olmalı.');
    if (value.length > 500 || !value.toLowerCase().startsWith('https://')) throw invalid;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw invalid;
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) throw invalid;
    return value;
  }

  if (key === INTERVAL_KEY) {
    return parseWholeInteger(raw, 5, 1440, key, 'Çekme aralığı 5-1440 dakika arasında tam sayı olmalıdır.');
  }

  throw httpError(400, `Bilinmeyen ayar anahtarı: ${key}`);
}

async function putSettings(user, body) {
  ensureObject(body);
  const entries = Object.entries(body);
  if (entries.length === 0) throw httpError(400, 'Kaydedilecek ayar yok.');

  for (const [key] of entries) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      throw httpError(400, `Bilinmeyen ayar anahtarı: ${key}`);
    }
  }

  const needsSlugs = entries.some(([key]) => SLUG_KEYS.includes(key));
  const activeSlugs = new Set(needsSlugs ? (await loadActiveCategories()).map((row) => row.slug) : []);

  const updates = {};
  for (const [key, raw] of entries) {
    updates[key] = normalizeSettingValue(key, raw, activeSlugs);
  }

  const keys = Object.keys(updates);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT setting_key, setting_value FROM site_settings WHERE setting_key = ANY($1::text[])',
      [keys]
    );
    const before = {};
    for (const key of keys) before[key] = DEFAULTS[key];
    for (const row of rows) before[row.setting_key] = String(row.setting_value);

    for (const key of keys) {
      await client.query(
        `INSERT INTO site_settings (setting_key, setting_value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, updates[key], user.id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, before_data, after_data)
       VALUES ($1, 'settings.updated', 'site_settings', $2::jsonb, $3::jsonb)`,
      [user.id, JSON.stringify(before), JSON.stringify(updates)]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  invalidate();
  return await getSettings();
}

async function getMeta() {
  return { cities: CITIES, categories: (await loadActiveCategories()).map((row) => ({ slug: row.slug, name: row.name })) };
}

async function getAboutPage() {
  const { rows } = await pool.query(
    `SELECT id, title, slug, content, status, created_at, updated_at
     FROM static_pages WHERE slug = $1 ORDER BY id ASC LIMIT 1`,
    [ABOUT_SLUG]
  );
  return rows[0] || null;
}

async function putAboutPage(user, body) {
  ensureObject(body);

  if (body.content !== undefined && body.content !== null && typeof body.content !== 'string') {
    throw httpError(400, 'İçerik metin olmalıdır.');
  }
  const content = typeof body.content === 'string' ? body.content : '';
  if (content.length > ABOUT_MAX_CONTENT) {
    throw httpError(400, `İçerik en fazla ${ABOUT_MAX_CONTENT} karakter olabilir.`);
  }
  if (!ABOUT_STATUSES.includes(body.status)) {
    throw httpError(400, 'Durum taslak veya yayında olmalıdır.');
  }

  const { rows: existing } = await pool.query(
    'SELECT id FROM static_pages WHERE slug = $1 ORDER BY id ASC LIMIT 1',
    [ABOUT_SLUG]
  );

  const columns = 'id, title, slug, content, status, created_at, updated_at';
  let result;
  if (existing[0]) {
    result = await pool.query(
      `UPDATE static_pages SET content = $1, status = $2, updated_at = NOW()
       WHERE id = $3 RETURNING ${columns}`,
      [content, body.status, existing[0].id]
    );
  } else {
    result = await pool.query(
      `INSERT INTO static_pages (title, slug, content, status, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`,
      [ABOUT_TITLE, ABOUT_SLUG, content, body.status, user && user.id !== undefined ? user.id : null]
    );
  }
  return result.rows[0];
}

async function handle(user, req, res, method, pathname, url, ctx) {
  let target;
  if (pathname === SETTINGS_PATH) target = 'settings';
  else if (pathname === ABOUT_PATH) target = 'about';
  else if (pathname === META_PATH) target = 'meta';
  else return false;

  try {
    requireAdmin(user);
    if (method !== 'GET') checkSameOrigin(req);

    if (target === 'meta') {
      if (method === 'GET') {
        sendJson(res, 200, await getMeta());
      } else {
        sendJson(res, 405, { error: 'Desteklenmeyen yöntem.' });
      }
      return true;
    }

    if (target === 'settings') {
      if (method === 'GET') {
        sendJson(res, 200, { settings: await getSettings() });
      } else if (method === 'PUT') {
        const body = await readJson(req);
        const settings = await putSettings(user, body);
        sendJson(res, 200, { ok: true, settings });
      } else {
        sendJson(res, 405, { error: 'Desteklenmeyen yöntem.' });
      }
      return true;
    }

    if (method === 'GET') {
      sendJson(res, 200, { page: await getAboutPage() });
    } else if (method === 'PUT') {
      const body = await readJson(req);
      const page = await putAboutPage(user, body);
      sendJson(res, 200, { ok: true, page });
    } else {
      sendJson(res, 405, { error: 'Desteklenmeyen yöntem.' });
    }
  } catch (error) {
    if (error.status) {
      sendJson(res, error.status, { error: error.message });
    } else {
      console.error('Site ayarları isteğinde hata:', error);
      sendJson(res, 500, { error: 'Sunucu hatası oluştu.' });
    }
  }
  return true;
}

module.exports = { handle };
