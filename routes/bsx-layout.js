// BSX kabuk bileşenleri: <head>, üst bar, header, footer, script'ler.
// Sözleşme: TASARIM-BSX.md §3 (L1, L2, L3), §6 (JS), §8.
const { esc, url } = require('./bsx-kit');

// Sosyal ağ anahtarı -> { renk sınıfı, görünen harf, ad }
const SOCIAL = {
  fb: { cls: 'bsx-soc--fb', glyph: 'f', name: 'Facebook' },
  x: { cls: 'bsx-soc--x', glyph: 'X', name: 'X' },
  ig: { cls: 'bsx-soc--ig', glyph: 'ig', name: 'Instagram' },
  yt: { cls: 'bsx-soc--yt', glyph: '▶', name: 'YouTube' },
  li: { cls: 'bsx-soc--li', glyph: 'in', name: 'LinkedIn' },
  tumblr: { cls: 'bsx-soc--tumblr', glyph: 't', name: 'Tumblr' },
  wa: { cls: 'bsx-soc--wa', glyph: 'wa', name: 'WhatsApp' },
  tg: { cls: 'bsx-soc--tg', glyph: '✈', name: 'Telegram' },
  pin: { cls: 'bsx-soc--pin', glyph: 'P', name: 'Pinterest' },
};
const SOCIAL_ORDER = ['fb', 'x', 'ig', 'yt', 'li', 'tumblr', 'wa', 'tg', 'pin'];
const YOUTUBE_FALLBACK = 'https://www.youtube.com/';

const TOPBAR_LINKS = [
  { label: 'Hakkımızda', href: '/hakkimizda' },
  { label: 'Künye', href: '/kunye' },
  { label: 'İletişim', href: '/iletisim' },
  { label: 'Veri Politikası', href: '/veri-politikasi' },
  { label: 'Gizlilik Politikası', href: '/gizlilik-politikasi' },
];

// Geçerli sosyal linkleri sabit sırayla döndürür. YouTube her zaman bulunur.
function socialItems(site) {
  const given = new Map();
  for (const s of Array.isArray(site && site.social) ? site.social : []) {
    const key = String(s && s.key || '').toLowerCase();
    const href = url(s && s.href);
    if (SOCIAL[key] && href) given.set(key, href);
  }
  if (!given.has('yt')) given.set('yt', YOUTUBE_FALLBACK);
  return SOCIAL_ORDER.filter((k) => given.has(k)).map((k) => ({ key: k, href: given.get(k), ...SOCIAL[k] }));
}

function socialHtml(site) {
  return `<div class="bsx-social">${socialItems(site).map((s) =>
    `<a class="bsx-soc ${s.cls}" href="${esc(s.href)}" rel="noopener noreferrer" target="_blank" aria-label="${esc(s.name)}" title="${esc(s.name)}">${esc(s.glyph)}</a>`
  ).join('')}</div>`;
}

function logoHtml(site, cls, height = 36) {
  const src = url(site && site.logoUrl);
  const brand = (site && site.brand) || 'Art World TV';
  if (!src) return `<a class="${cls}" href="/"><span class="bsx-brand-text">${esc(brand)}</span></a>`;
  return `<a class="${cls}" href="/"><img src="${esc(src)}" alt="${esc(brand)}" height="${height}"></a>`;
}

function linkEl(item, cls = '') {
  const href = url(item && item.href);
  if (!href || !item.label) return '';
  return `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}">${esc(item.label)}</a>`;
}

function head(title, description) {
  const t = esc(title || 'Art World TV');
  const d = esc(description || '');
  return `<!doctype html><html lang="tr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${d}">
<title>${t}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/bsx-base.css">
<link rel="stylesheet" href="/bsx-sections-1.css">
<link rel="stylesheet" href="/bsx-sections-2.css">
<link rel="alternate" type="application/rss+xml" title="RSS" href="/rss.xml">
</head><body class="bsx">`;
}

function topbar(site) {
  return `<div class="bsx-topbar"><div class="bsx-wrap bsx-topbar-in"><nav class="bsx-topbar-links" aria-label="Kurumsal">${TOPBAR_LINKS.map((l) => linkEl(l)).join('')}</nav>${socialHtml(site)}</div></div>`;
}

