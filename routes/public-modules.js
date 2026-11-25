'use strict';

// Admin tarafından yönetilen modüllerin (galeri, video, köşe yazıları, sayfalar,
// resmi ilanlar, burçlar, ziyaretçi haberleri, yorumlar, footer linkleri) okur tarafı.
// Yazma/moderasyon işlemleri api.js ve ilgili route dosyalarında kalır.

const pool = require('../db/pool');

const NOT_FOUND = Symbol('not-found');
const FOOTER_CACHE_TTL_MS = 60_000;
const ANNOUNCEMENT_VISIBLE_SQL = `
  status = 'published'
  AND (publish_at IS NULL OR publish_at <= NOW())
  AND (ends_at IS NULL OR ends_at > NOW())`;

let footerHtml = '';
let footerLoadedAt = 0;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

// Yalnızca https://, http:// veya tek "/" ile başlayan yerel yollar kabul edilir.
// Dönen değer ham (escape edilmemiş) URL'dir; çıktıda esc() ile kullanılmalıdır.
function cleanUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /[\s\u0000-\u001f]/.test(raw)) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/') && !/^\/[/\\]/.test(raw)) return raw;
  return '';
}

// Admin düz metin içerikleri: escape, boş satırla paragraf, tek satır sonu <br>.
function textToHtml(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function imageUrls(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => cleanUrl(line))
    .filter(Boolean);
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul'
  });
}

function isoDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function normalizePath(pathname) {
  let path = String(pathname || '/');
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function decodeSlug(raw) {
  try {
    const slug = decodeURIComponent(raw);
    if (!slug || slug.includes('/')) return null;
    return slug;
  } catch {
    return null;
  }
}

function hrefFor(prefix, slug) {
  return `${prefix}${encodeURIComponent(slug)}`;
}

function crumbs(trail) {
  const items = trail.map((item) => (item.href
    ? `<span>›</span><a href="${esc(item.href)}">${esc(item.label)}</a>`
    : `<span>›</span><span>${esc(item.label)}</span>`)).join('');
  return `<nav class="breadcrumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a>${items}</nav>`;
}

function layout({ trail, kicker, title, inner }) {
  return `<section class="corporate-page">${crumbs(trail)}${kicker ? `<span class="section-kicker">${esc(kicker)}</span>` : ''}<h1>${esc(title)}</h1>${inner}</section>`;
}

function emptyState(message) {
  return `<p class="public-empty">${esc(message)}</p>`;
}

function hpField() {
  return '<div class="hp-field" aria-hidden="true"><label>Web sitesi<input name="website" tabindex="-1" autocomplete="off"></label></div>';
}

function notFoundPage() {
  return NOT_FOUND;
}

// Modül açık mı? Ayar okunamazsa veya yoksa 'on' kabul edilir.
async function moduleOn(key) {
  try {
    const { getSettings } = require('./settings-store');
    const settings = await getSettings();
    return !settings || settings[key] !== 'off';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Footer önbelleği
// ---------------------------------------------------------------------------

function footerColumn(title, links) {
  const items = links
    .map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`)
    .join('');
  return `<div class="footer-column"><b>${esc(String(title).toLocaleUpperCase('tr-TR'))}</b>${items}</div>`;
}

function buildFooterHtml(categories, rows) {
  const links = rows
    .map((row) => ({
      categoryId: row.category_id == null ? null : Number(row.category_id),
      label: String(row.label ?? '').trim(),
      href: cleanUrl(row.url)
    }))
    .filter((link) => link.label && link.href);

  const knownIds = new Set(categories.map((category) => Number(category.id)));
  let html = '';

  for (const category of categories) {
    const items = links.filter((link) => link.categoryId === Number(category.id));
    if (items.length) html += footerColumn(category.name, items);
  }

  const orphans = links.filter((link) => link.categoryId == null || !knownIds.has(link.categoryId));
  if (orphans.length) html += footerColumn('Bağlantılar', orphans);

  return html;
}

async function refreshFooterCache() {
  if (Date.now() - footerLoadedAt < FOOTER_CACHE_TTL_MS) return;
  try {
    const [categories, links] = await Promise.all([
      pool.query('SELECT id, name FROM link_categories ORDER BY sort_order ASC, id ASC'),
      pool.query('SELECT category_id, label, url FROM footer_links ORDER BY sort_order ASC, id ASC')
    ]);
    footerHtml = buildFooterHtml(categories.rows, links.rows);
    footerLoadedAt = Date.now();
  } catch (error) {
    // Hata durumunda eski önbellek korunur; tekrar denemeden önce 60 sn beklenir.
    footerLoadedAt = Date.now();
    console.error('Footer linkleri yenilenemedi, önceki önbellek kullanılıyor:', error.message);
  }
}

function footerLinksHtml() {
  return footerHtml;
}

// ---------------------------------------------------------------------------
// Yorumlar (haber detay sayfası)
// ---------------------------------------------------------------------------

async function renderComments(articleId) {
  const id = Number(articleId);
  if (!Number.isInteger(id) || id <= 0) return '';
  if (!(await moduleOn('module.comments'))) return '';

  let rows = [];
  try {
    const result = await pool.query(
      `SELECT author_name, body, created_at
         FROM comments
        WHERE article_id = $1 AND status = 'approved'
        ORDER BY created_at ASC, id ASC`,
      [id]
    );
    rows = result.rows;
  } catch (error) {
    console.error('Yorumlar yüklenemedi:', error.message);
    rows = [];
  }

  const list = rows.length
    ? `<ol class="comment-list">${rows.map((row) => `<li class="comment"><strong>${esc(row.author_name)}</strong> <time datetime="${esc(isoDate(row.created_at))}">${esc(formatDate(row.created_at))}</time><p>${esc(row.body).replace(/\r?\n/g, '<br>')}</p></li>`).join('')}</ol>`
    : emptyState('Bu habere henüz yorum yapılmamış.');

  return `<section class="article-comments" id="yorumlar"><h2>Yorumlar (${rows.length})</h2>${list}<form data-comment-form data-article-id="${id}" novalidate><label for="comment-name-${id}">Adınız <span aria-hidden="true">*</span></label><input id="comment-name-${id}" name="name" type="text" required maxlength="120" autocomplete="name"><label for="comment-email-${id}">E-posta (isteğe bağlı)</label><input id="comment-email-${id}" name="email" type="email" maxlength="200" autocomplete="email"><small>E-posta adresiniz yayımlanmaz.</small><label for="comment-body-${id}">Yorumunuz <span aria-hidden="true">*</span></label><textarea id="comment-body-${id}" name="body" rows="5" required maxlength="2000"></textarea>${hpField()}<label class="form-consent"><input type="checkbox" name="consent" required> Adımın ve yorumumun yayımlanmasını kabul ediyorum.</label><button type="submit">Yorumu gönder</button><p data-form-status role="status" aria-live="polite"></p><small>Yorumlar editör onayından sonra yayımlanır.</small></form></section>`;
}

// ---------------------------------------------------------------------------
// Sayfa işleyicileri. Dönüş: { title, description, bodyHtml } | NOT_FOUND | null (false)
// ---------------------------------------------------------------------------

async function listGalleries() {
  const { rows } = await pool.query(`
    SELECT g.id, g.title, COALESCE(g.slug, g.id::text) AS slug, g.image_urls, c.name AS category_name
      FROM galleries g
      LEFT JOIN gallery_categories c ON c.id = g.category_id
     WHERE g.status = 'published'
     ORDER BY g.created_at DESC, g.id DESC`);

  const cards = rows.map((row) => {
    const images = imageUrls(row.image_urls);
    const cover = images[0] ? `<img src="${esc(images[0])}" alt="${esc(row.title)}" loading="lazy">` : '';
    const kicker = row.category_name ? `<span class="section-kicker">${esc(row.category_name)}</span>` : '';
    return `<article class="news-card gallery-card"><a href="${esc(hrefFor('/galeri/', row.slug))}">${cover}<div>${kicker}<h2>${esc(row.title)}</h2><p>${images.length} fotoğraf</p></div></a></article>`;
  });

  return {
    title: 'Galeriler',
    description: 'Art World TV foto galerileri.',
    bodyHtml: layout({
      trail: [{ label: 'Galeriler' }],
      kicker: 'FOTOĞRAF',
      title: 'Galeriler',
      inner: cards.length ? `<div class="gallery-grid">${cards.join('')}</div>` : emptyState('Henüz yayımlanmış galeri bulunmuyor.')
    })
  };
}

async function galleryDetail(slug) {
  const { rows } = await pool.query(`
    SELECT g.title, g.description, g.image_urls, c.name AS category_name
      FROM galleries g
      LEFT JOIN gallery_categories c ON c.id = g.category_id
     WHERE g.status = 'published' AND COALESCE(g.slug, g.id::text) = $1
     LIMIT 1`, [slug]);
  const row = rows[0];
  if (!row) return notFoundPage();

  const images = imageUrls(row.image_urls);
  const grid = images.length
    ? `<div class="gallery-grid">${images.map((src) => `<figure><img src="${esc(src)}" alt="${esc(row.title)}" loading="lazy"></figure>`).join('')}</div>`
    : emptyState('Bu galeride henüz fotoğraf yok.');

  return {
    title: row.title,
    description: row.description || '',
    bodyHtml: layout({
      trail: [{ label: 'Galeriler', href: '/galeri' }, { label: row.title }],
      kicker: row.category_name || 'FOTOĞRAF',
      title: row.title,
      inner: `${textToHtml(row.description)}${grid}`
    })
  };
}

async function listVideos() {
  const { rows } = await pool.query(`
    SELECT v.title, COALESCE(v.slug, v.id::text) AS slug, v.youtube_url, c.name AS category_name
      FROM videos v
      LEFT JOIN video_categories c ON c.id = v.category_id
     WHERE v.status = 'published'
     ORDER BY v.created_at DESC, v.id DESC`);

  const cards = rows.map((row) => {
    const id = youtubeId(row.youtube_url);
    const thumb = id ? `<img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="${esc(row.title)}" loading="lazy">` : '';
    const kicker = row.category_name ? `<small>${esc(row.category_name)}</small>` : '';
    return `<article class="video-card"><a href="${esc(hrefFor('/video/', row.slug))}">${thumb}<span class="play" aria-hidden="true">▶</span>${kicker}<h2>${esc(row.title)}</h2></a></article>`;
  });

  return {
    title: 'Videolar',
    description: 'Art World TV video arşivi.',
    bodyHtml: layout({
      trail: [{ label: 'Videolar' }],
      kicker: 'VİDEO',
      title: 'Videolar',
      inner: cards.length ? `<div class="video-grid">${cards.join('')}</div>` : emptyState('Henüz yayımlanmış video bulunmuyor.')
    })
  };
}

async function videoDetail(slug) {
  const { rows } = await pool.query(`
    SELECT v.title, v.youtube_url, v.description, c.name AS category_name
      FROM videos v
      LEFT JOIN video_categories c ON c.id = v.category_id
     WHERE v.status = 'published' AND COALESCE(v.slug, v.id::text) = $1
     LIMIT 1`, [slug]);
  const row = rows[0];
  if (!row) return notFoundPage();

  const id = youtubeId(row.youtube_url);
  let player = '';
  if (id) {
    player = `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" title="${esc(row.title)}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  } else {
    const link = cleanUrl(row.youtube_url);
    if (link) {
      player = `<p><a class="text-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Videoyu YouTube'da izle</a></p>`;
    }
  }

  return {
    title: row.title,
    description: row.description || '',
    bodyHtml: layout({
      trail: [{ label: 'Videolar', href: '/video' }, { label: row.title }],
      kicker: row.category_name || 'VİDEO',
      title: row.title,
      inner: `${player}${textToHtml(row.description)}`
    })
  };
}

// Videonun YouTube kimliğini çıkarır (watch, youtu.be, embed, shorts, live).
function youtubeId(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] || null;
  } else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = match ? match[1] : null;
    }
  }

  return id && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null;
}

