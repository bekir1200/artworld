// BSX ana sayfa bolumleri (1/2): son dakika, manset, kart seridi, video + gundem,
// piyasalar, kose yazarlari, haber izgarasi A.
// Sozlesme: TASARIM-BSX.md §3 (S1-S7), §4 (veri), §5 (renderer), §6 (JS isaretleri).
// Ortak yardimcilar routes/bsx-kit.js'ten gelir; burada kendi escape/kart kodu yoktur.

const { esc, url, img, card, title, section } = require('./bsx-kit');

const ARROW_PREV = '&#8249;';
const ARROW_NEXT = '&#8250;';

const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const list = (arr) => (Array.isArray(arr) ? arr : []);
const hasTitle = (c) => Boolean(c && c.title);
const cardsOf = (arr) => list(arr).filter(hasTitle);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const hrefOf = (v) => url(v) || '#';

function initialOf(name) {
  const t = String(name || '').trim();
  return t ? t.charAt(0).toLocaleUpperCase('tr-TR') : '?';
}

// Manset/piyasa degeri: BTC ve buyuk degerler tam sayi, digerleri en fazla 4 hane.
function fmtValue(code, v) {
  const big = code === 'BTC' || Math.abs(v) >= 1000;
  return v.toLocaleString('tr-TR', { maximumFractionDigits: big ? 0 : 4 });
}

