'use strict';

// HTML yanıtları için İçerik Güvenlik Politikası (CSP).
// - ENFORCED: sayfayı bozmayan kurallar hemen uygulanır (eklenti/nesne, <base>, form hedefi, çerçeveleme).
// - REPORT_ONLY: tam politika önce yalnız raporlanır; tarayıcı konsolunda ihlal görülmezse ENFORCED'a taşınır.
//   Yönetim panelindeki satır içi onsubmit="" bağlayıcıları kaldırılmadan script-src 'self' zorlanamaz.
function frameAncestors(frameOptions) {
  return String(frameOptions || '').toUpperCase() === 'SAMEORIGIN' ? "'self'" : "'none'";
}

function cspHeaders(frameOptions = 'DENY') {
  const ancestors = `frame-ancestors ${frameAncestors(frameOptions)}`;
  const enforced = ["object-src 'none'", "base-uri 'self'", "form-action 'self'", ancestors].join('; ');
  const full = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    'frame-src https:',
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ancestors
  ].join('; ');
  return {
    'Content-Security-Policy': enforced,
    'Content-Security-Policy-Report-Only': full
  };
}

module.exports = { cspHeaders };
