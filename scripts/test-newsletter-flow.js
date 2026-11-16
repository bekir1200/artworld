require('../config/env');
process.env.SITE_URL = '';
const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const pool = require('../db/pool');

async function main() {
  const client = await pool.connect();
  const query = client.query.bind(client);
  await query('BEGIN');
  const scoped = (sql, args) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? Promise.resolve({ rows: [] }) : query(sql, args);
  pool.query = scoped;
  pool.connect = async () => ({ query: scoped, release() {} });
  const { handleApi } = require('../routes/api');
  const server = http.createServer((req, res) => { const url = new URL(req.url, `http://${req.headers.host}`); handleApi(req, res, url.pathname, url); });
  try {
    const contact = (await query(`INSERT INTO crm_contacts (email, contact_type, source, status) VALUES ($1, 'newsletter', 'test', 'unsubscribed') RETURNING id`, [`test-${randomBytes(8).toString('hex')}@example.invalid`])).rows[0];
    const makeToken = async (purpose) => {
      const token = randomBytes(32).toString('base64url');
      await query(`INSERT INTO newsletter_tokens(contact_id, token_hash, purpose, expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '1 hour')`, [contact.id, createHash('sha256').update(token).digest('hex'), purpose]);
      return token;
    };
    const confirm = await makeToken('confirm');
    const unsubscribe = await makeToken('unsubscribe');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (action, token) => fetch(`${base}/api/newsletter/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ token }) });
    function check(name, condition) { if (!condition) throw new Error(`FAIL ${name}`); console.log(`PASS ${name}`); }
    check('confirmation succeeds', (await request('confirm', confirm)).status === 200);
    check('confirmation replay rejected', (await request('confirm', confirm)).status === 400);
    check('consent granted', (await query(`SELECT status FROM crm_contacts WHERE id=$1`, [contact.id])).rows[0].status === 'open');
    const pending = await makeToken('confirm');
    check('previous unsubscribe link remains valid', (await request('unsubscribe', unsubscribe)).status === 200);
    check('unsubscribe invalidates pending confirmation', (await request('confirm', pending)).status === 400);
    check('unsubscribed state', (await query(`SELECT status FROM crm_contacts WHERE id=$1`, [contact.id])).rows[0].status === 'unsubscribed');
    check('unsubscribe replay rejected', (await request('unsubscribe', unsubscribe)).status === 400);
    const subscribe = () => fetch(`${base}/api/newsletter/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: 'rate-limit@example.invalid', consent: true }) });
    for (let i = 0; i < 3; i++) check('unconfigured email fails safely', (await subscribe()).status === 503);
    check('repeated subscriptions rate limited', (await subscribe()).status === 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await query('ROLLBACK');
    client.release();
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