function fmtPct(p) {
  return Math.abs(p).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Ilk slayt (sayfanin ust ana gorseli) hemen yuklensin; digerleri lazy kalir.
const EAGER_ATTR = 'loading="eager" fetchpriority="high"';
function eagerIfFirst(html, index) {
  return index === 0 ? html.replace('loading="lazy"', EAGER_ATTR) : html;
}
function heroImg(c, i) {
  return eagerIfFirst(img(c.image, c.title, 'bsx-hero-pic'), i);
}
function slideImg(c, i) {
  return eagerIfFirst(img(c.image, c.title, 'bsx-feat-pic'), i);
}

// S1 — Son dakika kayan basliklar (§3 S1, §6 ticker).
function breaking(data) {
  const items = cardsOf(data.breaking);
  if (!items.length) return '';
  const ticks = items
    .map((t, i) => `<a class="bsx-tick${i === 0 ? ' is-active' : ''}" data-bsx-tick href="${esc(hrefOf(t.href))}">${esc(t.title)}</a>`)
    .join('');
  const inner = `<div class="bsx-breaking-in" data-bsx-ticker>`
    + `<div class="bsx-breaking-label">${CLOCK_SVG}<span class="bsx-breaking-text">SON DAKİKA</span>`
    + `<span class="bsx-breaking-nav"><button type="button" class="bsx-breaking-btn" data-bsx-prev aria-label="Önceki başlık">${ARROW_PREV}</button>`
    + `<button type="button" class="bsx-breaking-btn" data-bsx-next aria-label="Sonraki başlık">${ARROW_NEXT}</button></span></div>`
    + `<div class="bsx-breaking-list">${ticks}</div>`
    + `</div>`;
  return section('bsx-breaking', inner);
}

// S2 — Manset slider: solda numara rayi, sagda slaytlar (§3 S2, §6 slider).
function hero(data) {
  const items = cardsOf(data.hero);
  if (!items.length) return '';
  const nums = items
    .map((_, i) => `<button type="button"${i === 0 ? ' class="is-active"' : ''} data-bsx-goto="${i}" aria-label="${i + 1}. manşet">${i + 1}</button>`)
    .join('');
  const slides = items
    .map((c, i) => `<a class="bsx-hero-slide${i === 0 ? ' is-active' : ''}" data-bsx-slide href="${esc(hrefOf(c.href))}">`
      + `<div class="bsx-hero-img">${heroImg(c, i)}</div>`
      // Görselde zaten yazı varsa (hideTitle) başlık yalnız ekran okuyucular için kalır.
      + `<div class="bsx-hero-panel${c.hideTitle && c.image ? ' bsx-hero-panel--hidden' : ''}"><h2 class="bsx-hero-title">${esc(c.title)}</h2></div>`
      + `</a>`)
    .join('');
  const inner = `<div class="bsx-hero-in" data-bsx-slider data-bsx-auto="6000">`
    + `<nav class="bsx-hero-nums" aria-label="Manşet seçimi">${nums}</nav>`
    + `<div class="bsx-hero-slides">${slides}</div>`
    + `</div>`;
  return section('bsx-hero', inner);
}

// S3 — Kart seridi: yatay carousel, 10 kart (§3 S3, §6 carousel).
function strip(data) {
  const items = cardsOf(data.strip);
  if (!items.length) return '';
  const inner = `<div class="bsx-strip-car" data-bsx-carousel>`
    + `<button type="button" class="bsx-arrow bsx-arrow--prev" data-bsx-prev aria-label="Önceki">${ARROW_PREV}</button>`
    + `<div class="bsx-strip-track" data-bsx-track>${items.map((c) => card(c)).join('')}</div>`
    + `<button type="button" class="bsx-arrow bsx-arrow--next" data-bsx-next aria-label="Sonraki">${ARROW_NEXT}</button>`
    + `</div>`;
  return section('bsx-strip', inner);
}

function hItem(c) {
  return `<a class="bsx-hitem" href="${esc(hrefOf(c.href))}">`
    + `<span class="bsx-hitem-img">${img(c.image, c.title, 'bsx-hitem-pic')}</span>`
    + `<span class="bsx-hitem-title">${esc(c.title)}</span>`
    + `</a>`;
}

// S4 — Video haber slider (20 slayt, 1..20 numara) + sag kolon GUNDEM listesi (§3 S4).
function featured(data) {
  const slides = cardsOf(data.featured);
  if (!slides.length) return '';
  const gundem = cardsOf(data.gundem);
  const hasSide = gundem.length > 0;

  const slideHtml = slides
    .map((c, i) => `<a class="bsx-feat-slide${i === 0 ? ' is-active' : ''}" data-bsx-slide href="${esc(hrefOf(c.href))}">`
      + `<div class="bsx-feat-img">${slideImg(c, i)}</div>`
      + `<span class="bsx-feat-tag">Video Haber</span>`
      + `<div class="bsx-feat-cap"><h2 class="bsx-feat-title">${esc(c.title)}</h2></div>`
      + `</a>`)
    .join('');
  const numsHtml = slides
    .map((_, i) => `<button type="button"${i === 0 ? ' class="is-active"' : ''} data-bsx-goto="${i}" aria-label="${i + 1}. video">${i + 1}</button>`)
    .join('');

  const main = `<div class="bsx-feat-main" data-bsx-slider>`
    + `<div class="bsx-feat-slides">${slideHtml}</div>`
    + `<div class="bsx-feat-nav">`
    + `<button type="button" class="bsx-feat-arrow" data-bsx-prev aria-label="Önceki">${ARROW_PREV}</button>`
    + `<div class="bsx-feat-nums">${numsHtml}</div>`
    + `<button type="button" class="bsx-feat-arrow" data-bsx-next aria-label="Sonraki">${ARROW_NEXT}</button>`
    + `</div></div>`;

  const side = hasSide
    ? `<aside class="bsx-feat-side">${title('GÜNDEM', '/kategori/gundem')}<div class="bsx-hlist">${gundem.map(hItem).join('')}</div></aside>`
    : '';

  const inner = `<div class="bsx-feat-grid${hasSide ? '' : ' bsx-feat-grid--full'}">${main}${side}</div>`;
  return section('bsx-featured', inner);
}

// S5 — Piyasalar: 6 hucre, deger + degisim rozeti (§3 S5).
function fx(data) {
  const items = list(data.fx);
  if (!items.length) return '';
  const cells = items
    .map((f) => {
      const v = finite(f && f.value);
      const p = finite(f && f.changePct);
      const name = esc((f && (f.name || f.code)) || '');
      const valueHtml = v === null ? '—' : esc(fmtValue(f.code, v));
      let badge = '';
      if (v !== null && p !== null) {
        const dir = p > 0 ? 'up' : p < 0 ? 'down' : 'flat';
        badge = `<span class="bsx-fx-chg bsx-fx-chg--${dir}">${p < 0 ? '-' : ''}%${fmtPct(p)}</span>`;
      }
      return `<div class="bsx-fx-cell"><span class="bsx-fx-name">${name}</span>`
        + `<div class="bsx-fx-row"><span class="bsx-fx-value">${valueHtml}</span>${badge}</div></div>`;
    })
    .join('');
  return section('bsx-fx', `<div class="bsx-fx-in">${cells}</div>`);
}

function initialOrPhoto(c) {
  const name = String(c.name);
  if (url(c.avatar)) return img(c.avatar, name, 'bsx-columnist-img');
  return `<span class="bsx-columnist-initial">${esc(initialOf(name))}</span>`;
}

// S6 — Kose yazarlari: yatay carousel, 401x144 kartlar (§3 S6).
function columnists(data) {
  const items = list(data.columnists).filter((c) => c && c.name);
  if (!items.length) return '';
  const cells = items
    .map((c) => `<a class="bsx-columnist" href="${esc(hrefOf(c.href))}">`
      + `<div class="bsx-columnist-text"><span class="bsx-columnist-name">${esc(c.name)}</span>`
      + `${c.title ? `<span class="bsx-columnist-title">${esc(c.title)}</span>` : ''}</div>`
      + `<div class="bsx-columnist-photo"><span class="bsx-columnist-arc" aria-hidden="true"></span>${initialOrPhoto(c)}</div>`
      + `</a>`)
    .join('');
  const inner = `${title('KÖŞE YAZARLARI', '/yazarlar')}`
    + `<div class="bsx-col-car" data-bsx-carousel>`
    + `<button type="button" class="bsx-arrow bsx-arrow--prev" data-bsx-prev aria-label="Önceki">${ARROW_PREV}</button>`
    + `<div class="bsx-col-track" data-bsx-track>${cells}</div>`
    + `<button type="button" class="bsx-arrow bsx-arrow--next" data-bsx-next aria-label="Sonraki">${ARROW_NEXT}</button>`
    + `</div>`;
  return section('bsx-columnists', inner);
}

// S7 — Haber izgarasi A: 4 kolon, 8 kart, baslik yok (§3 S7).
function gridA(data) {
  const items = cardsOf(data.gridA);
  if (!items.length) return '';
  return section('bsx-gridA', `<div class="bsx-grid4">${items.map((c) => card(c)).join('')}</div>`);
}

module.exports = { breaking, hero, strip, featured, fx, columnists, gridA };
