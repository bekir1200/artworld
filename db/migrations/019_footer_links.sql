-- 019: Footer linkleri modulu (kategoriler ve bagli linkler). Ekleme odakli; mevcut tablolara dokunmaz.

CREATE TABLE IF NOT EXISTS link_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS footer_links (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES link_categories(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Demo veri: yalnizca kategori tablosu bossa eklenir (tekrar calistirmaya karsi guvenli).
DO $$
DECLARE
  c_kurumsal INT;
  c_kesfet INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM link_categories) THEN
    INSERT INTO link_categories (name, slug, sort_order)
      VALUES ('Kurumsal', 'kurumsal', 1)
      RETURNING id INTO c_kurumsal;
    INSERT INTO link_categories (name, slug, sort_order)
      VALUES ('Keşfet', 'kesfet', 2)
      RETURNING id INTO c_kesfet;

    INSERT INTO footer_links (category_id, label, url, sort_order) VALUES
      (c_kurumsal, 'Hakkımızda', '/hakkimizda', 1),
      (c_kurumsal, 'İletişim', '/iletisim', 2),
      (c_kesfet, 'Galeriler', '/galeriler', 1),
      (c_kesfet, 'Videolar', '/videolar', 2);
  END IF;
END $$;
