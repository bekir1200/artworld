require('./config/env');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleApi, isAuthenticated, publishScheduledArticles } = require('./routes/api');
const { servePublicPage } = require('./routes/public-pages');
const { serveMedia } = require('./routes/media');

const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3003);
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

http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
}).listen(port, () => console.log(`Art World TV hazır: http://localhost:${port}`));

const scheduledPublishTimer = setInterval(() => {
  publishScheduledArticles().catch((error) => console.error('Planlı haber yayını başarısız:', error?.stack || error));
}, 30_000);
scheduledPublishTimer.unref();

// İleri tarihli makale/galeri/video yayını (dakikada bir).
const { publishDue } = require('./routes/scheduler');
const moduleScheduleTimer = setInterval(() => {
  publishDue().catch((error) => console.error('Planlı içerik yayını başarısız:', error?.stack || error));
}, 60_000);
moduleScheduleTimer.unref();

// İçerik botları: zamanı gelen aktif ajansları çeker (aralık Cron ayarlarından okunur).
const { runDueBots } = require('./routes/bot-runner');
const botTimer = setInterval(() => {
  runDueBots().catch((error) => console.error('İçerik botu çalıştırılamadı:', error?.stack || error));
}, 60_000);
botTimer.unref();
