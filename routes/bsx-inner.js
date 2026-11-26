// BSX iç sayfaları: haber detayı, kategori, arama. Sözleşme: TASARIM-ICSAYFA-BSX.md.
// Saf HTML üretir, veritabanına dokunmaz. Tüm metin esc() ile, tüm dış bağlantılar url() ile süzülür.
const { youtubeId } = require('./youtube');
const L = require('./bsx-layout');
const { esc, url, img, card } = require('./bsx-kit');

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DEFAULT_SITE = { brand: 'Art World TV', logoUrl: '', slogan: '', social: [] };
const DEFAULT_FOOTER = { columns: [] };

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// dd Ay yyyy, HH:mm (Türkçe ay, saat Europe/Istanbul). Geçersiz ya da boş tarihte ''.
function formatDate(value) {
  const d = toDate(value);
  if (!d) return '';
  const p = {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  for (const part of parts) p[part.type] = part.value;
  if (!p.day || !p.month || !p.year || !p.hour || !p.minute) return '';
  return `${p.day.padStart(2, '0')} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour.padStart(2, '0')}:${p.minute}`;
}

function isoDate(value) {
  const d = toDate(value);
  return d ? d.toISOString() : '';
}

// Sayı biçimi (tr-TR). Sayı değilse ''.
function countText(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('tr-TR') : '';
}

const newsPath = (slug) => (slug ? `/haber/${encodeURIComponent(slug)}` : '#');
const catPath = (slug) => (slug ? `/kategori/${encodeURIComponent(slug)}` : '');
const siteBase = () => String(process.env.SITE_URL || '').replace(/\/$/, '');

function shellParts(shell) {
  const s = shell || {};
  return {
    site: s.site || DEFAULT_SITE,
    nav: Array.isArray(s.nav) ? s.nav : [],
    footer: s.footer || DEFAULT_FOOTER,
  };
}

function brandOf(site) {
  return (site && site.brand) || 'Art World TV';
}

// Gövde metni: dizi ise bloklar; metin ise boş satırla paragraflara ayrılır (public-pages renderStoryBody mantığı).
function bodyHtml(body) {
  const blocks = Array.isArray(body)
    ? body
    : String(body ?? '').split(/\r?\n\s*\r?\n/).map((text) => ({ type: 'paragraph', text }));
  const html = blocks.map((block) => {
    const b = block || {};
    const text = esc(String(b.text ?? '').trim()).replace(/\r?\n/g, '<br>');
    if (!text) return '';
    if (b.type === 'heading') return `<h2>${text}</h2>`;
    if (b.type === 'quote') return `<blockquote>${text}</blockquote>`;
    return `<p>${text}</p>`;
  }).join('');
  return html || '<p>Bu haberin metni henüz eklenmemiş.</p>';
}

// Tam BSX sayfası: head → #top → topbar → header → main → footer → popup → scripts.
function fullPage(parts, { title, description, main, popupHtml = '' }) {
  const { site, nav, footer } = parts;
  const head = L.head(title, description)
    .replace('</head>', '<link rel="stylesheet" href="/bsx-inner.css"><link rel="stylesheet" href="/public-modules.css"></head>');
  return `${head}<div id="top"></div>${L.topbar(site)}${L.header(site, nav)}`
    + `<main class="bsx-main"><div class="bsx-inner">${main}</div></main>`
    + `${L.footer(site, footer)}${popupHtml || ''}${L.scripts()}`;
}

// items: [{ label, href? }]. href yoksa son öğe olarak düz metin basılır.
function crumbs(items) {
  const parts = items.filter((i) => i && i.label).map((i) =>
    (i.href ? `<a href="${esc(i.href)}">${esc(i.label)}</a>` : `<span>${esc(i.label)}</span>`));
  return `<nav class="bsx-crumbs" aria-label="Sayfa yolu">${parts.join('<span class="sep">›</span>')}</nav>`;
}

function sideBox(label, inner) {
  if (!inner) return '';
  return `<section class="bsx-side-box"><h2 class="bsx-side-title">${esc(label)}</h2>${inner}</section>`;
}

// Kenar çubuğu numaralı/madde listesi. items: [{ slug, headline }]
function sideItems(items, tag, cls) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.headline && i.slug);
  if (!list.length) return '';
  const lis = list.map((i) => `<li class="bsx-side-item"><a href="${esc(newsPath(i.slug))}">${esc(i.headline)}</a></li>`).join('');
  return `<${tag} class="${cls}">${lis}</${tag}>`;
}

