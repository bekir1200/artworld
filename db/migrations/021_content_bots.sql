-- 021: İçerik Botları (haber ajansı RSS yapılandırması) modülü.
-- Ekleme odaklı; mevcut tablolara dokunmaz. Tekrar çalıştırmaya karşı güvenlidir.
-- Not: Bu tablo yalnızca yapılandırma iskeletidir; otomatik haber çekme bu aşamada yoktur.

CREATE TABLE IF NOT EXISTS content_bots (
  id SERIAL PRIMARY KEY,
  agency_key TEXT NOT NULL UNIQUE,
  agency_name TEXT NOT NULL,
  rss_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO content_bots (agency_key, agency_name, rss_url, is_active) VALUES
  ('anka', 'Anka Haber Ajansı', NULL, FALSE),
  ('dha', 'Doğan Haber Ajansı', NULL, FALSE),
  ('hibya', 'Hibya Haber Ajansı', NULL, FALSE),
  ('igf', 'IGF Haber Ajansı', NULL, FALSE),
  ('iha', 'İhlas Haber Ajansı', NULL, FALSE),
  ('ilkha', 'İlke Haber Ajansı', NULL, FALSE)
ON CONFLICT (agency_key) DO NOTHING;
