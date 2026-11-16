-- 023: Resmi İlanlar, Burçlar ve Vizyondaki Filmler modülleri.
-- Ekleme odaklı; mevcut tablolara dokunmaz. Tekrar çalıştırmaya karşı güvenlidir (IF NOT EXISTS / ON CONFLICT).

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  ilan_no TEXT,
  body TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  publish_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO announcements (title, slug, ilan_no, body, status) VALUES
  ('Örnek resmi ilan', 'ornek-resmi-ilan', 'ILAN-0001', 'Bu kayıt örnek taslaktır; yayın öncesi silinebilir.', 'draft')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS horoscopes (
  sign_key TEXT PRIMARY KEY,
  sign_name TEXT NOT NULL,
  date_range TEXT NOT NULL,
  symbol TEXT NOT NULL,
  daily_text TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO horoscopes (sign_key, sign_name, date_range, symbol, daily_text, sort_order) VALUES
  ('koc',     'Koç',     '21 Mart – 19 Nisan',     '♈', '', 1),
  ('boga',    'Boğa',    '20 Nisan – 20 Mayıs',    '♉', '', 2),
  ('ikizler', 'İkizler', '21 Mayıs – 20 Haziran',  '♊', '', 3),
  ('yengec',  'Yengeç',  '21 Haziran – 22 Temmuz', '♋', '', 4),
  ('aslan',   'Aslan',   '23 Temmuz – 22 Ağustos', '♌', '', 5),
  ('basak',   'Başak',   '23 Ağustos – 22 Eylül',  '♍', '', 6),
  ('terazi',  'Terazi',  '23 Eylül – 22 Ekim',     '♎', '', 7),
  ('akrep',   'Akrep',   '23 Ekim – 21 Kasım',     '♏', '', 8),
  ('yay',     'Yay',     '22 Kasım – 21 Aralık',   '♐', '', 9),
  ('oglak',   'Oğlak',   '22 Aralık – 19 Ocak',    '♑', '', 10),
  ('kova',    'Kova',    '20 Ocak – 18 Şubat',     '♒', '', 11),
  ('balik',   'Balık',   '19 Şubat – 20 Mart',     '♓', '', 12)
ON CONFLICT (sign_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS movies (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  duration_min INT,
  release_date DATE,
  rating NUMERIC(3,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10)),
  poster_url TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