function header(site, nav) {
  const items = (Array.isArray(nav) ? nav : []).filter((n) => n && n.label && url(n.href));
  const inline = items.slice(0, 8);
  const rest = items.slice(8);
  const restHtml = rest.length
    ? `<div class="bsx-dropdown" data-bsx-dropdown><button class="bsx-nav-link bsx-dropdown-toggle" type="button" aria-expanded="false" data-bsx-dropdown-toggle>Diğer <span aria-hidden="true">⌄</span></button><div class="bsx-dropdown-menu">${rest.map((n) => linkEl(n)).join('')}</div></div>`
    : '';
  const navHtml = inline.map((n) => linkEl(n, 'bsx-nav-link')).join('') + restHtml;
  const mobileHtml = items.map((n) => linkEl(n)).join('');
  // showAnnouncements açıkça false ise Resmi İlanlar butonu basılmaz (undefined ise basılır).
  const showAnn = !(site && site.showAnnouncements === false);
  const annBtn = showAnn ? '<a class="bsx-yellow-btn" href="/resmi-ilanlar">Resmi İlanlar</a>' : '';
  const annMobile = showAnn ? '<a class="bsx-mobile-yellow" href="/resmi-ilanlar">Resmi İlanlar</a>' : '';
  // Canlı yayın düğmesi: dış adres yeni sekmede açılır.
  const liveHref = site && site.live ? url(site.live.href) : '';
  const liveExternal = /^https:/i.test(liveHref);
  const liveAttrs = liveExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  const liveBtn = liveHref ? `<a class="bsx-live-btn" href="${esc(liveHref)}"${liveAttrs}><span class="bsx-live-dot" aria-hidden="true"></span>CANLI YAYIN</a>` : '';

  return `<header class="bsx-header"><div class="bsx-wrap bsx-header-in">${logoHtml(site, 'bsx-logo', 44)}<nav class="bsx-nav" aria-label="Ana menü">${navHtml}</nav><div class="bsx-header-tools">${liveBtn}${annBtn}<a class="bsx-icon-btn" href="/arama" aria-label="Ara" title="Ara"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a><button class="bsx-icon-btn" type="button" data-bsx-theme aria-pressed="false" aria-label="Koyu tema" title="Koyu tema"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button><button class="bsx-icon-btn bsx-burger" type="button" data-bsx-menu aria-expanded="false" aria-label="Menü"><span aria-hidden="true">☰</span></button></div></div><div class="bsx-mobile"><div class="bsx-wrap bsx-mobile-in">${mobileHtml}${annMobile}</div></div></header>`;
}

function footer(site, footerData) {
  const columns = footerData && Array.isArray(footerData.columns) ? footerData.columns : [];
  const colHtml = columns
    .filter((c) => c && c.title && Array.isArray(c.links) && c.links.some((l) => linkEl(l)))
    .map((c) => `<div class="bsx-footer-col"><h4 class="bsx-footer-title">${esc(c.title)}</h4><div class="bsx-footer-links">${c.links.map((l) => linkEl(l)).join('')}</div></div>`)
    .join('');
  const brandName = (site && site.brand) || 'Art World TV';
  const slogan = site && site.slogan ? `<p class="bsx-footer-slogan">${esc(site.slogan)}</p>` : '';
  const year = new Date().getFullYear();
  return `<footer class="bsx-footer"><div class="bsx-wrap"><div class="bsx-footer-grid">${colHtml}<div class="bsx-footer-col bsx-footer-brand">${logoHtml(site, 'bsx-footer-logo')}${slogan}${socialHtml(site)}</div></div><div class="bsx-footer-bottom">© ${year} ${esc(brandName)}. Tüm hakları saklıdır.</div></div><a class="bsx-totop" href="#top" aria-label="Yukarı">↑</a></footer>`;
}

// Popup reklam. adHtml güvenilir sunucu HTML'idir, escape edilmez. Boşsa ''.
function popup(adHtml, hours) {
  if (!adHtml) return '';
  const h = Math.max(1, Math.min(720, parseInt(hours, 10) || 24));
  return `<div class="bsx-popup" data-bsx-popup data-hours="${h}" hidden role="dialog" aria-modal="true" aria-label="Reklam"><div class="bsx-popup-box"><button type="button" class="bsx-popup-close" data-bsx-popup-close aria-label="Kapat">×</button>${adHtml}</div></div>`;
}

function scripts() {
  return `<script src="/bsx.js" defer></script><script src="/site-modules.js" defer></script></body></html>`;
}

module.exports = { head, topbar, header, footer, popup, scripts };
