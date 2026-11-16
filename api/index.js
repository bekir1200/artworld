// Vercel giriş noktası. vercel.json tüm istekleri /api/index?path=<yol> adresine yönlendirir;
// burada gerçek istek yolu geri yüklenip site-handler.js'e verilir.
const { handleRequest } = require('../site-handler');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://vercel.local');
  if (url.pathname === '/api/index') {
    const original = url.searchParams.get('path') || '';
    url.searchParams.delete('path');
    req.url = `/${original}${url.search}`;
  }
  return handleRequest(req, res);
};
