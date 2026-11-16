-- Ana sayfa popup reklam alanı.
-- ad_placements: placement_key UNIQUE, supported_sizes JSONB (008) biçimi:
-- {"desktop":[[w,h],...],"mobile":[[w,h],...]}. Tekrar çalıştırmaya güvenli.
INSERT INTO ad_placements (placement_key, display_name, page_area, format, is_active, supported_sizes)
VALUES (
  'popup',
  'Popup Reklam (ana sayfa)',
  'Ana sayfa',
  'Masaüstü: 300×250, 600×500 · Mobil: 300×250',
  TRUE,
  '{"desktop":[[300,250],[600,500]],"mobile":[[300,250]]}'::jsonb
)
ON CONFLICT (placement_key) DO NOTHING;
