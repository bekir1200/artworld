const pool = require('../db/pool');

const ADMIN_ROLES = ['admin', 'editor_in_chief', 'editor'];
const guard = require('./publish-guard');
const VIDEO_STATUSES = ['draft', 'published', 'scheduled', 'archived'];
const MAX_INT = 2147483647;

function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function slugify(value, fallback = 'video') {
  const trMap = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  const slug = String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (ch) => trMap[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || fallback;
}

function cleanText(value, { max, field, required = false }) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw httpError(400, `${field} zorunludur.`);
  if (text.length > max) throw httpError(400, `${field} en fazla ${max} karakter olabilir.`);
  return text;
}

function cleanUrl(value) {
  const text = cleanText(value, { max: 2000, field: 'YouTube URL' });
  if (!text) return null;
  let parsed;
  try { parsed = new URL(text); } catch { throw httpError(400, 'YouTube URL geçerli bir adres olmalıdır.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw httpError(400, 'YouTube URL yalnızca http veya https olabilir.');
  }
  return parsed.href;
}

function cleanCategoryId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_INT) throw httpError(400, 'Geçersiz kategori.');
  return n;
}

function cleanStatus(value) {
  if (!VIDEO_STATUSES.includes(value)) throw httpError(400, 'Geçersiz video durumu.');
  return value;
}

// Planlı yayın zamanı: ileri tarihli video için gelecekte bir tarih zorunludur.
function requireFutureSchedule(value) {
  const date = value instanceof Date ? value : (typeof value === 'string' && value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw httpError(400, 'İleri tarihli içerik için gelecekte bir yayın zamanı seçin.');
  }
  return date;
}

// ?status= filtresi (isteğe bağlı). Geçersiz değer 400 döner.
function statusFilter(url) {
  const raw = url && url.searchParams ? url.searchParams.get('status') : null;
  if (!raw) return null;
  return cleanStatus(raw);
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > MAX_INT) throw httpError(404, 'Video bulunamadı.');
  return id;
}

async function assertCategoryExists(categoryId) {
  if (categoryId === null) return;
  const { rowCount } = await pool.query('SELECT 1 FROM video_categories WHERE id = $1', [categoryId]);
  if (!rowCount) throw httpError(400, 'Seçilen kategori bulunamadı.');
}

async function fetchVideoById(id) {
  const { rows } = await pool.query(
    `SELECT v.id, v.title, v.slug, v.category_id, c.name AS category_name,
            v.youtube_url, v.description, v.status, v.publish_at, v.published_at, v.created_at, v.updated_at
       FROM videos v
       LEFT JOIN video_categories c ON c.id = v.category_id
      WHERE v.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function listCategories(res) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.slug, c.sort_order, c.created_at,
            COUNT(v.id)::int AS video_count
       FROM video_categories c
       LEFT JOIN videos v ON v.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC`
  );
  sendJson(res, 200, { categories: rows });
}

async function createCategory(req, res) {
  const body = (await readJson(req)) || {};
  const name = cleanText(body.name, { max: 120, field: 'Kategori adı', required: true });
  const slug = slugify(name, 'kategori');

  const duplicate = await pool.query('SELECT 1 FROM video_categories WHERE slug = $1 LIMIT 1', [slug]);
  if (duplicate.rowCount) throw httpError(409, 'Bu isimde bir kategori zaten var.');

  const { rows } = await pool.query(
    `INSERT INTO video_categories (name, slug, sort_order)
     VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM video_categories))
     RETURNING id, name, slug, sort_order, created_at`,
    [name, slug]
  );
  sendJson(res, 201, { category: { ...rows[0], video_count: 0 } });
}

