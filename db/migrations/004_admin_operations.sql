INSERT INTO ad_placements (placement_key, display_name, page_area, format) VALUES
  ('home-leaderboard', 'Ana sayfa üst bant', 'Ana sayfa', '728×90 banner'),
  ('home-feature', 'Ana sayfa manşet yanı', 'Ana sayfa', 'Yatay görsel'),
  ('article-inline', 'Haber içi reklam', 'Haber detayı', 'Yatay görsel'),
  ('article-sidebar', 'Haber yanı reklam', 'Haber detayı', 'Dikey görsel'),
  ('category-top', 'Kategori üst alanı', 'Kategori sayfası', 'Yatay görsel'),
  ('video-sponsor', 'Video sponsoru', 'Video alanı', 'Sponsorlu içerik')
ON CONFLICT (placement_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  page_area = EXCLUDED.page_area,
  format = EXCLUDED.format,
  is_active = TRUE;
