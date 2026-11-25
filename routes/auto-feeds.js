'use strict';
/* Burç & Film modülü için günlük otomatik içerik.
   - Vizyondaki filmler: TMDB "now playing" (Türkiye, Türkçe). Yeni filmler afişiyle eklenip yayınlanır,
     vizyondan kalkan TMDB filmleri taslağa alınır. Elle eklenen filmlere dokunulmaz.
   - Günlük burç yorumları: Claude API ile 12 burç için o güne özel, özgün Türkçe kısa yorum.
   Anahtarlar yönetim panelindeki şifreli API kasasından (Ayarlar > API ve entegrasyonlar: "tmdb",
   "anthropic") okunur; kasada yoksa ortam değişkenine (TMDB_API_KEY, ANTHROPIC_API_KEY) bakılır.
   Anahtar yoksa ilgili iş çalışmaz.
   Her iş günde bir kez (İstanbul saatiyle) çalışır; başarısız olursa bir saat sonra yeniden denenir. */

const { randomBytes, createDecipheriv } = require('node:crypto');
const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db/pool');
const { downloadImage } = require('./bot-runner');

const TIME_ZONE = 'Europe/Istanbul';
const RESULT_MAX = 500;
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w500';
const TMDB_PAGES = 2; // sayfa başına 20 film
const TMDB_TIMEOUT_MS = 15000;
const HOROSCOPE_MODEL = 'claude-opus-5-5';
const HOROSCOPE_TEXT_MAX = 2000;

const running = new Set();
const KEY_CACHE_MS = 30000;
let keyCache = { expiresAt: 0, values: {} };

class FeedError extends Error {}

/* ---------- API anahtarları ---------- */
// Kasadaki değer AES-256-GCM ile şifrelidir (routes/api.js encryptSetting ile aynı biçim).
function decryptCredential(value) {
  const [version, ivHex, tagHex, dataHex] = String(value || '').split(':');
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || '';
  if (version !== 'v1' || !/^[a-f0-9]{64}$/i.test(secret) || !/^[a-f0-9]{24}$/i.test(ivHex || '')
    || !/^[a-f0-9]{32}$/i.test(tagHex || '') || !/^(?:[a-f0-9]{2})+$/i.test(dataHex || '')) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8').trim();
  } catch {
    return '';
  }
}

async function loadKeys() {
  if (keyCache.expiresAt > Date.now()) return keyCache.values;
  const values = {};
  try {
    const { rows } = await pool.query(
      `SELECT integration_key, ciphertext FROM integration_credentials
        WHERE integration_key IN ('tmdb', 'anthropic') AND field_key = 'api-key'`
    );
    rows.forEach((row) => { values[row.integration_key] = decryptCredential(row.ciphertext); });
  } catch (error) {
    console.error('[auto-feeds] API anahtarları okunamadı:', error.message);
  }
  keyCache = { expiresAt: Date.now() + KEY_CACHE_MS, values };
  return values;
}

async function tmdbKey() {
  return (await loadKeys()).tmdb || String(process.env.TMDB_API_KEY || '').trim();
}

async function anthropicKey() {
  return (await loadKeys()).anthropic || String(process.env.ANTHROPIC_API_KEY || '').trim();
}

/* ---------- Çalışma kaydı ---------- */
async function getFeedStatus(feedKey) {
  const { rows } = await pool.query(
    'SELECT last_run_at, last_result, last_ok FROM auto_feed_runs WHERE feed_key = $1',
    [feedKey]
  );
  return {
    configured: await FEEDS[feedKey].configured(),
    running: running.has(feedKey),
    last_run_at: rows[0]?.last_run_at || null,
    last_result: rows[0]?.last_result || '',
    last_ok: rows[0]?.last_ok === true
  };
}

async function recordRun(feedKey, ok, text) {
  await pool.query(
    `INSERT INTO auto_feed_runs (feed_key, last_run_at, last_result, last_ok)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (feed_key) DO UPDATE
       SET last_run_at = EXCLUDED.last_run_at, last_result = EXCLUDED.last_result, last_ok = EXCLUDED.last_ok`,
    [feedKey, String(text).slice(0, RESULT_MAX), ok]
  );
}

// Bugün (İstanbul) başarıyla çalıştıysa ya da son bir saatte denendiyse sıra gelmemiştir.
async function isDue(feedKey) {
  const { rows } = await pool.query(
    `SELECT 1 FROM auto_feed_runs
      WHERE feed_key = $1
        AND ((last_ok AND (last_run_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date)
             OR (NOT last_ok AND last_run_at > NOW() - INTERVAL '1 hour'))`,
    [feedKey, TIME_ZONE]
  );
  return rows.length === 0;
}

