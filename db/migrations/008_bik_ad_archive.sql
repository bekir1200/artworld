ALTER TABLE ad_placements
  ADD COLUMN supported_sizes JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE ad_placements
SET format = '1280×250, 1170×150, 980×220, 970×150, 900×100 masaüstü; 320×100, 300×100 mobil',
    supported_sizes = '{"desktop":[[1280,250],[1170,150],[980,220],[970,150],[900,100]],"mobile":[[320,100],[300,100]]}'::jsonb
WHERE placement_key IN ('home-leaderboard','article-inline');

UPDATE ad_placements
SET format = '300×250 masaüstü ve mobil',
    supported_sizes = '{"desktop":[[300,250]],"mobile":[[300,250]]}'::jsonb
WHERE placement_key IN ('home-feature','article-sidebar');

UPDATE ad_placements
SET format = '970×150, 900×100 masaüstü; 320×100, 300×100 mobil',
    supported_sizes = '{"desktop":[[970,150],[900,100]],"mobile":[[320,100],[300,100]]}'::jsonb
WHERE placement_key = 'category-top';

UPDATE ad_placements
SET format = '1280×720 video sponsoru',
    supported_sizes = '{"desktop":[[1280,720]],"mobile":[[1280,720]]}'::jsonb
WHERE placement_key = 'video-sponsor';

ALTER TABLE ad_campaigns
  ADD COLUMN regulatory_reference TEXT NOT NULL DEFAULT '';

ALTER TABLE ad_delivery_events
  ADD COLUMN creative_id BIGINT REFERENCES ad_creatives(id) ON DELETE SET NULL;

CREATE TABLE ad_delivery_daily_archive (
  archive_date DATE NOT NULL,
  campaign_id BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE RESTRICT,
  placement_id BIGINT NOT NULL REFERENCES ad_placements(id) ON DELETE RESTRICT,
  creative_id BIGINT NOT NULL REFERENCES ad_creatives(id) ON DELETE RESTRICT,
  regulatory_reference TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL,
  advertiser_name TEXT NOT NULL,
  placement_key TEXT NOT NULL,
  placement_name TEXT NOT NULL,
  placement_format TEXT NOT NULL,
  creative_headline TEXT NOT NULL,
  target_url TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  media_width INTEGER,
  media_height INTEGER,
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (archive_date, campaign_id, placement_id, creative_id)
);

CREATE INDEX ad_delivery_daily_archive_date_idx
  ON ad_delivery_daily_archive (archive_date DESC, placement_id, campaign_id);

CREATE INDEX ad_delivery_events_creative_time_idx
  ON ad_delivery_events (creative_id, occurred_at DESC);
