'use strict';
/* İçerik botu çekim motoru.
   Aktif ajansların RSS/Atom beslemesini çeker ve yeni haberleri articles tablosuna TASLAK olarak ekler.
   Otomatik yayın yoktur: status her zaman 'draft'. Harici kütüphane yok; ayrıştırma regex ile yapılır. */

const dns = require('node:dns/promises');
const net = require('node:net');
const pool = require('../db/pool');
const { getSettings } = require('./settings-store');

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 30;
const USER_AGENT = 'ArtWorldTV-ContentBot/1.0';
const DEFAULT_INTERVAL_MIN = 30;
const TITLE_MAX = 220;
const SPOT_MAX = 300;
const BODY_MAX = 20000;
const RESULT_MAX = 500;
const URL_MAX = 2000;

// Modül düzeyinde kilit: aynı anda tek çekim (zamanlayıcı ya da manuel).
let running = false;

class BotError extends Error {}

/* ---------- Ayarlar ---------- */
async function loadCronSettings() {
  try {
    const settings = (await getSettings()) || {};
    const enabledRaw = String(settings['cron.botsEnabled'] ?? 'on').trim().toLowerCase();
    const minutes = Number(String(settings['cron.botIntervalMinutes'] ?? DEFAULT_INTERVAL_MIN).trim());
    return {
      enabled: enabledRaw !== 'off',
      intervalMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.floor(minutes) : DEFAULT_INTERVAL_MIN
    };
  } catch (error) {
    console.error('[bot-runner] Ayarlar okunamadı, varsayılanlar kullanılıyor:', error.message);
    return { enabled: true, intervalMinutes: DEFAULT_INTERVAL_MIN };
  }
}

/* ---------- SSRF koruması ---------- */
function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || a >= 224;                          // multicast / rezerv / yayın
}

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family !== 6) return true; // bilinmeyen biçim: güvenli tarafta kal
  const ip = address.toLowerCase();
  if (ip.startsWith('::')) {
    // ::, ::1 ve IPv4-mapped (::ffff:a.b.c.d / ::ffff:xxxx:yyyy) kontrolü
    const mappedDotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
    const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPrivateIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
    }
    return true; // ::, ::1 ve deprecated ::/96 aralığı
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00   // fc00::/7 (unique local)
    || (first & 0xffc0) === 0xfe80;    // fe80::/10 (link-local)
}

async function assertPublicHttpUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { throw new BotError('RSS adresi geçersiz.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BotError('Yalnız http(s) RSS adresleri desteklenir.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new BotError('RSS adresi geçersiz.');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new BotError('İç ağ adreslerine istek yapılamaz.');
    return url;
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BotError('RSS sunucusu çözümlenemedi.');
  }
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new BotError('İç ağ adreslerine istek yapılamaz.');
  }
  return url;
}

/* ---------- Çekme ---------- */
const MAX_REDIRECTS = 3;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// Yönlendirmeler elle izlenir; her adım isteğten önce herkese açık adres kontrolünden geçer.
async function fetchWithValidatedRedirects(rawUrl) {
  let current = String(rawUrl);
  for (let hop = 0; ; hop += 1) {
    await assertPublicHttpUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5'
      }
    });
    if (!REDIRECT_CODES.has(response.status)) {
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        throw new BotError(`Desteklenmeyen yönlendirme kodu (HTTP ${response.status}).`);
      }
      return response;
    }
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new BotError('RSS adresi çok fazla yönlendiriyor.');
    const location = response.headers.get('location');
    if (!location) throw new BotError('Yönlendirme adresi eksik.');
    try {
      current = new URL(location, current).href;
    } catch {
      throw new BotError('Yönlendirme adresi geçersiz.');
    }
  }
}

// Charset önceliği: Content-Type charset, yoksa XML bildirimindeki encoding, yoksa utf-8.
function detectCharset(contentType, bytes) {
  const fromHeader = String(contentType || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  if (fromHeader) return fromHeader[1];
  const head = bytes.subarray(0, 200).toString('latin1');
  const fromXml = head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i);
  return fromXml ? fromXml[1] : null;
}