/* ---------- TMDB: vizyondaki filmler ---------- */
async function tmdbGet(path, params) {
  const key = await tmdbKey();
  const url = new URL(TMDB_API + path);
  Object.entries(params || {}).forEach(([name, value]) => url.searchParams.set(name, String(value)));
  const headers = { Accept: 'application/json' };
  // Uzun "API Okuma Erişim Anahtarı" Bearer olarak, kısa v3 anahtarı api_key parametresi olarak gider.
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(TMDB_TIMEOUT_MS) });
  } catch (error) {
    throw new FeedError(error?.name === 'TimeoutError' ? 'TMDB isteği zaman aşımına uğradı.' : 'TMDB\'ye ulaşılamadı.');
  }
  if (response.status === 401) throw new FeedError('TMDB API anahtarı geçersiz.');
  if (!response.ok) throw new FeedError(`TMDB yanıtı başarısız (HTTP ${response.status}).`);
  return response.json();
}

function cleanText(value, max) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, max) : null;
}

function cleanDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function cleanRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null;
  return Math.round(n * 10) / 10;
}

async function savePoster(client, posterPath, title) {
  if (typeof posterPath !== 'string' || !/^\/[\w.-]+$/.test(posterPath)) return null;
  const image = await downloadImage(TMDB_IMAGE + posterPath);
  if (!image) return null;
  const storageKey = `${randomBytes(20).toString('hex')}.${image.extension}`;
  await client.query(
    `INSERT INTO media_assets
       (storage_key, original_name, mime_type, byte_size, width, height, alt_text, source_credit, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'TMDB', $8)`,
    [storageKey, image.name, image.mime, image.bytes.length, image.width, image.height, title, image.bytes]
  );
  return `/media/${storageKey}`;
}

