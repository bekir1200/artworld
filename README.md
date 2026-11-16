# Art World TV Haber Portalı

Node.js ile sunulan, Türkçe haber ana sayfası ve içerik/reklam/okur ilişkileri paneli için arayüz prototipidir.

## Çalıştırma

Node.js 20 veya üstünü kurun, proje klasöründe `npm start` çalıştırın ve `http://localhost:3003` adresini açın. Geliştirme için `npm run dev` kullanılabilir.

## PostgreSQL geliştirme kurulumu

1. `.env.example` dosyasını `.env` adıyla kopyalayın. Yerel geliştirme parolasını değiştirin; `.env` Git'e eklenmez.
2. Docker Desktop'ı açın ve proje klasöründe `docker compose up -d postgres` çalıştırın. PostgreSQL, ana makinenin `5433` portunda dinler; uygulama varsayılan olarak `3003` portunu kullanır.
3. `npm run db:check` ile bağlantıyı kontrol edin.
4. `npm run db:migrate` ile `db/migrations` altındaki sıralı şemaları uygulayın. Tekrar çalıştırmak daha önce uygulanmış migration'ları atlar.
5. API gizli bilgilerini saklamak için 32 rastgele bayt üretin: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Çıktıyı `.env` içindeki `SETTINGS_ENCRYPTION_KEY` alanına koyun ve sunucuyu yeniden başlatın. Anahtarı veri tabanı yedeğiyle birlikte güvenli yedekleyin; kaybolursa saklanan API değerleri açılamaz.
6. İlk yönetici için PowerShell'de parolayı güvenli istemden alın ve yalnızca komut süresince ortam değişkeninde tutun:

   ```powershell
   $secure = Read-Host "Yönetici parolası" -AsSecureString
   $env:ADMIN_PASSWORD = [Net.NetworkCredential]::new("", $secure).Password
   npm run admin:create
   Remove-Item Env:ADMIN_PASSWORD
   ```

   Komut e-posta ve görünen adı sorar. Yönetici parolası en az 14 karakter olmalıdır. Giriş sayfası `/giris`, yönetim paneli `/yonetim` adresindedir.

Migration'lar; kullanıcı/oturum ve roller, haber/medya, reklam, CRM, denetim ve şifreli entegrasyon kasası tablolarını kurar. `/yonetim` içindeki kullanıcı/rol ve API/entegrasyon ayarlarını yalnızca yönetici kullanabilir. API değerleri AES-256-GCM ile şifrelenir, yeniden okunabilir biçimde ekrana gönderilmez; değiştirme veya silme yapılabilir. Yönetim ekranında Google Ads, Analytics 4, Search Console, YouTube canlı yayın, diğer Google API ve özel RTMP sağlayıcısı için alan şablonları bulunur.

### Art World TV kaynak sitesinden arşiv aktarımı

`https://www.artworld.com.tr/sitemap.xml` altındaki haber sayfaları ve kapak görsellerini almak için Python bağımlılıklarını kurup manifesti üretin; ardından kategorileri güncelleyen migration'ı ve Node.js aktarım komutunu çalıştırın:

```powershell
python -m pip install -r scripts/requirements-artworld-import.txt
python scripts/scrape-artworld-site.py
npm run db:migrate
npm run data:import:artworld
```

Aktarım yayımlanmış haberlerin başlık, spot, metin, kategori, tarih, kaynak adresi ve kapak görsellerini alır. Kaynak bağlantısı `articles.source_url` alanında saklanır; yinelenen haberler tekrar oluşturulmaz. Geçici manifest ve görseller `.gitignore` kapsamındaki `data/artworld-source/` klasöründe kalır.

## Yönetim rolleri

- Yönetici: tüm alanlar, personel/rol yönetimi ve API/entegrasyon ayarları.
- Yazı işleri müdürü: tüm haberler, onay ve yayın. Editör: haber düzenleme ve incelemeye gönderme; onay/yayın yetkisi yok.
- Muhabir: yalnız kendi taslakları ve incelemeye gönderme.
- Reklam satış: reklam alanı.
- CRM sorumlusu: okur CRM alanı.

Rol denetimi sunucu tarafında uygulanır; yönetim panelinde sekmeler de role göre süzülür. Reklamveren/kampanya, reklam kreatifi onayı ve aktif reklam alanlarının gösterim/tıklama kaydı; CRM not/atama/CSV ve bülten aboneliği kalıcı veriye bağlıdır. Gmail üzerinden bülten göndermek için admin panelindeki Google Gmail entegrasyonunu (`gmail.send` OAuth kapsamı), `.env` içindeki herkese açık HTTPS `SITE_URL` değerini ve HTTPS alan adını yapılandırın. Gmail bilgileri girilmeden gönderim endpoint'i e-posta yollamaz.

