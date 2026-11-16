# Basınsoft görünümü — tasarım şartnamesi (birebir hedef)

Referans: https://demo.basinsoft.net/ (ölçülerek çıkarıldı). Amaç: Art World TV ön yüzünü ve admin panelini bu demonun GÖRÜNÜMÜNE birebir benzetmek. İçerik/marka Art World TV kalır (logo, isim), yalnız görsel tasarım kopyalanır. Veriler zaten bağlı; yalnız CSS/az miktarda markup.

## Tasarım jetonları (TAM değerler)
- **Font:** Poppins (Google Fonts, ağırlıklar 400/500/600/700). `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');` body'ye uygula.
- **Sayfa zemini:** `#ececec` (açık gri). Kartlar/bloklar beyaz `#ffffff`.
- **Metin:** ana `#1f2937`, soluk `#6b7280`, çizgi/kenar `#e5e7eb`.
- **Kırmızı vurgu:** `#e02424` (koyu: `#c81e1e`). Bölüm başlık etiketleri, SON DAKİKA, Resmi İlanlar butonu, aktif/hover.
- **Footer:** zemin `#1e293b` (koyu lacivert-gri), link `#94a3b8`, başlık beyaz.
- **Konteyner genişliği:** `max-width:1200px; margin-inline:auto; padding-inline:16px`.
- **Kart köşe yarıçapı:** 8px. **Gölge:** `0 1px 3px rgba(0,0,0,.12)`.
- Renkli bölüm degradeleri: Foto Galeri pembe→magenta `linear-gradient(135deg,#ec4899,#db2777)`; Video Galeri mor→çivit `linear-gradient(135deg,#7c3aed,#4f46e5)`; Burçlar pembe `linear-gradient(90deg,#db2777,#be185d)`; Firma Rehberi turuncu `#f97316`.

## Bölüm başlığı deseni (ÇOK ÖNEMLİ — her yerde böyle)
Kırmızı BÜYÜK HARF kalın etiket (20px/700, `#e02424`) + hemen sağında ince gri yatay çizgi (flex ile tüm genişliği doldurur) + en sağda küçük kırmızı "TÜMÜ" linki.
Art World TV'de bu `.section-heading > div > (.section-kicker + h2)` yapısında. Hedef: `.section-kicker`'ı kırmızı 20px/700 yap; yanına çizgi; `.text-link`'i sağa "TÜMÜ" gibi küçük kırmızı yap. (h2 başlığı gizlenebilir ya da küçük kalabilir; basınsoft'ta tek kırmızı etiket var.)

## Haber kartı deseni
Beyaz kart, radius 8px, hafif gölge. Üstte 16:9 görsel (radius üst köşeler). Görselin sol-üstünde koyu yarı saydam küçük kategori rozeti (ör. "GÜNDEM", beyaz metin, `rgba(0,0,0,.6)` zemin, küçük). Altında başlık (16px/600, koyu, hover kırmızı), ince saat/meta. Art World TV'de `.news-card > a.news-thumb(img + span.badge) + .news-copy(.meta, h3>a, p, .byline)`.

## Bölüm sırası (ana sayfa, basınsoft):
Üst bar (gri şerit, kurumsal linkler + sosyal) → beyaz sticky nav (logo solda, menü, sağda kırmızı "Resmi İlanlar") → SON DAKİKA şeridi → büyük manşet (kırmızı degrade kaplama, solda 1–6 numara rayı) → kategori blokları (2 kolon) → köşe yazarları (yuvarlak avatarlar kırmızı halka) → kategori ızgaraları → MAGAZIN (4'lü) → Vizyondaki Filmler (tarih çipleri + afiş) → Foto Galeri (pembe degrade) → SPOR → Video Galeri (mor degrade) → Burçlar (pembe şerit) → Hava Durumu → Çok okunanlar → Firma Rehberi (turuncu) → Footer (koyu lacivert, Kurumsal/Servisler/Bağlantılar kolonları + sosyal + uygulama rozetleri).

## Mevcut CSS hedefleri (Art World TV markup'ı — kaynaktan DOĞRULA)
- Header/nav: `.masthead.shell`, `.masthead-tools`, `.edition`, `.search-button`, `.login-link` (Yönetim linki → kırmızı buton yap), `.nav-wrap`, `nav.nav`, `nav.nav a`, `.nav-active`, `.mobile-menu`.
- SON DAKİKA: `.breaking`, `.breaking-label`, `.ticker-window`, `.ticker-track`, `.ticker-control`.
- Manşet: `.lead-grid`, `.lead-story`, `.lead-image`, `.lead-shade`, `.lead-content`, `.eyebrow`, `.lead-counter`, `.lead-side`, `.side-story`.
- Bölümler: `.section-heading`, `.section-heading.compact`, `.section-kicker`, `h2`, `.text-link`, `.filter-row .filter`.
- Haber listesi: `.news-section`, `.news-list`, `.news-card`, `.news-thumb`, `.news-copy`, `.meta`, `.byline`, `.avatar`, `.read-time`, `.load-more`.
- Yan: `.popular ol li`, `.rank`, `.live-card`, `.ad-slot`, `.newsletter`.
- Ana sayfa bs modülleri (`routes/home-modules.js` çıktısı): `.bs-home`, `.bs-block-grid`, `.bs-block`, `.bs-head`, `.bs-more`, `.bs-block-body`, `.bs-lead`, `.bs-list`, `.bs-columnists-row`, `.bs-avatar`, `.bs-card-grid`, `.bs-poster`, `.bs-play`, `.bs-zodiac-row`, `.bs-feed`, `.bs-poll`, `.bs-thumb-badge`.
- Footer (`public/index.html`): `#footer`, `.footer-main`, `.footer-brand`, `.socials`, `.footer-column`, `.footer-bottom`.
- Yerleşim: `main.home-builder.bs-home`, `.home-module`, `.home-full`, `.home-main`, `.home-side`, `.shell`.

## Kurallar
- Sadece YENİ CSS dosyaları yaz; `styles.css`/`home-basinsoft.css`/`corporate.css`/markup'a dokunma (denetleyici gerekirse markup'a dokunur). Yeni tema en son yüklendiği için override eder; gerektiğinde yeterince özgül seçici veya hedefli `!important` kullan.
- Responsive: ≤980px tablet, ≤640px mobil tek kolon. Yatay kaydırma olmamalı.
- Koyu tema (`body.dark`) ŞART DEĞİL; basınsoft tek tema (açık). `body.dark` kurallarını ezip açık temayı sabitleme; sadece açık temayı hedefle.