async function listAuthors() {
  const { rows } = await pool.query(`
    SELECT title, COALESCE(slug, id::text) AS slug, author_name,
           COALESCE(published_at, created_at) AS published_at
      FROM columns
     WHERE status = 'published'
     ORDER BY author_name ASC, COALESCE(published_at, created_at) DESC NULLS LAST, id DESC`);

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.author_name)) groups.set(row.author_name, []);
    groups.get(row.author_name).push(row);
  }

  const html = [...groups.entries()].map(([author, items]) => `<section class="author-group"><h2>${esc(author)}</h2><ul class="author-articles">${items.map((item) => {
    const date = formatDate(item.published_at);
    return `<li><a class="text-link" href="${esc(hrefFor('/yazi/', item.slug))}">${esc(item.title)}</a>${date ? ` <span class="meta">${esc(date)}</span>` : ''}</li>`;
  }).join('')}</ul></section>`).join('');

  return {
    title: 'Yazarlar',
    description: 'Art World TV köşe yazarları ve yazıları.',
    bodyHtml: layout({
      trail: [{ label: 'Yazarlar' }],
      kicker: 'KÖŞE YAZILARI',
      title: 'Yazarlar',
      inner: html || emptyState('Henüz yayımlanmış yazı bulunmuyor.')
    })
  };
}

