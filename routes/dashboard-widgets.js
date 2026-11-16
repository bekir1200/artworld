'use strict';

const pool = require('../db/pool');

const ENDPOINT = '/api/admin/dashboard-widgets';
const ALLOWED_ROLES = new Set(['admin', 'editor_in_chief', 'editor', 'reporter', 'ad_sales', 'crm_manager']);
const ROLE_LABELS = {
  admin: 'Yönetici',
  editor_in_chief: 'Yazı işleri müdürü',
  editor: 'Editör',
  reporter: 'Muhabir',
  ad_sales: 'Reklam satış',
  crm_manager: 'CRM sorumlusu'
};
const ISTANBUL_TZ = 'Europe/Istanbul';
const CITY = 'Antalya';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

/* ---------- Yardımcılar ---------- */

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(value === null ? '' : JSON.stringify(value));
}

function istanbulToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ISTANBUL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function clientIpOf(req) {
  let ip = req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
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

/* ---------- Dış kaynak önbelleği (yalnızca başarılı sonuçlar, 15 dk) ---------- */

const cache = new Map();

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
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

/* ---------- Hava durumu (Open-Meteo) ---------- */

function loadWeather() {
  return cached('weather', async () => {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=36.8969&longitude=30.7133'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FIstanbul&forecast_days=5';
    const data = await getJson(url);
    const daily = data.daily;
    const days = daily.time.slice(0, 5).map((date, i) => ({
      date,
      label: weatherLabel(daily.weather_code[i]),
      min: Number.isFinite(daily.temperature_2m_min[i]) ? Math.round(daily.temperature_2m_min[i]) : null,
      max: Number.isFinite(daily.temperature_2m_max[i]) ? Math.round(daily.temperature_2m_max[i]) : null
    }));
    if (!days.length) throw new Error('Boş hava durumu yanıtı');
    return { city: CITY, days };
  });
}

/* ---------- Namaz vakitleri (Aladhan) ---------- */

function loadPrayer() {
  return cached('prayer', async () => {
    const data = await getJson('https://api.aladhan.com/v1/timingsByCity?city=Antalya&country=Turkey&method=13');
    const t = data.data.timings;
    const hm = (value) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
    };
    const times = {
      imsak: hm(t.Fajr),
      gunes: hm(t.Sunrise),
      ogle: hm(t.Dhuhr),
      ikindi: hm(t.Asr),
      aksam: hm(t.Maghrib),
      yatsi: hm(t.Isha)
    };
    if (Object.values(times).some((v) => v === null)) throw new Error('Eksik namaz vakti');
    return { city: CITY, date: istanbulToday(), times };
  });
}

/* ---------- Döviz (Frankfurter) ve Bitcoin (CoinGecko) ---------- */

async function ratesFor(dateParam) {
  const base = 'https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD,TRY,GBP';
  const rows = await getJson(dateParam ? `${base}&date=${dateParam}` : base);
  const map = {};
  for (const row of rows) map[row.quote] = { date: row.date, rate: row.rate };
  if (!map.USD || !map.TRY || !map.GBP) throw new Error('Eksik kur verisi');
  return map;
}

// EUR/TRY = TRY, USD/TRY = TRY/USD, GBP/TRY = TRY/GBP (hepsi EUR bazlı oranlardan).
function tryValues(map) {
  return {
    EUR: map.TRY.rate,
    USD: map.TRY.rate / map.USD.rate,
    GBP: map.TRY.rate / map.GBP.rate
  };
}

// Önceki iş günü kuru: bugünden geriye en fazla 4 gün bakar; her kur için tarihi
// güncelden eski ilk veriyi alır.
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