## Basın İlan Kurumu reklamları ve yayın arşivi

`/arsiv?tarih=YYYY-MM-DD` seçilen tarihte yayında olan haberleri, reklam görsellerini ve günlük gösterim/tıklama kayıtlarını gösterir. Makale yayın durumları ve revizyon tarihleri kullanılır; reklam gösteriminde o günkü kreatif ve kurum kodu arşivlenir. Migration öncesindeki eski reklam olaylarında kreatif birebir doğrulanamıyorsa arşiv bunu yaklaşık eşleşme olarak işaretler. Admin kampanya formundaki **Basın İlan Kurumu ilan/yayın kodu** alanı bu referansı saklar.

`ilan_202611101258` paketinde gönderilen kreatif ölçüleri (piksel): 1280×720, 1280×250, 1170×150, 980×220, 970×150, 900×100, 320×100, 300×250 ve 300×100. Reklam alanı seçildiğinde kabul edilen ölçüler yönetimde görünür; kreatif görseli bu alanın ölçülerinden biriyle eşleşmelidir. Dosyadaki yayın bilgisi 17.11.2026 tarihini ve `ILN02589472` / `INT-001727` referanslarını içerir.

## Sayfa tasarımı

Yönetici, `/yonetim` içindeki **Sayfa tasarımı** bölümünde ana sayfa ve haber detayını görsel tuvalde düzenleyebilir. Bileşen paletinden ekleme, sürükle-bırak sıralama, seçili bileşen için içerik/görünürlük/renk/genişlik/boşluk ayarları, masaüstü/tablet/mobil tuval görünümü ve gerçek sayfa önizlemesi bulunur. Düzenler taslak olarak saklanıp yayımlanabilir; isimli şablonlar veritabanına kaydedilebilir, yüklenebilir ve silinebilir. Sayfalara serbest HTML/JavaScript eklenmez; yalnız tanımlı bileşenler kullanılabilir.

## Kapsam

- Haber ana sayfası: manşet, son dakika akışı, günün özeti, kategori seçkisi, çok okunanlar, video ve reklam alanları.
- Yönetim merkezi: editoryal iş akışı, kampanya/kreatif/reklam alanları, CRM kuyruğu, kullanıcı yetkileri, entegrasyon kasası, işlem geçmişi ve ana sayfa/haber şablonu düzenleyicisi.
- Haber editörü: taslak açma/düzenleme, incelemeye gönderme, onaylama, yayımlama ve arşivleme; içerik revizyonları ve işlem günlüğü.
- Yayındaki haberlerden oluşturulan ana sayfa, haber detayları, kategoriler, arama, sayfalı arşiv, RSS (`/rss.xml`), XML site haritası (`/sitemap.xml`) ve `robots.txt`.
- Haber editöründen JPG, PNG veya WebP kapak görseli yükleme; 6 MB sınırı, içerik imzası kontrolü ve taslak görsellere oturum koruması.
- Mobil uyumlu sayfa, büyük yazı ölçeği, koyu görünüm, arama penceresi ve kategori filtresi.
- Reklam gösterim/tıklama olayları ve CRM kayıtları uygulamaya bağlıdır. Gmail bülten gönderimi ve Google API raporları, admin entegrasyon bilgileri girilip servis OAuth izinleri verildikten sonra kullanılabilir. Canlı yayın, kaynak sitedeki resmî Artı Dijital Medya oynatıcısını kullanır.

## Üretim öncesi ihtiyaçlar

1. Personel rolleri, admin kullanıcı yönetimi, güvenli oturum açma, editör onay geçmişi ve denetim kayıtları.
2. PostgreSQL gibi kalıcı veri tabanı, yedekleme, medya depolama ve CDN.
3. Reklam sözleşmesi/teslimatı ve ölçümleme altyapısı; sponsorlu içeriklerin açıkça etiketlenmesi.
4. Yapılandırılmış haber verisi, SEO ve trafik analitiği entegrasyonu.
5. Künye, iletişim, yayın ilkeleri, düzeltme ve cevap, gizlilik/KVKK ve çerez sayfalarının gerçek kurumsal bilgilerle tamamlanması. Yürürlükteki Basın Kanunu ve Basın İlan Kurumu kurallarının işletmeye uygulanması hukuk ve yayın danışmanıyla ayrıca değerlendirilmelidir.

## Referans araştırması

Ensonhaber sayfalarının görünen yapısından kategori navigasyonu, son dakika akışı, haber/video yüzleri ve kurumsal sayfalar incelenmiştir. Kod ve metinler Art World TV için özgün hazırlanmıştır; örnek başlıklar gerçek haber değildir.