async function columnDetail(slug) {
  const { rows } = await pool.query(`
    SELECT title, author_name, summary, body, COALESCE(published_at, created_at) AS published_at
      FROM columns
     WHERE status = 'published' AND COALESCE(slug, id::text) = $1
     LIMIT 1`, [slug]);
  const row = rows[0];
  if (!row) return notFoundPage();

  const date = formatDate(row.published_at);
  const meta = `<p class="meta">${esc(row.author_name)}${date ? `<i>·</i>${esc(date)}` : ''}</p>`;
  const summary = row.summary ? `<p class="lead">${esc(row.summary)}</p>` : '';

  return {
    title: row.title,
    description: row.summary || '',
    bodyHtml: layout({
      trail: [{ label: 'Yazarlar', href: '/yazarlar' }, { label: row.title }],
      kicker: 'KÖŞE YAZISI',
      title: row.title,
      inner: `${meta}${summary}<article class="column-body">${textToHtml(row.body)}</article>`
    })
  };
}

function staticPageResult(row, trailLabel, trailHref) {
  return {
    title: row.title,
    description: '',
    bodyHtml: layout({
      trail: [{ label: trailLabel, href: trailHref }, { label: row.title }],
      kicker: '',
      title: row.title,
      inner: `<article class="static-body">${textToHtml(row.content) || emptyState('Bu sayfanın içeriği henüz eklenmemiş.')}</article>`
    })
  };
}

async function staticDetail(slug) {
  const { rows } = await pool.query(`
    SELECT title, content
      FROM static_pages
     WHERE status = 'published' AND COALESCE(slug, id::text) = $1
     LIMIT 1`, [slug]);
  if (!rows[0]) return notFoundPage();
  return staticPageResult(rows[0], 'Sayfalar', null);
}

// /hakkimizda: yayımlanmış 'hakkimizda' sayfası yoksa null döner (kurumsal sayfa devreye girer).
async function aboutPage() {
  const { rows } = await pool.query(`
    SELECT title, content
      FROM static_pages
     WHERE slug = 'hakkimizda' AND status = 'published'
     LIMIT 1`);
  if (!rows[0]) return null;
  return staticPageResult(rows[0], 'Kurumsal', null);
}

async function listAnnouncements() {
  // Modül Ayarları → Resmi İlanlar pasifse sayfa yok (null → serve false → 404).
  if (!(await moduleOn('module.announcements'))) return null;
  const { rows } = await pool.query(`
    SELECT title, COALESCE(slug, id::text) AS slug, ilan_no,
           COALESCE(publish_at, created_at) AS dated
      FROM announcements
     WHERE ${ANNOUNCEMENT_VISIBLE_SQL}
     ORDER BY COALESCE(publish_at, created_at) DESC, id DESC`);

  const items = rows.map((row) => {
    const date = formatDate(row.dated);
    return `<article class="news-card"><div><h2><a href="${esc(hrefFor('/resmi-ilanlar/', row.slug))}">${esc(row.title)}</a></h2><p class="meta">${row.ilan_no ? `İlan No: ${esc(row.ilan_no)}` : ''}${row.ilan_no && date ? '<i>·</i>' : ''}${esc(date)}</p></div></article>`;
  });

  return {
    title: 'Resmi ilanlar',
    description: 'Resmi ilan ve duyurular.',
    bodyHtml: layout({
      trail: [{ label: 'Resmi ilanlar' }],
      kicker: 'RESMİ İLANLAR',
      title: 'Resmi ilanlar',
      inner: items.length ? `<div class="news-list">${items.join('')}</div>` : emptyState('Şu anda yayımlanmış resmi ilan bulunmuyor.')
    })
  };
}

