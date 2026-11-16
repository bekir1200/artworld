ALTER TABLE articles
  ADD COLUMN views_count BIGINT NOT NULL DEFAULT 0 CHECK (views_count >= 0);

CREATE INDEX articles_public_popular_idx
  ON articles (status, views_count DESC, published_at DESC)
  WHERE status = 'published';
