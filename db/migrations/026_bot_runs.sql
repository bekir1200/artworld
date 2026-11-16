-- 026: İçerik botları çekim sonuçları ve haber kaynağı indeksi.
-- Ekleme odaklı; tekrar çalıştırmaya karşı güvenlidir.

ALTER TABLE content_bots
  ADD COLUMN IF NOT EXISTS last_result TEXT,
  ADD COLUMN IF NOT EXISTS last_inserted INT NOT NULL DEFAULT 0;

-- Bot çekimlerinde tekrar eden haberleri (articles.source_url) hızlı bulmak için.
CREATE INDEX IF NOT EXISTS articles_source_url_idx ON articles (source_url);