async function announcementDetail(slug) {
  if (!(await moduleOn('module.announcements'))) return null;
  const { rows } = await pool.query(`
    SELECT title, ilan_no, body, attachment_url, publish_at, created_at
      FROM announcements
     WHERE ${ANNOUNCEMENT_VISIBLE_SQL}
       AND COALESCE(slug, id::text) = $1
     LIMIT 1`, [slug]);
  const row = rows[0];
  if (!row) return notFoundPage();

  const date = formatDate(row.publish_at || row.created_at);
  const meta = `<p class="meta">${row.ilan_no ? `İlan No: ${esc(row.ilan_no)}` : ''}${row.ilan_no && date ? '<i>·</i>' : ''}${esc(date)}</p>`;
  const attachment = cleanUrl(row.attachment_url);
  const attachmentLink = attachment
    ? `<p><a class="text-link" href="${esc(attachment)}" target="_blank" rel="noopener noreferrer">Ek dosyayı aç</a></p>`
    : '';

  return {
    title: row.title,
    description: '',
    bodyHtml: layout({
      trail: [{ label: 'Resmi ilanlar', href: '/resmi-ilanlar' }, { label: row.title }],
      kicker: 'RESMİ İLAN',
      title: row.title,
      inner: `${meta}<article class="announcement-body">${textToHtml(row.body)}</article>${attachmentLink}`
    })
  };
}

async function listHoroscopes() {
  if (!(await moduleOn('module.horoscope'))) return null;

  const { rows } = await pool.query(`
    SELECT sign_name, date_range, symbol, daily_text, updated_at
      FROM horoscopes
     ORDER BY sort_order ASC, sign_name ASC`);

  const cards = rows.map((row) => `<article class="news-card horoscope-card"><div><span class="horoscope-symbol" aria-hidden="true">${esc(row.symbol)}</span><h2>${esc(row.sign_name)}</h2><p class="section-kicker">${esc(row.date_range)}</p>${textToHtml(row.daily_text) || emptyState('Bugün için yorum henüz eklenmedi.')}</div></article>`);

  return {
    title: 'Burçlar',
    description: 'Günlük burç yorumları.',
    bodyHtml: layout({
      trail: [{ label: 'Burçlar' }],
      kicker: 'BURÇLAR',
      title: 'Burçlar',
      inner: cards.length ? `<div class="horoscope-grid">${cards.join('')}</div>` : emptyState('Burç bilgileri henüz eklenmemiş.')
    })
  };
}

// ---------------------------------------------------------------------------
// Vizyondaki filmler
// ---------------------------------------------------------------------------

