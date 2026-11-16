require('../config/env');
const http = require('node:http');
const crypto = require('node:crypto');
const pool = require('../db/pool');
async function main() {
  const client = await pool.connect();
  const query = client.query.bind(client);
  await query('BEGIN');
  const scopedQuery = (sql, args) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? Promise.resolve({ rows: [] }) : query(sql, args);
  pool.query = scopedQuery;
  pool.connect = async () => ({ query: scopedQuery, release() {} });
  const { handleApi } = require('../routes/api');
  const server = http.createServer((req, res) => { const url = new URL(req.url, `http://${req.headers.host}`); handleApi(req, res, url.pathname, url); });
  let failed = 0;
  try {
    const user = (await query("SELECT id FROM users WHERE role='admin' AND is_active=TRUE LIMIT 1")).rows[0];
    if (!user) throw new Error('Active admin required');
    const token = crypto.randomBytes(32).toString('base64url');
    await query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '5 minutes')", [user.id,crypto.createHash('sha256').update(token).digest('hex')]);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, method='GET', body, auth=true) => { const r = await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,...(auth?{Cookie:`artworld_session=${token}`}:{})},body:body?JSON.stringify(body):undefined}); return {status:r.status,data:await r.json()}; };
    const check = (name, ok, detail='') => { console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`); if(!ok) failed++; };
    check('unauthenticated access', (await call('/api/articles','GET',null,false)).status===401);
    check('dashboard', (await call('/api/dashboard')).status===200);
    const cats = await call('/api/categories');
    const body = {headline:'Integration test temporary article',body:'Temporary test content',categoryId:cats.data[0]?.id,tags:'test',status:'draft'};
    const created = await call('/api/articles','POST',body);
    check('create draft',created.status===201,JSON.stringify(created.data.error||''));
    if(!created.data.article) return;
    const path = '/api/articles/'+created.data.article.id;
    check('read draft',(await call(path)).status===200);
    check('invalid headline',(await call(path,'PATCH',{...body,headline:'x'})).status===400);
    for(const status of ['in_review','approved','published','archived','draft']) {
      const result = await call(path,'PATCH',{...body,status});
      check('transition '+status,result.status===200, result.data.error||'');
    }
    await call(path,'PATCH',{...body,status:'in_review'});
    const scheduled = await call(path,'PATCH',{...body,status:'scheduled',scheduledAt:new Date(Date.now()+3600000).toISOString()});
    check('schedule from review',scheduled.status===200,scheduled.data.error||'');
    check('reschedule', (await call(path,'PATCH',{...body,status:'scheduled',scheduledAt:new Date(Date.now()+7200000).toISOString()})).status===200);
    check('reject past schedule', (await call(path,'PATCH',{...body,status:'scheduled',scheduledAt:new Date(Date.now()-60000).toISOString()})).status===400);
    check('reject missing schedule', (await call(path,'PATCH',{...body,status:'scheduled'})).status===400);
    await call(path,'PATCH',{...body,status:'approved'});
    check('schedule from approved', (await call(path,'PATCH',{...body,status:'scheduled',scheduledAt:new Date(Date.now()+3600000).toISOString()})).status===200);
    const detail = (await call(path)).data.article;
    check('tags retained',detail.tags.includes('test'));
    check('revision recorded',detail.revisions.length>1);
    const list = await call('/api/articles');
    check('list contains created article',list.data.some(a=>a.id===created.data.article.id));
    console.log(`RESULT: ${failed} failed checks`);
    process.exitCode=failed?1:0;
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await query('ROLLBACK');
    client.release();
    await pool.end();
    console.log('Test transaction rolled back; no test records retained.');
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
