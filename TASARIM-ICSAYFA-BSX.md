# İç sayfalar — BSX sözleşmesi (basınsoft yapısı)

Amaç: haber detayı, kategori, arama sayfaları ana sayfayla aynı üst bar, menü, altbilgi, renk ve font dilini kullansın. Eski tema katmanı (`bs-core/bs-shell/bs-blocks`) bu sayfalarda kullanılmaz. Koyu mod (`body.bsx-dark`) tüm yeni sınıfları kapsar.

## 1. Ortak kabuk
- Her sayfa `routes/bsx-layout.js` fonksiyonlarını kullanır: `head(title, description)`, `topbar(site)`, `header(site, nav)`, `footer(site, footer)`, `scripts()`.
- `head()` `</head>` öncesine şu iki satırı eklemek zorundadır (sırayla): `<link rel="stylesheet" href="/bsx-inner.css"><link rel="stylesheet" href="/public-modules.css">`.
- Gövde: `<body class="bsx">` (bu değer `decoratePublicHtml` tarafından eski temanın eklenmesini engeller).
- Sayfa yapısı: `head` → `<div id="top"></div>` → `topbar` → `header` → `<main class="bsx-main">…</main>` → `footer` → `scripts()`.
- Tüm metin `esc()` ile kaçışlanır; `url()` ile bağlantılar süzülür (`routes/bsx-kit.js`).

## 2. Ortak sınıf adları (CSS ve HTML bu listeye göre yazılır)
Kapsayıcılar
- `.bsx-inner` — sayfa kapsayıcısı (genişlik: `--bsx-w`, yatay boşluk 16px)
- `.bsx-inner-grid` — iki kolonlu ızgara: ana sütun + kenar çubuğu (masaüstü ~ 1fr + 360px, aralık 24px; mobilde tek kolon, kenar çubuğu içeriğin altında)

Breadcrumb
- `.bsx-crumbs` (nav, aria-label="Sayfa yolu"), `.bsx-crumbs a`, `.bsx-crumbs .sep`

Haber detayı
- `.bsx-article` (article), `.bsx-article-cat` (kategori etiketi, kırmızı büyük harf), `.bsx-article-title` (h1, 36–40px, kalın), `.bsx-article-summary` (standfirst, 18px, gri)
- `.bsx-article-meta` (yazar, tarih, güncelleme, görüntülenme — satır içi, ayırıcılı)
- `.bsx-article-cover` (figure), `.bsx-article-cover img`, `.bsx-article-cover figcaption`
- `.bsx-article-body` (metin: 17px, satır 1.75, paragraflar arası 1em)
- `.bsx-share` (paylaşım bağlantıları satırı)
- `.bsx-related` (İLGİLİ HABERLER liste), `.bsx-comments` (yorum bölümü kapsayıcısı; içerik `public-modules` HTML'i)

Kategori / arama / listeleme
- `.bsx-page-title` (h1, kırmızı nokta ile başlayan kategori adı), `.bsx-page-desc` (açıklama, gri)
- `.bsx-list` (kart listesi, dikey), `.bsx-list-item` (yatay kart: küçük görsel solda, başlık ve özet sağda)
- `.bsx-list-item-img`, `.bsx-list-item-title`, `.bsx-list-item-meta`
- `.bsx-empty` (boş durum mesajı)

Kenar çubuğu
- `.bsx-side-box` (kutu, beyaz arka plan, üst kırmızı çizgi), `.bsx-side-title` (kırmızı büyük harf başlık), `.bsx-side-list`, `.bsx-side-item` (numara + başlık)

Arama
- `.bsx-search-form` (input + "Ara" düğmesi), `.bsx-search-input`, `.bsx-search-btn`

## 3. Veri sözleşmesi (routes/bsx-inner.js dışa aktarır)
Tüm fonksiyonlar saf HTML döndürür; veritabanına dokunmaz. Girdiler ana sayfa verisinden ayrı tutulur.

`shell` = `{ site, nav, footer }` (`home-data.load()` içinden alınır)

- `renderArticlePage({ shell, article, related, popular, ad, commentsHtml, popupHtml })`
  - `article`: `{ slug, headline, standfirst, body, published_at, updated_at, author_name, category_name, category_slug, cover_url, cover_alt_text, cover_caption, views_count }`
  - `related`: `[{ slug, headline, category_name }]`, `popular`: `[{ slug, headline, views_count }]`
  - `ad`: reklam HTML'i (boş olabilir), `commentsHtml`: yorum HTML'i (boş olabilir)
  - Gövde metni: mevcut `renderStoryBody(body)` (routes/public-pages.js ~satır 467) ile aynı biçimde paragraflara ayrılır ve kaçışlanır.
  - Tarih biçimi: `dd Ay yyyy, HH:mm` (Türkçe ay adları), saat Europe/Istanbul.
  - Kenar çubuğu: "ÇOK OKUNANLAR" (popular) ve "İLGİLİ HABERLER" (related) kutuları.
  - Başlık `<title>`: `${headline} | Art World TV` (head() parametresi).
- `renderCategoryPage({ shell, category, articles, ad, popup })`
  - `category`: `{ name, slug }`, `articles`: `[{ slug, headline, standfirst, published_at, author_name, category_name, cover_url, cover_alt_text }]`
  - İlk 1 haber büyük kart, sonraki 2 haber orta kart (ızgara), kalanlar `.bsx-list` içinde yatay kart.
  - Kenar çubuğu: "ÇOK OKUNANLAR" yok (veri yok); onun yerine "KATEGORİLER" (shell.nav'dan) kutusu.
- `renderSearchPage({ shell, query, articles })`
  - Arama formu üstte; `query` boşsa "Aramak için en az 2 karakter yazın." mesajı; sonuç yoksa `.bsx-empty`.

Ortak kart HTML'i için `card()` ve `title()` (bsx-kit) kullanılabilir; yeni sınıflar yukarıdaki listeye sadık kalır.

## 4. Renk ve tipografi
- Font: `var(--bsx-font)` (Poppins). Renkler: `--bsx-red`, `--bsx-ink`, `--bsx-text`, `--bsx-muted`, `--bsx-line`, `--bsx-card`, `--bsx-bg`.
- Başlık kırmızısı yalnızca kategori etiketinde ve kenar başlıklarında.

## 5. Koyu mod
- `body.bsx-dark` altında her yeni sınıf için karşılık gelen kural zorunludur: arka plan `#111827`, kart `#1f2937`, metin `#f3f4f6`, ikincil metin `#9ca3af`, çizgi `#374151`.

## 6. Mobil
- 768px altında: `.bsx-inner-grid` tek kolon; başlık 26px; yatay kart görseli 96px.
- 16px yan boşluk; yatay kaydırma yok.
