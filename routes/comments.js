const pool = require('../db/pool');

const STATUSES = ['pending', 'approved', 'rejected', 'spam'];

function sendJson(res, s, d) {
  res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(d));
}

async function readJson(req, limit = 200000) {
  return await new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > limit) { req.destroy(); reject(new Error('Gövde çok büyük.')); }
    });
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('Geçersiz JSON.')); }
    });
    req.on('error', reject);
  });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, 'Geçersiz yorum kimliği.');
  return id;
}

// Çerez tabanlı oturumlarda CSRF'e karşı: Origin başlığı varsa host ile eşleşmeli.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handle(user, req, res, method, pathname, url) {
  if (!pathname.startsWith('/api/admin/comments')) return false;
  if (!user || !['admin', 'editor_in_chief', 'editor'].includes(user.role)) { sendJson(res, 403, { error: 'Bu işlem için yetkiniz yok.' }); return true; }
  try {
    if (method !== 'GET' && !isSameOrigin(req)) throw httpError(403, 'Geçersiz istek kaynağı.');

    // GET /api/admin/comments?status=
    if (method === 'GET' && pathname === '/api/admin/comments') {
      const requested = url.searchParams.get('status');
      const filter = requested && requested !== 'all' ? requested : null;
      if (filter && !STATUSES.includes(filter)) throw httpError(400, 'Geçersiz durum filtresi.');

      const listSql = `
        SELECT id, article_id, article_title, author_name, author_email, body, status, ip_address, created_at
        FROM comments
        ${filter ? 'WHERE status = $1' : ''}
        ORDER BY created_at DESC, id DESC`;
      const [list, countRows] = await Promise.all([
        pool.query(listSql, filter ? [filter] : []),
        pool.query('SELECT status, COUNT(*)::int AS count FROM comments GROUP BY status')
      ]);

      const counts = { pending: 0, approved: 0, rejected: 0, spam: 0 };
      for (const row of countRows.rows) {
        if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] = row.count;
      }
      return sendJson(res, 200, { comments: list.rows, counts }), true;
    }

    // PATCH /api/admin/comments/:id  {status}
    const idMatch = pathname.match(/^\/api\/admin\/comments\/([^/]+)$/);
    if (idMatch && method === 'PATCH') {
      const id = parseId(idMatch[1]);
      const body = (await readJson(req)) || {};
      if (!STATUSES.includes(body.status)) throw httpError(400, 'Geçersiz yorum durumu.');
      const result = await pool.query('UPDATE comments SET status = $1 WHERE id = $2 RETURNING id', [body.status, id]);
      if (!result.rowCount) throw httpError(404, 'Yorum bulunamadı.');
      return sendJson(res, 200, { ok: true }), true;
    }

    // DELETE /api/admin/comments/:id
    if (idMatch && method === 'DELETE') {
      const id = parseId(idMatch[1]);
      const result = await pool.query('DELETE FROM comments WHERE id = $1', [id]);
      if (!result.rowCount) throw httpError(404, 'Yorum bulunamadı.');
      return sendJson(res, 200, { ok: true }), true;
    }

    sendJson(res, 404, { error: 'Adres bulunamadı.' });
    return true;
  }
  catch (err) {
    sendJson(res, err.status || 400, { error: err.message || 'İşlem başarısız.' });
    return true;
  }
}

module.exports = { handle };