async function loadFx() {
  let latest = null;
  try {
    latest = await cached('fx-latest', () => ratesFor(null));
  } catch {
    latest = null;
  }

  let prevValues = null;
  if (latest) {
    try {
      prevValues = tryValues(await loadFxPrevious(latest));
    } catch {
      prevValues = null;
    }
  }
  const curValues = latest ? tryValues(latest) : null;

  const fxItem = (code, name) => ({
    code,
    name,
    value: curValues ? round(curValues[code], 4) : null,
    changePct: curValues && prevValues ? pctChange(curValues[code], prevValues[code]) : null
  });

  let btc = { code: 'BTC', name: 'Bitcoin', value: null, usd: null, changePct: null };
  try {
    const data = await cached('btc', () => getJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=try,usd&include_24hr_change=true'));
    const b = data.bitcoin;
    btc = {
      code: 'BTC',
      name: 'Bitcoin',
      value: Number.isFinite(b.try) ? Math.round(b.try) : null,
      usd: Number.isFinite(b.usd) ? Math.round(b.usd) : null,
      changePct: Number.isFinite(b.try_24h_change) ? round(b.try_24h_change, 2) : null
    };
  } catch {
    // BTC alanları null kalır.
  }

  return [
    fxItem('USD', 'Dolar'),
    fxItem('EUR', 'Euro'),
    fxItem('GBP', 'Sterlin'),
    btc
  ];
}

/* ---------- Veritabanı parçaları ---------- */

const TODAY_SQL = `(NOW() AT TIME ZONE '${ISTANBUL_TZ}')::date`;

async function loadVisits() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE visit_date = ${TODAY_SQL})::int AS today_visitors,
      COALESCE(SUM(page_views) FILTER (WHERE visit_date = ${TODAY_SQL}), 0)::int AS today_views,
      COUNT(*) FILTER (WHERE visit_date >= date_trunc('month', ${TODAY_SQL})::date)::int AS month_visitors,
      COALESCE(SUM(page_views) FILTER (WHERE visit_date >= date_trunc('month', ${TODAY_SQL})::date), 0)::int AS month_views,
      COUNT(*) FILTER (WHERE visit_date >= date_trunc('year', ${TODAY_SQL})::date)::int AS year_visitors,
      COALESCE(SUM(page_views) FILTER (WHERE visit_date >= date_trunc('year', ${TODAY_SQL})::date), 0)::int AS year_views,
      COUNT(*)::int AS all_visitors,
      COALESCE(SUM(page_views), 0)::int AS all_views
    FROM site_visits_daily
  `);
  const r = rows[0];
  return {
    today: { visitors: r.today_visitors, views: r.today_views },
    month: { visitors: r.month_visitors, views: r.month_views },
    year: { visitors: r.year_visitors, views: r.year_views },
    all: { visitors: r.all_visitors, views: r.all_views }
  };
}

async function loadTrend() {
  const { rows } = await pool.query(`
    WITH days AS (
      SELECT generate_series(${TODAY_SQL} - 29, ${TODAY_SQL}, INTERVAL '1 day')::date AS d
    )
    SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
           COUNT(v.visitor_hash)::int AS visitors,
           COALESCE(SUM(v.page_views), 0)::int AS views
      FROM days
      LEFT JOIN site_visits_daily v ON v.visit_date = days.d
     GROUP BY days.d
     ORDER BY days.d
  `);
  return rows;
}

async function loadLiveVisitors() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS n
      FROM site_visitor_live
     WHERE last_seen > NOW() - INTERVAL '30 minutes'
  `);
  return rows[0].n;
}

async function loadCounters() {
  const entries = {
    articles: "SELECT COUNT(*)::int AS n FROM articles WHERE status = 'published'",
    columns: 'SELECT COUNT(*)::int AS n FROM columns',
    galleries: 'SELECT COUNT(*)::int AS n FROM galleries',
    videos: 'SELECT COUNT(*)::int AS n FROM videos',
    announcements: 'SELECT COUNT(*)::int AS n FROM announcements',
    users: 'SELECT COUNT(*)::int AS n FROM users WHERE is_active = TRUE'
  };
  const keys = Object.keys(entries);
  const results = await Promise.allSettled(keys.map(async (k) => (await pool.query(entries[k])).rows[0].n));
  const out = {};
  keys.forEach((k, i) => { out[k] = results[i].status === 'fulfilled' ? results[i].value : null; });
  return out;
}

async function loadStaffOnline() {
  const { rows } = await pool.query(`
    SELECT u.display_name AS "displayName", u.role AS role
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > NOW() AND u.is_active = TRUE
     GROUP BY u.id, u.display_name, u.role
     ORDER BY MAX(s.last_seen_at) DESC
     LIMIT 8
  `);
  return rows.map((r) => ({ displayName: r.displayName, roleLabel: ROLE_LABELS[r.role] || r.role }));
}

async function loadLogs() {
  const { rows } = await pool.query(`
    SELECT u.display_name AS actor, a.action AS action, a.entity_type AS "entityType", a.created_at AS "createdAt"
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 8
  `);
  return rows.map((r) => ({
    actor: r.actor || null,
    action: r.action,
    entityType: r.entityType,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
  }));
}

/* ---------- Yanıt ---------- */

function settled(result) {
  return result.status === 'fulfilled' ? result.value : null;
}

async function buildPayload(req) {
  const [visits, trend, liveVisitors, counters, staffOnline, logs, weather, fx, prayer] = await Promise.allSettled([
    loadVisits(),
    loadTrend(),
    loadLiveVisitors(),
    loadCounters(),
    loadStaffOnline(),
    loadLogs(),
    loadWeather(),
    loadFx(),
    loadPrayer()
  ]);

  return {
    clientIp: clientIpOf(req),
    generatedAt: new Date().toISOString(),
    visits: settled(visits),
    trend: settled(trend),
    liveVisitors: settled(liveVisitors),
    counters: settled(counters),
    staffOnline: settled(staffOnline),
    logs: settled(logs),
    weather: settled(weather),
    fx: settled(fx),
    prayer: settled(prayer)
  };
}

async function handle(user, req, res, method, pathname) {
  if (method !== 'GET' || pathname !== ENDPOINT) return false;
  if (!user) {
    sendJson(res, 401, { error: 'Oturum açmanız gerekiyor.' });
    return true;
  }
  if (!ALLOWED_ROLES.has(user.role)) {
    sendJson(res, 403, { error: 'Bu işlem için yetkiniz yok.' });
    return true;
  }
  sendJson(res, 200, await buildPayload(req));
  return true;
}

module.exports = { handle };
