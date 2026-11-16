const pool = require('../db/pool');

const STATUSES = ['draft', 'published', 'scheduled', 'archived'];
const TITLE_MAX = 200;
const AUTHOR_MAX = 200;
const SUMMARY_MAX = 1000;
const BODY_MAX = 50000;

function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }

function httpError(status, message){
  const err = new Error(message);
  err.status = status;
  return err;
}

// Türkçe karakterleri sadeleştirip URL uyumlu slug üretir.
const TR_CHARS = { 'ç':'c', 'Ç':'c', 'ğ':'g', 'Ğ':'g', 'ı':'i', 'I':'i', 'İ':'i', 'ö':'o', 'Ö':'o', 'ş':'s', 'Ş':'s', 'ü':'u', 'Ü':'u' };
function slugify(text){
  const slug = String(text || '')
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, ch => TR_CHARS[ch])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return slug || 'makale';
}

function parseId(raw){
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Geçersiz makale kimliği.');
  return id;
}

// Metin alanını doğrular: string'e çevirir, kırpar ve sınırları kontrol eder.
function textField(value, name, max, required){
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw httpError(400, `${name} metin olmalıdır.`);
  const text = value.trim();
  if (required && !text) throw httpError(400, `${name} zorunludur.`);
  if (text.length > max) throw httpError(400, `${name} en fazla ${max} karakter olabilir.`);
  return text;
}

function normalizeStatus(value){
  return STATUSES.includes(value) ? value : 'draft';
}

// Planlı yayın zamanı: ileri tarihli içerik için gelecekte bir tarih zorunludur.
function requireFutureSchedule(value){
  const date = value instanceof Date ? value : (typeof value === 'string' && value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw httpError(400, 'İleri tarihli içerik için gelecekte bir yayın zamanı seçin.');
  }
  return date;
}

// ?status= filtresi (isteğe bağlı). Geçersiz değer 400 döner.
function statusFilter(url){
  const raw = url && url.searchParams ? url.searchParams.get('status') : null;
  if (!raw) return null;
  if (!STATUSES.includes(raw)) throw httpError(400, 'Geçersiz durum.');
  return raw;
}

const LIST_COLUMNS = 'id, title, author_name, status, publish_at, published_at, created_at';

async function listColumns(res, status){
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE status = $1'; }
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM columns ${where} ORDER BY created_at DESC, id DESC`,
    params
  );
  sendJson(res, 200, { columns: rows });
}

async function createColumn(user, req, res){
  const data = await readJson(req);
  const title = textField(data.title, 'Başlık', TITLE_MAX, true);
  const authorName = textField(data.authorName, 'Yazar adı', AUTHOR_MAX, true);
  const summary = textField(data.summary, 'Özet', SUMMARY_MAX, false);
  const body = textField(data.body, 'İçerik', BODY_MAX, false);
  const status = normalizeStatus(data.status);
  const publishAt = status === 'scheduled' ? requireFutureSchedule(data.publishAt) : null;
  const slug = slugify(title);

  const { rows } = await pool.query(
    `INSERT INTO columns (title, slug, author_name, summary, body, status, published_at, publish_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'published' THEN NOW() ELSE NULL END, $7, $8)
     RETURNING id, title, slug, author_name, summary, body, status, publish_at, published_at, created_at, updated_at`,
    [title, slug, authorName, summary || null, body || null, status, publishAt, user && user.id != null ? user.id : null]
  );
  sendJson(res, 201, { column: rows[0] });
}

async function updateColumn(req, res, id){
  const data = await readJson(req);
  const sets = [];
  const params = [];
  const add = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };

  if (data.title !== undefined) {
    const title = textField(data.title, 'Başlık', TITLE_MAX, true);
    add('title = ?', title);
    add('slug = ?', slugify(title));
  }
  if (data.authorName !== undefined) {
    add('author_name = ?', textField(data.authorName, 'Yazar adı', AUTHOR_MAX, true));
  }
  if (data.summary !== undefined) {
    add('summary = ?', textField(data.summary, 'Özet', SUMMARY_MAX, false) || null);
  }
  if (data.body !== undefined) {
    add('body = ?', textField(data.body, 'İçerik', BODY_MAX, false) || null);
  }
  if (data.status !== undefined) {
    if (!STATUSES.includes(data.status)) throw httpError(400, 'Geçersiz durum.');
    add('status = ?', data.status);
    // Yayına alınınca yayın tarihi atanır; zaten yayında olan makalenin tarihi korunur.
    if (data.status === 'published') {
      sets.push(`published_at = CASE WHEN status <> 'published' THEN NOW() ELSE published_at END`);
    }
  }
  if (data.status !== undefined || data.publishAt !== undefined) {
    const { rows: current } = await pool.query('SELECT status, publish_at FROM columns WHERE id = $1', [id]);
    if (!current[0]) throw httpError(404, 'Makale bulunamadı.');
    const effective = data.status !== undefined ? data.status : current[0].status;
    let publishAt = null;
    if (effective === 'scheduled') {
      publishAt = requireFutureSchedule(data.publishAt !== undefined ? data.publishAt : current[0].publish_at);
    }
    add('publish_at = ?', publishAt);
  }
  if (!sets.length) throw httpError(400, 'Güncellenecek alan belirtilmedi.');

  sets.push('updated_at = NOW()');
  params.push(id);
  const { rowCount } = await pool.query(
    `UPDATE columns SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params
  );
  if (!rowCount) throw httpError(404, 'Makale bulunamadı.');
  sendJson(res, 200, { ok: true });
}

async function deleteColumn(res, id){
  const { rowCount } = await pool.query('DELETE FROM columns WHERE id = $1', [id]);
  if (!rowCount) throw httpError(404, 'Makale bulunamadı.');
  sendJson(res, 200, { ok: true });
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith('/api/admin/columns')) return false;
  if(!user || !['admin','editor_in_chief','editor'].includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    const rest = pathname.slice('/api/admin/columns'.length);

    if (rest === '' || rest === '/') {
      if (method === 'GET') { await listColumns(res, statusFilter(url)); return true; }
      if (method === 'POST') { await createColumn(user, req, res); return true; }
    } else {
      const match = /^\/(\d+)$/.exec(rest);
      if (match) {
        const id = parseId(match[1]);
        if (method === 'PATCH') { await updateColumn(req, res, id); return true; }
        if (method === 'DELETE') { await deleteColumn(res, id); return true; }
      }
    }

    sendJson(res,404,{error:'Adres bulunamadı.'}); return true;
  } catch(err){ sendJson(res, err.status||400, {error: err.message||'İşlem başarısız.'}); return true; }
}
module.exports = { handle };
