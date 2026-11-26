// BSX ana sayfa bölümleri (2/2): namaz, ızgara B, magazin, filmler, foto, spor,
// video, burçlar, ızgara C, hava durumu, top6, saat akışı.
// Sözleşme: TASARIM-BSX.md §3, §4, §5. Ortak yardımcılar routes/bsx-kit.js'ten gelir.

const footballHtml = require('./football-html');
const { esc, url, img, card, title, section } = require('./bsx-kit');

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// Dizi güvenliği: yalnız anahtar alanı dolu öğeleri, en fazla n tanesini alır.
function list(value, n, key = 'title') {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => x && x[key]).slice(0, n);
}

function hrefOf(value) {
  return esc(url(value) || '#');
}

function upperTr(value) {
  return String(value ?? '').toLocaleUpperCase('tr-TR');
}

// "2026-11-20" ya da "20.11.2026" → "20 Kasım 2026"; çözülemezse ''.
function trDate(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y;
  let mo;
  let d;
  if (m) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else {
    m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!m) return '';
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${String(d).padStart(2, '0')} ${MONTHS[mo - 1]} ${y}`;
}

function temp(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)}°C` : '—';
}

// ---------- Namaz vakitleri ----------
const CAMI_SVG = '<svg class="bsx-pr-ico" viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 40a18 18 0 0 1 36 0M10 46h44M14 40v6M50 40v6M6 46V30M6 30l3-6 3 6M58 46V30M58 30l3-6 3 6M32 22V12M28 16h8"/></svg>';
const PRAYER_KEYS = [['imsak', 'İmsak'], ['gunes', 'Güneş'], ['ogle', 'Öğle'], ['ikindi', 'İkindi'], ['aksam', 'Akşam'], ['yatsi', 'Yatsı']];

function prayer(data) {
  const p = data && data.prayer;
  const times = p && p.times;
  if (!times || !PRAYER_KEYS.some(([k]) => times[k])) return '';
  const city = upperTr(p.city).trim();
  const heading = title(city ? `${city} NAMAZ VAKİTLERİ` : 'NAMAZ VAKİTLERİ', '');
  const cells = PRAYER_KEYS.map(([k, label]) => `<div class="bsx-pr-cell">${CAMI_SVG}<div class="bsx-pr-text"><span class="bsx-pr-time">${esc(times[k] || '—')}</span><span class="bsx-pr-name">${esc(label)}</span></div></div>`).join('');
  return section('bsx-prayer', heading + `<div class="bsx-pr-grid">${cells}</div>`);
}

// ---------- Izgara B + Çok okunanlar ----------
function readRow(c) {
  const badge = c.category ? `<span class="bsx-mr-badge">${esc(c.category)}</span>` : '';
  return `<a class="bsx-mr-row" href="${hrefOf(c.href)}"><div class="bsx-mr-img">${img(c.image, c.title, 'bsx-gb-img')}${badge}</div><h3 class="bsx-mr-title">${esc(c.title)}</h3></a>`;
}

function gridB(data) {
  const main = list(data && data.gridB, 8);
  const reads = list(data && data.mostRead, 8);
  if (!main.length && !reads.length) return '';
  const bigHtml = main.slice(0, 2).map((c) => card(c, { size: 'md', cls: 'bsx-gb-big' })).join('');
  const smallHtml = main.slice(2, 8).map((c) => card(c, { size: 'sm', cls: 'bsx-gb-sm' })).join('');
  const left = main.length ? `<div class="bsx-gb-main">${bigHtml}${smallHtml}</div>` : '';
  const right = reads.length
    ? `<div class="bsx-gb-side">${title('ÇOK OKUNANLAR', '/haberler')}<div class="bsx-mr-list">${reads.map((c) => readRow(c)).join('')}</div></div>`
    : '';
  return section('bsx-gridb', `<div class="bsx-gb">${left}${right}</div>`);
}

// ---------- Magazin ----------
function magazin(data) {
  const items = list(data && data.magazin, 5);
  if (!items.length) return '';
  const [first, ...rest] = items;
  const more = url(first.categoryHref) || '/haberler';
  // Modül ayarı: magazinTitle {label, href} varsa başlık ondan; yoksa varsayılan 'MAGAZİN'.
  const mt = data && data.magazinTitle;
  const heading = mt && mt.label ? title(upperTr(mt.label), mt.href) : title('MAGAZİN', more);
  const grid = `<div class="bsx-mg-grid">${card(first, { summary: true, cls: 'bsx-mg-big' })}${rest.map((c) => card(c, { size: 'sm' })).join('')}</div>`;
  return section('bsx-magazin', heading + grid);
}

