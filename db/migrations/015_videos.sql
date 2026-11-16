-- Videolar modülü: video kategorileri ve videolar.
-- Additive: mevcut tablolara dokunmaz, tekrar çalıştırılabilir (idempotent).

CREATE TABLE IF NOT EXISTS video_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT,
  category_id INT REFERENCES video_categories(id) ON DELETE SET NULL,
  youtube_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'scheduled', 'archived')),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS video_categories_slug_idx ON video_categories (slug);
CREATE INDEX IF NOT EXISTS videos_category_idx ON videos (category_id);
CREATE INDEX IF NOT EXISTS videos_status_created_idx ON videos (status, created_at DESC);

-- Demo kategoriler (slug üzerinden tekrar eklenmez)
INSERT INTO video_categories (name, slug, sort_order)
SELECT v.name, v.slug, v.sort_order
  FROM (VALUES
    ('Gündem', 'gundem', 1),
    ('Röportaj', 'roportaj', 2),
    ('Kültür Sanat', 'kultur-sanat', 3)
  ) AS v(name, slug, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM video_categories c WHERE c.slug = v.slug
 );

-- Demo videolar (örnek YouTube bağlantıları; slug üzerinden tekrar eklenmez)
INSERT INTO videos (title, slug, category_id, youtube_url, description, status)
SELECT v.title,
       v.slug,
       (SELECT c.id FROM video_categories c WHERE c.slug = v.category_slug ORDER BY c.id LIMIT 1),
       v.youtube_url,
       v.description,
       v.status
  FROM (VALUES
    ('Haftanın Özeti', 'haftanin-ozeti', 'gundem',
     'https://www.youtube.com/watch?v=demo-ozet01',
     'Haftanın öne çıkan gelişmelerini kısa bir özetle derledik.', 'published'),
    ('Editörle Söyleşi', 'editorle-soylesi', 'roportaj',
     'https://www.youtube.com/watch?v=demo-soylesi02',
     'Editörümüzle gündemin perde arkasını konuşuyoruz.', 'draft'),
    ('Sanat Dünyasından Notlar', 'sanat-dunyasindan-notlar', 'kultur-sanat',
     'https://youtu.be/demo-sanat03',
     'Bu ay sanat dünyasında öne çıkan sergi ve etkinlikler.', 'scheduled')
  ) AS v(title, slug, category_slug, youtube_url, description, status)
 WHERE NOT EXISTS (
   SELECT 1 FROM videos x WHERE x.slug = v.slug
 );
