'use strict';

// İstemci IP'si. Vercel'de istek platformun proxy'sinden gelir; x-real-ip / x-vercel-forwarded-for başlıklarını
// Vercel'in kenar sunucusu kendisi yazar (istemcinin gönderdiği değerin üzerine), bu yüzden yalnız Vercel'de
// güvenilir. Başka ortamlarda istemcinin uydurabileceği başlıklara bakılmaz; soket adresi kullanılır.
function clientIp(req) {
  if (process.env.VERCEL === '1') {
    const header = req.headers['x-real-ip'] || String(req.headers['x-vercel-forwarded-for'] || '').split(',')[0];
    const value = String(header || '').trim();
    if (value) return value;
  }
  let ip = String((req.socket && req.socket.remoteAddress) || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip || 'unknown';
}

module.exports = { clientIp };
