// BSX ana sayfası: veriyi alır, bölümleri basınsoft sırasıyla birleştirir (TASARIM-BSX.md §3).
const L = require('./bsx-layout');
const S1 = require('./bsx-sections-1');
const S2 = require('./bsx-sections-2');

// Bölüm sırası referansla aynı. Bir bölüm hata verirse yalnız o bölüm düşer, sayfa ayakta kalır.
const ORDER = [
  ['breaking', S1.breaking], ['hero', S1.hero], ['strip', S1.strip], ['featured', S1.featured],
  ['fx', S1.fx], ['columnists', S1.columnists], ['gridA', S1.gridA], ['local', S2.local],
  ['prayer', S2.prayer], ['gridB', S2.gridB], ['magazin', S2.magazin], ['movies', S2.movies],
  ['photos', S2.photos], ['sport', S2.sport], ['videos', S2.videos], ['zodiac', S2.zodiac],
  ['gridC', S2.gridC], ['tabs', S2.tabs], ['weather', S2.weather], ['top6', S2.top6], ['timeline', S2.timeline]
];

// Modül Ayarları (MODUL-AYARLARI.md §3): bölüm → ayar anahtarı. Listede olmayan bölümler her zaman açık.
const TOGGLES = {
  breaking: 'module.breaking', strip: 'module.strip', featured: 'module.featured', fx: 'module.fx',
  columnists: 'module.columnists', local: 'module.local', prayer: 'module.prayer', movies: 'module.movies',
  photos: 'module.photos', videos: 'module.videos', zodiac: 'module.horoscope', weather: 'module.weather'
};

function isEnabled(name, settings) {
  const key = TOGGLES[name];
  return !key || !settings || settings[key] !== 'off';
}

function renderSection(name, fn, data) {
  if (typeof fn !== 'function') return '';
  try { return fn(data) || ''; }
  catch (error) { console.error(`Ana sayfa bölümü çizilemedi (${name}):`, error.message); return ''; }
}

// Tema Ayarları (theme.primary / theme.accent) → BSX CSS değişkenleri. Geçersiz renk yok sayılır.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function themeStyle(settings) {
  const primary = settings && HEX_COLOR.test(settings['theme.primary'] || '') ? settings['theme.primary'] : '';
  const accent = settings && HEX_COLOR.test(settings['theme.accent'] || '') ? settings['theme.accent'] : '';
  const vars = [];
  if (primary) vars.push(`--bsx-red:${primary}`, `--bsx-red2:${primary}`, `--bsx-red-dark:color-mix(in srgb, ${primary} 82%, #000)`);
  if (accent) vars.push(`--bsx-navy:${accent}`, `--bsx-blue:${accent}`);
  return vars.length ? `<style id="site-theme">:root{${vars.join(';')}}</style>` : '';
}

// adHtml: BİK üst reklam alanı; popupAdHtml: "popup" alanındaki aktif reklam (Popup Reklam modülü açıksa);
// settings: settings-store çıktısı (bölüm aç/kapa). Hepsi boş olabilir.
function render(data, { adHtml = '', leftRailAdHtml = '', rightRailAdHtml = '', featureAdHtml = '', popupAdHtml = '', settings = null } = {}) {
  const site = data.site || { brand: 'Art World TV', logoUrl: '/assets/art-world-logo.png', slogan: '', social: [] };
  const sections = ORDER.map(([name, fn]) => {
    if (!isEnabled(name, settings)) return '';
    const html = renderSection(name, fn, data);
    // Üst bant ve manşet slider'ı yan reklam raylarıyla aynı satırda göster.
    if (name === 'breaking' && adHtml) return html;
    if (name === 'hero' && (adHtml || leftRailAdHtml || rightRailAdHtml)) return `<section class="bsx-sec bsx-hero-ad-layout"><div class="bsx-wrap">${leftRailAdHtml ? `<aside class="bsx-ad-rail bsx-ad-rail-left" aria-label="Sol reklam">${leftRailAdHtml}</aside>` : ''}<div class="bsx-hero-ad-center">${adHtml ? `<div class="bsx-ad-leaderboard">${adHtml}</div>` : ''}${html}</div>${rightRailAdHtml ? `<aside class="bsx-ad-rail bsx-ad-rail-right" aria-label="Sağ reklam">${rightRailAdHtml}</aside>` : ''}</div></section>`;
    // "home-feature" reklamı ilk haber ızgarasının altına (ızgara her zaman açık, reklam kaybolmaz).
    if (name === 'gridA' && featureAdHtml) return `${html}<section class="bsx-sec bsx-ad bsx-ad-feature"><div class="bsx-wrap">${featureAdHtml}</div></section>`;
    return html;
  }).join('');
  const head = L.head(`${site.brand} — Haber, Spor, Magazin ve Son Dakika Haberleri`, `${site.brand}: Antalya ve Türkiye gündemi, son dakika haberleri, spor, magazin ve canlı yayın.`)
    .replace('</head>', '<link rel="stylesheet" href="/bsx-ads.css">' + themeStyle(settings) + '</head>');
  const defaultDark = !!settings && settings['theme.defaultDark'] === 'on';
  const headHtml = defaultDark ? head.replace('<body class="bsx">', '<body class="bsx bsx-dark" data-default-dark="1">') : head;
  const popupHtml = popupAdHtml && typeof L.popup === 'function' ? L.popup(popupAdHtml, data.popupHours || 24) : '';
  return `${headHtml}<div id="top"></div>${L.topbar(site)}${L.header(site, data.nav || [])}<main class="bsx-main">${sections}</main>${L.footer(site, data.footer || { columns: [] })}${popupHtml}`
    + L.scripts().replace('</body>', '<script src="/bsx-ads.js" defer></script></body>');
}

module.exports = { render };
