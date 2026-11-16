-- 024: Makale, galeri ve video modülleri için planlı yayın (ileri tarihli).
-- Additive: yalnızca yeni kolonlar ve indeksler eklenir; tekrar çalıştırılabilir (idempotent).
-- publish_at: planlanan yayın zamanı (status = 'scheduled' iken dolu).
-- published_at: yayına alındığı an (columns'ta zaten vardı; galleries ve videos'a eklenir).

ALTER TABLE columns ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
ALTER TABLE columns ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE galleries ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
ALTER TABLE galleries ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE videos ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS columns_status_publish_idx ON columns (status, publish_at);
CREATE INDEX IF NOT EXISTS galleries_status_publish_idx ON galleries (status, publish_at);
CREATE INDEX IF NOT EXISTS videos_status_publish_idx ON videos (status, publish_at);
