const pool = require('../db/pool');

const BASE = '/api/admin/static-pages';
const ALLOWED_ROLES = ['admin', 'editor_in_chief', 'editor'];
const guard = require('./publish-guard');
const STATUSES = ['draft', 'published'];
// Hakkımızda sayfası yönetici ayarlarından (settings-ext) düzenlenir; burada da yalnız yöneticiye açık.
const ABOUT_SLUG = 'hakkimizda';
const MAX_TITLE = 200;
const MAX_SLUG = 120;
const MAX_CONTENT = 100000;

function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }
function httpError(status, message){ const e=new Error(message); e.status=status; return e; }

function parsePageId(raw){
  if(!/^\d+$/.test(String(raw))) throw httpError(400, 'Geçersiz sayfa kimliği.');
  const id = Number(raw);
  if(!Number.isSafeInteger(id) || id <= 0) throw httpError(400, 'Geçersiz sayfa kimliği.');
  return id;
}

function ensureObject(body){
  if(!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Geçersiz istek gövdesi.');
  return body;
}

// Türkçe karakterleri sadeleştirir: "Şirket Künyesi!" -> "sirket-kunyesi"
function slugify(text){
  return String(text || '')
    .replace(/İ/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

function validateTitle(value){
  const title = typeof value === 'string' ? value.trim() : '';
  if(!title) throw httpError(400, 'Sayfa başlığı zorunludur.');
  if(title.length > MAX_TITLE) throw httpError(400, `Sayfa başlığı en fazla ${MAX_TITLE} karakter olabilir.`);
  return title;
}

function validateContent(value){
  if(value === undefined || value === null) return '';
  if(typeof value !== 'string') throw httpError(400, 'İçerik metin olmalıdır.');
  if(value.length > MAX_CONTENT) throw httpError(400, `İçerik en fazla ${MAX_CONTENT} karakter olabilir.`);
  return value;
}

function normalizeStatus(value){
  return STATUSES.includes(value) ? value : 'draft';
}

function resolveSlug(rawSlug, title){
  if(rawSlug !== undefined && rawSlug !== null && typeof rawSlug !== 'string') throw httpError(400, 'Slug metin olmalıdır.');
  const slug = slugify(rawSlug && rawSlug.trim() ? rawSlug : title);
  if(!slug) throw httpError(400, 'Geçerli bir slug üretilemedi. Slug alanına harf veya rakam girin.');
  return slug;
}

async function listPages(){
  const { rows } = await pool.query(`
    SELECT id, title, slug, status, updated_at, created_at
    FROM static_pages
    ORDER BY created_at DESC, id DESC`);
  return rows;
}

async function createPage(user, body){
  const title = validateTitle(body.title);
  const slug = resolveSlug(body.slug, title);
  const content = validateContent(body.content);
  const status = normalizeStatus(body.status);
  guard.assertCanSetStatus(user, status);
  if(slug === ABOUT_SLUG && user.role !== 'admin') throw httpError(403, 'Hakkımızda sayfasını yalnızca yönetici düzenleyebilir.');
  const createdBy = user && user.id !== undefined ? user.id : null;
  const { rows } = await pool.query(`
    INSERT INTO static_pages (title, slug, content, status, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, title, slug, content, status, created_at, updated_at`,
    [title, slug, content, status, createdBy]);
  return rows[0];
}

async function updatePage(user, id, body){
  const fields = [];
  const values = [];
  const set = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };

  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasSlug = Object.prototype.hasOwnProperty.call(body, 'slug');
  const hasContent = Object.prototype.hasOwnProperty.call(body, 'content');
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  if(!hasTitle && !hasSlug && !hasContent && !hasStatus){
    throw httpError(400, 'Güncellenecek en az bir alan gönderin.');
  }

  if(hasStatus) guard.assertCanSetStatus(user, normalizeStatus(body.status));
  await guard.assertCanEditExisting(user, 'static_pages', id);
  const { rows: existingRows } = await pool.query('SELECT title, slug FROM static_pages WHERE id = $1', [id]);
  if(!existingRows[0]) throw httpError(404, 'Sayfa bulunamadı.');
  if(user.role !== 'admin' && (existingRows[0].slug === ABOUT_SLUG || (hasSlug && resolveSlug(body.slug, existingRows[0].title) === ABOUT_SLUG))){
    throw httpError(403, 'Hakkımızda sayfasını yalnızca yönetici düzenleyebilir.');
  }

  const title = hasTitle ? validateTitle(body.title) : existingRows[0].title;
  if(hasTitle) set('title', title);
  if(hasSlug) set('slug', resolveSlug(body.slug, title));
  if(hasContent) set('content', validateContent(body.content));
  if(hasStatus) set('status', normalizeStatus(body.status));

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE static_pages SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING id`,
    values
  );
  if(!rows[0]) throw httpError(404, 'Sayfa bulunamadı.');
}

async function deletePage(user, id){
  await guard.assertCanEditExisting(user, 'static_pages', id);
  const about = await pool.query('SELECT 1 FROM static_pages WHERE id = $1 AND slug = $2', [id, ABOUT_SLUG]);
  if(about.rowCount && user.role !== 'admin') throw httpError(403, 'Hakkımızda sayfasını yalnızca yönetici silebilir.');
  const { rows } = await pool.query('DELETE FROM static_pages WHERE id = $1 RETURNING id', [id]);
  if(!rows[0]) throw httpError(404, 'Sayfa bulunamadı.');
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith(BASE)) return false;
  if(!user || !ALLOWED_ROLES.includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    const rest = pathname.slice(BASE.length).replace(/\/+$/, '');

    if(rest === ''){
      if(method === 'GET'){
        sendJson(res, 200, { pages: await listPages() });
        return true;
      }
      if(method === 'POST'){
        const body = ensureObject(await readJson(req));
        const page = await createPage(user, body);
        sendJson(res, 201, { page });
        return true;
      }
    } else {
      const match = /^\/([^/]+)$/.exec(rest);
      if(match){
        const id = parsePageId(match[1]);
        if(method === 'PATCH'){
          const body = ensureObject(await readJson(req));
          await updatePage(user, id, body);
          sendJson(res, 200, { ok: true });
          return true;
        }
        if(method === 'DELETE'){
          await deletePage(user, id);
          sendJson(res, 200, { ok: true });
          return true;
        }
      }
    }

    sendJson(res,404,{error:'Adres bulunamadı.'});
    return true;
  }
  catch(err){
    sendJson(res, err.status||400, {error: err.message||'İşlem başarısız.'});
    return true;
  }
}

module.exports = { handle };
