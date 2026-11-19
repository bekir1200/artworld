-- Ana sayfa sol ve sağ dikey reklamları kampanya yönetiminde ayrı alanlar olsun.
INSERT INTO ad_placements (placement_key, display_name, page_area, format, is_active, supported_sizes)
VALUES
  ('home-rail-left', 'Ana sayfa sol dikey banner', 'Ana sayfa', 'Masaüstü: 300×600 · Mobil: 300×250', TRUE,
   '{"desktop":[[300,600]],"mobile":[[300,250]]}'::jsonb),
  ('home-rail-right', 'Ana sayfa sağ dikey banner', 'Ana sayfa', 'Masaüstü: 300×600 · Mobil: 300×250', TRUE,
   '{"desktop":[[300,600]],"mobile":[[300,250]]}'::jsonb)
ON CONFLICT (placement_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  page_area = EXCLUDED.page_area,
  format = EXCLUDED.format,
  is_active = TRUE,
  supported_sizes = EXCLUDED.supported_sizes;