// ---------- Vizyondaki filmler (carousel) ----------
function movies(data) {
  const items = list(data && data.movies, 12);
  if (!items.length) return '';
  const slides = items.map((m) => {
    const date = trDate(m.date);
    const chip = date ? `<span class="bsx-mv-date">${esc(date)}</span>` : '';
    return `<a class="bsx-mv-item" href="${hrefOf(m.href)}"><div class="bsx-mv-img">${img(m.image, m.title, 'bsx-mv-pic')}${chip}</div><div class="bsx-mv-body"><h3 class="bsx-mv-title">${esc(m.title)}</h3></div></a>`;
  }).join('');
  const carousel = `<div class="bsx-mv-carousel" data-bsx-carousel><button class="bsx-arrow bsx-arrow--prev" type="button" data-bsx-prev aria-label="Önceki">‹</button><div class="bsx-mv-track" data-bsx-track>${slides}</div><button class="bsx-arrow bsx-arrow--next" type="button" data-bsx-next aria-label="Sonraki">›</button></div>`;
  return section('bsx-movies', title('VİZYONDAKİ FİLMLER', '/filmler') + carousel);
}

// ---------- Foto galeri (3 kolon: sol 2 / orta 1 büyük / sağ 2) ----------
function photos(data) {
  const items = list(data && data.photos, 5);
  if (!items.length) return '';
  // Eksik veride boş kolon bırakılmaz: dolu grupların sayısı kadar kolon açılır.
  const groups = [items.slice(0, 2), items.slice(2, 3), items.slice(3, 5)].filter((g) => g.length);
  const cells = groups.map((g, gi) => g.map((p, pi) => {
    const row = g.length === 1 ? '1 / span 2' : String(pi + 1);
    return `<a class="bsx-ph-card" href="${hrefOf(p.href)}" style="grid-column:${gi + 1};grid-row:${row}"><div class="bsx-ph-img">${img(p.image, p.title, 'bsx-ph-pic')}</div><span class="bsx-ph-cap">${esc(p.title)}</span></a>`;
  }).join('')).join('');
  const cols = groups.length;
  const grid = `<div class="bsx-ph-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${cells}</div>`;
  return section('bsx-photos', title('FOTO GALERİ', '/galeri', { light: true }) + grid);
}

// ---------- Spor ----------
function sport(data) {
  const items = list(data && data.sport, 5);
  if (!items.length) return '';
  const big = items.length > 4 ? items[4] : items[0];
  const smalls = items.filter((c) => c !== big).slice(0, 4);
  const more = url(items[0].categoryHref) || '/kategori/spor';
  // Modül ayarı: sportTitle {label, href} varsa başlık ondan; yoksa varsayılan 'SPOR'.
  const st = data && data.sportTitle;
  const heading = st && st.label ? title(upperTr(st.label), st.href) : title('SPOR', more);
  const smallHtml = smalls.map((c) => card(c, { size: 'sm' })).join('');
  const grid = `<div class="bsx-sp-grid"><div class="bsx-sp-smalls">${smallHtml}</div>${card(big, { summary: true, cls: 'bsx-sp-big' })}</div>`;
  return section('bsx-sport', heading + grid);
}

// ---------- Video galeri ----------
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#fff" d="M8 5v14l11-7z"/></svg>';

function videos(data) {
  const items = list(data && data.videos, 6);
  if (!items.length) return '';
  const [big, ...rest] = items;
  const bigHtml = `<a class="bsx-vd-big" href="${hrefOf(big.href)}"><div class="bsx-vd-img">${img(big.image, big.title, 'bsx-vd-pic')}</div><span class="bsx-vd-play" aria-hidden="true">${PLAY_SVG}</span><div class="bsx-vd-cap"><h3 class="bsx-vd-bigtitle">${esc(big.title)}</h3></div></a>`;
  const rows = rest.slice(0, 5).map((v) => `<a class="bsx-vd-row" href="${hrefOf(v.href)}"><div class="bsx-vd-thumb">${img(v.image, v.title, 'bsx-vd-pic')}<span class="bsx-vd-play-sm" aria-hidden="true">${PLAY_SVG}</span></div><span class="bsx-vd-rowtitle">${esc(v.title)}</span></a>`).join('');
  // Tek video varsa sağ liste olmaz; büyük kapak tam genişlikte, yüksekliği 464px ile sınırlı kalır.
  const gridCls = rest.length ? 'bsx-vd-grid' : 'bsx-vd-grid bsx-vd-grid--single';
  const listHtml = rest.length ? `<div class="bsx-vd-list">${rows}</div>` : '';
  return section('bsx-videos', title('VİDEO GALERİ', '/video', { light: true }) + `<div class="${gridCls}">${bigHtml}${listHtml}</div>`);
}

