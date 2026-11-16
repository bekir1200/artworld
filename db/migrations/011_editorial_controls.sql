ALTER TABLE articles
  ADD COLUMN homepage_slider_slot TEXT NOT NULL DEFAULT 'auto'
    CHECK (homepage_slider_slot IN ('auto', 'main', 'side_top', 'side_bottom', 'none')),
  ADD COLUMN is_in_briefing BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN is_in_latest BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE articles
   SET homepage_slider_slot = 'main'
 WHERE is_featured = TRUE AND homepage_slider_slot = 'auto';

CREATE INDEX articles_homepage_slot_public_idx
  ON articles (homepage_slider_slot, published_at DESC)
  WHERE status = 'published';

CREATE INDEX articles_briefing_public_idx
  ON articles (published_at DESC)
  WHERE status = 'published' AND is_in_briefing = TRUE;