async function syncMovies() {
  if (!(await tmdbKey())) throw new FeedError('TMDB API anahtarı girilmemiş (Ayarlar > API ve entegrasyonlar).');
  const genreData = await tmdbGet('/genre/movie/list', { language: 'tr-TR' });
  const genres = new Map((genreData.genres || []).map((g) => [g.id, g.name]));

  const seen = new Map();
  for (let page = 1; page <= TMDB_PAGES; page += 1) {
    const data = await tmdbGet('/movie/now_playing', { language: 'tr-TR', region: 'TR', page });
    (data.results || []).forEach((movie) => {
      if (Number.isInteger(movie.id) && !seen.has(movie.id)) seen.set(movie.id, movie);
    });
    if (!data.total_pages || page >= data.total_pages) break;
  }
  if (!seen.size) throw new FeedError('TMDB vizyon listesi boş döndü.');

  const existing = await pool.query(
    'SELECT tmdb_id, poster_url FROM movies WHERE tmdb_id = ANY($1::int[])',
    [[...seen.keys()]]
  );
  const known = new Map(existing.rows.map((row) => [row.tmdb_id, row]));
  let added = 0;
  let updated = 0;

  for (const movie of seen.values()) {
    const title = cleanText(movie.title || movie.original_title, 200);
    if (!title) continue;
    const genre = cleanText((movie.genre_ids || []).map((id) => genres.get(id)).filter(Boolean).slice(0, 2).join(', '), 60);
    const fields = {
      genre,
      releaseDate: cleanDate(movie.release_date),
      rating: cleanRating(movie.vote_average),
      summary: cleanText(movie.overview, 2000)
    };
    const current = known.get(movie.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (current) {
        // Mevcut film: puan ve bilgiler tazelenir; editörün verdiği yayın durumu korunur.
        const posterUrl = current.poster_url || await savePoster(client, movie.poster_path, title);
        await client.query(
          `UPDATE movies
              SET title = $2, genre = COALESCE($3, genre), release_date = COALESCE($4::date, release_date),
                  rating = $5, summary = COALESCE($6, summary), poster_url = $7, updated_at = NOW()
            WHERE tmdb_id = $1`,
          [movie.id, title, fields.genre, fields.releaseDate, fields.rating, fields.summary, posterUrl]
        );
        updated += 1;
      } else {
        let runtime = null;
        try {
          const details = await tmdbGet(`/movie/${movie.id}`, { language: 'tr-TR' });
          if (Number.isInteger(details.runtime) && details.runtime >= 1 && details.runtime <= 600) runtime = details.runtime;
        } catch { /* süre bilgisi olmadan da eklenir */ }
        const posterUrl = await savePoster(client, movie.poster_path, title);
        await client.query(
          `INSERT INTO movies (title, genre, duration_min, release_date, rating, poster_url, summary, status, tmdb_id, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8, 'tmdb')
           ON CONFLICT (tmdb_id) WHERE tmdb_id IS NOT NULL DO NOTHING`,
          [title, fields.genre, runtime, fields.releaseDate, fields.rating, posterUrl, fields.summary, movie.id]
        );
        added += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // Vizyondan kalkan TMDB filmleri sitede gizlenir (silinmez).
  const removed = await pool.query(
    `UPDATE movies SET status = 'draft', updated_at = NOW()
      WHERE source = 'tmdb' AND status = 'published' AND NOT (tmdb_id = ANY($1::int[]))`,
    [[...seen.keys()]]
  );
  return `Tamam: vizyonda ${seen.size} film, ${added} yeni, ${updated} güncellendi, ${removed.rowCount} vizyondan kalktı.`;
}

/* ---------- Claude: günlük burç yorumları ---------- */
const HOROSCOPE_SYSTEM = [
  'Bir Türk haber sitesinin astroloji köşesi için günlük burç yorumları yazıyorsun.',
  'Her burç için o güne özel, özgün, akıcı Türkçe ile 2-3 cümlelik (yaklaşık 250-400 karakter) bir yorum yaz.',
  'Ton sıcak, olumlu ve eğlenceli olsun; aşk, iş, para, sağlık ya da sosyal hayattan bir-iki konuya değin ve burçların yorumlarını birbirinden farklı tut.',
  'Kesin kehanet, korkutucu ifade, tıbbi ya da finansal tavsiye verme; tarih, gezegen konumu gibi doğrulanamayacak teknik iddialara girme.',
  'Burç adını yorumun başında tekrar etme.'
].join(' ');

async function generateHoroscopes() {
  const apiKey = await anthropicKey();
  if (!apiKey) throw new FeedError('Anthropic API anahtarı girilmemiş (Ayarlar > API ve entegrasyonlar).');
  const { rows: signs } = await pool.query('SELECT sign_key, sign_name, date_range FROM horoscopes ORDER BY sort_order');
  if (!signs.length) throw new FeedError('Burç kaydı bulunamadı.');

  const today = new Intl.DateTimeFormat('tr-TR', { timeZone: TIME_ZONE, dateStyle: 'full' }).format(new Date());
  const schema = {
    type: 'object',
    properties: Object.fromEntries(signs.map((s) => [s.sign_key, { type: 'string', description: `${s.sign_name} burcu yorumu` }])),
    required: signs.map((s) => s.sign_key),
    additionalProperties: false
  };

  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await client.beta.messages.create({
      model: HOROSCOPE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: HOROSCOPE_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: `Bugün ${today}. Şu burçlar için bugünün yorumlarını yaz: `
          + signs.map((s) => `${s.sign_name} (${s.date_range})`).join(', ') + '.'
      }]
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new FeedError('Anthropic API anahtarı geçersiz.');
    if (error instanceof Anthropic.PermissionDeniedError) throw new FeedError('Anthropic API anahtarının bu işleme yetkisi yok.');
    if (error instanceof Anthropic.RateLimitError) throw new FeedError('Anthropic API sınırına takıldı; biraz sonra tekrar denenecek.');
    if (error instanceof Anthropic.APIError) throw new FeedError(`Anthropic API hatası (${error.status || 'bağlantı'}).`);
    throw error;
  }
  if (response.stop_reason === 'refusal') throw new FeedError('Model isteği reddetti; yorumlar güncellenmedi.');
  if (response.stop_reason === 'max_tokens') throw new FeedError('Yanıt yarım kaldı; yorumlar güncellenmedi.');

  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new FeedError('Model yanıtı okunamadı; yorumlar güncellenmedi.'); }

  const updates = signs
    .map((s) => [s.sign_key, typeof parsed[s.sign_key] === 'string' ? parsed[s.sign_key].replace(/\s+/g, ' ').trim().slice(0, HOROSCOPE_TEXT_MAX) : ''])
    .filter(([, value]) => value);
  if (updates.length !== signs.length) throw new FeedError('Yanıtta bazı burçlar eksik; yorumlar güncellenmedi.');

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const [key, value] of updates) {
      await db.query('UPDATE horoscopes SET daily_text = $2, updated_at = NOW() WHERE sign_key = $1', [key, value]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
  return `Tamam: ${updates.length} burcun ${today} yorumu yazıldı.`;
}

/* ---------- Çalıştırıcı ---------- */
const FEEDS = {
  movies: { run: syncMovies, configured: async () => Boolean(await tmdbKey()) },
  horoscopes: { run: generateHoroscopes, configured: async () => Boolean(await anthropicKey()) }
};

// Tek bir işi çalıştırır ve sonucu kaydeder. Hata fırlatmaz: { ok, result } döner.
async function runFeed(feedKey) {
  const feed = FEEDS[feedKey];
  if (!feed) return { ok: false, result: 'Bilinmeyen iş.' };
  if (running.has(feedKey)) return { ok: false, result: 'Bu iş zaten çalışıyor. Biraz sonra tekrar deneyin.' };
  running.add(feedKey);
  try {
    let ok = true;
    let result;
    try {
      result = await feed.run();
    } catch (error) {
      ok = false;
      result = error instanceof FeedError ? error.message : 'Beklenmeyen bir hata oluştu.';
      if (!(error instanceof FeedError)) console.error(`[auto-feeds] ${feedKey}:`, error?.stack || error);
    }
    await recordRun(feedKey, ok, result);
    return { ok, result };
  } finally {
    running.delete(feedKey);
  }
}

// Zamanlayıcıdan çağrılır: anahtarı tanımlı ve bugün sırası gelmiş işleri çalıştırır.
async function runDueFeeds() {
  const results = [];
  for (const feedKey of Object.keys(FEEDS)) {
    if (running.has(feedKey) || !(await FEEDS[feedKey].configured())) continue;
    if (!(await isDue(feedKey))) continue;
    results.push({ feedKey, ...(await runFeed(feedKey)) });
  }
  return results;
}

module.exports = { runFeed, runDueFeeds, getFeedStatus };