function catNavHtml(nav) {
  const items = nav.filter((n) => n && n.label && url(n.href));
  if (!items.length) return '';
  return `<ul class="bsx-side-list">${items.map((n) =>
    `<li class="bsx-side-item"><a href="${esc(url(n.href))}">${esc(n.label)}</a></li>`).join('')}</ul>`;
}

// Liste öğesi (yatay kart). Kategori sayfası ve arama sonuçları kullanır.
function listItem(a) {
  const meta = [a.category_name, formatDate(a.published_at)].filter(Boolean).join(' · ');
  return `<a class="bsx-list-item" href="${esc(newsPath(a.slug))}">`
    + `<div class="bsx-list-item-img">${img(a.cover_url, a.cover_alt_text || a.headline)}</div>`
    + `<div><h3 class="bsx-list-item-title">${esc(a.headline)}</h3>`
    + `${a.standfirst ? `<p>${esc(a.standfirst)}</p>` : ''}`
    + `${meta ? `<div class="bsx-list-item-meta">${esc(meta)}</div>` : ''}</div></a>`;
}

// card() için veri dönüşümü.
function toCard(a) {
  return { title: a.headline, href: newsPath(a.slug), image: a.cover_url, category: a.category_name, summary: a.standfirst };
}

function validArticles(articles) {
  return Array.isArray(articles) ? articles.filter((a) => a && a.headline) : [];
}

// ---------- Haber detayı ----------

function renderArticleMain(a, ad) {
  const headline = a.headline || '';
  const date = formatDate(a.published_at);
  const updated = formatDate(a.updated_at);
  const views = countText(a.views_count);
  const meta = [];
  if (a.author_name) meta.push(`<span>${esc(a.author_name)}</span>`);
  if (date) meta.push(`<time datetime="${esc(isoDate(a.published_at))}">${esc(date)}</time>`);
  if (updated) meta.push(`<span>Güncelleme: ${esc(updated)}</span>`);
  if (views) meta.push(`<span>${esc(views)} görüntülenme</span>`);
  const catLink = a.category_name
    ? (a.category_slug
      ? `<a class="bsx-article-cat" href="${esc(catPath(a.category_slug))}">${esc(a.category_name)}</a>`
      : `<span class="bsx-article-cat">${esc(a.category_name)}</span>`)
    : '';
  const summary = a.standfirst ? `<p class="bsx-article-summary">${esc(a.standfirst)}</p>` : '';
  const coverImage = `<figure class="bsx-article-cover">${img(a.cover_url, a.cover_alt_text || headline)}`
    + `${a.cover_caption ? `<figcaption>${esc(a.cover_caption)}</figcaption>` : ''}</figure>`;
  // Haberde YouTube videosu varsa kapak görselinin yerine oynatıcı gösterilir.
  const videoId = youtubeId(a.video_url);
  const cover = videoId
    ? `<div class="bsx-article-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(videoId)}" title="${esc(headline)} videosu" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
    : coverImage;
  const article = `<article class="bsx-article"><header>${catLink}`
    + `<h1 class="bsx-article-title">${esc(headline)}</h1>${summary}`
    + `${meta.length ? `<div class="bsx-article-meta">${meta.join('')}</div>` : ''}</header>`
    + `${cover}<div class="bsx-article-body">${bodyHtml(a.body)}</div></article>`;
  return `${article}${ad || ''}`;
}

// Paylaşım bağlantıları: düz bağlantılar, izleme yok.
function shareHtml(a) {
  const pageUrl = `${siteBase()}${newsPath(a.slug)}`;
  const text = a.headline || '';
  const links = [
    ['X', `https://x.com/intent/post?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`],
    ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${text} ${pageUrl}`.trim())}`],
  ];
  return `<div class="bsx-share"><span>Paylaş:</span>${links.map(([label, href]) =>
    `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`).join('')}</div>`;
}

