const fs = require('node:fs/promises');
const path = require('node:path');
const { createDecipheriv } = require('node:crypto');
const pool = require('../db/pool');
const profile = require('../config/site-profile');
const siteStructure = require('../config/site-structure');
const homeModules = require('./home-modules');
const publicModules = require('./public-modules');
const { trackVisit } = require('./analytics');
const settingsStore = require('./settings-store');

const publicDir = path.join(__dirname, '..', 'public');
const siteUrl = (process.env.SITE_URL || 'http://localhost:3003').replace(/\/$/, '');
let siteIdentityCache = { expiresAt: 0, value: {} };

async function getSiteIdentity() {
  if (siteIdentityCache.expiresAt > Date.now()) return siteIdentityCache.value;
  const { rows } = await pool.query('SELECT setting_key, setting_value FROM site_settings');
  siteIdentityCache = { expiresAt: Date.now() + 5000, value: Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])) };
  return siteIdentityCache.value;
}

function decryptIntegrationCredential(value) {
  const [version, ivHex, tagHex, dataHex] = String(value || '').split(':');
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || '';
  if (version !== 'v1' || !/^[a-f0-9]{64}$/i.test(secret) || !/^[a-f0-9]{24}$/i.test(ivHex || '') || !/^[a-f0-9]{32}$/i.test(tagHex || '') || !/^(?:[a-f0-9]{2})+$/i.test(dataHex || '')) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

async function getLivePlaybackUrl() {
  const { rows } = await pool.query("SELECT ciphertext FROM integration_credentials WHERE integration_key = 'live-stream' AND field_key = 'playback-url' LIMIT 1");
  const value = decryptIntegrationCredential(rows[0]?.ciphertext);
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeCorporateHref(value) {
  if (typeof value !== 'string' || /[\s\\\x00-\x1f\x7f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

function escapeXml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function sendXml(res, status, xml, contentType = 'application/xml; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.end(xml);
  return true;
}

function articleHref(article) {
  return `/haber/${encodeURIComponent(article.slug)}`;
}

function categoryHref(article) {
  return article.category_slug ? `/kategori/${encodeURIComponent(article.category_slug)}` : '/';
}

function formatDate(value, options = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) {
  return value ? new Intl.DateTimeFormat('tr-TR', options).format(new Date(value)) : '';
}

function formatCount(value) {
  return new Intl.NumberFormat('tr-TR', { notation: Number(value) >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function corporateNavigation(activePath = '') {
  const prioritized = ['antalya', 'gundem', 'siyaset'];
  const navigationSlugs = new Set([...prioritized, 'canli-yayin', 'resmi-reklamlar']);
  const primary = prioritized.map((slug) => profile.categories.find((category) => category.slug === slug)).filter(Boolean);
  const secondary = profile.categories.filter((category) => !navigationSlugs.has(category.slug));
  const link = (label, href) => `<a href="${escapeHtml(href)}"${activePath === href ? ' class="nav-active" aria-current="page"' : ''}>${escapeHtml(label)}</a>`;
  const corporate = siteIdentityCache.value.corporateLinks ? siteIdentityCache.value.corporateLinks.split('\n').map((line) => line.split('|').map((part) => part.trim())).filter(([label, href]) => label && safeCorporateHref(href)) : [];
  return `<div class="nav-wrap"><nav id="primary-navigation" class="shell nav" aria-label="Haber kategorileri">${link('Ana Sayfa', '/')}${primary.map((category) => link(category.name, `/kategori/${encodeURIComponent(category.slug)}`)).join('')}${link('Canlı Yayın', '/canli-yayin')}${secondary.map((category) => link(category.name, `/kategori/${encodeURIComponent(category.slug)}`)).join('')}${corporate.map(([label, href]) => link(label, href)).join('')}</nav></div>`;
}

function renderPublicHeader(activePath = '') {
  const date = formatDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  const masthead = `<header class="masthead shell"><button class="icon-button mobile-menu" aria-label="Menüyü aç" aria-controls="primary-navigation" aria-expanded="false" data-menu>☰</button><a class="brand" href="/" aria-label="Art World TV ana sayfa"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="Art World TV"></a><div class="masthead-tools"><span class="edition">${escapeHtml(date)} · Antalya</span><button class="search-button" data-search aria-label="Haberlerde ara"><span aria-hidden="true">⌕</span> Haber ara</button><button class="icon-button" data-theme aria-label="Görünümü değiştir">◐</button><a class="login-link" href="/yonetim">Yönetim</a></div></header>`;
  return `${masthead}${corporateNavigation(activePath)}`;
}

function replacePublicHeader(markup, activePath = '') {
  const headerPattern = /<header class="masthead shell">[\s\S]*?<\/header>\s*<div class="nav-wrap">[\s\S]*?<\/div>/;
  const updated = markup.replace(headerPattern, renderPublicHeader(activePath)).replace(/<img src="\/assets\/art-world-logo\.png"/g, `<img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}"`);
  if (updated === markup) throw new Error('Ortak site üst alanı şablonda bulunamadı.');
  return updated;
}

function corporateFooter() {
  const identity = siteIdentityCache.value;
  const links = identity.corporateLinks ? identity.corporateLinks.split('\n').map((line) => line.split('|').map((part) => part.trim())).filter(([label, href]) => label && safeCorporateHref(href)) : [['Künye', '/kunye'], ['İletişim', '/iletisim'], ['Yayın ilkeleri', '/yayin-ilkeleri'], ['Reklam ver', '/reklam-ver'], ['Canlı yayın', '/canli-yayin'], ['Yayın arşivi', '/arsiv']];
  return `<footer class="corporate-footer"><div class="shell corporate-footer-grid"><div><strong>${escapeHtml(profile.brand)}</strong><p>${escapeHtml(identity.slogan || identity.publisher || profile.publisher)}</p></div><nav aria-label="Kurumsal bağlantılar">${links.map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('')}<a href="/rss.xml">RSS</a><a href="/sitemap.xml">Site haritası</a></nav><nav aria-label="Yasal sayfalar"><a href="/gizlilik-politikasi">Gizlilik politikası</a><a href="/veri-politikasi">Veri politikası</a><a href="/kullanim-sartlari">Kullanım şartları</a><a href="/kullanici-sozlesmesi">Kullanıcı sözleşmesi</a></nav>${publicModules.footerLinksHtml()}</div><div class="shell corporate-footer-bottom">© ${new Date().getFullYear()} ${escapeHtml(profile.brand)} · ${escapeHtml(identity.address || profile.address)}</div></footer>`;
}

function renderCorporatePage(pathname) {
  const identity = siteIdentityCache.value;
  const publisher = identity.publisher || profile.publisher;
  const representative = identity.representative || profile.representative;
  const editorInChief = identity.editorInChief || profile.editorInChief;
  const address = identity.address || profile.address;
  const phone = identity.phone || profile.phone;
  const emails = identity.emails ? identity.emails.split(',').map((email) => email.trim()).filter(Boolean) : profile.emails;
  const website = identity.website || profile.website;
  const uets = identity.uets || profile.uets;
  const hostingProvider = identity.hostingProvider || profile.hostingProvider;
  const hostingAddress = identity.hostingAddress || profile.hostingAddress;
  const phoneLink = phone.replace(/[^+\d]/g, '');
  const mailLink = `mailto:${escapeHtml(emails[0] || '')}`;
  const pages = {
    '/hakkimizda': ['Hakkımızda', 'Art World TV hakkında', `<p>Art World TV; Antalya merkezli haber yayını, yerel gündem ve televizyon/video içerikleri sunar. Kaynak sitede Antalya, Türkiye ve dünya gündeminin yanı sıra kültür-sanat, spor, röportaj ve program arşivi bölümleri yer alıyor.</p><p>Yayıncı: <strong>${escapeHtml(publisher)}</strong></p><p>Program ve canlı yayın bağlantıları için <a class="corporate-inline-link" href="/canli-yayin">Art World TV yayın sayfasını</a> ziyaret edin.</p>`],
    '/kunye': ['Künye', 'Art World TV yayın künyesi', `<dl class="corporate-facts"><div><dt>Ticaret unvanı</dt><dd>${escapeHtml(publisher)}</dd></div><div><dt>Tüzel kişi temsilcisi</dt><dd>${escapeHtml(representative)}</dd></div><div><dt>Yayıncı</dt><dd><a href="${escapeHtml(website)}">${escapeHtml(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></dd></div><div><dt>Sorumlu yazı işleri müdürü</dt><dd>${escapeHtml(editorInChief)}</dd></div><div><dt>Yönetim yeri</dt><dd>${escapeHtml(address)}</dd></div><div><dt>İletişim telefonu</dt><dd><a href="tel:${escapeHtml(phoneLink)}">${escapeHtml(phone)}</a></dd></div><div><dt>Kurumsal e-posta</dt><dd>${emails.map((email) => `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join('<br>')}</dd></div><div><dt>UETS</dt><dd>${escapeHtml(uets)}</dd></div><div><dt>Yer sağlayıcı</dt><dd>${escapeHtml(hostingProvider)} · ${escapeHtml(hostingAddress)}</dd></div></dl><p class="corporate-source">Kaynak: <a href="https://www.artworld.com.tr/sayfa-kunye-2" rel="noopener noreferrer">Art World TV resmî künyesi</a>.</p>`],
    '/iletisim': ['İletişim', 'Art World TV ile iletişime geçin', `<div class="corporate-contact-grid"><a class="corporate-contact-card" href="tel:${escapeHtml(phoneLink)}"><span>Telefon</span><strong>${escapeHtml(phone)}</strong></a><a class="corporate-contact-card" href="${mailLink}"><span>E-posta</span><strong>${escapeHtml(emails[0] || '')}</strong></a><div class="corporate-contact-card"><span>Yönetim yeri</span><strong>${escapeHtml(address)}</strong></div></div><p>Haber, düzeltme/cevap, reklam ve diğer başvurularınızı e-posta ile iletebilirsiniz. Konu satırında başvurunuzun türünü belirtin.</p><a class="corporate-action" href="${mailLink}?subject=${encodeURIComponent('Art World TV başvurusu')}">E-posta gönder</a><p class="corporate-source">İletişim bilgileri <a href="https://www.artworld.com.tr/iletisim" rel="noopener noreferrer">kaynak sitede yayımlanan bilgilerden</a> alınmıştır.</p>`],
    '/yayin-ilkeleri': ['Yayın İlkeleri', 'Haber yayınında temel yaklaşımımız', `<ul class="corporate-principles">${profile.editorialPrinciples.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="corporate-source">Bu özet, <a href="https://artworld.com.tr/yayin-ilkeleri" rel="noopener noreferrer">Art World TV’de yayımlanan yayın ilkeleri</a> esas alınarak hazırlanmıştır.</p>`],
    '/reklam-ver': ['Reklam Ver', 'Art World TV reklam ve iş birliği başvuruları', `<p>Kaynak sitedeki reklam bilgileri; ölçülebilir dijital yayın, hedef kitleye erişim, performans raporlama ve kampanya esnekliğini öne çıkarıyor. Uygun yayın alanı ve kampanya planı için ekiple iletişime geçin.</p><ul class="corporate-principles">${profile.adBenefits.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><div class="corporate-contact-grid"><a class="corporate-contact-card" href="tel:${escapeHtml(phoneLink)}"><span>Telefon</span><strong>${escapeHtml(profile.phone)}</strong></a><a class="corporate-contact-card" href="mailto:${escapeHtml(profile.emails[1])}?subject=${encodeURIComponent('Reklam ve iş birliği')}"><span>Reklam e-postası</span><strong>${escapeHtml(profile.emails[1])}</strong></a></div><a class="corporate-action" href="mailto:${escapeHtml(profile.emails[1])}?subject=${encodeURIComponent('Reklam ve iş birliği')}">Reklam başvurusu gönder</a><p class="corporate-source">Kaynak: <a href="https://artworld.com.tr/reklam-ver" rel="noopener noreferrer">Art World TV reklam sayfası</a>.</p>`],
    '/canli-yayin': ['Canlı Yayın', 'Art World TV canlı yayın ve programları', `<p>Art World TV canlı yayını, kaynak sitede kullanılan resmî Artı Dijital Medya oynatıcısı üzerinden açılır.</p><div class="corporate-live-embed"><iframe src="${escapeHtml(profile.liveEmbed)}" title="Art World TV canlı yayın oynatıcısı" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div><div class="corporate-live-links"><a class="corporate-action" href="${escapeHtml(profile.liveTv)}" target="_blank" rel="noopener noreferrer">Artı Dijital Medya’da aç</a><a class="corporate-action corporate-action-secondary" href="${escapeHtml(profile.youtube)}" target="_blank" rel="noopener noreferrer">YouTube kanalını aç</a><a class="corporate-action corporate-action-secondary" href="${escapeHtml(profile.videoArchive)}" target="_blank" rel="noopener noreferrer">Video arşivi</a></div><h2 id="programlar">Programlar</h2><ul class="program-list">${profile.programs.map((program) => `<li>${escapeHtml(program)}</li>`).join('')}</ul><p class="corporate-source">Oynatıcı adresi, kaynak sitenin canlı yayın sayfasındaki gömülü video bağlantısından alındı.</p>`],
    '/servisler': ['Servisler', 'Art World TV yayın servisleri', `<p>Kaynak sitedeki servis menüsünde bulunan başlıklar:</p><ul class="service-list">${profile.services.map((service) => `<li>${escapeHtml(service)}</li>`).join('')}</ul><p class="corporate-notice">Bu başlıkların kaynak/servis sağlayıcı bağlantıları yeni portala henüz aktarılmadı. Gerçek veri entegrasyonu yapılmadan servis değerleri gösterilmeyecek.</p>`],
    '/icerik-bolumleri': ['İçerik Bölümleri', 'Art World TV fotoğraf, video, yazar ve arşiv bölümleri', `<p>Kaynak sitede yer alan fotoğraf/video galerileri, yazarlar, röportajlar ve özel arşiv bölümleri:</p><div class="corporate-section-links">${profile.archiveSections.map((section) => `<a class="corporate-section-card" href="${escapeHtml(section.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(section.name)}</strong><span>Kaynak arşivi aç</span></a>`).join('')}</div><p class="corporate-notice">Haber arşivindeki 613 içerik bu projeye aktarılıyor. Fotoğraf galerisi, video kayıtları, yazar profilleri ve röportaj koleksiyonları henüz bu CMS’in veritabanında tutulmuyor; bağlantılar mevcut Art World TV arşivine gider.</p>`],
    '/haber-gonder': ['Haber Gönder', 'Haber ve ihbarlarınızı Art World TV’ye iletin', `<p>Haber önerisi, yerel gelişme veya ihbarınızı e-posta ile iletin. Varsa olayın zamanı, yeri, doğrulanabilir kaynakları ve yayımlama izni bulunan görselleri ekleyin.</p><a class="corporate-action" href="mailto:${escapeHtml(profile.emails[0])}?subject=${encodeURIComponent('Haber önerisi / ihbar')}">Haber önerisi gönder</a><p class="corporate-source">Kişisel veya hassas bilgileri e-posta ile göndermeden önce başvurunuz için gerekli olup olmadığını değerlendirin.</p>`],
    '/gizlilik-politikasi': ['Gizlilik Politikası', 'Gizlilik metni hakkında', `<p>Kaynak sitedeki gizlilik metnini yeni portala aktarmadan önce gözden geçirmek gerekiyor. Bu nedenle bu sayfa şu an onaylı hukuki metin olarak sunulmuyor.</p><p class="corporate-notice">Yeni portalda kullanılan çerezler, oturum bilgileri, analitik araçları ve saklama süreleri yayın öncesinde gerçek uygulamaya göre açıklanıp yetkili kişi tarafından onaylanmalıdır.</p><a class="corporate-inline-link" href="https://www.artworld.com.tr/gizlilik-politikasi" rel="noopener noreferrer">Kaynak sitedeki mevcut gizlilik sayfası</a>`],
    '/veri-politikasi': ['Veri Politikası', 'Kişisel veriler hakkında bilgilendirme', `<p>Kaynak sitedeki veri politikası metninde kurum adı için “XXXXX” gibi tamamlanmamış alanlar ve yeni portal ile doğrulanmamış hükümler bulunuyor. Yanlış veya eski bir metni yeni sitede geçerli politika gibi yayımlamamak için burada kopyalamadım.</p><p class="corporate-notice">Yayın öncesinde veri sorumlusu, işleme amaçları, hukuki dayanaklar, alıcı grupları, saklama süreleri ve başvuru yöntemi gerçek işleyişe göre belirlenip onaylanmalıdır.</p><a class="corporate-inline-link" href="https://www.artworld.com.tr/veri-politikasi" rel="noopener noreferrer">Kaynak sitedeki mevcut veri politikası</a>`],
    '/kullanim-sartlari': ['Kullanım Şartları', 'Kullanım kuralları metni hakkında', `<p>Kaynak sitedeki kullanım kuralları yorum ve üyelik özelliklerine yönelik. Yeni portalın kullanıcı özellikleriyle aynı kapsamda olup olmadığı doğrulanmadan metni aynen taşımadım.</p><p class="corporate-notice">Yorum, üyelik veya kullanıcı gönderisi özellikleri açılmadan önce bu sayfa gerçek ürün işleyişine göre güncellenmelidir.</p><a class="corporate-inline-link" href="https://artworld.com.tr/kullanim-sartlari" rel="noopener noreferrer">Kaynak sitedeki mevcut kullanım şartları</a>`],
    '/kullanici-sozlesmesi': ['Kullanıcı Sözleşmesi', 'Kullanıcı sözleşmesi metni hakkında', `<p>Kaynak sitedeki mevcut kullanıcı sözleşmesinin yeni portalın özelliklerine ve gerçek taraf bilgilerine uygunluğu doğrulanmalı. Yeni sitede doğrulanmamış bir sözleşme yürürlükteymiş gibi yayımlanmıyor.</p><p class="corporate-notice">Üyelik ve kullanıcı işlemleri devreye alınmadan önce sözleşme içeriği ve taraf bilgileri onaylanmalıdır.</p><a class="corporate-inline-link" href="https://www.artworld.com.tr/kullanici-sozlesmesi" rel="noopener noreferrer">Kaynak sitedeki mevcut kullanıcı sözleşmesi</a>`]
  };
  const page = pages[pathname];
  if (!page) return null;
  const [title, description, content] = page;
  const canonical = `${siteUrl}${pathname}`;
  return replacePublicHeader(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071827"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><title>${escapeHtml(title)} | ${escapeHtml(profile.brand)}</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corporate.css"></head><body><header class="masthead shell"><a class="brand" href="/" aria-label="${escapeHtml(profile.brand)} ana sayfa"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="${escapeHtml(profile.brand)}"></a><div class="masthead-tools"><a class="login-link" href="/yonetim">Yönetim</a></div></header>${corporateNavigation()}<main class="shell corporate-page"><nav class="corporate-breadcrumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a><span>›</span><span>${escapeHtml(title)}</span></nav><article><span class="section-kicker">ART WORLD TV · KURUMSAL</span><h1>${escapeHtml(title)}</h1><p class="corporate-lede">${escapeHtml(description)}</p><div class="corporate-body">${content}</div></article></main>${corporateFooter()}<script src="/app.js"></script></body></html>`, pathname);
}

function renderNewsCard(article) {
  const category = article.category_name || 'Haber';
  const categoryFilter = category === 'Kültür Sanat' ? 'Kültür' : category;
  const cover = article.cover_url
    ? `<img src="${escapeHtml(article.cover_url)}" alt="${escapeHtml(article.cover_alt_text || article.headline)}" loading="lazy">`
    : '';
  return `<article class="news-card" data-category="${escapeHtml(categoryFilter)}">
    <a class="news-thumb placeholder-cover" href="${articleHref(article)}" aria-label="${escapeHtml(article.headline)}">${cover}</a>
    <div class="news-copy"><span class="meta">${escapeHtml(category.toLocaleUpperCase('tr-TR'))} <i>·</i> ${escapeHtml(formatDate(article.published_at, { hour: '2-digit', minute: '2-digit' }))}</span>
      <h3><a href="${articleHref(article)}">${escapeHtml(article.headline)}</a></h3>
      <p>${escapeHtml(article.standfirst || '')}</p>
      <div class="byline"><span class="avatar">${escapeHtml((article.author_name || 'A').slice(0, 1).toLocaleUpperCase('tr-TR'))}</span> ${escapeHtml(article.author_name || 'Art World TV')} <span class="read-time">${article.read_minutes} dk okuma</span></div>
    </div></article>`;
}

function renderNewsSelection(articles, limit) {
  const cards = articles.slice(0, limit).map((article) => {
    const cover = article.cover_url
      ? `<img src="${escapeHtml(article.cover_url)}" alt="${escapeHtml(article.cover_alt_text || article.headline)}" width="640" height="360" loading="lazy">`
      : '<span aria-hidden="true">ART WORLD TV</span>';
    return `<li><article class="news-selection-card">
    <a class="news-selection-image${article.cover_url ? '' : ' placeholder-cover'}" href="${articleHref(article)}" aria-label="${escapeHtml(article.headline)}">${cover}</a>
    <div class="news-selection-meta"><time datetime="${escapeHtml(new Date(article.published_at).toISOString())}">${escapeHtml(formatDate(article.published_at, { hour: '2-digit', minute: '2-digit' }))}</time><a href="${categoryHref(article)}">${escapeHtml(article.category_name || 'Haber')}</a></div>
    <h3><a href="${articleHref(article)}">${escapeHtml(article.headline)}</a></h3>
    ${article.standfirst ? `<p>${escapeHtml(article.standfirst)}</p>` : ''}
    <small>${escapeHtml(article.author_name || 'Art World TV')}</small>
  </article></li>`;
  }).join('');
  return `<ol class="news-selection-grid">${cards || '<li class="news-selection-empty">Henüz haber yok.</li>'}</ol>`;
}

function sliderControls(slot, index, count, label) {
  if (count < 2) return '';
  return `<div class="hero-slider-controls" aria-label="${escapeHtml(label)} kaydırıcı kontrolleri"><button type="button" data-slider-prev aria-label="Önceki haber">‹</button><span data-slider-position aria-live="polite">${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}</span><button type="button" data-slider-next aria-label="Sonraki haber">›</button></div>`;
}

function renderHero(article, slide = {}) {
  const category = article.category_name || 'Haber';
  const image = article.cover_url
    ? `<img class="lead-image" src="${escapeHtml(article.cover_url)}" alt="${escapeHtml(article.cover_alt_text || article.headline)}" loading="lazy">`
    : '<div class="lead-image placeholder-cover" aria-hidden="true"></div>';
  return `<article class="lead-story hero-slide" data-hero-slide${slide.active ? '' : ' hidden'} aria-hidden="${slide.active ? 'false' : 'true'}">${image}<div class="lead-shade"></div>
    <div class="lead-content"><span class="eyebrow"><a href="${categoryHref(article)}">${escapeHtml(category.toLocaleUpperCase('tr-TR'))}</a> <b>·</b> ${escapeHtml(formatDate(article.published_at, { hour: '2-digit', minute: '2-digit' }))}</span>
      <h1><a href="${articleHref(article)}">${escapeHtml(article.headline)}</a></h1><p>${escapeHtml(article.standfirst || '')}</p><a class="read-more" href="${articleHref(article)}">Haberi oku <span>→</span></a></div>${sliderControls('main', slide.index || 0, slide.count || 1, 'Manşet')}${slide.count > 1 ? `<span class="lead-counter">${String((slide.index || 0) + 1).padStart(2, '0')} <i>/</i> ${String(slide.count).padStart(2, '0')}</span>` : ''}</article>`;
}

function renderSideStory(article, index, slide = {}) {
  const category = article.category_name || 'Haber';
  const cover = article.cover_url
    ? `<img src="${escapeHtml(article.cover_url)}" alt="" loading="lazy">`
    : '<div class="placeholder-cover" aria-hidden="true"></div>';
  return `<article class="side-story hero-slide" data-hero-slide${slide.active ? '' : ' hidden'} aria-hidden="${slide.active ? 'false' : 'true'}">${cover}<a class="side-story-link" href="${articleHref(article)}"><span class="side-tag">${escapeHtml(category.toLocaleUpperCase('tr-TR'))}</span><h2>${escapeHtml(article.headline)}</h2><span class="story-time">${escapeHtml(formatDate(article.published_at, { hour: '2-digit', minute: '2-digit' }))}</span></a>${sliderControls(`side-${index + 1}`, slide.index || 0, slide.count || 1, 'Haber')}</article>`;
}

function renderHeroSlider(articles, slot, label, renderSlide) {
  if (!articles.length) return '';
  const layoutClass = slot === 'main' ? 'hero-slider-main' : 'side-slider';
  return `<div class="hero-slider ${layoutClass}" data-hero-slider role="region" aria-roledescription="carousel" aria-label="${escapeHtml(label)}">${articles.map((article, index) => renderSlide(article, index, articles.length)).join('')}</div>`;
}

function renderBreaking(article) {
  return `<a href="${articleHref(article)}">${escapeHtml(article.headline)}</a>`;
}

function renderBrief(article) {
  return `<a href="${articleHref(article)}"><time>${escapeHtml(formatDate(article.published_at, { hour: '2-digit', minute: '2-digit' }))}</time><span>${escapeHtml(article.headline)}</span><b>→</b></a>`;
}

function renderPopular(article, index) {
  return `<li><a href="${articleHref(article)}"><span class="rank">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(article.headline)}</span><b>${escapeHtml(formatCount(article.views_count))}</b></a></li>`;
}

async function selectArticles(limit = 30) {
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.headline, a.standfirst, a.body, a.status, a.is_breaking,
            a.is_featured, a.homepage_slider_slot, a.is_in_briefing, a.is_in_latest, a.views_count, a.published_at,
            c.name AS category_name, c.slug AS category_slug, u.display_name AS author_name,
            m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text
       FROM articles a
       LEFT JOIN categories c ON c.id = a.primary_category_id
       LEFT JOIN users u ON u.id = a.author_id
       LEFT JOIN media_assets m ON m.id = a.cover_media_id
      WHERE a.status = 'published' AND a.published_at <= NOW()
      ORDER BY a.is_featured DESC, a.is_breaking DESC, a.published_at DESC
      LIMIT $1`, [limit]
  );
  return rows.map((article) => {
    const text = Array.isArray(article.body) ? article.body.map((block) => block?.text || '').join(' ') : String(article.body || '');
    return { ...article, cover_url: article.cover_storage_key ? `/media/${article.cover_storage_key}` : '', read_minutes: Math.max(1, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length / 220)) };
  });
}

async function getActiveAd(placementKey) {
  const { rows } = await pool.query(
    `SELECT cr.id, cr.headline, cr.target_url, m.storage_key, m.alt_text, m.width, m.height,
            COALESCE(variants.items, '[]'::json) AS variants,
            p.id AS placement_id, p.placement_key, p.display_name AS placement_name, p.format AS placement_format,
            p.supported_sizes,
            c.id AS campaign_id, c.name AS campaign_name, c.regulatory_reference, a.company_name AS advertiser_name
       FROM ad_creatives cr JOIN ad_campaigns c ON c.id = cr.campaign_id
       JOIN advertisers a ON a.id = c.advertiser_id
       JOIN ad_campaign_placements cp ON cp.campaign_id = c.id
       JOIN ad_placements p ON p.id = cp.placement_id
       JOIN media_assets m ON m.id = cr.media_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', variant.id, 'storage_key', vm.storage_key,
                                          'alt_text', vm.alt_text, 'width', vm.width, 'height', vm.height,
                                          'is_mobile', EXISTS (
                                            SELECT 1 FROM jsonb_array_elements(COALESCE(p.supported_sizes->'mobile', '[]'::jsonb)) mobile_size
                                             WHERE (mobile_size->>0)::integer = vm.width AND (mobile_size->>1)::integer = vm.height
                                          ))
                         ORDER BY vm.width DESC, vm.height DESC) AS items
           FROM ad_creatives variant JOIN media_assets vm ON vm.id = variant.media_id
          WHERE variant.campaign_id = cr.campaign_id AND variant.status = 'approved'
            AND variant.headline = cr.headline AND variant.target_url = cr.target_url
            AND EXISTS (
              SELECT 1 FROM jsonb_each(COALESCE(p.supported_sizes, '{}'::jsonb)) size_group
              CROSS JOIN LATERAL jsonb_array_elements(size_group.value) size_value
              WHERE (size_value->>0)::integer = vm.width AND (size_value->>1)::integer = vm.height
            )
       ) variants ON TRUE
      WHERE p.placement_key = $1 AND p.is_active = TRUE AND cr.status = 'approved' AND c.status = 'active'
        AND (c.starts_at IS NULL OR c.starts_at <= NOW()) AND (c.ends_at IS NULL OR c.ends_at > NOW())
      ORDER BY cr.created_at DESC LIMIT 1`, [placementKey]
  );
  const ad = rows[0];
  return ad || null;
}

function renderAdSlot(ad, fallbackTitle = 'Markanızı doğru kitleyle buluşturun.', placement = 'home-feature') {
  if (ad) {
    const variants = Array.isArray(ad.variants) && ad.variants.length ? ad.variants : [{ id: ad.id, storage_key: ad.storage_key, alt_text: ad.alt_text, width: ad.width, height: ad.height }];
    const mobile = variants.filter((item) => item.is_mobile === true);
    const desktop = variants.filter((item) => item.is_mobile !== true);
    const fallback = desktop[0] || variants[0];
    const srcset = (items) => items.filter((item) => item.storage_key && Number(item.width) > 0).map((item) => `/media/${escapeHtml(item.storage_key)} ${Number(item.width)}w`).join(', ');
    const tracking = variants.map((item) => ({
      id: item.id,
      source: `/media/${item.storage_key}`,
      impression: `/api/ads/${item.id}/impression?placement=${encodeURIComponent(placement)}`,
      click: `/api/ads/${item.id}/click?placement=${encodeURIComponent(placement)}`
    }));
    const mobileSource = srcset(mobile); const desktopSource = srcset(desktop);
    const imageSizes = '(max-width: 680px) calc(100vw - 30px), (max-width: 900px) calc(100vw - 36px), 1192px';
    const picture = `<picture>${mobileSource ? `<source media="(max-width: 680px)" srcset="${mobileSource}" sizes="${imageSizes}">` : ''}${desktopSource ? `<source media="(min-width: 681px)" srcset="${desktopSource}" sizes="${imageSizes}">` : ''}<img src="/media/${escapeHtml(fallback.storage_key || '')}" alt="${escapeHtml(ad.alt_text || ad.headline)}" loading="lazy" data-ad-creative-image></picture>`;
    return `<div class="ad-slot delivered-ad ad-placement-${escapeHtml(placement)} ${placement === 'home-leaderboard' ? 'ad-banner' : ''}" data-ad-impression="/api/ads/${ad.id}/impression?placement=${encodeURIComponent(placement)}" data-ad-variants="${escapeHtml(JSON.stringify(tracking))}"><span>REKLAM</span><a data-ad-click href="/api/ads/${ad.id}/click?placement=${encodeURIComponent(placement)}" rel="sponsored">${picture}<b>${escapeHtml(ad.headline)}</b></a></div>`;
  }
  const banner = ['home-leaderboard', 'article-inline', 'category-top'].includes(placement);
  const video = placement === 'video-sponsor';
  const image = video ? '/assets/bik/video-1280x720.jpg' : banner ? '/assets/bik/banner-970x150.jpg' : '/assets/bik/box-300x250.jpg';
  const responsive = banner
    ? `<source media="(max-width: 680px)" srcset="/assets/bik/banner-320x100.jpg 320w, /assets/bik/banner-300x100.jpg 300w" sizes="100vw"><source media="(min-width: 681px)" srcset="/assets/bik/banner-900x100.jpg 900w, /assets/bik/banner-970x150.jpg 970w, /assets/bik/banner-980x220.jpg 980w, /assets/bik/banner-1170x150.jpg 1170w, /assets/bik/banner-1280x250.jpg 1280w" sizes="100vw">`
    : '';
  const alt = video ? 'Basın İlan Kurumu tarafından sağlanan 1280 × 720 reklam görseli' : banner ? 'Basın İlan Kurumu reklam görseli' : 'Basın İlan Kurumu 300 × 250 reklam görseli';
  const dimensions = video ? ' width="1280" height="720"' : banner ? '' : ' width="300" height="250"';
  const sizeClass = banner ? 'top-ad' : 'rail-ad';
  return `<div class="ad-slot bik-ad ${sizeClass} ${banner ? 'bik-ad-banner' : video ? 'bik-ad-video' : 'bik-ad-box'}" data-bik-placement="${escapeHtml(placement)}"><span>REKLAM</span><picture>${responsive}<img src="${image}" alt="${alt}"${dimensions} loading="lazy"></picture><i>BİK · ${escapeHtml(placement)}</i></div>`;
}

function renderBriefingWidgets() {
  return `<div class="briefing-widgets" data-briefing-widgets>
    <section class="briefing-widget" aria-labelledby="briefing-weather-title" data-widget-weather>
      <div class="briefing-widget-heading"><div><span class="section-kicker">ANTALYA</span><h3 id="briefing-weather-title">Hava Durumu</h3></div><span class="widget-badge">Güncel</span></div>
      <div class="weather-reading"><strong data-weather-temperature>--°</strong><span data-weather-condition>Hava verisi yükleniyor.</span></div>
      <p class="briefing-widget-detail" data-weather-details>Bugünün en düşük ve en yüksek sıcaklığı alınıyor.</p>
      <small class="briefing-widget-updated" data-weather-updated></small>
      <a class="briefing-widget-source" href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">Kaynak: Open-Meteo</a>
    </section>
    <section class="briefing-widget" aria-labelledby="briefing-market-title" data-widget-market>
      <div class="briefing-widget-heading"><div><span class="section-kicker">DÖVİZ</span><h3 id="briefing-market-title">Piyasa Durumu</h3></div><span class="widget-badge">Referans kur</span></div>
      <div class="market-readings" aria-live="polite"><div><span>USD / TRY</span><strong data-market-usd>--</strong></div><div><span>EUR / TRY</span><strong data-market-eur>--</strong></div></div>
      <p class="briefing-widget-detail" data-market-details>Günlük referans kurları alınıyor.</p>
      <small class="briefing-widget-updated" data-market-updated></small>
      <a class="briefing-widget-source" href="https://frankfurter.dev/" target="_blank" rel="noopener noreferrer">Kaynak: Frankfurter · merkez bankası referansları</a>
    </section>
  </div>`;
}

function renderHomeModule(module, context) {
  const { articles, popular, ads, playbackUrl } = context;
  if (homeModuleTypes.has(module.type)) {
    try { return homeModules.render(module, context) || ''; }
    catch (error) { console.error('Ana sayfa modülü çizilemedi:', module.type, error.message); return ''; }
  }
  const title = escapeHtml(module.title || '');
  const limit = Math.min(20, Math.max(1, Number(module.limit) || 8));
  const section = (className, kicker, content) => `<section class="${className}"><div class="section-heading"><div><span class="section-kicker">${kicker}</span><h2>${title}</h2></div></div>${content}</section>`;
  switch (module.type) {
    case 'breaking': {
      const stories = articles.filter((article) => article.is_breaking).slice(0, limit);
      return `<section class="breaking" aria-label="Son dakika"><span class="breaking-label"><i></i> ${title || 'SON DAKİKA'}</span><div class="ticker-window"><div class="ticker-track">${stories.map(renderBreaking).join('') || '<span class="ticker-empty">Şu an son dakika haberi yok.</span>'}</div></div></section>`;
    }
    case 'hero': {
      if (!articles.length) return '<section class="lead-grid"><p class="public-empty">Yayınlanmış haber bulunmuyor.</p></section>';
      const pool = articles.slice(0, Math.max(3, Math.min(12, articles.length)));
      const featuredIndex = Math.max(0, pool.findIndex((article) => article.is_featured));
      const autoPool = Array.from({ length: pool.length }, (_, index) => pool[(featuredIndex + index) % pool.length]);
      const slotArticles = (slot, offset) => {
        const selected = articles.filter((article) => article.homepage_slider_slot === slot);
        const fill = autoPool.filter((article) => article.homepage_slider_slot === 'auto' || !article.homepage_slider_slot);
        const ordered = selected.length ? selected : fill;
        const result = ordered.slice(0, Math.min(5, ordered.length));
        return result.length ? result : autoPool.slice(offset, offset + Math.min(5, autoPool.length));
      };
      const mainSlides = slotArticles('main', 0);
      const topSlides = slotArticles('side_top', 1);
      const bottomSlides = slotArticles('side_bottom', 2);
      return `<section class="lead-grid" aria-label="${title || 'Öne çıkan haberler'}">${renderHeroSlider(mainSlides, 'main', 'Manşet haberler', (article, index, count) => renderHero(article, { active: index === 0, index, count }))}<div class="lead-side">${renderHeroSlider(topSlides, 'side-top', 'Yan manşet haberleri', (article, index, count) => renderSideStory(article, 0, { active: index === 0, index, count }))}${renderHeroSlider(bottomSlides, 'side-bottom', 'Alt yan manşet haberleri', (article, index, count) => renderSideStory(article, 1, { active: index === 0, index, count }))}</div></section>`;
    }
    case 'briefing': return section('briefing', 'GÜNÜN ÖZETİ', `<div class="brief-grid">${articles.filter((article) => article.is_in_briefing).slice(0, limit).map(renderBrief).join('') || '<p class="public-empty">Günün özeti için haber yok.</p>'}</div>${renderBriefingWidgets()}`);
    case 'latest': return section('news-section', 'ART WORLD TV', `${renderNewsSelection(articles.filter((article) => article.is_in_latest), limit)}<a class="text-link" href="/haberler">Tüm haberler</a>`);
    case 'categoryFeed': {
      const selected = module.category ? articles.filter((article) => article.category_slug === module.category) : articles;
      return section('news-section', 'KATEGORİ SEÇKİSİ', `<div class="news-list">${selected.slice(0, limit).map(renderNewsCard).join('') || '<p class="public-empty">Bu kategoride haber yok.</p>'}</div>`);
    }
    case 'popular': return section('popular', 'OKURLARIN RADARINDA', `<ol>${popular.slice(0, limit).map(renderPopular).join('') || '<li class="public-empty">Henüz okuma verisi yok.</li>'}</ol>`);
    case 'videoPrograms': return section('video-section', 'ART WORLD TV', `<div class="video-grid">${profile.programs.slice(0, limit).map((program, index) => `<a class="video-card program-card" href="/canli-yayin#programlar"><span class="program-mark">${['GÖ','İZ','SV','Hİ'][index] || 'TV'}</span><small>ART WORLD TV</small><h3>${escapeHtml(program)}</h3></a>`).join('')}</div><a class="text-link" href="/canli-yayin#programlar">Tüm programlar</a>`);
    case 'liveStream': return `<section class="live-card"><div class="live-top"><span><i></i> CANLI YAYIN</span></div>${playbackUrl ? `<div class="live-screen live-player"><video controls playsinline preload="none" aria-label="Art World TV canlı yayını"><source src="${escapeHtml(playbackUrl)}"></video></div>` : `<div class="live-screen"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="Art World TV"><span class="live-play">TV</span></div>`}<div class="live-meta"><strong>${title || 'Art World TV'}</strong><span>Canlı televizyon yayını</span></div>${playbackUrl ? '' : '<p class="live-unavailable">Yayın izleme adresi henüz ayarlanmamış.</p>'}</section>`;
    case 'adSlot': return renderAdSlot(ads[module.placement], module.title || 'Markanız için güçlü bir yayın alanı', module.placement);
    case 'newsletter': return `<section class="newsletter"><div class="newsletter-symbol">AW<span>+</span></div><div><span class="section-kicker">ART WORLD BÜLTEN</span><h2>${title || 'Gündem kutunuza gelsin'}</h2><p>Haber seçkisini e-posta adresinize gönderelim.</p></div><form data-newsletter><label class="sr-only" for="newsletter-${escapeHtml(module.id)}">E-posta adresiniz</label><input id="newsletter-${escapeHtml(module.id)}" name="email" type="email" placeholder="E-posta adresiniz" required><label class="newsletter-consent"><input name="consent" type="checkbox" required> Bülten gönderimi için kişisel verilerimin işlenmesini kabul ediyorum.</label><button type="submit">Bültene katıl</button><small data-form-message aria-live="polite">İstediğiniz zaman abonelikten ayrılabilirsiniz.</small></form></section>`;
    default: return '';
  }
}

function normalizeHomeLayout(layout) {
  const normalized = structuredClone(layout);
  const homeAds = [
    { id: 'home-ad-top-bik', title: 'BİK reklam alanı', placement: 'home-leaderboard', order: 5, zone: 'full' }
  ];
  for (const fallback of homeAds) {
    const existing = normalized.modules.find((module) => module.type === 'adSlot' && module.placement === fallback.placement);
    if (existing) {
      existing.enabled = true;
      existing.zone = fallback.zone;
    } else {
      normalized.modules.push({ ...fallback, type: 'adSlot', enabled: true, limit: 0 });
    }
  }
  // Modules that form one editorial stack should not be forced into the narrow sidebar.
  for (const module of normalized.modules || []) {
    if (['liveStream', 'popular', 'videoPrograms'].includes(module.type)) module.zone = 'main';
  }
  return normalized;
}

// Gerçek veriyle çizilen basınsoft tarzı ana sayfa blokları (routes/home-modules.js).
const homeModuleTypes = new Set(['categoryBlocks', 'latestFeed', 'columnists', 'poll', 'photoGallery', 'videoGallery', 'movies', 'horoscope']);

function renderHome(template, articles, popular, layout, ads = {}, playbackUrl = '', extra = {}) {
  layout = normalizeHomeLayout(layout);
  const enabled = [...layout.modules].filter((module) => module.enabled).sort((left, right) => left.order - right.order);
  const hasSide = enabled.some((module) => {
    if (module.type === 'adSlot') return module.placement !== 'home-leaderboard';
    const zone = module.zone || ({ breaking: 'full', hero: 'full', briefing: 'full', latest: 'main', categoryFeed: 'main', videoPrograms: 'main', liveStream: 'side', popular: 'side', newsletter: 'full' }[module.type] || 'full');
    return zone === 'side';
  });
  const modules = enabled.map((module) => {
    const zone = module.type === 'adSlot' ? (module.placement === 'home-leaderboard' ? 'full' : 'side') : (module.zone || ({ breaking: 'full', hero: 'full', briefing: 'full', latest: 'main', categoryFeed: 'main', videoPrograms: 'main', liveStream: 'side', popular: 'side', newsletter: 'full' }[module.type] || 'full'));
    return `<div class="home-module home-${zone}">${renderHomeModule(module, { articles, popular, ads, playbackUrl, extra })}</div>`;
  }).join('');
  const main = `<main id="top" class="shell home-builder bs-home${hasSide ? '' : ' home-builder-no-side'}">${modules}</main>`;
  // Şablondaki <main id="top"> sınıfı değişse de eşleşsin (eski regex yalnız class="shell" kabul ediyordu).
  let html = template.replace(/<main id="top"[^>]*>[\s\S]*?<\/main>/, main);
  if (html === template) throw new Error('Ana sayfa şablonunda <main id="top"> bulunamadı.');
  html = html.replace(/<!-- public-header:start -->[\s\S]*?<!-- public-header:end -->/, `${renderPublicHeader('/')}`);
  const identity = siteIdentityCache.value;
  html = html.replace(/<footer id="footer">[\s\S]*?<\/footer>/, (footer) => footer
    .replace('assets/art-world-logo.png', identity.logoUrl || '/assets/art-world-logo.png')
    .replace("Antalya'dan haber, televizyon ve yerel yayın.", escapeHtml(identity.slogan || "Antalya'dan haber, televizyon ve yerel yayın."))
    .replace('Art World TV. Tüm hakları saklıdır.', `${escapeHtml(identity.publisher || profile.publisher)}. Tüm hakları saklıdır.`)
    .replace('Antalya · Türkiye</span>', `${escapeHtml(identity.address || profile.address)}</span>`)
    .replace('<div class="footer-column"><b>KURUMSAL</b>', `${publicModules.footerLinksHtml()}<div class="footer-column"><b>KURUMSAL</b>`));
  html = html.replace('</head>', `</head>`);
  return html;
}

function renderArchivePagination(page, totalPages) {
  if (totalPages <= 1) return '';
  const windowSize = 5;
  const start = Math.max(1, Math.min(page - 2, totalPages - windowSize + 1));
  const end = Math.min(totalPages, start + windowSize - 1);
  const previous = page > 1
    ? `<a class="pagination-step" href="/haberler?page=${page - 1}" rel="prev" aria-label="Önceki sayfa">‹ Önceki</a>`
    : '<span class="pagination-step pagination-disabled" aria-disabled="true">‹ Önceki</span>';
  const next = page < totalPages
    ? `<a class="pagination-step" href="/haberler?page=${page + 1}" rel="next" aria-label="Sonraki sayfa">Sonraki ›</a>`
    : '<span class="pagination-step pagination-disabled" aria-disabled="true">Sonraki ›</span>';
  const numbers = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    .map((number) => number === page
      ? `<span class="pagination-number pagination-current" aria-current="page" aria-label="Sayfa ${number}">${number}</span>`
      : `<a class="pagination-number" href="/haberler?page=${number}" aria-label="Sayfa ${number}">${number}</a>`)
    .join('');
  return `<nav class="archive-pagination" aria-label="Haber arşivi sayfaları">${previous}<div class="pagination-numbers">${numbers}</div>${next}</nav>`;
}

function istanbulDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${part.year}-${part.month}-${part.day}`;
}

function publicationArchiveTemplate(date, articles, ads, totals, today) {
  const news = articles.length ? articles.map((article) => {
    const image = article.cover_storage_key ? `<img src="/media/${escapeHtml(article.cover_storage_key)}" alt="${escapeHtml(article.cover_alt_text || article.headline)}" loading="lazy">` : '';
    const title = article.is_current ? `<a href="${articleHref(article)}">${escapeHtml(article.headline)}</a>` : escapeHtml(article.headline);
    return `<article class="archive-news-record">${image}<div><span class="section-kicker">${escapeHtml(article.category_name || 'HABER')} · ${escapeHtml(formatDate(article.published_at, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }))}</span><h2>${title}</h2>${article.standfirst ? `<p>${escapeHtml(article.standfirst)}</p>` : ''}<small>${escapeHtml(article.author_name || 'Art World TV')}${article.is_current ? ' · Yayında' : ' · Tarihsel yayın kaydı'}</small></div></article>`;
  }).join('') : '<p class="archive-empty">Bu tarihte yayımlanmış haber kaydı bulunamadı.</p>';
  const adRecords = ads.length ? ads.map((ad) => {
    const creative = ad.storage_key
      ? `<a class="archive-ad-creative" href="${escapeHtml(ad.target_url)}" target="_blank" rel="sponsored noopener noreferrer"><img src="/media/${escapeHtml(ad.storage_key)}" alt="${escapeHtml(ad.creative_headline)}" loading="lazy"><strong>${escapeHtml(ad.creative_headline)}</strong></a>`
      : '<div class="archive-ad-missing">Bu tarih için reklam dosyası arşivlenmemiş.</div>';
    const code = ad.regulatory_reference ? `<span>İlan/yayın kodu: ${escapeHtml(ad.regulatory_reference)}</span>` : '';
    const recordNote = ad.verified_archive ? 'Günlük yayın kaydı' : 'Eski teslimat kaydı · kreatif eşleşmesi yaklaşık';
    return `<article class="archive-ad-record">${creative}<div class="archive-ad-meta"><strong>${escapeHtml(ad.placement_name)}</strong><span>${escapeHtml(ad.placement_format)}</span>${code}<span>${Number(ad.impressions).toLocaleString('tr-TR')} gösterim · ${Number(ad.clicks).toLocaleString('tr-TR')} tıklama</span><small>${recordNote} · ${escapeHtml(formatDate(ad.first_seen_at, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }))}–${escapeHtml(formatDate(ad.last_seen_at, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }))}</small></div></article>`;
  }).join('') : '<p class="archive-empty">Bu tarihte kaydedilmiş reklam gösterimi bulunamadı.</p>';
  return replacePublicHeader(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071827"><meta name="description" content="Art World TV haber ve reklam yayın arşivi"><link rel="canonical" href="${escapeHtml(`${siteUrl}/arsiv`)}"><title>Yayın Arşivi · ${escapeHtml(date)} | Art World TV</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corporate.css"></head><body><header class="masthead shell"><a class="brand" href="/" aria-label="Art World TV ana sayfa"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="Art World TV"></a></header>${corporateNavigation()}<main class="shell publication-archive"><nav class="breadcrumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a><span>›</span><span>Yayın Arşivi</span></nav><span class="section-kicker">GEÇMİŞ YAYINLAR</span><h1>Yayın Arşivi</h1><p class="archive-intro">Seçilen tarihte yayımlanmış haberleri ve sitede gösterimi kaydedilen reklamları inceleyin.</p><form class="publication-archive-filter" method="get" action="/arsiv"><label for="archive-date">Yayın tarihi</label><input id="archive-date" type="date" name="tarih" value="${escapeHtml(date)}" max="${escapeHtml(today)}" required><button class="primary-action" type="submit">Tarihi göster</button></form><div class="archive-summary"><span><strong>${totals.articles.toLocaleString('tr-TR')}</strong> haber</span><span><strong>${totals.ads.toLocaleString('tr-TR')}</strong> reklam kaydı</span><span><strong>${totals.impressions.toLocaleString('tr-TR')}</strong> gösterim</span><span><strong>${totals.clicks.toLocaleString('tr-TR')}</strong> tıklama</span></div><section class="archive-section"><div class="archive-section-heading"><div><span class="section-kicker">${escapeHtml(date)}</span><h2>Haber kayıtları</h2></div><span>${articles.length} haber</span></div><div class="archive-news-list">${news}</div></section><section class="archive-section"><div class="archive-section-heading"><div><span class="section-kicker">REKLAM TESLİMATI</span><h2>Gösterilen reklamlar</h2></div><span>${ads.length} reklam alanı</span></div><div class="archive-ad-list">${adRecords}</div><p class="archive-disclosure">Gösterim arşivi, site reklamlarında ölçümlenen gösterim ve tıklama olaylarıyla gün gün oluşturulur. Geçmiş sistem kayıtlarında görsel bulunmuyorsa bu durum kartta belirtilir.</p></section></main>${corporateFooter()}<script src="/app.js"></script></body></html>`, '/arsiv');
}

function renderCategoryCards(articles) {
  return articles.length ? articles.map(renderNewsCard).join('') : '<p class="public-empty">Bu kategoride henüz yayımlanmış haber yok.</p>';
}

function renderStoryBody(body) {
  const blocks = Array.isArray(body) ? body : [{ type: 'paragraph', text: String(body || '') }];
  return blocks.map((block) => {
    const text = escapeHtml(block?.text || '').replace(/\r?\n/g, '<br>');
    if (!text) return '';
    if (block.type === 'heading') return `<h2>${text}</h2>`;
    if (block.type === 'quote') return `<blockquote>${text}</blockquote>`;
    return `<p>${text}</p>`;
  }).join('') || '<p>Bu haberin metni henüz eklenmemiş.</p>';
}

function renderStoryModule(module, context) {
  const { article, related, ad, popular } = context;
  const category = article.category_name || 'Haber';
  switch (module.type) {
    case 'breadcrumb': return `<nav class="breadcrumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a><span>›</span><a href="/kategori/${escapeHtml(article.category_slug || '')}">${escapeHtml(category)}</a></nav>`;
    case 'articleHeader': return `<header class="story-header"><a class="story-category" href="/kategori/${escapeHtml(article.category_slug || '')}">${escapeHtml(category)}</a><h1>${escapeHtml(article.headline)}</h1><p class="story-standfirst">${escapeHtml(article.standfirst || '')}</p><div class="story-meta"><span>${escapeHtml(article.author_name || 'Art World TV')}</span><time datetime="${escapeHtml(new Date(article.published_at).toISOString())}">${escapeHtml(formatDate(article.published_at))}</time></div></header>`;
    case 'cover': return article.cover_url ? `<figure class="story-cover"><img src="${escapeHtml(article.cover_url)}" alt="${escapeHtml(article.cover_alt_text || article.headline)}"><figcaption>${escapeHtml(article.cover_caption || '')}</figcaption></figure>` : '';
    case 'body': return `<div class="story-body">${renderStoryBody(article.body)}</div><p class="story-updated">${article.updated_at ? `Güncelleme: ${escapeHtml(formatDate(article.updated_at))}` : ''}</p>`;
    case 'adInline': return ad ? `<div class="story-ad-slot">${renderAdSlot(ad, module.title || 'Sponsorlu içerik', 'article-inline')}</div>` : '';
    case 'adSidebar': return context.sidebarAd ? `<div class="story-ad-slot story-side-ad">${renderAdSlot(context.sidebarAd, module.title || 'Reklam', 'article-sidebar')}</div>` : '';
    case 'share': return `<section class="story-share"><h2>${escapeHtml(module.title || 'Haberi paylaş')}</h2><button type="button" data-share data-share-url="${escapeHtml(`${siteUrl}${articleHref(article)}`)}">Bağlantıyı kopyala</button><a href="https://wa.me/?text=${encodeURIComponent(`${article.headline} ${siteUrl}${articleHref(article)}`)}" target="_blank" rel="noopener noreferrer">WhatsApp’ta paylaş</a></section>`;
    case 'related': return related.length ? `<section class="related-news"><h2>${escapeHtml(module.title || 'İlgili haberler')}</h2><div class="related-grid">${related.map((item) => `<article><span>${escapeHtml(item.category_name || 'Haber')}</span><h3><a href="${articleHref(item)}">${escapeHtml(item.headline)}</a></h3></article>`).join('')}</div></section>` : '';
    case 'popular': return `<section class="story-popular"><h2>${escapeHtml(module.title || 'Çok okunanlar')}</h2><ol>${popular.slice(0, module.limit || 4).map(renderPopular).join('')}</ol></section>`;
    case 'newsletter': return `<section class="newsletter story-newsletter"><div><span class="section-kicker">ART WORLD BÜLTEN</span><h2>${escapeHtml(module.title || 'Art World TV bülteni')}</h2><p>Haber seçkisini e-posta adresinize gönderelim.</p></div><form data-newsletter><label class="sr-only" for="story-newsletter-email">E-posta adresiniz</label><input id="story-newsletter-email" name="email" type="email" required placeholder="E-posta adresiniz"><label class="newsletter-consent"><input name="consent" type="checkbox" required> Bülten gönderimi için kişisel verilerimin işlenmesini kabul ediyorum.</label><button type="submit">Bültene katıl</button><small data-form-message aria-live="polite">İstediğiniz zaman abonelikten ayrılabilirsiniz.</small></form></section>`;
    default: return '';
  }
}

function storyTemplate(article, related, layout, ad, popular, sidebarAd = null) {
  const url = `${siteUrl}${articleHref(article)}`;
  const title = `${article.headline} | Art World TV`;
  const description = article.seo_description || article.standfirst || article.headline;
  const schema = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: article.headline,
    description, datePublished: new Date(article.published_at).toISOString(), dateModified: new Date(article.updated_at).toISOString(),
    author: { '@type': 'Person', name: article.author_name || 'Art World TV' },
    publisher: { '@type': 'Organization', name: 'Art World TV' }, mainEntityOfPage: url,
    ...(article.cover_url ? { image: [`${siteUrl}${article.cover_url}`] } : {})
  };
  const modules = [...layout.modules].filter((module) => module.enabled).sort((left, right) => left.order - right.order)
    .map((module) => `<div class="story-module">${renderStoryModule(module, { article, related, ad, popular, sidebarAd })}</div>`).join('');
  return replacePublicHeader(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071827"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(url)}"><link rel="alternate" type="application/rss+xml" title="Art World TV Haberleri" href="${escapeHtml(`${siteUrl}/rss.xml`)}"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corporate.css"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script></head>
<body>
<header class="masthead shell"><a class="brand" href="/" aria-label="Art World TV ana sayfa"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="Art World TV"></a><div class="masthead-tools"><a class="login-link" href="/yonetim">Yönetim</a></div></header>${corporateNavigation()}
<main class="shell story-page"><article class="story-article">${modules}</article></main>
${corporateFooter()}<div class="toast" role="status" aria-live="polite"></div><script src="/app.js"></script></body></html>`, article.category_slug ? `/kategori/${encodeURIComponent(article.category_slug)}` : '');
}

function listingTemplate({ title, description, canonical, content, afterContent = '', activePath = '' }) {
  return replacePublicHeader(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071827"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><link rel="alternate" type="application/rss+xml" title="Art World TV Haberleri" href="${escapeHtml(`${siteUrl}/rss.xml`)}"><title>${escapeHtml(title)} | Art World TV</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corporate.css"></head><body><header class="masthead shell"><a class="brand" href="/" aria-label="Art World TV ana sayfa"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="Art World TV"></a></header>${corporateNavigation()}<main class="shell listing-page"><nav class="breadcrumbs" aria-label="Sayfa yolu"><a href="/">Ana sayfa</a><span>›</span><span>${escapeHtml(title)}</span></nav><section><span class="section-kicker">ART WORLD TV</span><h1>${escapeHtml(title)}</h1><p class="listing-intro">${escapeHtml(description)}</p><div class="news-list listing-news">${content}</div>${afterContent}</section></main>${corporateFooter()}<script src="/app.js"></script></body></html>`, activePath);
}

// Tüm okur sayfalarına ortak eklemeler: tema renkleri, varsayılan koyu tema, modül stilleri ve form/anket script'i.
function decoratePublicHtml(html) {
  if (typeof html !== 'string' || !html.includes('</body>') || !html.includes('</head>')) return html;
  // BSX ana sayfası kendi stil/script setini taşır; eski tema katmanları ona eklenmez.
  if (html.includes('<body class="bsx">')) return html;
  const settings = settingsStore.getCachedSettings();
  const hex = /^#[0-9a-fA-F]{6}$/;
  const vars = [];
  if (hex.test(settings['theme.primary'] || '')) vars.push(`--blue:${settings['theme.primary']};--blue-deep:${settings['theme.primary']}`);
  if (hex.test(settings['theme.accent'] || '')) vars.push(`--red:${settings['theme.accent']}`);
  let out = html;
  if (!out.includes('/public-modules.css')) out = out.replace('</head>', '<link rel="stylesheet" href="/public-modules.css"></head>');
  // Basınsoft görünüm teması — en son yüklenir ki mevcut stilleri ezsin (sıra: core → shell → blocks).
  if (!out.includes('/bs-core.css')) out = out.replace('</head>', '<link rel="stylesheet" href="/bs-core.css"><link rel="stylesheet" href="/bs-shell.css"><link rel="stylesheet" href="/bs-blocks.css"></head>');
  if (vars.length) out = out.replace('</head>', `<style id="site-theme">:root{${vars.join(';')}}</style></head>`);
  if (settings['theme.defaultDark'] === 'on') out = out.replace('<body>', '<body class="dark">');
  if (!out.includes('/site-modules.js')) out = out.replace('</body>', '<script src="/site-modules.js" defer></script></body>');
  return out;
}

function sendHtml(res, status, html, frameOptions = 'DENY') {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': frameOptions, 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  res.end(decoratePublicHtml(html));
}

// Modül sayfaları (galeri, video, yazarlar, resmi ilanlar...) için ortak sayfa iskeleti. title/description düz metindir.
function renderShell({ title = '', description = '', path: pagePath = '/', bodyHtml = '' } = {}) {
  const canonical = `${siteUrl}${pagePath}`;
  return replacePublicHeader(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071827"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><title>${escapeHtml(title)} | ${escapeHtml(profile.brand)}</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corporate.css"><link rel="stylesheet" href="/public-modules.css"></head><body><header class="masthead shell"><a class="brand" href="/" aria-label="${escapeHtml(profile.brand)} ana sayfa"><img src="${escapeHtml(siteIdentityCache.value.logoUrl || '/assets/art-world-logo.png')}" alt="${escapeHtml(profile.brand)}"></a><div class="masthead-tools"><a class="login-link" href="/yonetim">Yönetim</a></div></header>${corporateNavigation()}<main class="shell corporate-page module-page">${bodyHtml}</main>${corporateFooter()}<div class="toast" role="status" aria-live="polite"></div><script src="/app.js"></script></body></html>`, pagePath);
}

const publicModuleHelpers = { renderShell, sendHtml, escapeHtml };

async function servePublicPage(req, res, pathname, url) {
  if (req.method !== 'GET') return false;
  await getSiteIdentity();
  await settingsStore.getSettings();
  await publicModules.refreshFooterCache();
  // Sayfa görüntülemesi (çerezsiz, anonim). Dosya uzantılı istekler ve yönetim sayfaları sayılmaz.
  if (!/\.[a-z0-9]+$/i.test(pathname) && !/^\/(yonetim|giris)(\/|$)/.test(pathname)) trackVisit(req, pathname);
  if (await publicModules.serve(req, res, pathname, url, publicModuleHelpers)) return true;
  if (pathname === '/bulten/ayril' || pathname === '/bulten/onayla') {
    const token = String(url.searchParams.get('token') || '');
    const confirm = pathname === '/bulten/onayla';
    const valid = /^[A-Za-z0-9_-]{40,60}$/.test(token);
    const message = valid ? (confirm ? 'Bülten aboneliğinizi doğrulamak için düğmeye basın.' : 'Bülten aboneliğinizi sonlandırmak için düğmeye basın.') : 'Abonelik bağlantısı geçersiz.';
    const form = valid ? `<form data-newsletter-action="${confirm ? 'confirm' : 'unsubscribe'}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">${confirm ? 'Aboneliği doğrula' : 'Abonelikten ayrıl'}</button><p data-form-message role="status"></p></form>` : '';
    sendHtml(res, 200, `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Bülten aboneliği · Art World TV</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corporate.css"></head><body>${renderPublicHeader('/')}<main class="shell corporate-page"><article><span class="section-kicker">ART WORLD TV · BÜLTEN</span><h1>Bülten tercihi</h1><p>${escapeHtml(message)}</p>${form}</article></main>${corporateFooter()}<script src="/app.js"></script></body></html>`);
    return true;
  }
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(`User-agent: *\nAllow: /\nDisallow: /yonetim\nDisallow: /api/\nSitemap: ${siteUrl}/sitemap.xml\n`);
    return true;
  }
  if (pathname === '/rss.xml' || pathname === '/feed.xml') {
    const { rows } = await pool.query(
      `SELECT slug, headline, standfirst, published_at, updated_at
         FROM articles WHERE status = 'published' AND published_at <= NOW()
        ORDER BY published_at DESC, id DESC LIMIT 50`
    );
    const items = rows.map((article) => `
      <item>
        <title>${escapeXml(article.headline)}</title>
        <link>${escapeXml(`${siteUrl}${articleHref(article)}`)}</link>
        <guid isPermaLink="true">${escapeXml(`${siteUrl}${articleHref(article)}`)}</guid>
        <description>${escapeXml(article.standfirst || article.headline)}</description>
        <pubDate>${new Date(article.published_at).toUTCString()}</pubDate>
      </item>`).join('');
    const buildDate = rows[0]?.updated_at || rows[0]?.published_at || new Date();
    return sendXml(res, 200, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Art World TV Haberleri</title><link>${escapeXml(siteUrl)}</link>
  <description>Art World TV’de yayımlanan son haberler</description><language>tr-TR</language>
  <lastBuildDate>${new Date(buildDate).toUTCString()}</lastBuildDate>
  <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escapeXml(`${siteUrl}/rss.xml`)}" rel="self" type="application/rss+xml"/>
  ${items}
</channel></rss>`, 'application/rss+xml; charset=utf-8');
  }
  if (pathname === '/sitemap.xml') {
        const [{ rows: articles }, { rows: categories }] = await Promise.all([
      pool.query(`SELECT slug, updated_at, published_at FROM articles
                   WHERE status = 'published' AND published_at <= NOW()
                   ORDER BY published_at DESC, id DESC`),
      pool.query(`SELECT c.slug, MAX(a.updated_at) AS updated_at
                    FROM categories c JOIN articles a ON a.primary_category_id = c.id
                   WHERE c.is_active = TRUE AND a.status = 'published' AND a.published_at <= NOW()
                   GROUP BY c.slug`)
    ]);
    const staticPages = ['/hakkimizda', '/kunye', '/iletisim', '/yayin-ilkeleri', '/reklam-ver', '/canli-yayin', '/haber-gonder', '/arsiv', '/servisler', '/icerik-bolumleri', '/gizlilik-politikasi', '/veri-politikasi', '/kullanim-sartlari', '/kullanici-sozlesmesi'];
    const urls = [
      `<url><loc>${escapeXml(siteUrl)}/</loc></url>`,
      `<url><loc>${escapeXml(siteUrl)}/haberler</loc></url>`,
      ...staticPages.map((pathname) => `<url><loc>${escapeXml(`${siteUrl}${pathname}`)}</loc></url>`),
      ...categories.map((category) => `<url><loc>${escapeXml(`${siteUrl}/kategori/${encodeURIComponent(category.slug)}`)}</loc>${category.updated_at ? `<lastmod>${new Date(category.updated_at).toISOString()}</lastmod>` : ''}</url>`),
      ...articles.map((article) => `<url><loc>${escapeXml(`${siteUrl}${articleHref(article)}`)}</loc><lastmod>${new Date(article.updated_at || article.published_at).toISOString()}</lastmod></url>`)
    ].join('\n  ');
    return sendXml(res, 200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`);
  }
  if (pathname === '/arsiv') {
    const today = istanbulDate();
    const date = String(url.searchParams.get('tarih') || today);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
      && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
      && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (!validDate || date > today) {
      sendHtml(res, 400, '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tarih geçersiz · Art World TV</title><main><h1>Arşiv tarihi geçersiz</h1><p>Bugün veya daha önceki geçerli bir tarihi seçin.</p><a href="/arsiv">Yayın arşivine dön</a></main></html>');
      return true;
    }
    const [articleResult, archivedAdsResult, legacyAdsResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.slug, a.status = 'published' AS is_current, a.published_at,
                COALESCE(next_version.snapshot->>'headline', a.headline) AS headline,
                COALESCE(next_version.snapshot->>'standfirst', a.standfirst) AS standfirst,
                u.display_name AS author_name, c.name AS category_name, m.storage_key AS cover_storage_key,
                m.alt_text AS cover_alt_text
           FROM articles a
           LEFT JOIN LATERAL (
             SELECT e.to_status FROM article_workflow_events e
              WHERE e.article_id = a.id
                AND e.created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
              ORDER BY e.created_at DESC, e.id DESC LIMIT 1
           ) historical_status ON TRUE
           LEFT JOIN LATERAL (
             SELECT r.snapshot FROM article_revisions r
              WHERE r.article_id = a.id
                AND r.created_at >= (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
              ORDER BY r.created_at, r.revision_number LIMIT 1
           ) next_version ON TRUE
           LEFT JOIN users u ON u.id = a.author_id
           LEFT JOIN categories c ON c.id = COALESCE((next_version.snapshot->>'primary_category_id')::bigint, a.primary_category_id)
           LEFT JOIN media_assets m ON m.id = COALESCE((next_version.snapshot->>'cover_media_id')::bigint, a.cover_media_id)
          WHERE a.published_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
            AND COALESCE(historical_status.to_status,
                CASE WHEN a.status = 'published' OR (a.status = 'archived' AND (a.archived_at IS NULL OR a.archived_at >= (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul'))) THEN 'published' ELSE a.status END) = 'published'
          ORDER BY a.published_at DESC, a.id DESC LIMIT 300`, [date]
      ),
      pool.query(
        `SELECT archive_date, campaign_id, placement_id, creative_id, regulatory_reference,
                campaign_name, advertiser_name, placement_key, placement_name, placement_format,
                creative_headline, target_url, storage_key, media_width, media_height,
                impressions, clicks, first_seen_at, last_seen_at, TRUE AS verified_archive
           FROM ad_delivery_daily_archive WHERE archive_date = $1::date
          ORDER BY first_seen_at, placement_name`, [date]
      ),
      pool.query(
        `WITH deliveries AS (
           SELECT campaign_id, placement_id,
                  COUNT(*) FILTER (WHERE event_type = 'impression')::int AS impressions,
                  COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
                  MIN(occurred_at) AS first_seen_at, MAX(occurred_at) AS last_seen_at
             FROM ad_delivery_events
            WHERE occurred_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Istanbul')
              AND occurred_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')
              AND creative_id IS NULL
            GROUP BY campaign_id, placement_id
         )
         SELECT $1::date AS archive_date, c.id AS campaign_id, p.id AS placement_id, cr.id AS creative_id,
                c.regulatory_reference, c.name AS campaign_name, adv.company_name AS advertiser_name,
                p.placement_key, p.display_name AS placement_name, p.format AS placement_format,
                COALESCE(cr.headline, '') AS creative_headline, COALESCE(cr.target_url, '') AS target_url,
                m.storage_key, m.width AS media_width, m.height AS media_height,
                d.impressions, d.clicks, d.first_seen_at, d.last_seen_at, FALSE AS verified_archive
           FROM deliveries d JOIN ad_campaigns c ON c.id = d.campaign_id
           JOIN advertisers adv ON adv.id = c.advertiser_id JOIN ad_placements p ON p.id = d.placement_id
           LEFT JOIN LATERAL (
             SELECT cr.id, cr.headline, cr.target_url, cr.media_id FROM ad_creatives cr
              WHERE cr.campaign_id = c.id AND cr.created_at <= d.last_seen_at
              ORDER BY cr.created_at DESC LIMIT 1
           ) cr ON TRUE
           LEFT JOIN media_assets m ON m.id = cr.media_id
          WHERE NOT EXISTS (SELECT 1 FROM ad_delivery_daily_archive ar WHERE ar.archive_date = $1::date AND ar.campaign_id = c.id AND ar.placement_id = p.id)
          ORDER BY d.first_seen_at, p.display_name`, [date]
      )
    ]);
    const ads = [...archivedAdsResult.rows, ...legacyAdsResult.rows];
    const totals = {
      articles: articleResult.rows.length,
      ads: ads.length,
      impressions: ads.reduce((sum, item) => sum + Number(item.impressions || 0), 0),
      clicks: ads.reduce((sum, item) => sum + Number(item.clicks || 0), 0)
    };
    sendHtml(res, 200, publicationArchiveTemplate(date, articleResult.rows, ads, totals, today));
    return true;
  }
  const corporatePage = renderCorporatePage(pathname);
  if (corporatePage) {
    sendHtml(res, 200, corporatePage);
    return true;
  }
  if (pathname === '/') {
    // Yeni basınsoft düzenli ana sayfa (BSX). Bir hata olursa aşağıdaki eski ana sayfaya düşülür.
    try {
      const homeData = await require('./home-data').load();
      const settings = await settingsStore.getSettings();
      const adHtml = renderAdSlot(await getActiveAd('home-leaderboard'), 'Markanız için güçlü bir yayın alanı', 'home-leaderboard');
      // "home-feature" alanı: yalnız aktif reklam varsa gösterilir (ikinci bir yer tutucu basılmaz).
      const featureAd = await getActiveAd('home-feature').catch(() => null);
      const featureAdHtml = featureAd ? renderAdSlot(featureAd, '', 'home-feature') : '';
      // Popup Reklam modülü açıksa ve "popup" alanında aktif bir reklam varsa (yer tutucu banner gösterilmez).
      let popupAdHtml = '';
      if (settings['module.popup'] === 'on') {
        const popupAd = await getActiveAd('popup').catch(() => null);
        if (popupAd) popupAdHtml = renderAdSlot(popupAd, '', 'popup');
      }
      sendHtml(res, 200, require('./home-page').render(homeData, { adHtml, featureAdHtml, popupAdHtml, settings }));
      return true;
    } catch (error) {
      console.error('Yeni ana sayfa çizilemedi, eski düzene düşülüyor:', error?.stack || error);
    }
    const template = await fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
    const articles = await selectArticles(30);
    const layout = siteStructure.defaults.home;
    const { rows: popular } = await pool.query(
      `SELECT a.slug, a.headline, a.views_count
         FROM articles a WHERE a.status = 'published' AND a.published_at <= NOW()
        ORDER BY a.views_count DESC, a.published_at DESC LIMIT 4`
    );
    const placementKeys = [...new Set(layout.modules.filter((module) => module.enabled && module.type === 'adSlot').map((module) => module.placement))];
    const ads = Object.fromEntries(await Promise.all(placementKeys.map(async (key) => [key, await getActiveAd(key)])));
    const playbackUrl = await getLivePlaybackUrl();
    let extra = {};
    try { extra = await homeModules.loadData(); }
    catch (error) { console.error('Ana sayfa modül verisi alınamadı:', error.message); }
    sendHtml(res, 200, renderHome(template, articles, popular, layout, ads, playbackUrl, extra));
    return true;
  }

  if (pathname === '/haberler') {
    const requestedPage = String(url.searchParams.get('page') || '1');
    const parsedPage = /^[1-9]\d*$/.test(requestedPage) ? Number(requestedPage) : 1;
    const page = Number.isSafeInteger(parsedPage) ? parsedPage : 1;
    const pageSize = 12;
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM articles
        WHERE status = 'published' AND published_at <= NOW()`
    );
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / pageSize);
    if (page > Math.max(totalPages, 1)) {
      sendHtml(res, 404, '<!doctype html><html lang="tr"><meta charset="utf-8"><title>Sayfa bulunamadı</title><h1>Arşiv sayfası bulunamadı</h1><a href="/haberler">Haber arşivine dön</a></html>');
      return true;
    }
    const { rows } = await pool.query(
      `SELECT a.slug, a.headline, a.standfirst, a.body, a.published_at, u.display_name AS author_name,
              c.name AS category_name, c.slug AS category_slug, m.storage_key AS cover_storage_key,
              m.alt_text AS cover_alt_text
         FROM articles a LEFT JOIN users u ON u.id = a.author_id
         LEFT JOIN categories c ON c.id = a.primary_category_id
         LEFT JOIN media_assets m ON m.id = a.cover_media_id
        WHERE a.status = 'published' AND a.published_at <= NOW()
        ORDER BY a.published_at DESC, a.id DESC LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize]
    );
    const content = rows.map((article) => renderNewsCard({
      ...article,
      cover_url: article.cover_storage_key ? `/media/${article.cover_storage_key}` : '',
      read_minutes: 1
    })).join('') || '<p class="public-empty">Henüz yayımlanmış haber bulunmuyor.</p>';
    const pageTitle = page > 1 ? `Haber Arşivi · Sayfa ${page}` : 'Haber Arşivi';
    sendHtml(res, 200, listingTemplate({
      title: pageTitle,
      description: 'Art World TV’de yayımlanan tüm haberleri tarihe göre inceleyin.',
      canonical: page > 1 ? `${siteUrl}/haberler?page=${page}` : `${siteUrl}/haberler`,
      content,
      afterContent: `<p class="archive-count">${total.toLocaleString('tr-TR')} haber · ${totalPages ? `${page} / ${totalPages}. sayfa` : 'Arşiv boş'}</p>${renderArchivePagination(page, totalPages)}`
    }));
    return true;
  }

  const articleMatch = pathname.match(/^\/haber\/([^/]+)$/);
  if (articleMatch) {
    let slug;
    try { slug = decodeURIComponent(articleMatch[1]); } catch { sendHtml(res, 404, '<!doctype html><html lang="tr"><meta charset="utf-8"><title>Haber bulunamadı</title><h1>Haber bulunamadı</h1><a href="/">Ana sayfa</a></html>'); return true; }
    const { rows } = await pool.query(
      `UPDATE articles SET views_count = views_count + 1
        WHERE slug = $1 AND status = 'published' AND published_at <= NOW()
        RETURNING id, slug, headline, standfirst, body, seo_description, published_at, updated_at, primary_category_id, author_id, cover_media_id`, [slug]
    );
    const article = rows[0];
    if (!article) { sendHtml(res, 404, '<!doctype html><html lang="tr"><meta charset="utf-8"><title>Haber bulunamadı</title><h1>Haber bulunamadı</h1><a href="/">Ana sayfa</a></html>'); return true; }
    const layout = siteStructure.defaults.article;
    const [{ rows: taxonomy }, { rows: related }, { rows: popular }] = await Promise.all([
      pool.query(`SELECT c.name AS category_name, c.slug AS category_slug, u.display_name AS author_name,
                         m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text, m.caption AS cover_caption
                    FROM articles a LEFT JOIN categories c ON c.id = a.primary_category_id LEFT JOIN users u ON u.id = a.author_id
                    LEFT JOIN media_assets m ON m.id = a.cover_media_id WHERE a.id = $1`, [article.id]),
      pool.query(`SELECT a.slug, a.headline, c.name AS category_name
                    FROM articles a LEFT JOIN categories c ON c.id = a.primary_category_id
                   WHERE a.status = 'published' AND a.primary_category_id = $1 AND a.id <> $2
                   ORDER BY a.published_at DESC LIMIT 3`, [article.primary_category_id, article.id]),
      pool.query(`SELECT slug, headline, views_count FROM articles WHERE status = 'published' AND published_at <= NOW() ORDER BY views_count DESC LIMIT 4`)
    ]);
    const ad = layout.modules.some((module) => module.enabled && module.type === 'adInline') ? await getActiveAd('article-inline') : null;
    const sidebarAd = layout.modules.some((module) => module.enabled && module.type === 'adSidebar') ? await getActiveAd('article-sidebar') : null;
    const cover = taxonomy[0];
    let storyHtml = storyTemplate({ ...article, ...cover, cover_url: cover.cover_storage_key ? `/media/${cover.cover_storage_key}` : '' }, related, layout, ad, popular, sidebarAd);
    try {
      const commentsHtml = await publicModules.renderComments(article.id);
      if (commentsHtml) storyHtml = storyHtml.replace('</article></main>', `</article>${commentsHtml}</main>`);
    } catch (error) { console.error('Yorum bölümü çizilemedi:', error.message); }
    sendHtml(res, 200, storyHtml);
    return true;
  }

  const categoryMatch = pathname.match(/^\/kategori\/([^/]+)$/);
  if (categoryMatch) {
    let slug;
    try { slug = decodeURIComponent(categoryMatch[1]); } catch { sendHtml(res, 404, '<!doctype html><html lang="tr"><meta charset="utf-8"><title>Kategori bulunamadı</title><h1>Kategori bulunamadı</h1><a href="/">Ana sayfa</a></html>'); return true; }
    const { rows: categories } = await pool.query('SELECT id, name, slug FROM categories WHERE slug = $1 AND is_active = TRUE', [slug]);
    const category = categories[0];
    if (!category) { sendHtml(res, 404, '<!doctype html><html lang="tr"><meta charset="utf-8"><title>Kategori bulunamadı</title><h1>Kategori bulunamadı</h1><a href="/">Ana sayfa</a></html>'); return true; }
    const { rows: articles } = await pool.query(
      `SELECT a.slug, a.headline, a.standfirst, a.body, a.published_at, u.display_name AS author_name,
              c.name AS category_name, c.slug AS category_slug, m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text
         FROM articles a LEFT JOIN users u ON u.id = a.author_id
         LEFT JOIN categories c ON c.id = a.primary_category_id
         LEFT JOIN media_assets m ON m.id = a.cover_media_id
        WHERE a.status = 'published' AND a.published_at <= NOW() AND (a.primary_category_id = $1 OR EXISTS (SELECT 1 FROM article_categories ac WHERE ac.article_id = a.id AND ac.category_id = $1))
        ORDER BY a.published_at DESC LIMIT 50`, [category.id]
    );
    const content = articles.map((article) => renderNewsCard({ ...article, cover_url: article.cover_storage_key ? `/media/${article.cover_storage_key}` : '', read_minutes: 1 })).join('') || '<p class="public-empty">Bu kategoride henüz yayımlanmış haber yok.</p>';
    const categoryAd = await getActiveAd('category-top');
    const categoryContent = categoryAd ? `${renderAdSlot(categoryAd, 'Sponsorlu içerik', 'category-top')}${content}` : content;
    sendHtml(res, 200, listingTemplate({ title: category.name, description: `${category.name} kategorisinden güncel haberler.`, canonical: `${siteUrl}/kategori/${encodeURIComponent(category.slug)}`, content: categoryContent, activePath: `/kategori/${encodeURIComponent(category.slug)}` }));
    return true;
  }

  if (pathname === '/arama') {
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    let content = '<p class="public-empty">Aramak için en az 2 karakter yazın.</p>';
    if (query.length >= 2) {
      const term = `%${query}%`;
      const { rows } = await pool.query(
        `SELECT a.slug, a.headline, a.standfirst, a.body, a.published_at, u.display_name AS author_name,
                c.name AS category_name, c.slug AS category_slug, m.storage_key AS cover_storage_key, m.alt_text AS cover_alt_text
           FROM articles a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN categories c ON c.id = a.primary_category_id
           LEFT JOIN media_assets m ON m.id = a.cover_media_id
          WHERE a.status = 'published' AND a.published_at <= NOW() AND (a.headline ILIKE $1 OR a.standfirst ILIKE $1)
          ORDER BY a.published_at DESC LIMIT 50`, [term]
      );
      content = rows.map((article) => renderNewsCard({ ...article, cover_url: article.cover_storage_key ? `/media/${article.cover_storage_key}` : '', read_minutes: 1 })).join('') || '<p class="public-empty">Bu aramayla eşleşen haber bulunamadı.</p>';
    }
    sendHtml(res, 200, listingTemplate({ title: query ? `“${query}” arama sonuçları` : 'Haber ara', description: 'Art World TV haber arama sonuçları.', canonical: `${siteUrl}/arama`, content }));
    return true;
  }
  return false;
}

module.exports = { servePublicPage };
