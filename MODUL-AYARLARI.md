# Modül Ayarları — ortak sözleşme (basınsoft yapısı)

Tüm değerler `site_settings` tablosunda (setting_key, setting_value) metin olarak saklanır; `routes/settings-store.js` `getSettings()` hepsini varsayılanlarla birleştirip döner.

## 1. Ayar anahtarları (ADLARI DEĞİŞTİRMEYİN)

### Aktif/Pasif modüller — değer `'on'` | `'off'`
| Anahtar | Kart adı (basınsoft) | Varsayılan | Etkisi |
|---|---|---|---|
| `module.breaking` | Son Dakika | on | ana sayfa son dakika şeridi |
| `module.strip` | Yatay Manşet | on | manşet altındaki kart şeridi |
| `module.featured` | Spot | on | video haber + gündem bloğu |
| `module.fx` | Döviz Kurları | on | piyasalar şeridi |
| `module.columnists` | Yazarlar | on | köşe yazarları bölümü |
| `module.photos` | Foto Galeri | on | foto galeri bölümü |
| `module.videos` | Video Galeri | on | video galeri bölümü |
| `module.announcements` | Resmi İlanlar | on | header'daki sarı "Resmi İlanlar" butonu ve `/resmi-ilanlar` sayfası |
| `module.weather` | Hava Durumu | on | hava durumu bölümü |
| `module.prayer` | Namaz Vakitleri | on | namaz vakitleri bölümü |
| `module.horoscope` | Burç Yorumları | on | burçlar bölümü + `/burclar` (MEVCUT anahtar) |
| `module.local` | Yerel Haberler | on | "<ŞEHİR> HABERLERİ" bölümü (Modül Şehir'e göre) |
| `module.movies` | Vizyondaki Filmler | on | filmler bölümü (MEVCUT) |
| `module.comments` | Yorumlar | on | okur yorumları (MEVCUT) |
| `module.popup` | Popup Reklam | off | ana sayfada popup reklam |
| `module.polls` | Anketler (bizde ek) | on | MEVCUT |
| `module.visitorPosts` | Ziyaretçi Haberleri (bizde ek) | on | MEVCUT |

### Veri kaynağı bekleyen modüller — değer her zaman `'off'` (UI'da devre dışı, "API bağlanınca çalışır")
`module.pharmacy` (Nöbetçi Eczaneler), `module.papers` (Gazete Manşetleri), `module.standings` (Puan Durumu), `module.onlinePaper` (Online Gazete), `module.lottery` (Şans Oyunları), `module.directory` (Firma Rehberi), `module.traffic` (Trafik Durumu).

### Seçimli ayarlar
| Anahtar | Kart adı | Değer | Varsayılan |
|---|---|---|---|
| `blog.1` | 1. Blog | kategori slug'ı | `kultur-sanat` |
| `blog.2` | 2. Blog | kategori slug'ı | `spor` |
| `numbered.category` | Numaralı Haberler | kategori slug'ı ya da `''` (tüm haberler) | `''` |
| `tabs.categories` | Tab Menü | virgülle ayrılmış slug listesi (en fazla 8) ya da `''` (otomatik) | `''` |
| `module.city` | Modül Şehir | 81 ilden biri (Türkçe ad, ör. `Antalya`) | `Antalya` |
| `league.default` | Default Lig | `super-lig` \| `tff-1` \| `tff-2` \| `tff-3` | `super-lig` |
| `popup.hours` | Popup Reklam Süresi | tam sayı saat, 1–720 | `24` |

81 il listesi `routes/settings-store.js` içinde `CITIES` olarak dışa aktarılır (plaka sırasıyla); herkes bunu kullanır.

## 2. Ana sayfa veri alanları (`routes/home-data.js` `load()` — EK alanlar)
- `magazinTitle: { label, href }` — `blog.1` kategorisinin adı (BÜYÜK HARF değil, ham ad) ve `/kategori/<slug>`; `magazin` öğeleri bu kategoriden.
- `sportTitle: { label, href }` — `blog.2` için aynısı; `sport` öğeleri bu kategoriden.
- `top6` — `numbered.category` doluysa o kategoriden, boşsa genel.
- `tabs` — `tabs.categories` doluysa o sırayla o kategoriler, boşsa mevcut otomatik seçim.
- `local: { title: '<ŞEHİR> HABERLERİ', href: '/kategori/<slug>', items: [card x8] } | null` — `module.city` adının slug'ı (Türkçe sadeleştirilmiş, ör. `antalya`) ile eşleşen aktif kategori varsa; yoksa `null`.
- `weather.city` ve `prayer.city` = `module.city`.
- `site.showAnnouncements: boolean` — `module.announcements === 'on'`.
- `popupHours: number` — `popup.hours`.

## 3. Bölüm açma/kapama (denetleyici `routes/home-page.js`'te uygular)
breaking→`module.breaking`, strip→`module.strip`, featured→`module.featured`, fx→`module.fx`, columnists→`module.columnists`, local→`module.local`, prayer→`module.prayer`, movies→`module.movies`, photos→`module.photos`, videos→`module.videos`, zodiac→`module.horoscope`, weather→`module.weather`. Manşet, ızgaralar, 1. ve 2. blog, sekmeli blok, numaralı haberler ve saat akışı her zaman açık.