function renderArticlePage({ shell, article, related, popular, ad, commentsHtml, popupHtml } = {}) {
  const parts = shellParts(shell);
  const brand = brandOf(parts.site);
  const a = article || {};
  const headline = a.headline || '';
  const crumbItems = [{ label: 'Anasayfa', href: '/' }];
  if (a.category_name) crumbItems.push({ label: a.category_name, href: catPath(a.category_slug) });
  crumbItems.push({ label: headline });
  const comments = String(commentsHtml || '').trim();
  const commentsBox = comments ? `<section class="bsx-comments">${comments}</section>` : '';
  const main = `${crumbs(crumbItems)}<div class="bsx-inner-grid">`
    + `<div>${renderArticleMain(a, ad)}${shareHtml(a)}${commentsBox}</div>`
    + `<aside>${sideBox('ÇOK OKUNANLAR', sideItems(popular, 'ol', 'bsx-side-list'))}`
    + `${sideBox('İLGİLİ HABERLER', sideItems(related, 'ul', 'bsx-side-list bsx-related'))}</aside></div>`;
  return fullPage(parts, {
    title: headline ? `${headline} | ${brand}` : brand,
    description: a.standfirst || headline,
    main,
    popupHtml,
  });
}

// ---------- Kategori ----------

function renderCategoryPage({ shell, category, articles, ad, popup, page = 1, totalPages = 1, pager = '', intro = '' } = {}) {
  const parts = shellParts(shell);
  const brand = brandOf(parts.site);
  const name = (category && category.name) || 'Kategori';
  const list = validArticles(articles);
  const lead = list.slice(0, 1).map((a) => card(toCard(a), { summary: true })).join('');
  const medium = list.slice(1, 3).map((a) => card(toCard(a))).join('');
  const mediumHtml = medium ? `<div class="bsx-cards-pair">${medium}</div>` : '';
  const rest = list.slice(3);
  const restHtml = rest.length ? `<div class="bsx-list">${rest.map(listItem).join('')}</div>` : '';
  const body = list.length
    ? `${lead}${mediumHtml}${restHtml}`
    : '<p class="bsx-empty">Bu kategoride henüz yayımlanmış haber yok.</p>';
  const pageNote = totalPages > 1 ? ` · Sayfa ${Number(page)} / ${Number(totalPages)}` : '';
  const main = `${crumbs([{ label: 'Anasayfa', href: '/' }, { label: name }])}`
    + `<h1 class="bsx-page-title">${esc(name)}</h1>`
    + `<p class="bsx-page-desc">${esc(name)} kategorisinden güncel haberler.${esc(pageNote)}</p>${intro}`
    + `<div class="bsx-inner-grid"><div>${ad || ''}${body}${pager || ''}</div>`
    + `<aside>${sideBox('KATEGORİLER', catNavHtml(parts.nav))}</aside></div>`;
  return fullPage(parts, {
    title: `${name}${page > 1 ? ` · Sayfa ${Number(page)}` : ''} | ${brand}`,
    description: `${name} kategorisinden güncel haberler.`,
    main,
    popupHtml: popup,
  });
}

// ---------- Arama ----------

function renderSearchPage({ shell, query, articles, total, pager = '' } = {}) {
  const parts = shellParts(shell);
  const brand = brandOf(parts.site);
  const q = String(query ?? '').trim().slice(0, 100);
  const list = validArticles(articles);
  let results;
  if (q.length < 2) results = '<p class="bsx-empty">Aramak için en az 2 karakter yazın.</p>';
  else if (!list.length) results = '<p class="bsx-empty">Aramanızla eşleşen haber bulunamadı.</p>';
  else results = `${Number(total) > 0 ? `<p class="bsx-page-desc">${esc(Number(total).toLocaleString('tr-TR'))} sonuç</p>` : ''}<div class="bsx-list">${list.map(listItem).join('')}</div>${pager || ''}`;
  const form = `<form class="bsx-search-form" action="/arama" method="get" role="search">`
    + `<input class="bsx-search-input" type="search" name="q" value="${esc(q)}" maxlength="100" placeholder="Haber ara" aria-label="Haber ara">`
    + `<button class="bsx-search-btn" type="submit">Ara</button></form>`;
  const main = `${crumbs([{ label: 'Anasayfa', href: '/' }, { label: 'Arama' }])}`
    + `<h1 class="bsx-page-title">Arama</h1>${form}${results}`;
  return fullPage(parts, {
    title: `Arama | ${brand}`,
    description: `${brand} haber arama.`,
    main,
  });
}

module.exports = { renderArticlePage, renderCategoryPage, renderSearchPage };
