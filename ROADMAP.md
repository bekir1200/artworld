# Art World TV Haber Sistemi Yol Haritası

Bu yol haritası mevcut Node.js arayüz prototipini kalıcı veriye bağlı, editoryal iş akışına sahip bir haber yayın sistemine dönüştürmek için hazırlanmıştır. Tarihler, ekip büyüklüğü ve yayın hedefi henüz belirlenmediği için aşamalar takvim yerine bağımlılık ve tamamlanma ölçütlerine göre sıralanmıştır.

## Mevcut durum

- Ana sayfa ve `/yonetim` arayüzleri hazırlanmış durumda.
- PostgreSQL seçildi; `pg` sürücüsü, bağlantı havuzu, yerel Docker Compose tanımı ve ilk şema migration'ı eklendi.
- PostgreSQL 18 konteyneri çalışıyor ve ilk migration uygulanmış durumda.
- Yönetici oluşturma komutu, scrypt parola özeti, güvenli oturum çerezi, giriş/çıkış ve giriş denemesi sınırı eklendi.
- Haber oluşturma/düzenleme, editör incelemesi, onay, yayın/arşiv geçişleri, kategori/durum sayacı ve revizyon/denetim kayıtları PostgreSQL'e bağlı.
- Reklamveren/kampanya taslakları, reklam alanı envanteri ve CRM kayıt kuyruğu PostgreSQL'e bağlandı.
- Admin-only API/entegrasyon kasası (AES-256-GCM), personel ve rol yönetimi tamamlandı; editoryal, reklam ve CRM sekmeleri role göre süzülüyor.
- Yönetim panelinde canlı özetler, haber arama/durum filtresi, reklam kampanya akışı, CRM arama/filtre/durum güncelleme ve yönetici işlem geçmişi var.
- Ana sayfa, haber detayları, kategoriler ve arama yayımlanmış haberleri PostgreSQL'den sunuyor; haber görüntülenmeleri kaydediliyor.
- Haber editöründen güvenli kapak görseli yükleme, haber kaydına bağlama ve haber yüzlerinde gösterme tamamlandı.
- Art World TV kaynağından doğrulanabilen 496 haber, kapak görselleriyle PostgreSQL'e aktarıldı; 117 eski/erişilemeyen kaynak bağlantısı hata raporunda kaldı.
- Kurumsal sayfalar, kaynak kategori yapısı ve resmî canlı yayın oynatıcısı eklendi.
- Bu nedenle sistemin yayın öncesi kalan altyapı ve içerik gereksinimleri tamamlanmalıdır.

## Aşama 0 — Kapsamı ve yayın kurallarını netleştir

### Yapılacaklar

- Haber türleri ve kategorileri belirle: haber, özel dosya, video, galeri, köşe yazısı gibi.
- Kullanıcı rollerini tanımla: yönetici, yazı işleri müdürü, editör, muhabir, reklam satış ve CRM sorumlusu.
- Her rolün haber oluşturma, düzenleme, onaylama, yayımlama ve reklam/CRM verisine erişim yetkisini kararlaştır.
- Reklam formatlarını, konumlarını, kampanya alanlarını ve sponsorlu içerik etiketlerini tanımla.
- Künye, iletişim, yayın ilkeleri, düzeltme/cevap, gizlilik ve KVKK içeriklerinin sorumlularını belirle.
- Alan adı, barındırma, medya depolama, e-posta ve canlı yayın sağlayıcılarını seç.

### Tamamlanma ölçütü

- Rol/yetki tablosu, haber alanları, yayın akışı ve reklam envanteri yazılı olarak onaylanmış olmalı.
- Gerçek kurumsal bilgiler ve hukuki metinler için sorumlular belli olmalı.

## Aşama 1 — Sunucu, veri tabanı ve güvenli erişim

### Yapılacaklar

