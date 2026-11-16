INSERT INTO categories (name, slug, sort_order, is_active) VALUES
  ('Antalya', 'antalya', 10, TRUE),
  ('Gündem', 'gundem', 20, TRUE),
  ('Siyaset', 'siyaset', 30, TRUE),
  ('Asayiş', 'asayis', 40, TRUE),
  ('Ekonomi', 'ekonomi', 50, TRUE),
  ('Dünya', 'dunya', 60, TRUE),
  ('Eğitim', 'egitim', 70, TRUE),
  ('Sağlık', 'saglik', 80, TRUE),
  ('Turizm', 'turizm', 90, TRUE),
  ('Spor', 'spor', 100, TRUE),
  ('Kültür Sanat', 'kultur-sanat', 110, TRUE),
  ('Yaşam', 'yasam', 120, TRUE),
  ('Türkiye', 'turkiye', 130, TRUE),
  ('Canlı Yayın', 'canli-yayin', 140, TRUE),
  ('Resmi Reklamlar', 'resmi-reklamlar', 150, TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;