// ---------- Yerel haberler ("<ŞEHİR> HABERLERİ") ----------
function local(data) {
  const l = data && data.local;
  if (!l) return '';
  const items = list(l.items, 8);
  if (!items.length) return '';
  const cards = items.map((c) => card(c)).join('');
  return section('bsx-local', title(l.title, l.href) + `<div class="bsx-lc-grid">${cards}</div>`);
}

// ---------- Burçlar ----------
function zodiac(data) {
  const items = list(data && data.zodiac, 12, 'name');
  if (!items.length) return '';
  const cells = items.map((z) => `<a class="bsx-zd-item" href="${hrefOf(z.href)}"><span class="bsx-zd-sym" aria-hidden="true">${esc(z.symbol)}</span><span class="bsx-zd-name">${esc(z.name)}</span></a>`).join('');
  return section('bsx-zodiac', title('BURÇLAR', '/burclar') + `<div class="bsx-zd-strip"><div class="bsx-zd-grid">${cells}</div></div>`);
}

// ---------- Izgara C ----------
function gridC(data) {
  const items = list(data && data.gridC, 10);
  if (!items.length) return '';
  const bigHtml = items.slice(0, 3).map((c) => card(c, { size: 'md', cls: 'bsx-gc-big' })).join('');
  const smallHtml = items.slice(3, 10).map((c) => card(c, { size: 'sm', cls: 'bsx-gc-sm' })).join('');
  return section('bsx-gridc', `<div class="bsx-gc-grid">${bigHtml}${smallHtml}</div>`);
}

// ---------- Sekmeli kategori bloğu (hava durumundan önce) ----------
// Sözleşme: data.tabs = [{label, href, items:[card x5]}]. JS (data-bsx-tabs / data-bsx-tab / data-bsx-pane) başka ajanda.
function tabs(data) {
  const groups = Array.isArray(data && data.tabs)
    ? data.tabs.filter((t) => t && t.label && Array.isArray(t.items) && t.items.some((c) => c && c.title))
    : [];
  if (!groups.length) return '';
  const bar = groups.map((t, i) => `<button type="button" class="bsx-tb-btn${i === 0 ? ' is-active' : ''}" role="tab" data-bsx-tab="${i}" aria-selected="${i === 0 ? 'true' : 'false'}">${esc(t.label)}</button>`).join('');
  const panes = groups.map((t, i) => {
    const items = t.items.filter((c) => c && c.title).slice(0, 5);
    const [first, ...rest] = items;
    return `<div class="bsx-tb-pane" role="tabpanel" data-bsx-pane="${i}"${i > 0 ? ' hidden' : ''}><div class="bsx-tb-pane-grid">${card(first, { summary: true, cls: 'bsx-tb-big' })}<div class="bsx-tb-small">${rest.map((c) => card(c, { size: 'sm' })).join('')}</div></div></div>`;
  }).join('');
  return section('bsx-tabs', `<div class="bsx-tb" data-bsx-tabs><div class="bsx-tb-bar" role="tablist">${bar}</div>${panes}</div>`);
}

// ---------- Hava durumu ----------
const ICON_OPEN = '<svg class="bsx-wx-ico" viewBox="0 0 64 64" aria-hidden="true" focusable="false">';
const CLOUD = '<path fill="#94a3b8" d="M18 46h28a10 10 0 0 0 0-20 14 14 0 0 0-27 4 8 8 0 0 0-1 16z"/>';

