const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db/pool');
const { isAuthenticated } = require('./api');

const mediaDir = path.join(__dirname, '..', 'storage', 'media');
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function serveMedia(req, res, pathname) {
  if (!pathname.startsWith('/media/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }

  const match = pathname.match(/^\/media\/([a-f0-9]{40}\.(?:png|jpg|webp))$/);
  if (!match) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Görsel bulunamadı.');
    return true;
  }

  const { rows } = await pool.query(
    `SELECT m.storage_key, m.mime_type, m.byte_size,
            EXISTS (SELECT 1 FROM articles a WHERE a.cover_media_id = m.id AND a.status = 'published' AND a.published_at <= NOW()) AS is_public
       FROM media_assets m WHERE m.storage_key = $1`, [match[1]]
  );
  const media = rows[0];
  if (!media || !mimeTypes.has(media.mime_type)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Görsel bulunamadı.');
    return true;
  }
  if (!media.is_public && !await isAuthenticated(req)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Görsel bulunamadı.');
    return true;
  }

  const filePath = path.join(mediaDir, media.storage_key);
  const cacheControl = media.is_public ? 'public, max-age=31536000, immutable' : 'private, no-store';
  try { await fs.promises.access(filePath); }
  catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Görsel bulunamadı.');
    return true;
  }
  res.writeHead(200, {
    'Content-Type': media.mime_type,
    'Content-Length': media.byte_size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-site'
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Görsel bulunamadı.');
    } else res.destroy();
  });
  stream.pipe(res);
  return true;
}

module.exports = { serveMedia };
