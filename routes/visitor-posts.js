const pool = require('../db/pool');

const STATUSES = ['pending', 'approved', 'rejected'];
const PREFIX = '/api/admin/visitor-posts';

function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }
function httpError(status, message){ const e=new Error(message); e.status=status; return e; }

function parseId(raw){
  const id = Number(raw);
  if(!Number.isInteger(id) || id <= 0) throw httpError(400, 'Geçersiz başvuru kimliği.');
  return id;
}

function mapPost(row){
  return {
    id: row.id,
    submitter_name: row.submitter_name,
    submitter_email: row.submitter_email,
    title: row.title,
    body: row.body,
    status: row.status,
    ip_address: row.ip_address,
    created_at: row.created_at
  };
}

async function listPosts(status){
  const params = [];
  let where = '';
  if(status){
    params.push(status);
    where = 'WHERE status = $1';
  }
  const { rows } = await pool.query(
    `SELECT id, submitter_name, submitter_email, title, body, status, ip_address, created_at
       FROM visitor_posts ${where}
      ORDER BY created_at DESC, id DESC`,
    params
  );
  const { rows: countRows } = await pool.query(
    'SELECT status, COUNT(*)::int AS total FROM visitor_posts GROUP BY status'
  );
  const counts = { pending: 0, approved: 0, rejected: 0 };
  countRows.forEach(r => { if(STATUSES.includes(r.status)) counts[r.status] = r.total; });
  return { posts: rows.map(mapPost), counts };
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith(PREFIX)) return false;
  if(!user || !['admin','editor_in_chief','editor'].includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    const rest = pathname.slice(PREFIX.length);

    if(method === 'GET' && (rest === '' || rest === '/')){
      const status = url.searchParams.get('status') || '';
      if(status && !STATUSES.includes(status)) throw httpError(400, 'Geçersiz durum filtresi.');
      sendJson(res, 200, await listPosts(status));
      return true;
    }

    if((method === 'PATCH' || method === 'DELETE') && /^\/[^/]+$/.test(rest)){
      const id = parseId(rest.slice(1));

      if(method === 'PATCH'){
        const body = await readJson(req);
        const status = body && typeof body.status === 'string' ? body.status : '';
        if(!STATUSES.includes(status)) throw httpError(400, 'Geçersiz durum.');
        const result = await pool.query('UPDATE visitor_posts SET status = $1 WHERE id = $2', [status, id]);
        if(!result.rowCount) throw httpError(404, 'Başvuru bulunamadı.');
        sendJson(res, 200, { ok: true });
        return true;
      }

      const result = await pool.query('DELETE FROM visitor_posts WHERE id = $1', [id]);
      if(!result.rowCount) throw httpError(404, 'Başvuru bulunamadı.');
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res,404,{error:'Adres bulunamadı.'}); return true;
  }
  catch(err){ sendJson(res, err.status||400, {error: err.message||'İşlem başarısız.'}); return true; }
}
module.exports = { handle };