- Node.js sunucusunu üretim kullanımına uygun API ve sayfa rotalarıyla yapılandır.
- PostgreSQL sunucusunu başlatıp `.env` bağlantısını doğrula; yedekleme ve geri yükleme düzenini kur.
- Haber, kategori, yazar, kullanıcı, medya, reklam kampanyası ve CRM kayıtları için API uçlarını oluştur.
- Güvenli oturum açma, parola saklama/sıfırlama ve rol tabanlı erişim denetimi ekle.
- Girdi doğrulama, hata yanıtları, denetim kayıtları, hız sınırlama ve yedekleme düzeni kur.
- Gizli anahtarları ortam değişkenlerinde tut; HTTPS, log saklama ve geri yükleme sürecini yapılandır.

### Tamamlanma ölçütü

- Yetkisiz kullanıcı yönetim verisine erişememeli.
- Yetki verilen kullanıcı oturum açabilmeli ve izinli alanlarda kayıt oluşturup okuyabilmeli.
- Veri tabanı yedeği alınabilmeli ve belgelenmiş adımlarla geri yüklenebilmeli.

### İlerleme

- Tamamlandı: yerel PostgreSQL bağlantısı, yönetici oluşturma, oturum açma/kapama, yetkili haber listesi ve taslak oluşturma/düzenleme.
- Tamamlandı: taslak → inceleme → onay → yayın/arşiv geçişleri, revizyon kaydı, denetim günlüğü ve yönetim ekranına bağlama.
- Tamamlandı: ana sayfa, haber detayı, kategori ve arama sayfalarını yayımlanmış PostgreSQL haberlerine bağlama; görüntülenme sayacı ve popüler haber sıralaması.
- Sırada: planlı yayın ve revizyon geri yükleme.

## Aşama 2 — Haber CMS’i ve editoryal iş akışı

### Yapılacaklar

- Haber oluşturma/düzenleme ekranı: başlık, spot, gövde, yazar, kaynak, kategori, etiket, slug, kapak görseli, açıklama ve SEO alanları.
- Durum akışı: taslak → editör incelemesi → onaylandı → planlandı/yayında → arşivlendi.
- Taslak önizlemesi, planlı yayın, güncelleme, yayından alma ve geri alma işlevleri.
- İçeriği kimin ne zaman oluşturduğunu/düzenlediğini ve kimlerin onayladığını gösteren sürüm geçmişi.
- Editör ataması, editör notu ve düzeltme gerekçesi.
- Medya kütüphanesi: dosya yükleme, kırpma/alternatif boyutlar, alt metin, açıklama, kaynak ve kullanım hakkı bilgisi.
- Kategori, etiket ve yazar profillerinin yönetimi.

### Tamamlanma ölçütü

- Muhabir taslak kaydedebilmeli; editör incelemeye gönderebilmeli; yetkili editör onaylayıp hemen veya planlı yayımlayabilmeli.
- Yayımlanan içerik ana sayfa ve ilgili kategoriye otomatik yansımalı.
- Değişiklik geçmişi görüntülenip önceki sürüm geri yüklenebilmeli.

## Aşama 3 — Okur tarafı haber sitesi

### İlerleme

- Tamamlandı: haber detay adresleri, kategori listeleri, başlık/spot araması, ana sayfa seçkileri, görüntülenmeye göre çok okunanlar ve sayfalı `/haberler` arşivi.
- Tamamlandı: kapak görseli yükleme/sunma, başlık görselini haber detayında ve kartlarda gösterme.
- Tamamlandı: yayımlanmış haberlerden otomatik RSS (`/rss.xml`), XML site haritası (`/sitemap.xml`) ve site haritasını bildiren `robots.txt`.
- Tamamlandı: Art World TV kategori yapısı, 496 erişilebilir arşiv haberi ve kapak görselleri, künye/iletişim/yayın ilkeleri/reklam/canlı yayın/servisler kurumsal sayfaları.
- Tamamlandı: admin’den ana sayfa ve haber detayı modüllerini ekleme/kaldırma/sıralama, vurgu rengini seçme, taslak önizleme ve yayına alma.
- Sırada: Google News site haritası ve yapılandırılmış haber verisi.

