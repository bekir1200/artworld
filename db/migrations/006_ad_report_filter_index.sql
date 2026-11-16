CREATE INDEX IF NOT EXISTS ad_delivery_placement_time_idx
  ON ad_delivery_events (placement_id, occurred_at DESC)
  INCLUDE (campaign_id, event_type);
