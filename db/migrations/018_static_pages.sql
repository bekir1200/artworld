-- 018: Sayfalar (statik sayfa CRUD: künye, iletişim, hakkımızda vb.) modülü.
-- Ekleme odaklı; mevcut tablolara dokunmaz. Tekrar çalıştırmaya karşı güvenlidir.

CREATE TABLE IF NOT EXISTS static_pages (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS static_pages_slug_idx ON static_pages (slug);

-- Demo veri: yalnızca slug henüz yoksa eklenir (tekrar çalıştırmaya karşı güvenli).
INSERT INTO static_pages (title, slug, content, status)
SELECT v.title, v.slug, v.content, v.status
FROM (VALUES
  ('Hakkımızda', 'hakkimizda', 'Bu sayfanın içeriğini Sayfa yönetimi üzerinden güncelleyebilirsiniz.', 'published'),
  ('İletişim', 'iletisim', 'Bu sayfanın içeriğini Sayfa yönetimi üzerinden güncelleyebilirsiniz.', 'published'),
  ('Künye', 'kunye', 'Bu sayfanın içeriğini Sayfa yönetimi üzerinden güncelleyebilirsiniz.', 'draft')
) AS v(title, slug, content, status)
WHERE NOT EXISTS (SELECT 1 FROM static_pages s WHERE s.slug = v.slug);
