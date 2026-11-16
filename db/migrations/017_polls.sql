-- 017: Anketler (okur anketleri) modulu. Ekleme odakli; mevcut tablolara dokunmaz.

CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id SERIAL PRIMARY KEY,
  poll_id INT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  votes INT NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0
);

-- Demo veri: yalnizca anket tablosu bossa eklenir (tekrar calistirmaya karsi guvenli).
DO $$
DECLARE
  p1 INT;
  p2 INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM polls) THEN
    INSERT INTO polls (question, status)
      VALUES ('Haber sitemizde en çok hangi içeriği görmek istersiniz?', 'active')
      RETURNING id INTO p1;
    INSERT INTO poll_options (poll_id, label, votes, sort_order) VALUES
      (p1, 'Güncel haberler', 42, 1),
      (p1, 'Analiz ve köşe yazıları', 27, 2),
      (p1, 'Video haberler', 35, 3),
      (p1, 'Ekonomi', 18, 4);

    INSERT INTO polls (question, status)
      VALUES ('Şehir içi ulaşımda en büyük sorun sizce nedir?', 'closed')
      RETURNING id INTO p2;
    INSERT INTO poll_options (poll_id, label, votes, sort_order) VALUES
      (p2, 'Trafik yoğunluğu', 120, 1),
      (p2, 'Toplu taşıma sıklığı', 88, 2),
      (p2, 'Ücretler', 54, 3);
  END IF;
END $$;
