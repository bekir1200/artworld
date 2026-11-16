const pool = require('../db/pool');

const ALLOWED_ROLES = ['admin', 'editor_in_chief', 'editor'];
const STATUSES = ['active', 'closed'];
const MAX_QUESTION = 280;
const MAX_OPTION = 160;
const MAX_OPTIONS = 10;

function sendJson(res, s, d){ res.writeHead(s,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(d)); }
async function readJson(req, limit=200000){ return await new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>limit){ req.destroy(); reject(new Error('Gövde çok büyük.')); }}); req.on('end',()=>{ try{ resolve(b?JSON.parse(b):{}); }catch{ reject(new Error('Geçersiz JSON.')); }}); req.on('error',reject); }); }

function httpError(status, message){
  const err = new Error(message);
  err.status = status;
  return err;
}

function parsePollId(raw){
  const id = Number(raw);
  if(!Number.isInteger(id) || id <= 0) throw httpError(400, 'Geçersiz anket kimliği.');
  return id;
}

function mapPoll(row){
  const options = Array.isArray(row.options) ? row.options : [];
  const totalVotes = options.reduce((sum, o) => sum + Number(o.votes || 0), 0);
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    created_at: row.created_at,
    totalVotes,
    options: options.map(o => ({ id: o.id, label: o.label, votes: Number(o.votes || 0), sort_order: o.sort_order }))
  };
}

const POLL_SELECT = `
  SELECT p.id, p.question, p.status, p.created_at,
         COALESCE(
           json_agg(
             json_build_object('id', o.id, 'label', o.label, 'votes', o.votes, 'sort_order', o.sort_order)
             ORDER BY o.sort_order, o.id
           ) FILTER (WHERE o.id IS NOT NULL),
           '[]'::json
         ) AS options
  FROM polls p
  LEFT JOIN poll_options o ON o.poll_id = p.id`;

async function fetchPoll(id, db = pool){
  const { rows } = await db.query(`${POLL_SELECT} WHERE p.id = $1 GROUP BY p.id`, [id]);
  return rows[0] ? mapPoll(rows[0]) : null;
}

async function listPolls(){
  const { rows } = await pool.query(`${POLL_SELECT} GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`);
  return rows.map(mapPoll);
}

function validatePollInput(body){
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if(!question) throw httpError(400, 'Anket sorusu zorunludur.');
  if(question.length > MAX_QUESTION) throw httpError(400, `Soru en fazla ${MAX_QUESTION} karakter olabilir.`);

  if(!Array.isArray(body.options)) throw httpError(400, 'Seçenekler bir liste olmalıdır.');
  const options = body.options
    .map(o => (typeof o === 'string' ? o.trim() : ''))
    .filter(Boolean);
  if(options.length < 2) throw httpError(400, 'En az 2 dolu seçenek girmelisiniz.');
  if(options.length > MAX_OPTIONS) throw httpError(400, `En fazla ${MAX_OPTIONS} seçenek eklenebilir.`);
  if(options.some(o => o.length > MAX_OPTION)) throw httpError(400, `Her seçenek en fazla ${MAX_OPTION} karakter olabilir.`);

  return { question, options };
}

async function createPoll(user, body){
  const { question, options } = validatePollInput(body);
  const client = await pool.connect();
  let pollId;
  try {
    await client.query('BEGIN');
    const created = await client.query(
      'INSERT INTO polls (question, created_by) VALUES ($1, $2) RETURNING id',
      [question, user.id ?? null]
    );
    pollId = created.rows[0].id;
    for(let i = 0; i < options.length; i++){
      await client.query(
        'INSERT INTO poll_options (poll_id, label, votes, sort_order) VALUES ($1, $2, 0, $3)',
        [pollId, options[i], i + 1]
      );
    }
    await client.query('COMMIT');
  } catch(err){
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return fetchPoll(pollId);
}

async function updatePollStatus(id, body){
  if(!STATUSES.includes(body.status)) throw httpError(400, "Durum 'active' veya 'closed' olmalıdır.");
  const { rows } = await pool.query('UPDATE polls SET status = $1 WHERE id = $2 RETURNING id', [body.status, id]);
  if(!rows[0]) throw httpError(404, 'Anket bulunamadı.');
  return fetchPoll(id);
}

async function deletePoll(id){
  const { rowCount } = await pool.query('DELETE FROM polls WHERE id = $1', [id]);
  if(!rowCount) throw httpError(404, 'Anket bulunamadı.');
  return { ok: true, id };
}

async function handle(user, req, res, method, pathname, url){
  if(!pathname.startsWith('/api/admin/polls')) return false;
  if(!user || !ALLOWED_ROLES.includes(user.role)){ sendJson(res,403,{error:'Bu işlem için yetkiniz yok.'}); return true; }
  try {
    if(pathname === '/api/admin/polls'){
      if(method === 'GET'){
        sendJson(res, 200, { polls: await listPolls() });
        return true;
      }
      if(method === 'POST'){
        const body = await readJson(req);
        const poll = await createPoll(user, body);
        sendJson(res, 201, { poll });
        return true;
      }
    }

    const match = pathname.match(/^\/api\/admin\/polls\/([^/]+)$/);
    if(match){
      const id = parsePollId(match[1]);
      if(method === 'PATCH'){
        const body = await readJson(req);
        const poll = await updatePollStatus(id, body);
        sendJson(res, 200, { poll });
        return true;
      }
      if(method === 'DELETE'){
        sendJson(res, 200, await deletePoll(id));
        return true;
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