function decodeFeedBytes(bytes, contentType) {
  const label = detectCharset(contentType, bytes);
  let decoder;
  try {
    decoder = new TextDecoder(label || 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8'); // desteklenmeyen ya da geçersiz etiket
  }
  return decoder.decode(bytes);
}

async function fetchFeedText(rawUrl) {
  const response = await fetchWithValidatedRedirects(rawUrl);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new BotError(`RSS yanıtı başarısız (HTTP ${response.status}).`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new BotError('RSS yanıtı 2 MB sınırını aşıyor.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BotError('RSS yanıtı 2 MB sınırını aşıyor.');
    }
    chunks.push(value);
  }
  return decodeFeedBytes(Buffer.concat(chunks), response.headers.get('content-type'));
}

/* ---------- RSS / Atom ayrıştırma (paketsiz) ---------- */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

function unwrapCdata(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// CDATA aç, HTML etiketlerini sök, entity'leri çöz (entity'li HTML için bir kez daha sök), satırları toparla.
function toPlainText(raw) {
  let text = unwrapCdata(String(raw || ''));
  text = text.replace(/<\/p\s*>|<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/<[^>]*>/g, ' ');
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function getTagContent(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'));
  return match ? match[1] : '';
}

function extractLink(block) {
  // Atom: <link href="..." /> (rel yoksa ya da alternate)
  for (const match of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const rel = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i);
    if (href && (!rel || rel[1].toLowerCase() === 'alternate')) return decodeEntities(href[1]).trim();
  }
  // RSS: <link>https://...</link>
  return toPlainText(getTagContent(block, 'link')).replace(/\s+/g, ' ').trim();
}

function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((match) => match[2]);
  return blocks.slice(0, MAX_ITEMS).map((block) => {
    const description = toPlainText(
      getTagContent(block, 'description') || getTagContent(block, 'summary')
      || getTagContent(block, 'content:encoded') || getTagContent(block, 'content')
    );
    const dateRaw = toPlainText(getTagContent(block, 'pubDate') || getTagContent(block, 'published') || getTagContent(block, 'updated'));
    const publishedAt = dateRaw ? new Date(dateRaw) : null;
    return {
      title: toPlainText(getTagContent(block, 'title')).replace(/\s+/g, ' ').trim(),
      link: extractLink(block),
      description,
      pubDate: dateRaw || null,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.valueOf()) ? publishedAt.toISOString() : null,
      guid: toPlainText(getTagContent(block, 'guid') || getTagContent(block, 'id')).replace(/\s+/g, ' ').trim() || null
    };
  });
}

/* ---------- Taslak ekleme ---------- */
// Haber Yönetimi ile aynı slug deseni (routes/api.js slugify).
function slugify(text) {
  return text.toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180) || 'haber';
}

async function findDefaultCategoryId() {
  // Kategori: 'Gündem' (import-artworld-archive.js ile aynı varsayılan). Yoksa NULL.
  const result = await pool.query("SELECT id FROM categories WHERE slug = 'gundem' AND is_active = TRUE LIMIT 1");
  return result.rows[0]?.id || null;
}

