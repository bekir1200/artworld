// BSX ortak yardımcıları — ana sayfa renderer'ları (bsx-sections-*.js, bsx-layout.js) bunları kullanır.
// Sözleşme: TASARIM-BSX.md §2 ve §5.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
}

// Yalnız http(s):// ya da tek "/" ile başlayan yolları kabul eder; aksi halde ''.
function url(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : '';
  } catch { return ''; }
}

const NOIMG_SVG = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>';

function noimg(cls = '') {
  return `<span class="bsx-noimg${cls ? ` ${esc(cls)}` : ''}">${NOIMG_SVG}</span>`;
}

function img(src, alt = '', cls = '') {
  const safe = url(src);
  if (!safe) return noimg(cls);
  return `<img${cls ? ` class="${esc(cls)}"` : ''} src="${esc(safe)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

// Standart dikey haber kartı (.bsx-card). opts: { size:'md'|'sm', badge:true, summary:false, cls:'' }
function card(c, opts = {}) {
  if (!c || !c.title) return '';
  const { size = 'md', badge = true, summary = false, cls = '' } = opts;
  const href = url(c.href) || '#';
  const badgeHtml = badge && c.category ? `<span class="bsx-badge">${esc(c.category)}</span>` : '';
  const summaryHtml = summary && c.summary ? `<p class="bsx-card-summary">${esc(c.summary)}</p>` : '';
  const classes = ['bsx-card', size === 'sm' ? 'bsx-card--sm' : '', cls].filter(Boolean).join(' ');
  return `<a class="${classes}" href="${esc(href)}"><div class="bsx-card-img">${img(c.image, c.title)}${badgeHtml}</div><div class="bsx-card-body"><h3 class="bsx-card-title">${esc(c.title)}</h3>${summaryHtml}</div></a>`;
}

// Bölüm başlığı (.bsx-title). opts: { light:false, more:'TÜMÜ' } — more:false ise "TÜMÜ" linki çıkmaz.
function title(label, href = '', opts = {}) {
  const { light = false, more = 'TÜMÜ' } = opts;
  const safe = url(href);
  const labelHtml = safe ? `<a class="bsx-title-label" href="${esc(safe)}">${esc(label)}</a>` : `<span class="bsx-title-label">${esc(label)}</span>`;
  const moreHtml = more && safe ? `<a class="bsx-title-more" href="${esc(safe)}">${esc(more)}</a>` : '';
  return `<div class="bsx-title${light ? ' bsx-title--light' : ''}">${labelHtml}<span class="bsx-title-line" aria-hidden="true"></span>${moreHtml}</div>`;
}

function section(cls, inner) {
  if (!inner) return '';
  // id = bölüm sınıfı: footer'daki "/#bsx-weather" gibi bağlantılar doğrudan bölüme iner.
  return `<section id="${esc(cls)}" class="bsx-sec ${esc(cls)}"><div class="bsx-wrap">${inner}</div></section>`;
}

module.exports = { esc, url, noimg, img, card, title, section };
