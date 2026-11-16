// Vercel giriş noktası: tüm istekleri app.js'teki işleyiciye yönlendirir (vercel.json).
const { handleRequest } = require('../app');

module.exports = handleRequest;
