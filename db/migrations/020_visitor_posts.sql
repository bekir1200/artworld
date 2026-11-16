-- 020: Ziyaretci Haberleri (okurdan gelen haber basvuru kuyrugu + moderasyon).
-- Ekleme odakli; mevcut tablolara dokunmaz.

CREATE TABLE IF NOT EXISTS visitor_posts (
  id SERIAL PRIMARY KEY,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS visitor_posts_status_idx ON visitor_posts (status);

-- Demo veri: yalnizca tablo bossa eklenir (tekrar calistirmaya karsi guvenli).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM visitor_posts) THEN
    INSERT INTO visitor_posts (submitter_name, submitter_email, title, body, status, ip_address, created_at) VALUES
      ('Ayşe Yılmaz', 'ayse.yilmaz@example.com', 'Mahallemizdeki kaldırım çalışması haftalardır sürüyor',
       'Merkez mahallesindeki ana caddede kaldırım çalışması iki aydır devam ediyor. Yayalar yolu kullanamıyor, esnaf da zarar görüyor. Yetkililerin bir açıklama yapmasını bekliyoruz.',
       'pending', '85.104.12.44', NOW() - INTERVAL '2 hours'),
      ('Mehmet Demir', NULL, 'Belediye otobüs saatleri değişti',
       'Hafta içi sabah seferlerinin saatleri sessizce değiştirilmiş. Durakta bekleyen okul öğrencileri ve işçiler bu durumdan etkileniyor.',
       'pending', '78.165.201.9', NOW() - INTERVAL '5 hours'),
      ('Zeynep Kaya', 'zeynep.kaya@example.com', 'Yerel kütüphane etkinliği',
       'Bu hafta sonu kütüphanemizde çocuklar için ücretsiz okuma atölyesi düzenlenecek. Haberinizde duyurulmasını rica ederim.',
       'approved', '88.230.7.150', NOW() - INTERVAL '1 day'),
      ('Ali Çelik', 'ali.celik@example.com', 'Reklam gibi görünen haber',
       'Bu içerik bir ürün tanıtımı gibi hazırlanmış ancak haber olarak yayımlanmış. Gerçek bir haber değil.',
       'rejected', '31.206.44.18', NOW() - INTERVAL '3 days'),
      ('Elif Arslan', 'elif.arslan@example.com', 'Okul servis ücretlerindeki artış',
       'Bu dönemde özel okul servis ücretleri yüzde kırk arttı. Velilerin tepkisi büyük ve konunun incelenmesi gerekiyor.',
       'approved', '94.54.20.73', NOW() - INTERVAL '6 days');
  END IF;
END $$;
