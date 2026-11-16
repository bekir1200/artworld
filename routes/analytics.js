const { createHash } = require('node:crypto');
const pool = require('../db/pool');

const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|python|headless/i;
const TIME_ZONE = 'Europe/Istanbul';
const LIVE_CLEANUP_CHANCE = 0.01;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function analyticsKey() {
  return process.env.SETTINGS_ENCRYPTION_KEY || 'artworld-analytics';
}

// Europe/Istanbul takvim gunu, YYYY-MM-DD bicimi.
function istanbulDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

// Gunluk tuz: gun degisince ziyaretci kimligi de degisir (izlenebilirlik sinirli).
function dailySalt(dateKey) {
  return sha256(analyticsKey() + dateKey);
}

// Fire-and-forget: cagiran await etmez; hicbir hata disari sizmaz.
async function trackVisit(req, pathname) {
  try {
    if (!req || req.method !== 'GET') return;

    const userAgent = String(req.headers?.['user-agent'] || '');
    if (BOT_PATTERN.test(userAgent)) return;

    const ip = String(req.socket?.remoteAddress || '');
    const dateKey = istanbulDateKey();
    const visitorHash = sha256(dailySalt(dateKey) + ip + userAgent);
    const livePath = String(pathname || '').slice(0, 200);

    await pool.query(
      `INSERT INTO site_visits_daily (visit_date, visitor_hash)
       VALUES ((NOW() AT TIME ZONE 'Europe/Istanbul')::date, $1)
       ON CONFLICT (visit_date, visitor_hash)
       DO UPDATE SET page_views = site_visits_daily.page_views + 1`,
      [visitorHash]
    );

    await pool.query(
      `INSERT INTO site_visitor_live (visitor_hash, last_seen, last_path)
       VALUES ($1, NOW(), $2)
       ON CONFLICT (visitor_hash)
       DO UPDATE SET last_seen = NOW(), last_path = EXCLUDED.last_path`,
      [visitorHash, livePath]
    );

    if (Math.random() < LIVE_CLEANUP_CHANCE) {
      await pool.query(`DELETE FROM site_visitor_live WHERE last_seen < NOW() - INTERVAL '1 day'`);
    }
  } catch (error) {
    console.error('Ziyaretci sayimi kaydedilemedi:', error.message);
  }
}

module.exports = { trackVisit };
