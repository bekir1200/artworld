const pool = require('../db/pool');
function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }
function httpError(status, message){ const e=new Error(message); e.status=status; return e; }

const BASE = '/api/admin/footer-links';
const LABEL_MAX = 120;
const NAME_MAX = 120;
const URL_MAX = 500;

function parseId(raw){
  const n = Number(raw);
  if(!Number.isInteger(n) || n <= 0) throw httpError(400, 'Geçersiz kimlik.');
  return n;
}

function textValue(value){
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(text){
  const slug = String(text)
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'kategori';
}

function isValidUrl(value){
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith('/api/admin/footer-links')) return false;
  if(!user || !['admin','editor_in_chief','editor'].includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    const rest = pathname.slice(BASE.length).replace(/\/+$/, '');

    // Kategoriler: /categories yollari /:id sayi yolundan once eslestirilir.
    if(rest === '/categories' && method === 'GET'){
      const result = await pool.query(
        `SELECT c.id, c.name, c.slug, c.sort_order, c.created_at,
                COUNT(f.id)::int AS link_count
           FROM link_categories c
           LEFT JOIN footer_links f ON f.category_id = c.id
          GROUP BY c.id
          ORDER BY c.sort_order, c.id`
      );
      sendJson(res, 200, { categories: result.rows });
      return true;
    }

    if(rest === '/categories' && method === 'POST'){
      const body = await readJson(req);
      const name = textValue(body.name);
      if(!name) throw httpError(400, 'Kategori adı zorunludur.');
      if(name.length > NAME_MAX) throw httpError(400, `Kategori adı en fazla ${NAME_MAX} karakter olabilir.`);
      const result = await pool.query(
        `INSERT INTO link_categories (name, slug, sort_order)
         VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM link_categories))
         RETURNING id, name, slug, sort_order, created_at`,
        [name, slugify(name)]
      );
      sendJson(res, 201, { category: { ...result.rows[0], link_count: 0 } });
      return true;
    }

    const categoryMatch = rest.match(/^\/categories\/([^/]+)$/);
    if(categoryMatch && method === 'DELETE'){
      const id = parseId(categoryMatch[1]);
      const result = await pool.query('DELETE FROM link_categories WHERE id = $1 RETURNING id', [id]);
      if(!result.rowCount) throw httpError(404, 'Kategori bulunamadı.');
      sendJson(res, 200, { ok: true, id });
      return true;
    }

    // Linkler
    if(rest === '' && method === 'GET'){
      const result = await pool.query(
        `SELECT f.id, f.category_id, f.label, f.url, f.sort_order, f.created_at,
                c.name AS category_name
           FROM footer_links f
           LEFT JOIN link_categories c ON c.id = f.category_id
          ORDER BY c.sort_order NULLS LAST, c.id NULLS LAST, f.sort_order, f.id`
      );
      sendJson(res, 200, { links: result.rows });
      return true;
    }

    if(rest === '' && method === 'POST'){
      const body = await readJson(req);
      const label = textValue(body.label);
      const linkUrl = textValue(body.url);
      if(!label) throw httpError(400, 'Etiket zorunludur.');
      if(label.length > LABEL_MAX) throw httpError(400, `Etiket en fazla ${LABEL_MAX} karakter olabilir.`);
      if(!linkUrl) throw httpError(400, 'Bağlantı adresi zorunludur.');
      if(linkUrl.length > URL_MAX) throw httpError(400, `Bağlantı adresi en fazla ${URL_MAX} karakter olabilir.`);
      if(!isValidUrl(linkUrl)) throw httpError(400, 'Bağlantı http:// veya https:// ile ya da / ile başlamalıdır.');

      let categoryId = null;
      if(body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== ''){
        categoryId = parseId(body.categoryId);
        const exists = await pool.query('SELECT 1 FROM link_categories WHERE id = $1', [categoryId]);
        if(!exists.rowCount) throw httpError(400, 'Kategori bulunamadı.');
      }

      const result = await pool.query(
        `INSERT INTO footer_links (category_id, label, url, sort_order)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM footer_links))
         RETURNING id, category_id, label, url, sort_order, created_at`,
        [categoryId, label, linkUrl]
      );
      const row = result.rows[0];
      let categoryName = null;
      if(row.category_id !== null){
        const cat = await pool.query('SELECT name FROM link_categories WHERE id = $1', [row.category_id]);
        categoryName = cat.rows[0] ? cat.rows[0].name : null;
      }
      sendJson(res, 201, { link: { ...row, category_name: categoryName } });
      return true;
    }

    const linkMatch = rest.match(/^\/([^/]+)$/);
    if(linkMatch && method === 'DELETE'){
      const id = parseId(linkMatch[1]);
      const result = await pool.query('DELETE FROM footer_links WHERE id = $1 RETURNING id', [id]);
      if(!result.rowCount) throw httpError(404, 'Bağlantı bulunamadı.');
      sendJson(res, 200, { ok: true, id });
      return true;
    }

    sendJson(res,404,{error:'Adres bulunamadı.'}); return true;
  }
  catch(err){ sendJson(res, err.status||400, {error: err.message||'İşlem başarısız.'}); return true; }
}
module.exports = { handle };
