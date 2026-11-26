'use strict';

// BSX ana sayfa veri yükleyicisi. Tek giriş noktası: load().
// Çıktı şekli TASARIM-BSX.md §4 ve MODUL-AYARLARI.md §2 sözleşmelerine uyar.
// load() asla throw etmez: her parça bağımsız çekilir, hata veren parça [] / null alır.

const { loadFootball, loadTurkishEurope, leagueList } = require('./football');
const { getSettings } = require('./settings-store');
const pool = require('../db/pool');

const TZ = 'Europe/Istanbul';
const DEFAULT_CITY = 'Antalya';
const ANTALYA_COORDS = { lat: 36.8969, lon: 30.7133 };
const LOGO_FALLBACK = '/assets/art-world-logo.png';
const YT_DEFAULT = 'https://www.youtube.com/@artworld_tv-anahaberajans%C4%B1';
const FETCH_TIMEOUT_MS = 5000;
const EXTERNAL_TTL_MS = 15 * 60 * 1000;
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const MEMO_TTL_MS = 30 * 1000;
const POOL_SIZE = 120;
const EXCLUDED_NEWS_CATEGORY = 'resmi-reklamlar';
const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

const SOCIAL_KEYS = ['fb', 'x', 'ig', 'yt', 'li', 'tumblr', 'wa', 'tg', 'pin'];

// MODUL-AYARLARI.md §1 varsayılanları (site_settings'te kayıt yoksa geçerli).
const SETTING_DEFAULTS = {
  'module.announcements': 'on',
  'module.city': DEFAULT_CITY,
  'blog.1': 'kultur-sanat',
  'blog.2': 'spor',
  'numbered.category': '',
  'tabs.categories': '',
  'popup.hours': '24'
};

const STATIC_FOOTER = [
  {
    title: 'KURUMSAL',
    links: [
      { label: 'Hakkımızda', href: '/hakkimizda' },
      { label: 'Künye', href: '/kunye' },
      { label: 'İletişim', href: '/iletisim' },
      { label: 'Yayın İlkeleri', href: '/yayin-ilkeleri' },
      { label: 'Gizlilik Politikası', href: '/gizlilik-politikasi' }
    ]
  },
  {
    title: 'SERVİSLER',
    links: [
      { label: 'Hava Durumu', href: '/#bsx-weather' },
      { label: 'Namaz Vakitleri', href: '/#bsx-prayer' },
      { label: 'Burç Yorumları', href: '/burclar' },
      { label: 'Vizyondaki Filmler', href: '/filmler' },
      { label: 'Foto Galeri', href: '/galeri' },
      { label: 'Video Galeri', href: '/video' },
      { label: 'Resmi İlanlar', href: '/resmi-ilanlar' }
    ]
  },
  {
    title: 'BAĞLANTILAR',
    links: [
      { label: 'Haber Gönder', href: '/haber-gonder' },
      { label: 'Köşe Yazarları', href: '/yazarlar' },
      { label: 'Arşiv', href: '/haberler' },
      { label: 'RSS', href: '/rss.xml' },
      { label: 'Site Haritası', href: '/sitemap.xml' }
    ]
  }
];

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

// Yalnızca http(s):// ya da tek '/' ile başlayan adresler kabul edilir.
function safeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  return null;
}

function mediaUrl(storageKey) {
  if (!storageKey) return null;
  return `/media/${String(storageKey).split('/').map(encodeURIComponent).join('/')}`;
}

function articleHref(slug) {
  return `/haber/${encodeURIComponent(slug)}`;
}

