-- Görsel içerikleri veritabanında tutulur (Vercel gibi kalıcı diski olmayan ortamlar için).
-- Eski kayıtlar content NULL kalır; media.js bunları storage/media klasöründen okumaya devam eder.
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS content BYTEA;
