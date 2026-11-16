-- Okur yorumları ve moderasyon kuyruğu
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  article_id INT,
  article_title TEXT,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','spam')),
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_status_idx ON comments (status);

-- Demo moderasyon kuyruğu: yalnızca tablo boşken eklenir (tekrar çalıştırmak güvenlidir).
INSERT INTO comments (article_id, article_title, author_name, author_email, body, status, ip_address, created_at)
SELECT v.article_id, v.article_title, v.author_name, v.author_email, v.body, v.status, v.ip_address, v.created_at
FROM (VALUES
  (1, 'İstanbul''un yaratıcı mahalleleri', 'Elif Acar', 'elif.acar@example.com', 'Dosyadaki mahalle haritası çok açıklayıcı olmuş, teşekkürler.', 'pending', '203.0.113.10', NOW() - INTERVAL '2 hours'),
  (2, 'Yeni kuşak seramik sanatçıları', 'Burak Yılmaz', NULL, 'Atölye ziyaretleri hakkında daha fazla bilgi verebilir misiniz?', 'pending', '203.0.113.27', NOW() - INTERVAL '5 hours'),
  (1, 'İstanbul''un yaratıcı mahalleleri', 'Zeynep Okul', 'zeynep@example.com', 'Yazarın seçtiği örnekler gerçekten ilham verici.', 'approved', '198.51.100.4', NOW() - INTERVAL '1 day'),
  (3, 'Galeri açılışları bu hafta', 'Anonim Kullanıcı', NULL, 'Bu haber tamamen yanlış bilgi içeriyor, kaynak yok.', 'rejected', '192.0.2.55', NOW() - INTERVAL '2 days'),
  (2, 'Yeni kuşak seramik sanatçıları', 'Promosyon Bot', 'promo@example.net', 'Hemen tıklayın, bedava kazanç fırsatı! http://spam.example', 'spam', '192.0.2.99', NOW() - INTERVAL '3 days')
) AS v (article_id, article_title, author_name, author_email, body, status, ip_address, created_at)
WHERE NOT EXISTS (SELECT 1 FROM comments);