async function deleteCategory(id, res) {
  // videos.category_id FK'si ON DELETE SET NULL: bağlı videolar kategorisiz kalır.
  const { rows } = await pool.query('DELETE FROM video_categories WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) throw httpError(404, 'Kategori bulunamadı.');
  sendJson(res, 200, { ok: true, id: rows[0].id });
}

async function listVideos(res, status) {
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE v.status = $1'; }
  const { rows } = await pool.query(
    `SELECT v.id, v.title, v.slug, v.category_id, c.name AS category_name,
            v.youtube_url, v.description, v.status, v.publish_at, v.published_at, v.created_at, v.updated_at
       FROM videos v
       LEFT JOIN video_categories c ON c.id = v.category_id
       ${where}
      ORDER BY v.created_at DESC, v.id DESC`,
    params
  );
  sendJson(res, 200, { videos: rows });
}

async function createVideo(user, req, res) {
  const body = (await readJson(req)) || {};
  const title = cleanText(body.title, { max: 300, field: 'Başlık', required: true });
  const categoryId = cleanCategoryId(body.categoryId);
  const youtubeUrl = cleanUrl(body.youtubeUrl);
  const description = cleanText(body.description, { max: 5000, field: 'Açıklama' }) || null;
  const status = body.status ? cleanStatus(body.status) : 'draft';
  guard.assertCanSetStatus(user, status);
  const publishAt = status === 'scheduled' ? requireFutureSchedule(body.publishAt) : null;
  await assertCategoryExists(categoryId);

  const createdBy = user && user.id ? user.id : null;
  const { rows } = await pool.query(
    `INSERT INTO videos (title, slug, category_id, youtube_url, description, status, publish_at, published_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'published' THEN NOW() ELSE NULL END, $8)
     RETURNING id`,
    [title, slugify(title), categoryId, youtubeUrl, description, status, publishAt, createdBy]
  );
  sendJson(res, 201, { video: await fetchVideoById(rows[0].id) });
}

async function updateVideo(user, id, req, res) {
  const body = (await readJson(req)) || {};
  guard.assertCanSetStatus(user, body.status);
  await guard.assertCanEditExisting(user, 'videos', id);
  const sets = [];
  const params = [];
  const add = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if ('title' in body) {
    const title = cleanText(body.title, { max: 300, field: 'Başlık', required: true });
    add('title', title);
    add('slug', slugify(title));
  }
  if ('categoryId' in body) {
    const categoryId = cleanCategoryId(body.categoryId);
    await assertCategoryExists(categoryId);
    add('category_id', categoryId);
  }
  if ('youtubeUrl' in body) add('youtube_url', cleanUrl(body.youtubeUrl));
  if ('description' in body) add('description', cleanText(body.description, { max: 5000, field: 'Açıklama' }) || null);
  if ('status' in body) {
    const status = cleanStatus(body.status);
    add('status', status);
    // Yayına alınınca yayın tarihi atanır; zaten yayında olan videonun tarihi korunur.
    if (status === 'published') {
      sets.push(`published_at = CASE WHEN status <> 'published' THEN NOW() ELSE published_at END`);
    }
  }
  if ('status' in body || 'publishAt' in body) {
    const { rows: current } = await pool.query('SELECT status, publish_at FROM videos WHERE id = $1', [id]);
    if (!current[0]) throw httpError(404, 'Video bulunamadı.');
    const effective = 'status' in body ? body.status : current[0].status;
    let publishAt = null;
    if (effective === 'scheduled') {
      publishAt = requireFutureSchedule('publishAt' in body ? body.publishAt : current[0].publish_at);
    }
    add('publish_at', publishAt);
  }

  if (!sets.length) throw httpError(400, 'Güncellenecek alan yok.');

  sets.push('updated_at = NOW()');
  params.push(id);
  const { rowCount } = await pool.query(
    `UPDATE videos SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params
  );
  if (!rowCount) throw httpError(404, 'Video bulunamadı.');
  sendJson(res, 200, { video: await fetchVideoById(id) });
}

async function deleteVideo(id, res) {
  const { rowCount } = await pool.query('DELETE FROM videos WHERE id = $1', [id]);
  if (!rowCount) throw httpError(404, 'Video bulunamadı.');
  sendJson(res, 200, { ok: true });
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith('/api/admin/videos')) return false;
  if(!user || !ADMIN_ROLES.includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    if (pathname === '/api/admin/videos/categories') {
      if (method === 'GET') { await listCategories(res); return true; }
      if (method === 'POST') { await createCategory(req, res); return true; }
    }

    // Kategori silme: genel /<id> eşleşmesinden ÖNCE kontrol edilir.
    const categoryMatch = pathname.match(/^\/api\/admin\/videos\/categories\/([^/]+)$/);
    if (categoryMatch && method === 'DELETE') {
      await deleteCategory(parseId(categoryMatch[1]), res);
      return true;
    }

    if (pathname === '/api/admin/videos') {
      if (method === 'GET') { await listVideos(res, statusFilter(url)); return true; }
      if (method === 'POST') { await createVideo(user, req, res); return true; }
    }

    const match = pathname.match(/^\/api\/admin\/videos\/([^/]+)$/);
    if (match) {
      const id = parseId(match[1]);
      if (method === 'PATCH') { await updateVideo(user, id, req, res); return true; }
      if (method === 'DELETE') { await guard.assertCanEditExisting(user, 'videos', id); await deleteVideo(id, res); return true; }
    }

    sendJson(res,404,{error:'Adres bulunamadı.'}); return true;
  }
  catch(err){ sendJson(res, err.status||400, {error: err.message||'İşlem başarısız.'}); return true; }
}
module.exports = { handle };
