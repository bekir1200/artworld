-- Giriş denemesi sayaçları. Sunucusuz ortamda (Vercel) bellek örnekler arasında paylaşılmadığı için
-- sınır veritabanında tutulur. bucket: 'ip:<sha256>' ya da 'email:<sha256>'; ham IP/e-posta saklanmaz.
CREATE TABLE IF NOT EXISTS login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_ends_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_window_idx ON login_attempts (window_ends_at);