### Yapılacaklar

- Her haber için gerçek detay sayfası ve kalıcı URL oluştur.
- Kategori sayfaları, tüm haberler arşivi, arama sonuçları ve sayfalama/sonsuz kaydırma seçeneklerinden uygun olanını kur.
- Son dakika, manşet, günün seçkisi, çok okunanlar ve video listelerini veri tabanına bağla.
- Haberde yazar, kaynak, ilk yayın tarihi ve varsa güncelleme tarihini göster.
- Paylaşım bağlantıları, ilişkili haberler ve görsel galeri/video oynatma alanları ekle.
- Üst menü, alt menü ve kurumsal bağlantıları gerçek sayfalara bağla.
- Mobil düzen, klavye erişimi, görsel alt metinleri ve okunabilir hata/boş durumlarını tamamla.

### Tamamlanma ölçütü

- Bir yönetici yeni haber yayımladığında doğru URL, kategori ve haber detayında görünmeli.
- Okur arama yapabilmeli, kategoriye gidebilmeli ve arşivden daha eski haberleri bulabilmeli.
- Yayından kaldırılan/olmayan içerik için anlaşılır 404 sayfası çıkmalı.

## Aşama 4 — Reklam yönetimi ve okur CRM’i

### İlerleme

- Tamamlandı: reklam alanı envanteri, reklamveren/kampanya taslağı, kreatif yükleme/onayı, aktif alanlarda reklam gösterimi ve görünürlük/tıklama sayımı.
- Tamamlandı: rol kontrollü CRM kaydı, arama/filtre, durum atama, sorumlu/not güncelleme, CSV dışa aktarma ve bülten izin/ayrılma kaydı.
- Tamamlandı: Google Gmail API üzerinden bülten gönderimi; yetkili kullanıcı Gmail entegrasyonunu ve HTTPS `SITE_URL` değerini tanımladığında etkinleşir.
- Sırada: kampanya performans raporunu tarih/alan filtreleriyle genişletmek ve büyük abone listeleri için arka plan gönderim kuyruğu kurmak.

### Reklam yönetimi

- Reklamveren kaydı, iletişim geçmişi, kampanya oluşturma ve onay akışı.
- Reklam alanı/formatı, başlangıç-bitiş, kreatif, hedef sayfa ve teslimat durumunu yönetme.
- Gösterim/tıklama ölçümü veya seçilen reklam sağlayıcısıyla entegrasyon.
- Sponsorlu içerik ve reklam etiketlerinin okur tarafında açık biçimde görünmesi.
- Kampanya raporu ve gerektiğinde faturalama/veri dışa aktarma.

### CRM

- Bülten kayıtlarını, reklam taleplerini, okur mesajlarını ve düzeltme bildirimlerini ayrı kayıt türlerinde tut.
- İzin metni sürümü, izin zamanı/kaynağı, tercih ve abonelikten çıkma durumunu sakla.
- Erişim yetkileri, arama, durum atama, yanıt notu ve dışa aktarma işlevleri.
- İhtiyaç olmadan hassas okur bilgisi toplama; saklama ve silme sürelerini belirle.

### Tamamlanma ölçütü

- Kampanya durumları ve CRM kayıtları kalıcı olmalı; yetkili kullanıcı değişiklik geçmişini görebilmeli.
- Bülten aboneliği/ayrılma işlemleri gerçek kayıt üzerinde çalışmalı.
- Reklam alanı boşken sayfa düzeni bozulmamalı; reklam içerikleri editoryal haberlerden ayırt edilebilmeli.

## Aşama 5 — Arama görünürlüğü, analitik ve dağıtım

### Yapılacaklar

