require('./config/env');
const fs = require('node:fs');
const path = require('node:path');
const { handleApi, isAuthenticated } = require('./routes/api');
const { servePublicPage } = require('./routes/public-pages');
const { serveMedia } = require('./routes/media');
const { runScheduledTasks } = require('./routes/scheduled-tasks');

// İstek işleyicisi: hem yerel sunucu (server.js) hem Vercel (api/index.js) bunu kullanır.
const publicDir = path.join(__dirname, 'public');
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res, pathname) {
  let requested;
  if (pathname === '/yonetim' || pathname === '/yonetim/') {
    if (!await isAuthenticated(req)) {
      res.writeHead(302, { Location: '/giris', 'Cache-Control': 'no-store' });
      return res.end();
    }
    requested = 'yonetim.html';
  } else if (pathname === '/yonetim.html') {
    if (!await isAuthenticated(req)) {
      res.writeHead(302, { Location: '/giris', 'Cache-Control': 'no-store' });
      return res.end();
    }
    requested = 'yonetim.html';
  } else if (pathname === '/giris' || pathname === '/giris/') {
    if (await isAuthenticated(req)) {
      res.writeHead(302, { Location: '/yonetim', 'Cache-Control': 'no-store' });
      return res.end();
    }
    requested = 'giris.html';
  } else if (pathname === '/sifremi-unuttum') {
    // Sayfa göreli yollar (styles.css, password-reset.js) kullandığı için yalnız eğik çizgisiz adres eşlenir.
    requested = 'sifremi-unuttum.html';
  } else if (pathname === '/sifre-sifirla') {
    requested = 'sifre-sifirla.html';
  } else {
    requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  }

  const file = path.resolve(publicDir, requested);
  if (!file.startsWith(publicDir + path.sep)) return sendText(res, 403, 'Erişim reddedildi.');
  fs.readFile(file, (error, data) => {
    if (error) return sendText(res, 404, 'Sayfa bulunamadı.');
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/yonetim') || pathname.startsWith('/giris') ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    res.end(data);
  });
}

// Zamanlanmış işler (planlı yayın, içerik botları). Vercel'de dış bir zamanlayıcı bu adresi çağırır.
// Yetki: Authorization: Bearer <CRON_SECRET>. Vercel Cron bu başlığı kendisi ekler.
async function handleCron(req, res) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return sendText(res, 401, 'Yetkisiz.');
  const result = await runScheduledTasks();
  return sendJson(res, 200, { ok: true, ...result });
}

// Vercel yönlendirmesi (vercel.json) istekleri /api/index?path=<yol> adresine çevirir; gerçek yol burada geri yüklenir.
function restoreVercelPath(req) {
  const url = new URL(req.url, 'http://vercel.local');
  if (url.pathname !== '/api/index') return;
  const original = url.searchParams.get('path') || '';
  url.searchParams.delete('path');
  req.url = `/${original}${url.search}`;
}

async function handleRequest(req, res) {
  try {
    restoreVercelPath(req);
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (requestUrl.pathname === '/api/cron/run') return await handleCron(req, res);
    if (requestUrl.pathname.startsWith('/api/')) return await handleApi(req, res, requestUrl.pathname, requestUrl);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Bu istek yöntemi desteklenmiyor.');
    let pathname;
    try { pathname = decodeURIComponent(requestUrl.pathname); } catch { return sendText(res, 400, 'Adres biçimi geçersiz.'); }
    if (await serveMedia(req, res, pathname)) return;
    if (await servePublicPage(req, res, pathname, requestUrl)) return;
    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error('Sunucu hatası:', error.message);
    if (!res.headersSent) sendText(res, 500, 'Sunucu isteği tamamlayamadı.');
  }
}

module.exports = { handleRequest };
