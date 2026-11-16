# Art World TV — Admin Panel Eksik Analizi ve Yönetim Hiyerarşisi

Referans: `https://demo.basinsoft.net/admin` · Hedef: Art World TV `/yonetim`
Tarih: 16 Kasım 2026

## 1. Basınsoft admin yönetim hiyerarşisi (tam ağaç)

| # | Ana bölüm | Alt menüler | Rota |
|---|-----------|-------------|------|
| 1 | **Kontrol Paneli** | — | `/admin` |
| 2 | **Ayarlar** | Genel Ayarlar · Hakkımızda · Modül Ayarları · API Ayarları · Tema Ayarları · Cron Ayarları | `/admin/settings/*` |
| 3 | **Kullanıcılar** | Yetkiler · Yetki Ekle · Kullanıcı Listesi · Kullanıcı Ekle | `/admin/users/*` |
| 4 | **Sayfalar** | Sayfa Listesi · Sayfa Ekle | `/admin/pages/*` |
| 5 | **Haberler** | Kategoriler · Kategori Ekle · İleri Tarihli Haberler · Haberler · Haber Ekle | `/admin/posts/*` |
| 6 | **Makaleler** | Makale Listesi · İleri Tarihli Makaleler · Makale Ekle | `/admin/articles/*` |
| 7 | **Galeriler** | Galeri Kategorileri · Kategori Ekle · Galeri Listesi · İleri Tarihli · Galeri Ekle | `/admin/galleries/*` |
| 8 | **Videolar** | Video Kategorileri · Kategori Ekle · Video Listesi · İleri Tarihli · Video Ekle | `/admin/videos/*` |
| 9 | **Yorumlar** | Yorum Listesi (moderasyon) | `/admin/comments` |
| 10 | **İletişim** | Mesajlar | `/admin/contacts` |
| 11 | **Reklamlar** | Reklam Alanları · Reklam Ekle | `/admin/adverts/*` |
| 12 | **Footer Linkleri** | Link Kategorileri · Kategori Ekle · Link Ekle | `/admin/links/*` |
| 13 | **İçerik Botları** | Ajans Bot Ayarları + Anka, DHA, Hibya, IGF, İHA, İlke ajansları | `/admin/bots/*` |
| 14 | **Anketler** | Anket Listesi · Anket Ekle | `/admin/polls/*` |
| 15 | **Ziyaretçi Haberleri** | Okurdan gelen haber başvuruları | `/admin/visitor_posts` |
| 16 | **Kullanıcı Logları** | İşlem/giriş geçmişi | `/admin/logs` |

Ek öğeler: Resmi İlanlar (`/admin/announcements`), Changelog, Cache Temizle, üst barda bildirim (iletişim/yorum), Rapor Al, karanlık mod, hızlı ekleme (FAB) butonları.

## 2. Art World TV panelinde MEVCUT olanlar

Şu anki `/yonetim` sekmeli tek sayfa yapısı:
- Genel Bakış (dashboard — basınsoft tarzı widget'lar eklendi) ✅
- Haber Yönetimi (posts/articles CRUD, taslak→yayın akışı) ✅
- Reklam Yönetimi (kampanya, kreatif, reklam alanları/placements, rapor) ✅ ≈ Reklamlar
- Okur CRM (bülten, geri bildirim, reklam talebi) ✅ ≈ İletişim + fazlası
- Kullanıcılar ve roller ✅ ≈ Kullanıcılar/Yetkiler
- Site kimliği ✅ ≈ Ayarlar/Genel
- API ve entegrasyonlar ✅ ≈ Ayarlar/API
- İşlem geçmişi ✅ ≈ Kullanıcı Logları
- Sayfa tasarımı (görsel tuval) — basınsoft'ta yok, bizde ekstra

## 3. EKSİK modüller (basınsoft'ta var, bizde yok)

| Modül | Açıklama | Backend ihtiyacı | Öncelik |
|-------|----------|------------------|---------|
| **Makaleler** | Köşe yazısı/makale CMS'i (haberden ayrı tür, yazar profili) | migration + route + panel | Yüksek |
| **Galeriler** | Foto galeri + kategoriler, çoklu görsel yükleme | migration + route + panel | Yüksek |
| **Videolar** | Video galeri + kategoriler (YouTube/embed) | migration + route + panel | Yüksek |
| **Yorumlar** | Okur yorumu moderasyonu (onay/sil/spam) | migration + route + panel + ön yüz | Yüksek |
| **Anketler** | Anket oluştur, seçenek, oy sayımı, ön yüz widget | migration + route + panel + ön yüz | Orta |
| **Sayfalar** | Statik sayfa CRUD (künye, iletişim vb. içerik) | migration + route + panel | Orta |
| **Footer Linkleri** | Footer link + kategori yönetimi | migration + route + panel | Düşük |
| **Ziyaretçi Haberleri** | "Haber gönder" başvuru kuyruğu + onay | migration + route + panel | Orta |
| **İçerik Botları** | Haber ajansı RSS/otomatik içe aktarma (Anka/DHA/İHA…) | migration + route + panel + zamanlayıcı | Düşük (karmaşık) |
| **Kategori yönetimi UI** | Her modül için Kategoriler + Kategori Ekle ekranları | route + panel | Orta |
| **İleri Tarihli görünümler** | Planlı içerik filtresi (zaten planlı yayın altyapısı var) | panel filtresi | Düşük |
| **Ayarlar alt bölümleri** | Hakkımızda, Modül Ayarları, Tema Ayarları, Cron Ayarları | migration + panel | Düşük |

## 4. En büyük yapısal fark: menü düzeni

- **Basınsoft:** Çok sayfalı, **açılır-kapanır sol sidebar** + alt menüler (hiyerarşik).
- **Art World TV:** Tek sayfa, yatay sekme çubuğu.

→ Hedef: Paneli basınsoft tarzı **daraltılabilir sol sidebar + gruplu alt menü** hiyerarşisine dönüştürmek; her modül kendi bölümü olacak.

## 5. Uygulama planı (sıralı dalgalar — çakışmayı önlemek için)

**Dalga 1 (bu tur):** Admin UI'yi basınsoft tarzı sol sidebar hiyerarşisine dönüştür; mevcut panelleri yeni yapıya taşı; eksik modüller için panel iskeletleri ekle.

**Dalga 2+:** Her eksik modülün backend'i additive olarak eklenir — yeni `db/migrations/0XX_<modul>.sql` + yeni `routes/<modul>.js` + panelin canlı hale gelmesi. Modüller tek tek, denetimli. (Paylaşılan `api.js`/migration numaraları çakışmasın diye entegrasyonu denetleyici yapar.)

**Not:** İçerik botları (haber ajansı otomatik çekme) gerçek ajans anlaşması/erişimi gerektirir; önce arayüz + genel RSS içe aktarma iskeleti olarak yapılır, gerçek ajans bağlantıları ayrı değerlendirilir.
