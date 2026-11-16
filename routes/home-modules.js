'use strict';

// Ana sayfa "basınsoft" modülleri: gerçek veriyle dolu bloklar.
// loadData() tüm veriyi tek seferde çeker (bir sorgu patlarsa diğerleri etkilenmez);
// render() ise senkron çalışır ve yalnızca loadData() çıktısını kullanır.

const pool = require('../db/pool');

const TIME_ZONE = 'Europe/Istanbul';

const SETTING_KEYS = {
  poll: 'module.polls',
  horoscope: 'module.horoscope',
  movies: 'module.movies'
};

const DEFAULT_LIMITS = {
  categoryBlocks: 6,
  latestFeed: 8,
  columnists: 6,
  photoGallery: 4,
  videoGallery: 4,
  movies: 8,
  horoscope: 12
};

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// Yalnızca http(s) ya da kök göreli (/) adresler kabul edilir.
function safeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  return '';
}

function mediaUrl(storageKey) {
  if (!storageKey) return '';
  return `/media/${String(storageKey).split('/').map(encodeURIComponent).join('/')}`;
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
}

function isoTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
}

// DATE sütunları pg tarafından sunucunun yerel gece yarısı olarak okunur; bu yüzden yerel bileşenler kullanılır.
function formatDateOnly(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function youtubeId(url) {
  const text = String(url || '').trim();
  const match = text.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  return match ? match[1] : '';
}

function firstImageLine(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function articleHref(slug) {
  return `/haber/${encodeURIComponent(slug)}`;
}

function isSettingOn(extra, type) {
  const key = SETTING_KEYS[type];
  if (!key) return true;
  return !(extra.settings && extra.settings[key] === 'off');
}

// ---------------------------------------------------------------------------
// Veri yükleme
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = { 'module.polls': 'on', 'module.horoscope': 'on', 'module.movies': 'on' };

async function loadSettings() {
  try {
    const { getSettings } = require('./settings-store');
    const stored = await getSettings();
    return { ...DEFAULT_SETTINGS, ...(stored || {}) };
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      console.warn(`[home-modules] ayarlar okunamadı: ${error.message}`);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

async function loadCategoryBlocks() {
  const { rows: categories } = await pool.query(`
    SELECT c.id, c.name, c.slug
      FROM categories c
      JOIN (
        SELECT primary_category_id, COUNT(*) AS published_count
          FROM articles
         WHERE status = 'published'
           AND published_at <= NOW()
           AND primary_category_id IS NOT NULL
         GROUP BY primary_category_id
      ) counts ON counts.primary_category_id = c.id
     WHERE c.is_active = TRUE
     ORDER BY counts.published_count DESC, c.sort_order, c.id
     LIMIT 6`);
  if (!categories.length) return [];

  const { rows } = await pool.query(`
    SELECT ranked.primary_category_id, ranked.headline, ranked.slug, ranked.published_at, m.storage_key
      FROM (
        SELECT a.primary_category_id, a.headline, a.slug, a.published_at, a.cover_media_id,
               ROW_NUMBER() OVER (PARTITION BY a.primary_category_id ORDER BY a.published_at DESC, a.id DESC) AS rn
          FROM articles a
         WHERE a.status = 'published'
           AND a.published_at <= NOW()
           AND a.primary_category_id = ANY($1::bigint[])
      ) ranked
      LEFT JOIN media_assets m ON m.id = ranked.cover_media_id
     WHERE ranked.rn <= 4
     ORDER BY ranked.primary_category_id, ranked.rn`, [categories.map((category) => String(category.id))]);

  const blocks = new Map(categories.map((category) => [String(category.id), {
    name: category.name,
    slug: category.slug,
    articles: []
  }]));
  for (const row of rows) {
    const block = blocks.get(String(row.primary_category_id));
    if (!block) continue;
    block.articles.push({
      headline: row.headline,
      slug: row.slug,
      published_at: row.published_at,
      image_url: mediaUrl(row.storage_key)
    });
  }
  return [...blocks.values()];
}

async function loadLatestFeed() {
  const { rows } = await pool.query(`
    SELECT headline, slug, published_at
      FROM articles
     WHERE status = 'published' AND published_at <= NOW()
     ORDER BY published_at DESC, id DESC
     LIMIT 8`);
  return rows;
}

async function loadColumnists() {
  const { rows } = await pool.query(`
    SELECT title, slug, author_name, summary, published_at
      FROM columns
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST, created_at DESC, id DESC
     LIMIT 6`);
  return rows;
}

async function loadPhotoGallery() {
  const { rows } = await pool.query(`
    SELECT title, slug, image_urls
      FROM galleries
     WHERE status = 'published'
     ORDER BY created_at DESC NULLS LAST, id DESC
     LIMIT 4`);
  return rows.map((row) => {
    const images = firstImageLine(row.image_urls).filter((url) => safeUrl(url));
    return {
      title: row.title,
      slug: row.slug,
      cover_url: safeUrl(images[0]),
      image_count: images.length
    };
  });
}

async function loadVideoGallery() {
  const { rows } = await pool.query(`
    SELECT title, slug, youtube_url
      FROM videos
     WHERE status = 'published'
     ORDER BY created_at DESC NULLS LAST, id DESC
     LIMIT 4`);
  return rows.map((row) => {
    const id = youtubeId(row.youtube_url);
    return {
      title: row.title,
      slug: row.slug,
      cover_url: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''
    };
  });
}

async function loadPoll() {
  const { rows } = await pool.query(`
    SELECT id, question
      FROM polls
     WHERE status = 'active'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`);
  if (!rows.length) return null;
  const poll = rows[0];
  const { rows: options } = await pool.query(`
    SELECT id, label, votes
      FROM poll_options
     WHERE poll_id = $1
     ORDER BY sort_order, id`, [poll.id]);
  return { id: poll.id, question: poll.question, options };
}

async function loadHoroscope() {
  const { rows } = await pool.query(`
    SELECT sign_key, sign_name, date_range, symbol
      FROM horoscopes
     ORDER BY sort_order
     LIMIT 12`);
  return rows;
}

async function loadMovies() {
  const { rows } = await pool.query(`
    SELECT id, title, genre, duration_min, release_date, rating, poster_url
      FROM movies
     WHERE status = 'published'
     ORDER BY release_date DESC NULLS LAST, id DESC
     LIMIT 8`);
  return rows;
}

const LOADERS = {
  categoryBlocks: loadCategoryBlocks,
  latestFeed: loadLatestFeed,
  columnists: loadColumnists,
  photoGallery: loadPhotoGallery,
  videoGallery: loadVideoGallery,
  poll: loadPoll,
  horoscope: loadHoroscope,
  movies: loadMovies
};

async function loadData() {
  const keys = Object.keys(LOADERS);
  const [settings, ...results] = await Promise.allSettled([
    loadSettings(),
    ...keys.map((key) => LOADERS[key]())
  ]);

  const data = {
    settings: settings.status === 'fulfilled' ? settings.value : { ...DEFAULT_SETTINGS }
  };
  keys.forEach((key, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      data[key] = result.value;
    } else {
      data[key] = key === 'poll' ? null : [];
      console.warn(`[home-modules] ${key} verisi alınamadı: ${result.reason?.message || result.reason}`);
    }
  });
  return data;
}

// ---------------------------------------------------------------------------
// Render yardımcıları
// ---------------------------------------------------------------------------

function heading(kicker, title, moreHref = '', moreLabel = 'Tümü') {
  const more = moreHref ? `<a class="text-link bs-more" href="${escapeHtml(moreHref)}">${escapeHtml(moreLabel)}</a>` : '';
  return `<div class="section-heading bs-head"><div><span class="section-kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(title)}</h2></div>${more}</div>`;
}

function section(className, kicker, title, body, moreHref = '') {
  return `<section class="bs-section ${className}">${heading(kicker, title, moreHref)}${body}</section>`;
}

function empty(message) {
  return `<p class="public-empty">${escapeHtml(message)}</p>`;
}

function link(href, html) {
  return href ? `<a href="${escapeHtml(href)}">${html}</a>` : html;
}

function limitOf(module, type) {
  const value = Number(module.limit);
  return value > 0 ? Math.min(20, value) : DEFAULT_LIMITS[type];
}

// ---------------------------------------------------------------------------
// Modül render'ları
// ---------------------------------------------------------------------------

function renderCategoryBlocks(module, extra) {
  const limit = limitOf(module, 'categoryBlocks');
  const blocks = (extra.categoryBlocks || []).slice(0, limit);
  const cards = blocks.map((category) => {
    const categoryHref = `/kategori/${encodeURIComponent(category.slug)}`;
    const [lead, ...rest] = category.articles;
    const leadHtml = lead ? `<div class="bs-lead">${
      lead.image_url && safeUrl(lead.image_url)
        ? `<a href="${escapeHtml(articleHref(lead.slug))}"><img src="${escapeHtml(safeUrl(lead.image_url))}" alt="${escapeHtml(lead.headline)}" loading="lazy"></a>`
        : ''
    }<h3><a href="${escapeHtml(articleHref(lead.slug))}">${escapeHtml(lead.headline)}</a></h3></div>` : '';
    const listHtml = rest.length
      ? `<ul class="bs-list">${rest.map((article) => `<li><a href="${escapeHtml(articleHref(article.slug))}">${escapeHtml(article.headline)}</a><time datetime="${escapeHtml(isoTime(article.published_at))}">${escapeHtml(formatTime(article.published_at))}</time></li>`).join('')}</ul>`
      : '';
    return `<article class="bs-block"><div class="bs-head"><h3><a href="${escapeHtml(categoryHref)}">${escapeHtml(category.name)}</a></h3><a class="bs-more" href="${escapeHtml(categoryHref)}">Tümü</a></div><div class="bs-block-body">${leadHtml}${listHtml}</div></article>`;
  }).join('');
  return section('bs-category-blocks', 'KATEGORİLER', module.title || 'Kategorilerden', `<div class="bs-block-grid">${cards || empty('Kategorilerde henüz yayımlanmış haber yok.')}</div>`, '/haberler');
}

function renderLatestFeed(module, extra) {
  const limit = limitOf(module, 'latestFeed');
  const items = (extra.latestFeed || []).slice(0, limit);
  const list = items.map((article) => `<li><time datetime="${escapeHtml(isoTime(article.published_at))}">${escapeHtml(formatTime(article.published_at))}</time><a href="${escapeHtml(articleHref(article.slug))}">${escapeHtml(article.headline)}</a></li>`).join('');
  return section('bs-latest-feed', 'SON DAKİKA', module.title || 'Son dakika akışı', `<div class="bs-feed">${list ? `<ol>${list}</ol>` : empty('Akışta henüz haber yok.')}</div>`);
}

function renderColumnists(module, extra) {
  const limit = limitOf(module, 'columnists');
  const items = (extra.columnists || []).slice(0, limit);
  const cards = items.map((column) => {
    const initial = Array.from(String(column.author_name || '').trim())[0] || '?';
    const href = column.slug ? `/yazi/${encodeURIComponent(column.slug)}` : '';
    return `<article class="bs-columnist"><span class="bs-avatar" aria-hidden="true">${escapeHtml(initial.toLocaleUpperCase('tr-TR'))}</span><strong>${escapeHtml(column.author_name)}</strong><small>${escapeHtml(column.title)}</small>${href ? `<a href="${escapeHtml(href)}">Yazıyı oku</a>` : ''}</article>`;
  }).join('');
  return section('bs-columnists', 'KÖŞE YAZARLARI', module.title || 'Köşe yazarları', `<div class="bs-columnists-row">${cards || empty('Henüz yayımlanmış yazı yok.')}</div>`, '/yazarlar');
}

function renderPhotoGallery(module, extra) {
  const limit = limitOf(module, 'photoGallery');
  const items = (extra.photoGallery || []).slice(0, limit);
  const cards = items.map((gallery, index) => {
    const href = gallery.slug ? `/galeri/${encodeURIComponent(gallery.slug)}` : '';
    const thumb = gallery.cover_url
      ? `<img src="${escapeHtml(gallery.cover_url)}" alt="${escapeHtml(gallery.title)}" loading="lazy">`
      : `<div class="bs-poster alt-${(index % 3) + 1}" aria-hidden="true">FOTO<span>GALERİ</span></div>`;
    return `<article class="bs-card">${link(href, `<div class="bs-thumb">${thumb}<span class="bs-thumb-badge">${gallery.image_count} FOTO</span></div><h3>${escapeHtml(gallery.title)}</h3>`)}</article>`;
  }).join('');
  return section('bs-gallery', 'FOTO GALERİ', module.title || 'Foto galeri', `<div class="bs-card-grid">${cards || empty('Henüz yayımlanmış galeri yok.')}</div>`, '/galeri');
}

function renderVideoGallery(module, extra) {
  const limit = limitOf(module, 'videoGallery');
  const items = (extra.videoGallery || []).slice(0, limit);
  const cards = items.map((video, index) => {
    const href = video.slug ? `/video/${encodeURIComponent(video.slug)}` : '';
    const thumb = video.cover_url
      ? `<img src="${escapeHtml(video.cover_url)}" alt="${escapeHtml(video.title)}" loading="lazy">`
      : `<div class="bs-poster alt-${(index % 3) + 1}" aria-hidden="true">VİDEO<span>ART WORLD TV</span></div>`;
    return `<article class="bs-card">${link(href, `<div class="bs-thumb is-wide">${thumb}<span class="bs-play" aria-hidden="true"></span></div><h3>${escapeHtml(video.title)}</h3>`)}</article>`;
  }).join('');
  return section('bs-gallery bs-video-gallery', 'ART WORLD TV', module.title || 'Video galeri', `<div class="bs-card-grid">${cards || empty('Henüz yayımlanmış video yok.')}</div>`, '/video');
}

function renderPoll(module, extra) {
  const poll = extra.poll;
  const options = poll && Array.isArray(poll.options) ? poll.options : [];
  const body = poll && options.length
    ? `<form class="bs-poll" data-poll-form data-poll-id="${escapeHtml(poll.id)}"><p class="bs-poll-question"><strong>${escapeHtml(poll.question)}</strong></p>${options.map((option) => `<label><input type="radio" name="optionId" value="${escapeHtml(option.id)}" required> ${escapeHtml(option.label)}</label>`).join('')}<button type="submit">Oy ver</button><div data-poll-results hidden></div><p data-form-status role="status" aria-live="polite"></p></form>`
    : empty('Şu an açık bir anket yok.');
  return section('bs-poll-section', 'OKUR ANKETİ', module.title || 'Anket', body);
}

function renderHoroscope(module, extra) {
  const limit = limitOf(module, 'horoscope');
  const signs = (extra.horoscope || []).slice(0, limit);
  const items = signs.map((sign) => `<a href="/burclar#${encodeURIComponent(sign.sign_key)}"><span class="sign" aria-hidden="true">${escapeHtml(sign.symbol)}</span><strong>${escapeHtml(sign.sign_name)}</strong><small>${escapeHtml(sign.date_range)}</small></a>`).join('');
  return section('bs-zodiac-section', 'GÜNLÜK YORUMLAR', module.title || 'Burçlar', `<div class="bs-zodiac-row bs-zodiac">${items || empty('Burç yorumları henüz yayımlanmadı.')}</div>`, '/burclar');
}

function renderMovies(module, extra) {
  const limit = limitOf(module, 'movies');
  const items = (extra.movies || []).slice(0, limit);
  const cards = items.map((movie, index) => {
    const posterUrl = safeUrl(movie.poster_url);
    const thumb = posterUrl
      ? `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(movie.title)}" loading="lazy">`
      : `<div class="bs-poster alt-${(index % 3) + 1}" aria-hidden="true">${escapeHtml(movie.title)}<span>${escapeHtml(movie.genre || 'FİLM')}</span></div>`;
    const rating = Number(movie.rating);
    const meta = [movie.genre, movie.duration_min ? `${Number(movie.duration_min)} dk` : '', formatDateOnly(movie.release_date)]
      .filter(Boolean)
      .map((part) => escapeHtml(part))
      .join(' · ');
    return `<article class="bs-card"><div class="bs-thumb">${thumb}</div><h3>${escapeHtml(movie.title)}</h3>${meta ? `<small>${meta}</small>` : ''}${Number.isFinite(rating) && rating > 0 ? `<span class="bs-rating">★ ${rating.toFixed(1)}</span>` : ''}</article>`;
  }).join('');
  return section('bs-films', 'VİZYON', module.title || 'Vizyondaki filmler', `<div class="bs-card-grid">${cards || empty('Vizyondaki film bilgisi henüz yok.')}</div>`, '/filmler');
}

const RENDERERS = {
  categoryBlocks: renderCategoryBlocks,
  latestFeed: renderLatestFeed,
  columnists: renderColumnists,
  photoGallery: renderPhotoGallery,
  videoGallery: renderVideoGallery,
  poll: renderPoll,
  horoscope: renderHoroscope,
  movies: renderMovies
};

// Senkron. Bilinmeyen tip veya kapalı modül için '' döner.
function render(module, context = {}) {
  const renderer = module && RENDERERS[module.type];
  if (!renderer) return '';
  const extra = context.extra || {};
  if (!isSettingOn(extra, module.type)) return '';
  try {
    return renderer(module, extra);
  } catch (error) {
    console.warn(`[home-modules] ${module.type} render hatası: ${error.message}`);
    return '';
  }
}

module.exports = { loadData, render };
