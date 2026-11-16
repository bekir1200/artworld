-- Galeriler modülü: foto galeri kategorileri ve galeriler.
-- Additive: yalnızca yeni tablolar ve indeksler eklenir, mevcut tablolara dokunulmaz.

CREATE TABLE IF NOT EXISTS gallery_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS galleries (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT,
  category_id INT REFERENCES gallery_categories(id) ON DELETE SET NULL,
  description TEXT,
  image_urls TEXT, -- satır başına bir görsel URL'si
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'scheduled', 'archived')),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS galleries_category_idx ON galleries (category_id);
CREATE INDEX IF NOT EXISTS galleries_created_idx ON galleries (created_at DESC);

-- Demo kategoriler (slug üzerinden tekrar eklemeyi önler)
INSERT INTO gallery_categories (name, slug, sort_order)
SELECT v.name, v.slug, v.sort_order
  FROM (VALUES
    ('Spor', 'spor', 1),
    ('Kültür Sanat', 'kultur-sanat', 2),
    ('Teknoloji', 'teknoloji', 3)
  ) AS v(name, slug, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM gallery_categories c WHERE c.slug = v.slug);

-- Demo galeriler. Görsel URL'leri yer tutucudur; gerçek görsellerle değiştirilmelidir.
-- Demo kayıtlar taslak/arşiv olarak eklenir, yayına alınmaz.
INSERT INTO galleries (title, slug, category_id, description, image_urls, status)
SELECT v.title, v.slug, c.id, v.description, v.image_urls, v.status
  FROM (VALUES
    ('Haftanın en güçlü kareleri', 'haftanin-en-guclu-kareleri', 'spor',
     'Hafta boyunca spor sahalarından öne çıkan fotoğraflar.',
     'https://example.com/demo/spor-1.jpg' || E'\n' || 'https://example.com/demo/spor-2.jpg',
     'draft'),
    ('Sanat fuarından kareler', 'sanat-fuarindan-kareler', 'kultur-sanat',
     'Şehrin sanat etkinliklerinden seçilmiş görüntüler.',
     'https://example.com/demo/sanat-1.jpg' || E'\n' || 'https://example.com/demo/sanat-2.jpg' || E'\n' || 'https://example.com/demo/sanat-3.jpg',
     'draft'),
    ('Teknoloji zirvesi', 'teknoloji-zirvesi', 'teknoloji',
     'Zirvede sahneye çıkan konuşmacılar ve standlar.',
     'https://example.com/demo/teknoloji-1.jpg',
     'archived')
  ) AS v(title, slug, category_slug, description, image_urls, status)
  JOIN gallery_categories c ON c.slug = v.category_slug
 WHERE NOT EXISTS (SELECT 1 FROM galleries g WHERE g.slug = v.slug);
