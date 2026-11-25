-- Burç & Film modülü için otomatik kaynaklar.
-- movies: TMDB'den gelen filmler tmdb_id ile eşlenir; source elle eklenenleri ayırır.
ALTER TABLE movies ADD COLUMN IF NOT EXISTS tmdb_id INTEGER;
ALTER TABLE movies ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS movies_tmdb_id_key ON movies (tmdb_id) WHERE tmdb_id IS NOT NULL;

-- Günlük otomatik işlerin son çalışma kaydı (günde bir kez çalışsın, panelde sonucu görünsün).
CREATE TABLE IF NOT EXISTS auto_feed_runs (
  feed_key TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_result TEXT NOT NULL DEFAULT '',
  last_ok BOOLEAN NOT NULL DEFAULT FALSE
);