// Film adresi: /film/<id>-<ad>. Sayfa numarayla bulunur; ad kısmı okunabilirlik içindir.
function movieSlug(title) {
  return String(title || '').toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function movieHref(id, title) {
  const slug = movieSlug(title);
  return `/film/${Number(id)}${slug ? `-${slug}` : ''}`;
}

function formatDay(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return new Date(`${text}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const MOVIE_FIELDS = `id, title, genre, duration_min, to_char(release_date, 'YYYY-MM-DD') AS release_date,
  rating::float8 AS rating, poster_url, summary, source`;

function moviePoster(row, cls) {
  const url = cleanUrl(row.poster_url);
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(row.title)} afişi" loading="lazy">`
    : `<div class="${cls} movie-poster-empty" aria-hidden="true">${esc(row.title)}</div>`;
}

function movieMeta(row) {
  return [
    row.genre,
    row.duration_min ? `${Number(row.duration_min)} dk` : '',
    formatDay(row.release_date) ? `Vizyon: ${formatDay(row.release_date)}` : ''
  ].filter(Boolean).map(esc).join(' · ');
}

function movieCard(row) {
  const rating = Number(row.rating);
  const ratingHtml = Number.isFinite(rating) && rating > 0 ? `<span class="movie-rating">★ ${rating.toFixed(1)}</span>` : '';
  const meta = movieMeta(row);
  return `<article class="movie-card"><a href="${esc(movieHref(row.id, row.title))}"><div class="movie-card-poster">${moviePoster(row, 'movie-poster')}${ratingHtml}</div><h2>${esc(row.title)}</h2>${meta ? `<p>${meta}</p>` : ''}</a></article>`;
}

const TMDB_NOTE = '<p class="movie-source">Film bilgileri ve afişler <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a> kaynaklıdır. Bu ürün TMDB API\'sini kullanır ancak TMDB tarafından onaylanmamış veya sertifikalandırılmamıştır.</p>';

async function listMovies() {
  if (!(await moduleOn('module.movies'))) return null;
  const { rows } = await pool.query(`
    SELECT ${MOVIE_FIELDS} FROM movies
     WHERE status = 'published'
     ORDER BY release_date DESC NULLS LAST, id DESC
     LIMIT 120`);
  const fromTmdb = rows.some((row) => row.source === 'tmdb');
  return {
    title: 'Vizyondaki filmler',
    description: 'Sinemalarda vizyondaki filmler: tür, süre, vizyon tarihi ve konu özetleri.',
    bodyHtml: layout({
      trail: [{ label: 'Vizyondaki filmler' }],
      kicker: 'SİNEMA',
      title: 'Vizyondaki filmler',
      inner: rows.length
        ? `<div class="movie-grid">${rows.map(movieCard).join('')}</div>${fromTmdb ? TMDB_NOTE : ''}`
        : emptyState('Vizyondaki film bilgisi henüz yok.')
    })
  };
}

async function movieDetail(slug) {
  if (!(await moduleOn('module.movies'))) return null;
  const match = /^(\d{1,9})(?:-[a-z0-9-]*)?$/.exec(slug);
  if (!match) return notFoundPage();
  const { rows } = await pool.query(
    `SELECT ${MOVIE_FIELDS} FROM movies WHERE id = $1 AND status = 'published'`, [Number(match[1])]
  );
  const row = rows[0];
  if (!row) return notFoundPage();

  const { rows: others } = await pool.query(`
    SELECT ${MOVIE_FIELDS} FROM movies
     WHERE status = 'published' AND id <> $1
     ORDER BY release_date DESC NULLS LAST, id DESC
     LIMIT 8`, [row.id]);

  const rating = Number(row.rating);
  const facts = [
    ['Tür', row.genre],
    ['Süre', row.duration_min ? `${Number(row.duration_min)} dakika` : ''],
    ['Vizyon tarihi', formatDay(row.release_date)],
    ['Puan', Number.isFinite(rating) && rating > 0 ? `${rating.toFixed(1)} / 10${row.source === 'tmdb' ? ' (TMDB)' : ''}` : '']
  ].filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');

  const summary = textToHtml(row.summary) || '<p class="public-empty">Bu film için özet henüz eklenmedi.</p>';
  const othersHtml = others.length
    ? `<section class="movie-others"><h2>Vizyondaki diğer filmler</h2><div class="movie-grid movie-grid--compact">${others.map(movieCard).join('')}</div><p><a class="text-link" href="/filmler">Tüm vizyondaki filmler ›</a></p></section>`
    : '';

  return {
    title: row.title,
    description: String(row.summary || `${row.title} filmi hakkında bilgiler.`).slice(0, 300),
    bodyHtml: layout({
      trail: [{ label: 'Vizyondaki filmler', href: '/filmler' }, { label: row.title }],
      kicker: 'VİZYONDA',
      title: row.title,
      inner: `<div class="movie-detail"><div class="movie-detail-poster">${moviePoster(row, 'movie-poster')}</div><div class="movie-detail-body">${facts ? `<dl class="movie-facts">${facts}</dl>` : ''}<h2>Konusu</h2>${summary}</div></div>${row.source === 'tmdb' ? TMDB_NOTE : ''}${othersHtml}`
    })
  };
}

async function visitorPostForm() {
  if (!(await moduleOn('module.visitorPosts'))) return null;

  return {
    title: 'Haber gönderin',
    description: 'Okurlarımızdan haber ve bilgi kabul ediyoruz.',
    bodyHtml: layout({
      trail: [{ label: 'Haber gönderin' }],
      kicker: 'OKUR KATKISI',
      title: 'Haber gönderin',
      inner: `<p class="lead">Yerel bir olayı, duyuruyu ya da okurumuzu ilgilendiren konuyu bize iletebilirsiniz. Gönderiler editör ekibi tarafından incelenir; yayımlanması garanti değildir.</p><form data-visitor-post-form novalidate><label for="visitor-name">Adınız <span aria-hidden="true">*</span></label><input id="visitor-name" name="name" type="text" required maxlength="120" autocomplete="name"><label for="visitor-email">E-posta (isteğe bağlı)</label><input id="visitor-email" name="email" type="email" maxlength="200" autocomplete="email"><small>E-posta adresiniz yayımlanmaz.</small><label for="visitor-title">Başlık <span aria-hidden="true">*</span></label><input id="visitor-title" name="title" type="text" required maxlength="200"><label for="visitor-body">Haber metni <span aria-hidden="true">*</span></label><textarea id="visitor-body" name="body" rows="8" required maxlength="5000"></textarea>${hpField()}<label class="form-consent"><input type="checkbox" name="consent" required> Gönderdiğim bilgilerin haber değerlendirmesi için işlenmesini kabul ediyorum.</label><button type="submit">Gönder</button><p data-form-status role="status" aria-live="polite"></p></form>`
    })
  };
}

// ---------------------------------------------------------------------------
// Rota eşleştirme
// ---------------------------------------------------------------------------

const EXACT_ROUTES = {
  '/galeri': listGalleries,
  '/video': listVideos,
  '/yazarlar': listAuthors,
  '/resmi-ilanlar': listAnnouncements,
  '/burclar': listHoroscopes,
  '/filmler': listMovies,
  '/haber-gonder': visitorPostForm,
  '/hakkimizda': aboutPage
};

const PREFIX_ROUTES = [
  ['/galeri/', galleryDetail],
  ['/video/', videoDetail],
  ['/film/', movieDetail],
  ['/yazi/', columnDetail],
  ['/sayfa/', staticDetail],
  ['/resmi-ilanlar/', announcementDetail]
];

async function serve(req, res, pathname, url, helpers) {
  const method = String(req?.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  const path = normalizePath(pathname);
  let handler = null;
  let rawSlug = null;

  if (Object.prototype.hasOwnProperty.call(EXACT_ROUTES, path)) {
    handler = EXACT_ROUTES[path];
  } else {
    for (const [prefix, fn] of PREFIX_ROUTES) {
      if (path.startsWith(prefix)) {
        handler = fn;
        rawSlug = path.slice(prefix.length);
        break;
      }
    }
  }
  if (!handler) return false;

  let page;
  try {
    if (rawSlug === null) {
      page = await handler();
    } else {
      const slug = decodeSlug(rawSlug);
      page = slug === null ? NOT_FOUND : await handler(slug);
    }
  } catch (error) {
    // Tablo yoksa ya da sorgu hatasında rota devre dışı kalır; sunucu çökmez.
    console.error(`Modül sayfası işlenemedi (${path}):`, error.message);
    return false;
  }

  if (page === null) return false;

  if (page === NOT_FOUND) {
    helpers.sendHtml(res, 404, helpers.renderShell({
      title: 'Bulunamadı',
      description: '',
      path: pathname,
      bodyHtml: '<section class="corporate-page"><h1>İçerik bulunamadı</h1><p><a href="/">Ana sayfaya dön</a></p></section>'
    }));
    return true;
  }

  helpers.sendHtml(res, 200, helpers.renderShell({
    title: page.title,
    description: page.description,
    path: pathname,
    bodyHtml: page.bodyHtml
  }));
  return true;
}

module.exports = { serve, renderComments, refreshFooterCache, footerLinksHtml, movieHref };