function sunPart(cx, cy, r) {
  let rays = '';
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    const x1 = (cx + (r + 4) * Math.cos(a)).toFixed(1);
    const y1 = (cy + (r + 4) * Math.sin(a)).toFixed(1);
    const x2 = (cx + (r + 9) * Math.cos(a)).toFixed(1);
    const y2 = (cy + (r + 9) * Math.sin(a)).toFixed(1);
    rays += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f59e0b"/><g stroke="#f59e0b" stroke-width="3" stroke-linecap="round">${rays}</g>`;
}

const WX = {
  sun: `${ICON_OPEN}${sunPart(32, 32, 11)}</svg>`,
  partly: `${ICON_OPEN}${sunPart(24, 24, 8)}${CLOUD}</svg>`,
  cloud: `${ICON_OPEN}${CLOUD}</svg>`,
  fog: `${ICON_OPEN}<g stroke="#94a3b8" stroke-width="4" stroke-linecap="round"><path d="M12 24h40M18 34h32M12 44h40"/></g></svg>`,
  rain: `${ICON_OPEN}${CLOUD}<g stroke="#3b82f6" stroke-width="3" stroke-linecap="round"><path d="M24 50l-3 8M34 50l-3 8M44 50l-3 8"/></g></svg>`,
  snow: `${ICON_OPEN}${CLOUD}<g fill="#3b82f6"><circle cx="24" cy="54" r="3"/><circle cx="34" cy="58" r="3"/><circle cx="44" cy="54" r="3"/></g></svg>`,
  storm: `${ICON_OPEN}${CLOUD}<path fill="#f59e0b" d="M34 44l-7 10h6l-4 10 10-13h-6l4-7z"/></svg>`,
};

function wxIcon(code) {
  const c = code === null || code === undefined || code === '' ? NaN : Number(code);
  if (c === 0) return WX.sun;
  if (c >= 1 && c <= 3) return WX.partly;
  if (c === 45 || c === 48) return WX.fog;
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return WX.rain;
  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return WX.snow;
  if (c >= 95 && c <= 99) return WX.storm;
  return WX.cloud;
}

function weather(data) {
  const w = data && data.weather;
  if (!w || !Array.isArray(w.days) || !w.days.length) return '';
  const city = upperTr(w.city).trim();
  const days = w.days.slice(0, 7).map((d) => `<div class="bsx-wx-day"><span class="bsx-wx-date">${esc(d.date)}</span><span class="bsx-wx-name">${esc(d.dayName)}</span>${wxIcon(d.code)}<span class="bsx-wx-label">${esc(d.label)}</span><span class="bsx-wx-temp">${temp(d.min)} / ${temp(d.max)}</span></div>`).join('');
  const heading = city ? `${city} HAVA DURUMU` : 'HAVA DURUMU';
  return section('bsx-weather', title(heading, '') + `<div class="bsx-wx-grid">${days}</div>`);
}

// ---------- Puan durumu ve fikstür (Süper Lig) ----------
function standings(data) {
  const f = data && data.football;
  const inner = footballHtml.homeBlock(f, { europe: f && f.europe, leagues: (f && f.leagues) || [] });
  return inner ? section('bsx-standings', title('PUAN DURUMU VE FİKSTÜR', '/puan-durumu') + inner) : '';
}

// ---------- Numaralı liste (top 6) ----------
function top6(data) {
  const items = list(data && data.top6, 6);
  if (!items.length) return '';
  const cells = items.map((c, i) => {
    const cat = c.category ? `<span class="bsx-t6-cat">${esc(upperTr(c.category))}</span>` : '';
    return `<a class="bsx-t6-item" href="${hrefOf(c.href)}"><span class="bsx-t6-num">${i + 1}</span><div class="bsx-t6-body">${cat}<h3 class="bsx-t6-title">${esc(c.title)}</h3></div></a>`;
  }).join('');
  return section('bsx-top6', `<div class="bsx-t6-grid">${cells}</div>`);
}

// ---------- Saat akışı ----------
function timeline(data) {
  const items = list(data && data.timeline, 6);
  if (!items.length) return '';
  const rows = items.map((t) => `<a class="bsx-tl-item" href="${hrefOf(t.href)}"><span class="bsx-tl-time">${esc(t.time)}</span><span class="bsx-tl-title">${esc(t.title)}</span></a>`).join('');
  return section('bsx-timeline', `<div class="bsx-tl-grid">${rows}</div>`);
}

module.exports = { prayer, gridB, magazin, movies, photos, sport, standings, videos, local, zodiac, gridC, tabs, weather, top6, timeline };