- Haber sayfalarına uygun `NewsArticle` yapılandırılmış verisi, canonical URL, başlık ve açıklama ekle.
- Google News haber site haritasını ve yapılandırılmış haber verisini tamamla.
- Google Search Console ve kullanılacak analitik sistemini entegre et.
- İhtiyaca göre sosyal paylaşım kartları, e-posta bülteni ve anlık bildirim altyapısı ekle.
- BİK resmî ilan/reklam hedefi varsa ilgili teknik kuralları, ölçüm kodu ve bildirim süreçlerini hedef kapsamla karşılaştır.

### Tamamlanma ölçütü

- Yeni haber yayınlandığında doğru URL ve güncel tarih bilgileri site haritasında/akışta görünmeli.
- Arama motoru testlerinde yapılandırılmış veri ve temel meta alanları doğrulanmalı.
- Analitik raporları test verisiyle değil gerçek entegrasyon verisiyle dolmalı.

## Aşama 6 — Kurumsal içerik, mevzuat ve yayına hazırlık

### Yapılacaklar

- Künye ve iletişim sayfalarını gerçek yayıncı, sorumlu müdür, yer sağlayıcı ve iletişim bilgileriyle doldur.
- Yayın ilkeleri, düzeltme/cevap başvurusu, gizlilik/KVKK ve çerez tercihlerini tamamla.
- Haberlerin yayın/güncelleme tarihlerini ve editoryal geçmişini doğru kaydet.
- Kanunen/operasyonel olarak tutulması gereken içerik kayıtları için saklama ve dışa aktarma politikasını belirle.
- Alan adı, HTTPS, yedekleme, hata izleme, erişim kontrolü, mobil görünüm ve içerik onayı için yayına çıkış kontrolü yap.
- Hukuk ve yayın danışmanından gerçek işletme ve yayın kapsamına göre son değerlendirme al.

### Tamamlanma ölçütü

- Ana sayfadan künye/iletişim ve düzeltme başvurularına ulaşılabilmeli.
- Canlı sistemde örnek kayıtlar yerine gerçek ve onaylanmış içerik bulunmalı.
- Yedekleme, geri yükleme, yetki kontrolü ve yayın geri alma adımları uygulanmış olmalı.

## Aşama 7 — İsteğe bağlı büyüme özellikleri

- Okur üyeliği, kaydedilen haberler ve kategori/yazar takibi.
- Moderasyonlu yorumlar ve ihbar hattı.
- Canlı yayın, fotoğraf galerileri, podcast ve özel dosya sayfaları.
- Uygulama/anlık bildirim, çok dil ve kişiselleştirilmiş bülten.
- Gelişmiş reklam envanteri, kampanya tahmini ve içerik performansı raporları.

## Araştırma referansları

- Ensonhaber: [ana sayfa](https://www.ensonhaber.com/), [video](https://www.ensonhaber.com/video), [RSS](https://www.ensonhaber.com/rss-servisleri), [yayın ilkeleri](https://www.ensonhaber.com/yayin-ilkeleri).
- CMS örnekleri: [WordPress roller ve durumlar](https://wordpress.org/documentation/article/roles-and-capabilities/), [Strapi taslak/yayın](https://docs.strapi.io/cms/features/draft-and-publish), [Strapi denetim kayıtları](https://docs.strapi.io/cms/features/audit-logs).
- Teknik kaynaklar: [Google News site haritası](https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap), [Google Article verisi](https://developers.google.com/search/docs/appearance/structured-data/article), [BİK teknik tebliği](https://bik.gov.tr/storage/2024/05/Internet-Haber-Sitelerinin-Teknik-Olarak-Uymasi-Gereken-Kurallara-Dair-Usul-ve-Esaslar-Hakkinda-Teblig.pdf).

> Bu belge ürün/teknik planıdır; hukuki görüş değildir. Resmî ilan, basın kartı, KVKK ve yayın yükümlülükleri için kapsamı hukuk danışmanıyla doğrulayın.
