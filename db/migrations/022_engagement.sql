-- 022: Okur etkilesimi (anket oylari) ve cerezsiz anonim ziyaretci sayimi.
-- Ekleme odakli (additive); mevcut tablolara dokunmaz. Tekrar calistirmaya karsi guvenlidir.
-- NOT: Tablo/kolon adlari dashboard tarafindan okunur; degistirmeyin.

-- Anket oylari: ayni ziyaretci (voter_hash) ayni anketde yalnizca bir kez oy kullanabilir.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voter_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, voter_hash)
);

-- Gunluk anonim ziyaretci sayimi (cerez yok, ham IP saklanmaz).
CREATE TABLE IF NOT EXISTS site_visits_daily (
  visit_date DATE NOT NULL,
  visitor_hash TEXT NOT NULL,
  page_views INT NOT NULL DEFAULT 1,
  PRIMARY KEY (visit_date, visitor_hash)
);

CREATE INDEX IF NOT EXISTS site_visits_daily_visit_date_idx ON site_visits_daily (visit_date);

-- Canli ziyaretci takibi (son gorulme zamani).
CREATE TABLE IF NOT EXISTS site_visitor_live (
  visitor_hash TEXT PRIMARY KEY,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_path TEXT
);

CREATE INDEX IF NOT EXISTS site_visitor_live_last_seen_idx ON site_visitor_live (last_seen);