// Tek öğe: 'inserted' | 'skipped'. Hata fırlatabilir (executeBot yakalar).
async function importItem(bot, item, categoryId) {
  const headline = item.title.slice(0, TITLE_MAX);
  if (!headline) return 'skipped';
  if (!item.link || item.link.length > URL_MAX) return 'skipped';
  let parsed;
  try { parsed = new URL(item.link); } catch { return 'skipped'; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'skipped';
  const sourceUrl = parsed.href;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT 1 FROM articles WHERE source_url = $1 LIMIT 1', [sourceUrl]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      return 'skipped';
    }

    const baseSlug = slugify(headline);
    // routes/api.js ile aynı advisory lock anahtarı: eşzamanlı slug çakışması olmasın.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`article-slug:${baseSlug}`]);
    let slug = baseSlug;
    let suffix = 2;
    while ((await client.query('SELECT 1 FROM articles WHERE slug = $1', [slug])).rowCount) {
      slug = `${baseSlug.slice(0, 175)}-${suffix++}`;
    }

    const standfirst = item.description.slice(0, SPOT_MAX);
    const sourceLine = `Kaynak: ${bot.agency_name}`;
    const description = item.description.slice(0, BODY_MAX - sourceLine.length - 4);
    const bodyText = (description ? `${description}\n\n` : '') + sourceLine;
    const body = [{ type: 'paragraph', text: bodyText }];

    // Ajansta "otomatik yayınla" açıksa haber doğrudan yayına girer, değilse editör onayı bekler.
    const status = bot.auto_publish === true ? 'published' : 'draft';
    const inserted = await client.query(
      `INSERT INTO articles
         (slug, headline, standfirst, body, status, primary_category_id,
          source_name, source_url, seo_title, seo_description, published_at)
       VALUES ($1, $2, $3, $4::jsonb, $10, $5, $6, $7, $8, $9,
               CASE WHEN $10 = 'published' THEN NOW() END)
       RETURNING id`,
      [slug, headline, standfirst, JSON.stringify(body), categoryId,
        bot.agency_name, sourceUrl, headline, standfirst, status]
    );
    const articleId = inserted.rows[0].id;
    const note = status === 'published'
      ? 'İçerik botu tarafından otomatik yayınlandı'
      : 'İçerik botu tarafından taslak olarak eklendi';

    await client.query(
      `INSERT INTO article_revisions (article_id, revision_number, snapshot, change_note)
       VALUES ($1, 1, $2::jsonb, $3)`,
      [articleId, JSON.stringify({ headline, standfirst, body, status, primary_category_id: categoryId }), note]
    );
    await client.query(
      `INSERT INTO article_workflow_events (article_id, from_status, to_status, note)
       VALUES ($1, NULL, $2, $3)`,
      [articleId, status, note]
    );
    await client.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, after_data)
       VALUES ('bot.article.imported', 'article', $1, $2::jsonb)`,
      [articleId, JSON.stringify({ source_url: sourceUrl, agency_key: bot.agency_key, status, source_published_at: item.publishedAt })]
    );
    await client.query('COMMIT');
    return 'inserted';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ---------- Bir ajans çekimi (kilit dışı; çağıran kilidi tutar) ---------- */
function describeFetchError(error) {
  if (error instanceof BotError) return error.message;
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'RSS isteği zaman aşımına uğradı.';
  return 'RSS adresine ulaşılamadı.';
}

async function executeBot(bot, categoryId) {
  const summary = { botId: bot.id, agency: bot.agency_name, fetched: 0, inserted: 0, skipped: 0, failed: 0, error: null };
  let runError = null;
  try {
    if (!bot.rss_url || !String(bot.rss_url).trim()) throw new BotError('Önce RSS adresi girin.');
    const xml = await fetchFeedText(String(bot.rss_url).trim());
    const items = parseFeed(xml);
    summary.fetched = items.length;
    for (const item of items) {
      try {
        const outcome = await importItem(bot, item, categoryId);
        if (outcome === 'inserted') summary.inserted += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`[bot-runner] ${bot.agency_key} öğe kaydedilemedi:`, error.message);
      }
    }
  } catch (error) {
    runError = describeFetchError(error);
    if (!(error instanceof BotError)) console.error(`[bot-runner] ${bot.agency_key} çekim hatası:`, error.message);
  }

  summary.error = runError;
  const text = runError
    ? runError
    : `Tamam: ${summary.fetched} öğe, ${summary.inserted} yeni, ${summary.skipped} mevcut veya atlandı`
      + (summary.failed ? `, ${summary.failed} kayıt hatası` : '');
  summary.result = text.slice(0, RESULT_MAX);

  await pool.query(
    `UPDATE content_bots
        SET last_run_at = NOW(), last_result = $2, last_inserted = $3
      WHERE id = $1`,
    [bot.id, summary.result, runError ? 0 : summary.inserted]
  );
  return summary;
}

async function findBotById(id) {
  const result = await pool.query(
    'SELECT id, agency_key, agency_name, rss_url, auto_publish FROM content_bots WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

/* ---------- Dışa açık API ---------- */
// Manuel çekim. Asla throw etmez; sonuç her zaman {botId, agency, fetched, inserted, skipped, error}.
async function runBot(botId) {
  const id = Number(botId);
  const empty = (error, agency = null) => ({ botId: id, agency, fetched: 0, inserted: 0, skipped: 0, error });
  if (!Number.isSafeInteger(id) || id < 1) return empty('Geçersiz ajans kimliği.');
  if (running) return empty('Başka bir çekim sürüyor. Biraz sonra tekrar deneyin.');
  running = true;
  try {
    const bot = await findBotById(id);
    if (!bot) return empty('Ajans bulunamadı.');
    const categoryId = await findDefaultCategoryId();
    const summary = await executeBot(bot, categoryId);
    return {
      botId: summary.botId,
      agency: summary.agency,
      fetched: summary.fetched,
      inserted: summary.inserted,
      skipped: summary.skipped,
      error: summary.error
    };
  } catch (error) {
    console.error('[bot-runner] runBot hatası:', error.message);
    return empty('Çekim başlatılamadı.');
  } finally {
    running = false;
  }
}

// Zamanlayıcı girişi. Asla throw etmez.
async function runDueBots() {
  if (running) return [];
  running = true;
  try {
    const cron = await loadCronSettings();
    if (!cron.enabled) return [];
    const due = await pool.query(
      `SELECT id, agency_key, agency_name, rss_url, auto_publish
         FROM content_bots
        WHERE is_active = TRUE
          AND rss_url IS NOT NULL
          AND btrim(rss_url) <> ''
          AND (last_run_at IS NULL OR last_run_at < NOW() - make_interval(mins => $1::int))
        ORDER BY last_run_at ASC NULLS FIRST, id ASC`,
      [cron.intervalMinutes]
    );
    if (!due.rowCount) return [];
    const categoryId = await findDefaultCategoryId();
    const results = [];
    for (const bot of due.rows) {
      results.push(await executeBot(bot, categoryId));
    }
    return results;
  } catch (error) {
    console.error('[bot-runner] runDueBots hatası:', error.message);
    return [];
  } finally {
    running = false;
  }
}

module.exports = {
  runBot,
  runDueBots,
  _parseFeed: parseFeed,
  _assertPublicHttpUrl: assertPublicHttpUrl,
  _isPrivateIp: isPrivateIp,
  _decodeFeedBytes: decodeFeedBytes
};
