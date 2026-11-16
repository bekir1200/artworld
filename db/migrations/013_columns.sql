-- 013: Makaleler (köşe yazıları) modülü
-- Yalnızca ekleyici (additive) değişiklikler: mevcut tablolar değiştirilmez.

CREATE TABLE IF NOT EXISTS columns (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT,
  author_name TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled','archived')),
  published_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS columns_slug_idx ON columns (slug);
CREATE INDEX IF NOT EXISTS columns_status_idx ON columns (status);

-- Demo makaleler (tekrar çalıştırmaya karşı güvenli: aynı slug varsa eklenmez).
INSERT INTO columns (title, slug, author_name, summary, body, status, published_at, created_at, updated_at)
SELECT
  'Haber dilinde sadelik üzerine',
  'haber-dilinde-sadelik-uzerine',
  'Editör Masası',
  'Okurun dikkatini kaybetmeden anlaşılır bir haber dili nasıl kurulur?',
  'Haber metninde her cümle bir bilgi taşımalı. Gereksiz süslemeler okurun asıl soruya ulaşmasını geciktirir. Bu yazıda, yayın masasında uyguladığımız üç basit kuralı paylaşıyoruz: kısa cümleler, somut isimler ve etken çatı.',
  'published',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days'
WHERE NOT EXISTS (SELECT 1 FROM columns WHERE slug = 'haber-dilinde-sadelik-uzerine');

INSERT INTO columns (title, slug, author_name, summary, body, status, published_at, created_at, updated_at)
SELECT
  'Yerel basının geleceği',
  'yerel-basinin-gelecegi',
  'Dilara Yıldız',
  'Yerel gazetecilik, dijital dönüşümde hangi yolu izlemeli?',
  'Yerel haberciliğin ayakta kalması, topluluğun ihtiyaçlarını doğru okumaya bağlı. Bu yazıda yerel haberin ekonomik modellerini, okurla kurulan güven bağını ve kaynak çeşitliliğinin önemini tartışıyoruz.',
  'draft',
  NULL,
  NOW() - INTERVAL '1 day',
  NOW() - INTERVAL '1 day'
WHERE NOT EXISTS (SELECT 1 FROM columns WHERE slug = 'yerel-basinin-gelecegi');

INSERT INTO columns (title, slug, author_name, summary, body, status, published_at, created_at, updated_at)
SELECT
  'Düzeltme kültürü ve şeffaflık',
  'duzeltme-kulturu-ve-seffaflik',
  'Editör Masası',
  'Hatalı haberlerin düzeltilmesi, okurla güven ilişkisini nasıl güçlendirir?',
  'Gazetecilikte hata kaçınılmazdır; önemli olan onu nasıl ele aldığımızdır. Açık bir düzeltme politikası, okurun bize duyduğu güveni koruyan en somut araçtır. Bu yazı, düzeltme sürecimizin ilkelerini anlatıyor.',
  'scheduled',
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM columns WHERE slug = 'duzeltme-kulturu-ve-seffaflik');