function categoryHref(slug) {
  return `/kategori/${encodeURIComponent(slug)}`;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeOf(value) {
  const date = toDate(value);
  return date ? TIME_FMT.format(date) : '';
}

function dateOf(value) {
  const date = toDate(value);
  return date ? DATE_FMT.format(date) : null;
}

function youtubeId(url) {
  const match = String(url || '').trim()
    .match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  return match ? match[1] : '';
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function hm(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function weatherLabel(code) {
  if (code === 0) return 'Açık';
  if (code >= 1 && code <= 3) return 'Parçalı bulutlu';
  if (code === 45 || code === 48) return 'Sisli';
  if (code >= 51 && code <= 57) return 'Çisenti';
  if (code >= 61 && code <= 67) return 'Yağmurlu';
  if (code >= 71 && code <= 77) return 'Karlı';
  if (code >= 80 && code <= 82) return 'Sağanak';
  if (code >= 95 && code <= 99) return 'Gök gürültülü';
  return 'Bilinmiyor';
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayNameOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Türkçe ad -> URL slug (ç→c, ğ→g, ı→i, İ→i, ö→o, ş→s, ü→u; boşluk→-).
function citySlug(name) {
  return String(name || '')
    .replace(/İ/g, 'i')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Ham makale satırı -> havuz girdisi. key: tekrar kontrolü, card: sözleşme nesnesi.
function toEntry(row) {
  const published = row.published_at;
  const date = toDate(published);
  return {
    key: row.slug,
    hasImage: Boolean(row.storage_key),
    ts: date ? date.getTime() : 0,
    categoryId: row.category_id != null ? String(row.category_id) : null,
    card: {
      title: row.headline,
      href: articleHref(row.slug),
      image: mediaUrl(row.storage_key),
      category: row.category_name || null,
      categoryHref: row.category_slug ? categoryHref(row.category_slug) : null,
      time: timeOf(published),
      date: dateOf(published),
      summary: String(row.standfirst || '').trim() || null,
      hideTitle: row.hide_hero_title === true
    }
  };
}

// Girdilerden n kart seçer. Öncelik: kullanılmamış + görselli, sonra kullanılmamış,
// reuse=true ise son olarak tekrar kullanım (havuz küçükse bölüm yine dolsun).
function takeCards(entries, count, used, { reuse = false } = {}) {
  const out = [];
  const taken = new Set();
  const pass = (accept) => {
    for (const entry of entries) {
      if (out.length >= count) return;
      if (taken.has(entry) || used.has(entry.key) || !accept(entry)) continue;
      out.push(entry);
      taken.add(entry);
      used.add(entry.key);
    }
  };
  pass((entry) => entry.hasImage);
  pass(() => true);
  if (reuse) {
    for (const entry of entries) {
      if (out.length >= count) break;
      if (!taken.has(entry)) {
        out.push(entry);
        taken.add(entry);
      }
    }
  }
  return out.map((entry) => entry.card);
}

// Ayar okuma: kayıt varsa (boş dahil) o değer, yoksa MODUL-AYARLARI varsayılanı.
function settingValue(settings, key) {
  if (settings && Object.prototype.hasOwnProperty.call(settings, key)) return settings[key];
  return SETTING_DEFAULTS[key];
}

// Dış kaynak önbelleği: yalnızca başarılı sonuç, 15 dk.
const externalCache = new Map();

async function cached(key, loader) {
  const hit = externalCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  externalCache.set(key, { value, expiresAt: Date.now() + EXTERNAL_TTL_MS });
  return value;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Veritabanı yükleyicileri
// ---------------------------------------------------------------------------

const ARTICLE_COLUMNS = `
  a.slug, a.headline, a.standfirst, a.published_at, a.views_count, a.hide_hero_title,
  c.id AS category_id, c.name AS category_name, c.slug AS category_slug, m.storage_key`;

const ARTICLE_FROM = `
  FROM articles a
  LEFT JOIN categories c ON c.id = a.primary_category_id
  LEFT JOIN media_assets m ON m.id = a.cover_media_id`;

const PUBLISHED_ARTICLE = `a.status = 'published' AND a.published_at <= NOW()`;

// Ayarlar: settings-store (varsayılanlı) + modül/blog/popup anahtarları doğrudan.
// Hata -> boş nesne; değerler yukarıdaki SETTING_DEFAULTS ile tamamlanır.
async function loadSettings() {
  let settings = {};
  try {
    settings = { ...(await getSettings()) };
  } catch (error) {
    console.warn(`[home-data] ayarlar okunamadı: ${error.message}`);
  }
  try {
    const { rows } = await pool.query(`
      SELECT setting_key, setting_value
        FROM site_settings
       WHERE setting_key IN ('logoUrl', 'slogan', 'module.announcements', 'module.city',
                             'blog.1', 'blog.2', 'numbered.category', 'tabs.categories', 'popup.hours')
          OR setting_key LIKE 'social.%'`);
    for (const row of rows) settings[row.setting_key] = String(row.setting_value);
  } catch (error) {
    console.warn(`[home-data] site ayarları okunamadı: ${error.message}`);
  }
  return settings;
}

// Tüm kategoriler: slug -> { id, name, slug, active }.
async function loadCategoryIndex() {
  const { rows } = await pool.query(`SELECT id, name, slug, is_active FROM categories`);
  return new Map(rows.map((row) => [row.slug, {
    id: String(row.id),
    name: row.name,
    slug: row.slug,
    active: Boolean(row.is_active)
  }]));
}

async function loadNav() {
  const { rows } = await pool.query(`
    SELECT name, slug FROM categories WHERE is_active = TRUE ORDER BY sort_order, id`);
  return rows.map((row) => ({ label: row.name, href: categoryHref(row.slug) }));
}

// Son ~120 yayınlı haber; ana dağıtım havuzu (en yeniden eskiye).
async function loadPool() {
  const { rows } = await pool.query(`
    SELECT ${ARTICLE_COLUMNS}
      ${ARTICLE_FROM}
     WHERE ${PUBLISHED_ARTICLE}
     ORDER BY a.published_at DESC, a.id DESC
     LIMIT ${POOL_SIZE}`);
  return rows.map(toEntry);
}

// Kategori havuzları: gundem (kategori başına en fazla 12).
async function loadCategoryPool() {
  const { rows } = await pool.query(`
    WITH ranked AS (
      SELECT ${ARTICLE_COLUMNS},
             ROW_NUMBER() OVER (PARTITION BY c.slug ORDER BY a.published_at DESC, a.id DESC) AS rn
        ${ARTICLE_FROM}
       WHERE ${PUBLISHED_ARTICLE}
         AND c.slug = ANY($1::text[])
    )
    SELECT * FROM ranked WHERE rn <= 12 ORDER BY published_at DESC, slug`, [['gundem']]);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.category_slug)) map.set(row.category_slug, []);
    map.get(row.category_slug).push(toEntry(row));
  }
  return map;
}

// Verilen kategorilerden her biri için en fazla perCategory haber (görselliler önce, en yeni).
// Dönüş: girdi dizisi; her girdinin categoryId alanı vardır.
async function fetchCategoryEntries(ids, perCategory) {
  if (!ids.length) return [];
  const { rows } = await pool.query(`
    WITH ranked AS (
      SELECT ${ARTICLE_COLUMNS},
             ROW_NUMBER() OVER (
               PARTITION BY c.id
               ORDER BY (m.storage_key IS NULL), a.published_at DESC, a.id DESC
             ) AS rn
        ${ARTICLE_FROM}
       WHERE ${PUBLISHED_ARTICLE}
         AND a.primary_category_id = ANY($1::bigint[])
    )
    SELECT * FROM ranked WHERE rn <= $2 ORDER BY rn, published_at DESC`, [ids, perCategory]);
  return rows.map(toEntry);
}

async function loadBreaking() {
  const { rows } = await pool.query(`
    SELECT a.slug, a.headline
      FROM articles a
     WHERE ${PUBLISHED_ARTICLE} AND a.is_breaking = TRUE
     ORDER BY a.published_at DESC, a.id DESC
     LIMIT 10`);
  return rows.map((row) => ({ title: row.headline, href: articleHref(row.slug) }));
}

// Otomatik sekmeler: en çok yayınlı haberi olan 8 aktif kategori (resmi-reklamlar hariç).
async function autoTabCategories() {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.slug
      FROM categories c
      JOIN (
        SELECT primary_category_id, COUNT(*)::int AS n
          FROM articles
         WHERE status = 'published' AND published_at <= NOW() AND primary_category_id IS NOT NULL
         GROUP BY primary_category_id
      ) counts ON counts.primary_category_id = c.id
     WHERE c.is_active = TRUE AND c.slug <> '${EXCLUDED_NEWS_CATEGORY}'
     ORDER BY counts.n DESC, c.sort_order, c.id
     LIMIT 8`);
  return rows.map((row) => ({ id: String(row.id), name: row.name, slug: row.slug }));
}

// Sekmeli kategori bloğu: tabs.categories doluysa o sıra (aktif olmayanlar atlanır),
// boşsa otomatik seçim. Her sekmede en yeni 5 haber (görselliler önce). Tekrar edebilir.
async function loadTabs(ctx) {
  const raw = String(settingValue(ctx.settings, 'tabs.categories') || '');
  const slugs = [...new Set(raw.split(',').map((slug) => slug.trim()).filter(Boolean))]
    .filter((slug) => slug !== EXCLUDED_NEWS_CATEGORY);
  const manual = slugs
    .map((slug) => ctx.index.get(slug))
    .filter((category) => category && category.active)
    .slice(0, 8);
  const categories = manual.length ? manual : await autoTabCategories();
  if (!categories.length) return [];

  const entries = await fetchCategoryEntries(categories.map((category) => category.id), 5);
  return categories.map((category) => ({
    label: category.name,
    href: categoryHref(category.slug),
    items: entries
      .filter((entry) => entry.categoryId === category.id)
      .slice(0, 5)
      .map((entry) => entry.card)
  }));
}

// Blog bloğu: birincil kategori (aktifse); değilse yedek kategoriler (aktif olanlar birleşik).
async function loadBlock(ctx, primarySlug, fallbackSlugs) {
  const primary = ctx.index.get(primarySlug);
  let cats = [];
  let title = null;
  if (primary && primary.active) {
    cats = [primary];
    title = { label: primary.name, href: categoryHref(primary.slug) };
  } else {
    cats = fallbackSlugs.map((slug) => ctx.index.get(slug)).filter((category) => category && category.active);
    if (cats.length) title = { label: cats[0].name, href: categoryHref(cats[0].slug) };
  }
  if (!cats.length) return { title: null, entries: [] };
  const entries = await fetchCategoryEntries(cats.map((category) => category.id), 12);
  return { title, entries: entries.sort((a, b) => b.ts - a.ts) };
}

// Yerel haberler: module.city adının slug'ı ile eşleşen aktif kategori; yoksa null.
async function loadLocal(ctx) {
  const city = cityOf(ctx);
  const slug = citySlug(city);
  const category = ctx.index.get(slug);
  if (!category || !category.active) return null;
  const entries = await fetchCategoryEntries([category.id], 8);
  return {
    title: `${city.toLocaleUpperCase('tr-TR')} HABERLERİ`,
    href: categoryHref(category.slug),
    items: entries.slice(0, 8).map((entry) => entry.card)
  };
}

// Numaralı haberler: numbered.category doluysa o kategoriden haber havuzu; boş/bulunamazsa null.
async function loadNumbered(ctx) {
  const slug = String(settingValue(ctx.settings, 'numbered.category') || '').trim();
  const category = slug ? ctx.index.get(slug) : null;
  if (!category || !category.active) return [];
  return fetchCategoryEntries([category.id], 12);
}

async function loadMostRead() {
  const { rows } = await pool.query(`
    SELECT ${ARTICLE_COLUMNS}
      ${ARTICLE_FROM}
     WHERE ${PUBLISHED_ARTICLE}
     ORDER BY a.views_count DESC, a.published_at DESC, a.id DESC
     LIMIT 24`);
  return rows.map(toEntry);
}

async function loadColumnists() {
  const { rows } = await pool.query(`
    SELECT title, slug, author_name
      FROM columns
     WHERE status = 'published' AND slug IS NOT NULL
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT 6`);
  return rows.map((row) => ({
    name: row.author_name,
    title: row.title,
    href: `/yazi/${encodeURIComponent(row.slug)}`,
    avatar: null
  }));
}

async function loadPhotos() {
  const { rows } = await pool.query(`
    SELECT title, slug, image_urls
      FROM galleries
     WHERE status = 'published' AND slug IS NOT NULL
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT 5`);
  return rows.map((row) => {
    const lines = String(row.image_urls || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      title: row.title,
      href: `/galeri/${encodeURIComponent(row.slug)}`,
      image: safeUrl(lines[0]),
      count: lines.filter((line) => safeUrl(line)).length
    };
  });
}

async function loadVideos() {
  const { rows } = await pool.query(`
    SELECT title, slug, youtube_url
      FROM videos
     WHERE status = 'published' AND slug IS NOT NULL
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT 6`);
  return rows.map((row) => {
    const id = youtubeId(row.youtube_url);
    return {
      title: row.title,
      href: `/video/${encodeURIComponent(row.slug)}`,
      image: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
    };
  });
}

async function loadMovies() {
  const { rows } = await pool.query(`
    SELECT id, title, to_char(release_date, 'YYYY-MM-DD') AS release_date, poster_url
      FROM movies
     WHERE status = 'published'
     ORDER BY release_date DESC NULLS LAST, id DESC
     LIMIT 12`);
  return rows.map((row) => ({
    title: row.title,
    date: row.release_date || null,
    image: safeUrl(row.poster_url),
    href: require('./public-modules').movieHref(row.id, row.title)
  }));
}

async function loadZodiac() {
  const { rows } = await pool.query(`
    SELECT sign_key, sign_name, symbol FROM horoscopes ORDER BY sort_order LIMIT 12`);
  return rows.map((row) => ({ key: row.sign_key, name: row.sign_name, symbol: row.symbol, href: '/burclar' }));
}

async function loadFooterLinks() {
  const { rows } = await pool.query(`
    SELECT c.id AS category_id, c.name AS category, f.label, f.url
      FROM link_categories c
      JOIN footer_links f ON f.category_id = c.id
     ORDER BY c.sort_order, c.id, f.sort_order, f.id`);
  const groups = new Map();
  for (const row of rows) {
    const href = safeUrl(row.url);
    if (!href) continue;
    if (!groups.has(row.category_id)) groups.set(row.category_id, { title: row.category, links: [] });
    groups.get(row.category_id).links.push({ label: row.label, href });
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Dış kaynaklar (hata -> null; yalnız başarılı sonuç 15 dk önbelleğe alınır)
// ---------------------------------------------------------------------------

function cityOf(ctx) {
  return String(settingValue(ctx.settings, 'module.city') || '').trim() || DEFAULT_CITY;
}

// Şehir koordinatı (open-meteo geocoding), şehir başına 24 saat. Başarısızsa Antalya.
const geoCache = new Map();

async function cityCoords(city) {
  const hit = geoCache.get(city);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  try {
    const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr&countryCode=TR`);
    const place = data.results && data.results[0];
    const lat = Number(place?.latitude);
    const lon = Number(place?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('şehir bulunamadı');
    const value = { lat, lon };
    geoCache.set(city, { value, expiresAt: Date.now() + GEO_TTL_MS });
    return value;
  } catch (error) {
    console.warn(`[home-data] "${city}" koordinatı alınamadı, Antalya kullanılıyor: ${error.message}`);
    return ANTALYA_COORDS;
  }
}

async function loadWeather(city) {
  try {
    return await cached(`weather:${city}`, async () => {
      const { lat, lon } = await cityCoords(city);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FIstanbul&forecast_days=7';
      const daily = (await getJson(url)).daily || {};
      const dates = Array.isArray(daily.time) ? daily.time.slice(0, 7) : [];
      const days = dates.map((iso, i) => {
        const [dy, dm, dd] = iso.split('-');
        const min = Number(daily.temperature_2m_min?.[i]);
        const max = Number(daily.temperature_2m_max?.[i]);
        const code = daily.weather_code?.[i];
        return {
          date: `${dd}.${dm}.${dy}`,
          dayName: dayNameOf(iso),
          label: weatherLabel(code),
          code: Number.isFinite(code) ? code : null,
          min: Number.isFinite(min) ? Math.round(min) : null,
          max: Number.isFinite(max) ? Math.round(max) : null
        };
      });
      if (!days.length) throw new Error('Boş hava durumu yanıtı');
      return { city, days };
    });
  } catch (error) {
    console.warn(`[home-data] hava durumu alınamadı: ${error.message}`);
    return null;
  }
}

async function loadPrayer(city) {
  try {
    return await cached(`prayer:${city}`, async () => {
      const data = await getJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Turkey&method=13`);
      const t = data.data.timings;
      const times = {
        imsak: hm(t.Fajr),
        gunes: hm(t.Sunrise),
        ogle: hm(t.Dhuhr),
        ikindi: hm(t.Asr),
        aksam: hm(t.Maghrib),
        yatsi: hm(t.Isha)
      };
      if (Object.values(times).some((v) => v === null)) throw new Error('Eksik namaz vakti');
      return { city, times };
    });
  } catch (error) {
    console.warn(`[home-data] namaz vakitleri alınamadı: ${error.message}`);
    return null;
  }
}

// Frankfurter EUR bazlı oranlar; TRY çaprazları aşağıda hesaplanır.
async function ratesFor(dateParam) {
  const base = 'https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD,TRY,GBP';
  const rows = await getJson(dateParam ? `${base}&date=${dateParam}` : base);
  const map = {};
  for (const row of rows) map[row.quote] = { date: row.date, rate: row.rate };
  if (!map.USD || !map.TRY || !map.GBP) throw new Error('Eksik kur verisi');
  return map;
}

function tryValues(map) {
  return {
    EUR: map.TRY.rate,
    USD: map.TRY.rate / map.USD.rate,
    GBP: map.TRY.rate / map.GBP.rate
  };
}

// Önceki iş günü kuru: geriye en fazla 4 gün bakar; her kur için güncelden eski ilk veri.
async function loadFxPrevious(latest) {
  const latestDate = ['USD', 'TRY', 'GBP'].map((q) => latest[q].date).sort().pop();
  const prev = {};
  for (let k = 1; k <= 4 && Object.keys(prev).length < 3; k += 1) {
    const day = addDays(latestDate, -k);
    let history;
    try {
      history = await cached(`fx-${day}`, () => ratesFor(day));
    } catch {
      continue;
    }
    for (const q of ['USD', 'TRY', 'GBP']) {
      if (!prev[q] && history[q] && history[q].date < latest[q].date) prev[q] = history[q];
    }
  }
  if (Object.keys(prev).length < 3) throw new Error('Önceki gün kuru bulunamadı');
  return prev;
}

function pctChange(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return round(((cur / prev) - 1) * 100, 2);
}

// Sıra: ALTIN, USD, EUR, BIST, GBP, BTC. ALTIN ve BIST için anahtarsız kaynak yok -> null.
async function loadFx() {
  let latest = null;
  try {
    latest = await cached('fx-latest', () => ratesFor(null));
  } catch (error) {
    console.warn(`[home-data] döviz alınamadı: ${error.message}`);
  }

  let prev = null;
  if (latest) {
    try {
      prev = tryValues(await loadFxPrevious(latest));
    } catch {
      prev = null;
    }
  }
  const cur = latest ? tryValues(latest) : null;
  const fxItem = (code, name) => ({
    code,
    name,
    value: cur ? round(cur[code], 4) : null,
    changePct: cur && prev ? pctChange(cur[code], prev[code]) : null
  });

  let btc = { code: 'BTC', name: 'Bitcoin', value: null, changePct: null };
  try {
    const data = await cached('btc', () => getJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=try,usd&include_24hr_change=true'));
    const b = data.bitcoin || {};
    btc = {
      code: 'BTC',
      name: 'Bitcoin',
      value: Number.isFinite(b.try) ? Math.round(b.try) : null,
      changePct: Number.isFinite(b.try_24h_change) ? round(b.try_24h_change, 2) : null
    };
  } catch (error) {
    console.warn(`[home-data] bitcoin alınamadı: ${error.message}`);
  }

  return [
    { code: 'ALTIN', name: 'Altın', value: null, changePct: null },
    fxItem('USD', 'Dolar'),
    fxItem('EUR', 'Euro'),
    { code: 'BIST', name: 'BİST', value: null, changePct: null },
    fxItem('GBP', 'Sterlin'),
    btc
  ];
}

// ---------------------------------------------------------------------------
// Birleştirme
// ---------------------------------------------------------------------------

// Sabit 3 kolon her zaman döner. footer_links kategorisi sabit bir kolonla aynı
// başlıktaysa linkleri o kolonun sonuna, eşleşmeyenler BAĞLANTILAR sonuna eklenir.
// Aynı href tüm kolonlarda yalnız bir kez görünür (ilk geçen kalır).
function buildFooterColumns(dynamicGroups) {
  const columns = STATIC_FOOTER.map((column) => ({
    title: column.title,
    links: column.links.map((link) => ({ ...link }))
  }));
  const byTitle = (title) => columns.find((column) => column.title === title);
  const fallback = byTitle('BAĞLANTILAR');

  for (const group of dynamicGroups) {
    const key = String(group.title || '').toLocaleUpperCase('tr-TR');
    const target = byTitle(key) || fallback;
    target.links.push(...group.links.map((link) => ({ ...link })));
  }

  const seen = new Set();
  for (const column of columns) {
    column.links = column.links.filter((link) => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    });
  }
  return columns;
}

function assemble(raw) {
  const settings = raw.settings || {};
  const poolEntries = raw.pool || [];
  const catEntries = (slug) => (raw.categoryPool && raw.categoryPool.get(slug)) || [];

  const social = SOCIAL_KEYS
    .map((key) => ({ key, href: safeUrl(settings[`social.${key}`]) }))
    .filter((item) => item.href);

  const used = new Set();
  // Manşet en yeni 5 haber olmalı: ilk seçilen bölüm.
  const hero = takeCards(poolEntries, 5, used, { reuse: true });
  // Gundem: kategori haberleri, eksikse genel havuzdan tamamlanır.
  const gundemCat = takeCards(catEntries('gundem'), 5, used);
  const gundem = gundemCat.length < 5
    ? [...gundemCat, ...takeCards(poolEntries, 5 - gundemCat.length, used, { reuse: true })]
    : gundemCat;
  // Blog bölümleri (MODUL-AYARLARI blog.1 / blog.2; yoksa eski varsayılan kategoriler).
  const blog1 = raw.blog1 || { title: null, entries: [] };
  const blog2 = raw.blog2 || { title: null, entries: [] };
  const magazin = takeCards(blog1.entries, 5, used);
  const sport = takeCards(blog2.entries, 5, used);
  // Çok okunanlar popülerlik listesi: genel bölümlerden önce seçilir ki boş kalmasın.
  const mostRead = takeCards(raw.mostRead || [], 8, used);

  const strip = takeCards(poolEntries, 10, used, { reuse: true });
  const featured = takeCards(poolEntries, 20, used, { reuse: true });
  const gridA = takeCards(poolEntries, 8, used, { reuse: true });
  const gridB = takeCards(poolEntries, 8, used, { reuse: true });
  const gridC = takeCards(poolEntries, 10, used, { reuse: true });
  // Numaralı haberler: numbered.category doluysa o kategori, yoksa genel havuz.
  const numbered = raw.numbered && raw.numbered.length ? raw.numbered : poolEntries;
  const top6 = takeCards(numbered, 6, used, { reuse: true });

  const breaking = raw.breaking && raw.breaking.length
    ? raw.breaking
    : poolEntries.slice(0, 10).map((entry) => ({ title: entry.card.title, href: entry.card.href }));

  const timeline = poolEntries.slice(0, 8).map((entry) => ({
    time: entry.card.time,
    title: entry.card.title,
    href: entry.card.href
  }));

  const footer = { columns: buildFooterColumns(raw.footerLinks || []) };

  const hours = Number(settingValue(settings, 'popup.hours'));
  const popupHours = Number.isFinite(hours) && hours >= 1 ? Math.min(720, Math.floor(hours)) : 24;

  return {
    site: {
      brand: 'Art World TV',
      logoUrl: safeUrl(settings.logoUrl) || LOGO_FALLBACK,
      slogan: settings.slogan || '',
      social: social.length ? social : [{ key: 'yt', href: YT_DEFAULT }],
      showAnnouncements: settingValue(settings, 'module.announcements') === 'on',
      // Üst bardaki CANLI YAYIN düğmesi (Modül Ayarları > Canlı Yayın Butonu / Bağlantısı).
      live: settingValue(settings, 'module.liveButton') === 'off' ? null
        : { href: String(settings['live.url'] || '').trim() || '/canli-yayin' }
    },
    nav: raw.nav || [],
    tabs: raw.tabs || [],
    breaking,
    hero,
    strip,
    featured,
    gundem,
    fx: raw.fx || null,
    columnists: raw.columnists || [],
    gridA,
    prayer: raw.prayer || null,
    gridB,
    mostRead,
    magazinTitle: blog1.title,
    magazin,
    sportTitle: blog2.title,
    sport,
    movies: raw.movies || [],
    photos: raw.photos || [],
    videos: raw.videos || [],
    zodiac: raw.zodiac || [],
    gridC,
    weather: raw.weather || null,
    football: raw.football || null,
    top6,
    timeline,
    local: raw.local || null,
    popupHours,
    footer
  };
}

async function settledObject(tasks) {
  const names = Object.keys(tasks);
  const settled = await Promise.allSettled(names.map((name) => tasks[name]()));
  const out = {};
  names.forEach((name, index) => {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      out[name] = result.value;
    } else {
      out[name] = null;
      console.warn(`[home-data] ${name} alınamadı: ${result.reason?.message || result.reason}`);
    }
  });
  return out;
}

async function build() {
  // Aşama 1: ayarlar ve kategori dizini (sonraki aşamalar bunlara bağlı).
  const base = await settledObject({ settings: loadSettings, index: loadCategoryIndex });
  const ctx = { settings: base.settings || {}, index: base.index || new Map() };
  const city = cityOf(ctx);

  // Aşama 2: geri kalan tüm veri paralel.
  const raw = await settledObject({
    nav: loadNav,
    pool: loadPool,
    categoryPool: loadCategoryPool,
    breaking: loadBreaking,
    tabs: () => loadTabs(ctx),
    blog1: () => loadBlock(ctx, String(settingValue(ctx.settings, 'blog.1') || '').trim(), ['kultur-sanat', 'yasam']),
    blog2: () => loadBlock(ctx, String(settingValue(ctx.settings, 'blog.2') || '').trim(), ['spor']),
    numbered: () => loadNumbered(ctx),
    local: () => loadLocal(ctx),
    mostRead: loadMostRead,
    columnists: loadColumnists,
    photos: loadPhotos,
    videos: loadVideos,
    movies: loadMovies,
    zodiac: loadZodiac,
    footerLinks: loadFooterLinks,
    weather: () => loadWeather(city),
    prayer: () => loadPrayer(city),
    football: () => (settingValue(ctx.settings, 'module.standings') === 'off' ? null
      : Promise.all([loadFootball(), loadTurkishEurope().catch(() => null)])
        .then(([league, europe]) => (league ? { ...league, europe, leagues: leagueList() } : null))),
    fx: loadFx
  });
  raw.settings = ctx.settings;
  return assemble(raw);
}

const memo = { value: null, expiresAt: 0, promise: null };

// Tüm veri 30 sn bellekte tutulur (ayar değişikliği en geç 30 sn'de yansır);
// eşzamanlı istekler tek yüklemeyi paylaşır.
function load() {
  if (memo.value && memo.expiresAt > Date.now()) return Promise.resolve(memo.value);
  if (!memo.promise) {
    memo.promise = build()
      .then((value) => {
        memo.value = value;
        memo.expiresAt = Date.now() + MEMO_TTL_MS;
        return value;
      })
      .catch((error) => {
        console.warn(`[home-data] yükleme hatası: ${error.message}`);
        return assemble({});
      })
      .finally(() => {
        memo.promise = null;
      });
  }
  return memo.promise;
}

module.exports = { load };
