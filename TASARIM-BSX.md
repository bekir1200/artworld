# BSX — Ana sayfa yeniden kurulum şartnamesi (basınsoft birebir)

Referans: https://demo.basinsoft.net/ — 1280px genişlikte ölçüldü. Ana sayfa SIFIRDAN kurulur.
Kurallar:
- Tüm yeni sınıflar `bsx-` önekli. Ana sayfada YALNIZ bsx CSS dosyaları yüklenir (styles.css, home-basinsoft.css, bs-*.css, public-modules.css YÜKLENMEZ).
- Marka Art World TV (logo `/assets/art-world-logo.png`). Basınsoft logosu/adı/metni KULLANILMAZ.
- Harici kütüphane yok (Tailwind CDN de yok). Saf CSS + saf JS. Font: Google Fonts Poppins 400/500/600/700.
- Tüm dinamik metin HTML-escape edilir. URL'ler yalnız `http(s)://` veya tek `/` ile başlıyorsa kullanılır.
- Veri yoksa bölüm KENDİNİ GİZLER (boş string döner); sayfa asla kırık görünmez. Görsel yoksa `.bsx-noimg` gri kutu (#d1d5db zemin, ortada küçük resim ikonu svg).

## 1. Tasarım jetonları (`:root` — bsx-base.css'te tanımlı, herkes kullanır)
```
--bsx-bg:#ececec; --bsx-card:#fff; --bsx-ink:#000; --bsx-text:#111827; --bsx-muted:#6b7280;
--bsx-line:#e5e7eb; --bsx-line2:#d1d5db; --bsx-red:#e02424; --bsx-red2:#dc2626; --bsx-red-dark:#c81e1e;
--bsx-yellow:#fbbf24; --bsx-green:#046c4e; --bsx-up:#059669; --bsx-down:#e02424;
--bsx-navy:#1e293b; --bsx-navy-link:#94a3b8; --bsx-blue:#007aff;
--bsx-pink1:#e11d48; --bsx-pink2:#fb7185; /* foto galeri degrade */
--bsx-purple1:#5b21b6; --bsx-purple2:#7c3aed; /* video galeri degrade */
--bsx-orange:#ff8a4c; /* firma rehberi */
--bsx-w:1236px; --bsx-gap:16px; --bsx-font:'Poppins',sans-serif;
```
- Sayfa: `body{background:var(--bsx-bg);font-family:var(--bsx-font);color:var(--bsx-ink);margin:0}`
- Konteyner `.bsx-wrap{max-width:var(--bsx-w);margin:0 auto;padding:0 16px}`; bölümler arası dikey boşluk 16px (`.bsx-sec{margin:16px 0}`).

## 2. Ortak bileşenler (bsx-base.css — Ajan B yazar, herkes AYNEN kullanır)
- **Bölüm başlığı** `.bsx-title`: flex, align-center, gap 16px, yükseklik 28px, alt boşluk 16px.
  `<div class="bsx-title"><a class="bsx-title-label" href="…">KÖŞE YAZARLARI</a><span class="bsx-title-line"></span><a class="bsx-title-more" href="…">TÜMÜ</a></div>`
  label: 20px/700, kırmızı `--bsx-red`, BÜYÜK HARF, satır yüksekliği 28px. line: flex:1, height 2px, `--bsx-line2`. more: 16px/600 siyah (TÜMÜ).
  Varyant `.bsx-title--light` (renkli zemin üstünde): label ve more beyaz/`#cbd5e1`, line `rgba(255,255,255,.4)`.
- **Haber kartı** `.bsx-card` (dikey): beyaz, radius `0 0 6px 6px`, overflow hidden, gölge yok.
  `<a class="bsx-card" href="…"><div class="bsx-card-img"><img …><span class="bsx-badge">Gündem</span></div><div class="bsx-card-body"><h3 class="bsx-card-title">…</h3></div></a>`
  img: aspect-ratio 3/2 (297×198), object-fit cover, radius 0. body: padding 12px 8px, beyaz. title: 18px/600, lh 28px, renk siyah, 2 satır clamp (`-webkit-line-clamp:2`), hover kırmızı.
  Boyut varyantı `.bsx-card--sm` title 16px lh 24px.
- **Kategori rozeti** `.bsx-badge`: absolute top 6px left 6px, zemin `rgba(75,85,99,.85)`, beyaz, 11px/500, padding 2px 6px, radius 3px.
- **Görselsiz** `.bsx-noimg`: zemin #d1d5db, flex center, içinde gri svg resim ikonu.
- **Ok butonları** `.bsx-arrow` (carousel): 27×44, beyaz yarı saydam zemin, siyah ‹ › , dikey ortada, sol 0 / sağ 0.

## 3. Sayfa düzeni (yukarıdan aşağı, 1280px ölçüleri)
Her bölüm `<section class="bsx-sec bsx-XXX">` içinde, konteyner `.bsx-wrap`.

| # | Bölüm (renderer) | Düzen ve ölçüler |
|---|---|---|
| L1 | **Üst bar** `topbar` (Ajan B) | Tam genişlik zemin `#e5e7eb`, yükseklik 44px. Solda kurumsal linkler 14px siyah, aralarında 16px (Hakkımızda, Künye, İletişim, Çerez Politikası, Gizlilik Politikası). Sağda renkli kare sosyal ikonlar 24×24 radius 4px (fb #1877f2, x #000, ig #e1306c, yt #ff0000, li #0a66c2, tumblr #34526f, whatsapp #25d366, telegram #229ed9, pinterest #e60023), arası 4px; ikonlar içinde beyaz harf/svg. |
| L2 | **Header** `header` (Ajan B) | Beyaz, yükseklik 60px, `position:sticky;top:0;z-index:50`, alt ince gölge. İçerik `.bsx-wrap` flex: solda logo (yükseklik 36px), menü linkleri 18px/500 siyah, aralık 20px, hover kırmızı (Gündem, Politika→kategori adları verisinden ilk 8 + "Diğer ⌄" açılır menü), sağda SARI buton `Resmi İlanlar` (zemin `--bsx-yellow`, siyah 15px/600, padding 8px 16px, radius 6px) + arama ikonu + ay ikonu (koyu tema) + hamburger. ≤1024px menü gizlenir, hamburger açılır panel. |
| S1 | **Son dakika** `breaking` (Ajan C) | Yükseklik 44px, beyaz zemin, radius 4px. Solda kırmızı blok 232px (`--bsx-red`, radius 4px 0 0 4px): içinde beyaz 16px/700 "SON DAKİKA" + saat ikonu solda, sağda 2 küçük ok (‹ ›). Sağda kayan tek satır başlık 18px siyah, lh 44px, ellipsis. JS: 5 sn'de bir sonraki başlık (`data-bsx-ticker`). |
| S2 | **Manşet** `hero` (Ajan C) | Yükseklik 340px. Solda 40px genişlikte DİKEY numara rayı (beyaz zemin, 1..N, her biri 40×68, 16px/600 siyah; aktif olan kırmızı zemin beyaz yazı). Sağda slayt alanı: görsel solda %50 (604px, cover), üstünde sağdan sola kırmızı degrade panel `linear-gradient(to left,#dc2626 60%,rgba(220,38,38,0))` %65 genişlik, içinde sağa yaslı beyaz başlık 48px/700 lh 64px, 4 satır clamp, padding 24px. Numaraya hover/tık → o slayt. 6 sn otomatik geçiş (`data-bsx-slider`). |
| S3 | **Kart şeridi** `strip` (Ajan C) | Yatay carousel, 4 kart görünür (297px + 16 gap), toplam 10 kart, `.bsx-card` (görsel 297×198). Sol/sağ `.bsx-arrow`. Kaydırma CSS scroll-snap + JS ok ile (`data-bsx-carousel`). |
| S4 | **Video haber + Gündem** `featured` (Ajan C) | 12 kolon grid gap 16: SOL 8 kolon (819px): büyük slider 819×465 görsel; sağ üstte "Video Haber" etiketi (koyu lacivert zemin `#1e293b` beyaz 13px radius 4); altta siyah→şeffaf degrade, sarı (`--bsx-yellow`) 36px/700 başlık, 2 satır; altında 1..20 numaralı kare sayfa düğmeleri (her 39×40, kırmızı zemin beyaz yazı, aktif koyu lacivert), sol/sağ ok. SAĞ 4 kolon: `.bsx-title` "GÜNDEM" + 5 satır liste: her satır beyaz kutu 80px yükseklik, solda 144×80 görsel, sağda 16px/600 2 satır başlık. |
| S5 | **Piyasalar** `fx` (Ajan C) | 6 eşit hücre yatay (her ~206×73), beyaz zemin, hücre ayıraç 1px `#d1d5db`, padding 8px. Üstte ortada ad (14px/700: Altın, Dolar, Euro, BİST, Sterlin, Bitcoin), altta solda değer 14px, sağda değişim rozeti (yukarı yeşil `--bsx-up`, aşağı kırmızı, beyaz 12px, radius 3px, padding 2px 8px, metin `%0,22`). Veri null olan hücre "—". |
| S6 | **Köşe yazarları** `columnists` (Ajan C) | `.bsx-title` "KÖŞE YAZARLARI". Yatay carousel, 3 kart görünür (401×144), beyaz radius 8px padding 16px: solda yazar adı 20px/700 kırmızı? HAYIR → ad 18px/700 siyah, altında yazı başlığı 14px gri büyük harf 2 satır; sağda 96px yuvarlak fotoğraf, arkasında kırmızı yay (`border:4px solid --bsx-red`, border-left/bottom transparent, döndürülmüş). Foto yoksa baş harf daire. |
| S7 | **Haber ızgarası A** `gridA` (Ajan C) | 4 kolon × 2 satır `.bsx-card` (8 haber), gap 16. |
| S8 | **Namaz vakitleri** `prayer` (Ajan D) | 6 hücre grid gap 16, her 193×80 zemin `--bsx-green`, beyaz: solda cami ikonu (svg çizgi, beyaz, 64px), sağda saat 16px/600 ve vakit adı 14px/700 (İmsak, Güneş, Öğle, İkindi, Akşam, Yatsı). |
| S9 | **Izgara + Çok okunanlar** `gridB` (Ajan D) | 12 kolon: SOL 8 kolon: 2 büyük kart (401×268 görsel) + altında 3'lü küçük kartlar (toplam 8). SAĞ 4 kolon: `.bsx-title` "ÇOK OKUNANLAR" + 5–8 satır: beyaz kutu 80px, solda 144×80 görsel (sol-alt köşede küçük kategori rozeti), sağda 16px/600 2 satır başlık. |
| S10 | **Magazin** `magazin` (Ajan D) | `.bsx-title` "MAGAZİN". Grid 4 kolon: ilk kart 2 kolon×2 satır büyük (görsel 610×375, başlık 18/600 + altında 14px gri özet 4 satır), sağda 2×2 küçük kart. |
| S11 | **Vizyondaki filmler** `movies` (Ajan D) | `.bsx-title` "VİZYONDAKİ FİLMLER". Yatay carousel 6 görünür (193px): üstte gri tarih çipi (`#6b7280` zemin beyaz 11px radius 3 padding 2px 6px) görselin sol üstünde, görsel 193×108, altında beyaz kutu başlık 16px/600 ortalı 2 satır. Oklar. |
| S12 | **Foto galeri** `photos` (Ajan D) | Tam bölüm zemini degrade `linear-gradient(90deg,var(--bsx-pink1),var(--bsx-pink2))`, radius 0, padding 16px. `.bsx-title--light` "FOTO GALERİ". 3 kolon grid gap 16: sol kolon 2 kart üst üste (391×224), orta kolon 1 büyük (391×464), sağ kolon 2 kart. Kart: görsel cover, altta koyu şerit (`rgba(0,0,0,.55)`) içinde beyaz 13px/600 başlık. |
| S13 | **Spor** `sport` (Ajan D) | `.bsx-title` "SPOR". Grid 4 kolon: sol 2 kolonda 2×2 küçük kart, sağ 2 kolon×2 satır büyük kart (başlık + 14px gri özet). |
| S14 | **Video galeri** `videos` (Ajan D) | Zemin degrade `linear-gradient(90deg,var(--bsx-purple1),var(--bsx-purple2))`, padding 16px. `.bsx-title--light` "VİDEO GALERİ". Grid: sol 797×464 büyük video kapağı (altta degrade + beyaz 20px/700 başlık + ortada ▶ daire), sağ 391px: 5 satır liste, her 80px: solda 144×80 kapak (ortada küçük ▶), sağda beyaz 14px/600 başlık. Tık → video sayfası. |
| S15 | **Burçlar** `zodiac` (Ajan D) | `.bsx-title` "BURÇLAR". Beyaz şerit radius 8px padding 16px, 12 kolon grid gap 16: her hücre 86×96 pembe-kırmızı kare (`linear-gradient(135deg,#db2777,#e11d48)`, radius 8px), içinde beyaz sembol 36px ve ad 12px/600. |
| S16 | **Haber ızgarası C** `gridC` (Ajan D) | 3 kolon büyük kart (401×268) + altında 4'lü kartlar (toplam 10). |
| S17 | **Hava durumu** `weather` (Ajan D) | `.bsx-title` "ANTALYA HAVA DURUMU". 7 kolon grid gap 16, her 163×224 beyaz kutu ortalı: tarih 14px/600, gün adı 16px/700, hava ikonu (svg, 80px; güneş/bulut/yağmur/kar/sis koduna göre), durum 13px, min/max "9°C / 16°C" 13px. |
| S18 | **Numaralı liste** `top6` (Ajan D) | 3 kolon × 2 satır grid gap 16, beyaz kutu 117px yükseklik: solda dev numara (1..6) 64px/700 mavi `--bsx-blue`, sağda kategori 12px/700 mavi büyük harf + başlık 14px/600 3 satır. |
| S19 | **Saat akışı** `timeline` (Ajan D) | 2 kolon grid gap 8: her satır 48px beyaz, solda kırmızı rozet saat (`--bsx-red` beyaz 12px/700 padding 6px 8px radius 4), sağda 15px/500 başlık tek satır ellipsis. 8 satır. |
| L3 | **Footer** `footer` (Ajan B) | Zemin `--bsx-navy`, padding 40px 0. 4 kolon: KURUMSAL, SERVİSLER, BAĞLANTILAR (başlık beyaz 14px/700 büyük harf; linkler `--bsx-navy-link` 14px, arası 8px) ve sağ kolonda renkli sosyal ikonlar (üst bar ile aynı) + altında logo/slogan. Alt satır: üstte ince çizgi `rgba(255,255,255,.1)`, ortada `© {yıl} Art World TV. Tüm hakları saklıdır.` 13px `#94a3b8`. Sağ altta sabit kırmızı yuvarlak "yukarı" butonu 40px. |

Firma rehberi ve gazete manşetleri için veri kaynağı yok → yapılmaz.

## 4. Veri sözleşmesi — `routes/home-data.js` `load()` çıktısı (Ajan A üretir, C/D tüketir)
```
card = { title, href, image|null, category|null, categoryHref|null, time:'HH:MM', date:'YYYY-MM-DD', summary|null }
{
  site:      { brand:'Art World TV', logoUrl, slogan, social:[{key,href}] },
  nav:       [{label, href}],                // aktif kategoriler, sort_order
  breaking:  [{title, href}],                // en fazla 10
  hero:      [card x5],
  strip:     [card x10],
  featured:  [card x20], gundem:[card x5],
  fx:        [{code,name,value:number|null,changePct:number|null}] | null,   // ALTIN,USD,EUR,BIST,GBP,BTC (anahtarsız kaynaklarda olmayan → value null)
  columnists:[{name, title, href, avatar|null}],
  gridA:     [card x8],
  prayer:    { city, times:{imsak,gunes,ogle,ikindi,aksam,yatsi} } | null,
  gridB:     [card x8], mostRead:[card x8],
  magazin:   [card x5], sport:[card x5],
  movies:    [{title, date, image|null, href|null}],
  photos:    [{title, href, image|null, count}],
  videos:    [{title, href, image|null}],
  zodiac:    [{key, name, symbol, href}],
  gridC:     [card x10],
  weather:   { city, days:[{date,dayName,label,code,min,max}] } | null,   // 7 gün
  top6:      [card x6], timeline:[{time, title, href}],
  footer:    { columns:[{title, links:[{label, href}]}] }
}
```
Boş veri: dizi `[]`, nesne `null`. Renderer boşsa '' döner.

## 5. Renderer sözleşmesi
Her renderer saf fonksiyon: `(data) => htmlString`. Dosya başına:
```js
const { esc, url, card, title, noimg } = require('./bsx-kit');   // Ajan B yazar
module.exports = { breaking, hero, strip, featured, fx, columnists, gridA };   // Ajan C
module.exports = { prayer, gridB, magazin, movies, photos, sport, videos, zodiac, gridC, weather, top6, timeline }; // Ajan D
```
`routes/bsx-kit.js` (HAZIR — denetleyici yazdı, değiştirmeyin) şunları dışa aktarır — B, C ve D BUNLARI KULLANIR, kendi kopyasını yazmaz:
- `esc(str)` HTML escape · `url(str)` güvenli URL veya '' · `noimg()` gri ikon kutusu HTML'i
- `img(src, alt, cls)` → güvenli `<img loading="lazy">` ya da `noimg()`
- `card(c, {size:'md'|'sm', badge:true})` → yukarıdaki `.bsx-card` HTML'i
- `title(label, href, {light:false, more:'TÜMÜ'})` → `.bsx-title` HTML'i
- `section(cls, inner)` → `<section class="bsx-sec ${cls}"><div class="bsx-wrap">${inner}</div></section>` (inner boşsa '')

## 6. JS davranış sözleşmesi (`public/bsx.js` — Ajan B yazar; C/D yalnız işaretleri koyar)
- `[data-bsx-ticker]` içindeki `[data-bsx-tick]` öğeleri: biri görünür, 5 sn döner; `[data-bsx-prev]`/`[data-bsx-next]` butonları.
- `[data-bsx-slider]`: içindeki `[data-bsx-slide]` öğelerinden biri `.is-active`; `[data-bsx-goto="N"]` (0 tabanlı) tık/hover ile geçiş ve `.is-active` eşlenir; `data-bsx-auto="6000"` otomatik.
- `[data-bsx-carousel]`: içindeki `[data-bsx-track]` yatay scroll; `[data-bsx-prev]`/`[data-bsx-next]` bir kart genişliği kaydırır.
- `.bsx-totop`: tıkla en üste. Hamburger `[data-bsx-menu]` → `body.bsx-menu-open`. Arama ikonu `/arama`'ya gider.

## 7. Dosya sahipliği (çakışma yok)
- Ajan A: `routes/home-data.js`
- Ajan B: `routes/bsx-kit.js`, `routes/bsx-layout.js` (`head(title)`, `topbar(site)`, `header(site, nav)`, `footer(site, footerData)`, `scripts()`), `public/bsx-base.css`, `public/bsx.js`
- Ajan C: `routes/bsx-sections-1.js`, `public/bsx-sections-1.css`
- Ajan D: `routes/bsx-sections-2.js`, `public/bsx-sections-2.css`
- Denetleyici: `routes/home-page.js` (birleştirme) ve `routes/public-pages.js` bağlantısı.

## 8. Responsive
≤1100px: 12 kolonlu bölümler tek kolona iner (yan liste alta), 4'lü ızgaralar 3'e. ≤768px: ızgaralar 2 kolon, manşet: numara rayı gizli, görsel üstte panel altta (başlık 26px). ≤480px: kartlar 1 kolon, carousel'ler tek kart. Yatay sayfa kaydırması OLMAMALI.
