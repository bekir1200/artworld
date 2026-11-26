const pool = require('../db/pool');

const ALLOWED_ROLES = ['admin', 'editor_in_chief', 'editor'];
const guard = require('./publish-guard');
const STATUSES = new Set(['draft', 'published', 'scheduled', 'archived']);
const MAX_IMAGE_URLS = 100;
const MAX_URL_LENGTH = 2000;
const MAX_DESCRIPTION = 5000;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(req, limit = 200000) {
  return await new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        req.destroy();
        reject(httpError(413, 'Gövde çok büyük.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(httpError(400, 'Geçersiz JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function readBody(req) {
  const input = await readJson(req);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Geçersiz istek gövdesi.');
  return input;
}

// Oturum çerezi kullanıldığı için durum değiştiren isteklerde kaynak doğrulaması yapılır (api.js ile aynı mantık).
function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw httpError(403, 'İstek kaynağı doğrulanamadı.');
  let host = null;
  try { host = new URL(origin).host; } catch { host = null; }
  if (host !== req.headers.host) throw httpError(403, 'İstek kaynağı doğrulanamadı.');
}

function slugify(value, fallback) {
  const slug = String(value || '')
    .replace(/İ/g, 'i').replace(/ı/g, 'i')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || fallback;
}

function validateTitle(value, label = 'Başlık') {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw httpError(400, `${label} zorunludur.`);
  if (title.length > 200) throw httpError(400, `${label} en fazla 200 karakter olabilir.`);
  return title;
}

function validateCategoryId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw httpError(400, 'Geçersiz kategori.');
  return id;
}

function validateDescription(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw httpError(400, 'Açıklama metin olmalıdır.');
  const description = value.trim();
  if (description.length > MAX_DESCRIPTION) throw httpError(400, `Açıklama en fazla ${MAX_DESCRIPTION} karakter olabilir.`);
  return description;
}

// Kabul edilir: dizi veya satır satır metin. Dönüş: temiz URL dizisi.
function validateImageUrls(value) {
  if (value === null || value === undefined) return [];
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(/\r?\n/);
  else throw httpError(400, 'Görsel URL\'leri satır satır metin olmalıdır.');

  const urls = items.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  if (urls.length > MAX_IMAGE_URLS) throw httpError(400, `En fazla ${MAX_IMAGE_URLS} görsel eklenebilir.`);
  for (const url of urls) {
    if (url.length > MAX_URL_LENGTH) throw httpError(400, 'Görsel URL\'si çok uzun.');
    if (!/^(https?:\/\/\S+|\/\S*)$/i.test(url)) throw httpError(400, `Geçersiz görsel URL'si: ${url.slice(0, 80)}`);
  }
  return urls;
}

function validateStatus(value) {
  if (!STATUSES.has(value)) throw httpError(400, 'Geçersiz durum.');
  return value;
}

// ?status= filtresi (isteğe bağlı). Geçersiz değer 400 döner.
function statusFilter(url) {
  const raw = url && url.searchParams ? url.searchParams.get('status') : null;
  if (!raw) return null;
  return validateStatus(raw);
}

// Planlı yayın zamanı: ileri tarihli galeri için gelecekte bir tarih zorunludur.
function requireFutureSchedule(value) {
  const date = value instanceof Date ? value : (typeof value === 'string' && value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw httpError(400, 'İleri tarihli içerik için gelecekte bir yayın zamanı seçin.');
  }
  return date;
}

function serializeGallery(row) {
  const imageUrls = row.image_urls ? row.image_urls.split('\n').filter(Boolean) : [];
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    description: row.description || '',
    imageUrls,
    imageCount: imageUrls.length,
    status: row.status,
    publishAt: row.publish_at || null,
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeCategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    galleryCount: row.gallery_count,
    createdAt: row.created_at
  };
}

