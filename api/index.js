// Vercel giriş noktası: tüm istekleri site-handler.js'teki işleyiciye yönlendirir (vercel.json).
const { handleRequest } = require('../site-handler');

module.exports = handleRequest;
