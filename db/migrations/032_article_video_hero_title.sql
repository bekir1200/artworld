-- Habere YouTube videosu eklenebilir; manşette başlık yazısı gizlenebilir (görselin üzerinde zaten yazı varsa).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS hide_hero_title BOOLEAN NOT NULL DEFAULT FALSE;