async function fetchGallery(id) {
  const { rows } = await pool.query(
    `SELECT g.id, g.title, g.slug, g.category_id, c.name AS category_name, g.description,
            g.image_urls, g.status, g.publish_at, g.published_at, g.created_at, g.updated_at
       FROM galleries g
       LEFT JOIN gallery_categories c ON c.id = g.category_id
      WHERE g.id = $1`,
    [id]
  );
  return rows[0] ? serializeGallery(rows[0]) : null;
}

async function assertCategoryExists(categoryId) {
  if (categoryId === null) return;
  const { rows } = await pool.query('SELECT 1 FROM gallery_categories WHERE id = $1', [categoryId]);
  if (!rows[0]) throw httpError(400, 'Kategori bulunamadı.');
}

async function listCategories(res) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.slug, c.sort_order, c.created_at,
            (SELECT COUNT(*)::int FROM galleries g WHERE g.category_id = c.id) AS gallery_count
       FROM gallery_categories c
      ORDER BY c.sort_order ASC, c.name ASC, c.id ASC`
  );
  return sendJson(res, 200, { categories: rows.map(serializeCategory) });
}

async function createCategory(req, res) {
  const input = await readBody(req);
  const name = validateTitle(input.name, 'Kategori adı');
  if (name.length > 120) throw httpError(400, 'Kategori adı en fazla 120 karakter olabilir.');
  const slug = slugify(name, 'kategori');
  const { rows } = await pool.query(
    `INSERT INTO gallery_categories (name, slug, sort_order)
     SELECT $1, $2, COALESCE(MAX(sort_order), 0) + 1 FROM gallery_categories
     RETURNING id, name, slug, sort_order, created_at`,
    [name, slug]
  );
  return sendJson(res, 201, { category: serializeCategory({ ...rows[0], gallery_count: 0 }) });
}

async function deleteCategory(res, id) {
  // galleries.category_id FK'si ON DELETE SET NULL: bağlı galeriler kategorisiz kalır.
  const { rows } = await pool.query('DELETE FROM gallery_categories WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) throw httpError(404, 'Kategori bulunamadı.');
  return sendJson(res, 200, { ok: true, id: rows[0].id });
}

async function listGalleries(res, status) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE g.status = $1';
  }
  const { rows } = await pool.query(
    `SELECT g.id, g.title, g.slug, g.category_id, c.name AS category_name, g.description,
            g.image_urls, g.status, g.publish_at, g.published_at, g.created_at, g.updated_at
       FROM galleries g
       LEFT JOIN gallery_categories c ON c.id = g.category_id
       ${where}
      ORDER BY g.created_at DESC, g.id DESC`,
    params
  );
  return sendJson(res, 200, { galleries: rows.map(serializeGallery) });
}

async function createGallery(req, res, user) {
  const input = await readBody(req);
  const title = validateTitle(input.title);
  const categoryId = validateCategoryId(input.categoryId);
  const description = validateDescription(input.description);
  const imageUrls = validateImageUrls(input.imageUrls);
  const status = input.status === undefined ? 'draft' : validateStatus(input.status);
  guard.assertCanSetStatus(user, status);
  const publishAt = status === 'scheduled' ? requireFutureSchedule(input.publishAt) : null;
  await assertCategoryExists(categoryId);

  const { rows } = await pool.query(
    `INSERT INTO galleries (title, slug, category_id, description, image_urls, status, publish_at, published_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'published' THEN NOW() ELSE NULL END, $8)
     RETURNING id`,
    [title, slugify(title, 'galeri'), categoryId, description, imageUrls.join('\n'), status, publishAt, user.id]
  );
  return sendJson(res, 201, { gallery: await fetchGallery(rows[0].id) });
}

async function updateGallery(user, req, res, id) {
  const input = await readBody(req);
  guard.assertCanSetStatus(user, input.status);
  await guard.assertCanEditExisting(user, 'galleries', id);
  const sets = [];
  const params = [];
  const push = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if ('title' in input) {
    const title = validateTitle(input.title);
    push('title', title);
    push('slug', slugify(title, 'galeri'));
  }
  if ('categoryId' in input) {
    const categoryId = validateCategoryId(input.categoryId);
    await assertCategoryExists(categoryId);
    push('category_id', categoryId);
  }
  if ('description' in input) push('description', validateDescription(input.description));
  if ('imageUrls' in input) push('image_urls', validateImageUrls(input.imageUrls).join('\n'));
  if ('status' in input) {
    const status = validateStatus(input.status);
    push('status', status);
    // Yayına alınınca yayın tarihi atanır; zaten yayında olan galerinin tarihi korunur.
    if (status === 'published') {
      sets.push(`published_at = CASE WHEN status <> 'published' THEN NOW() ELSE published_at END`);
    }
  }
  if ('status' in input || 'publishAt' in input) {
    const { rows: current } = await pool.query('SELECT status, publish_at FROM galleries WHERE id = $1', [id]);
    if (!current[0]) throw httpError(404, 'Galeri bulunamadı.');
    const effective = 'status' in input ? input.status : current[0].status;
    let publishAt = null;
    if (effective === 'scheduled') {
      publishAt = requireFutureSchedule('publishAt' in input ? input.publishAt : current[0].publish_at);
    }
    push('publish_at', publishAt);
  }

  if (sets.length === 0) throw httpError(400, 'Güncellenecek alan bulunamadı.');

  sets.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE galleries SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (!rows[0]) throw httpError(404, 'Galeri bulunamadı.');
  return sendJson(res, 200, { gallery: await fetchGallery(rows[0].id) });
}

async function deleteGallery(res, id) {
  const { rows } = await pool.query('DELETE FROM galleries WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) throw httpError(404, 'Galeri bulunamadı.');
  return sendJson(res, 200, { ok: true, id: rows[0].id });
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw httpError(404, 'Adres bulunamadı.');
  return id;
}

async function handle(user, req, res, method, pathname, url) {
  if (!pathname.startsWith('/api/admin/galleries')) return false;
  if (!user || !ALLOWED_ROLES.includes(user.role)) {
    sendJson(res, 403, { error: 'Bu işlem için yetkiniz yok.' });
    return true;
  }

  try {
    if (method !== 'GET') checkSameOrigin(req);

    let sub = pathname.slice('/api/admin/galleries'.length);
    if (sub.length > 1 && sub.endsWith('/')) sub = sub.slice(0, -1);

    if (sub === '/categories' && method === 'GET') {
      await listCategories(res);
      return true;
    }
    if (sub === '/categories' && method === 'POST') {
      await createCategory(req, res);
      return true;
    }
    // Kategori silme: genel /<id> eşleşmesinden ÖNCE kontrol edilir.
    const categoryMatch = sub.match(/^\/categories\/([^/]+)$/);
    if (categoryMatch && method === 'DELETE') {
      await deleteCategory(res, parseId(categoryMatch[1]));
      return true;
    }
    if (sub === '' && method === 'GET') {
      await listGalleries(res, statusFilter(url));
      return true;
    }
    if (sub === '' && method === 'POST') {
      await createGallery(req, res, user);
      return true;
    }

    const match = sub.match(/^\/([^/]+)$/);
    if (match && match[1] !== 'categories' && (method === 'PATCH' || method === 'DELETE')) {
      const id = parseId(match[1]);
      if (method === 'PATCH') await updateGallery(user, req, res, id);
      else { await guard.assertCanEditExisting(user, 'galleries', id); await deleteGallery(res, id); }
      return true;
    }

    sendJson(res, 404, { error: 'Adres bulunamadı.' });
    return true;
  } catch (err) {
    if (err.status) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('Galeri işlemi hatası:', err.message);
      sendJson(res, 500, { error: 'İşlem başarısız.' });
    }
    return true;
  }
}

module.exports = { handle };
