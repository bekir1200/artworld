-- 029: İçerik botları için ajans bazında otomatik yayın.
-- auto_publish = TRUE olan ajansın çektiği haberler taslak yerine doğrudan yayına girer.
-- Ekleme odaklı; tekrar çalıştırmaya karşı güvenlidir.

ALTER TABLE content_bots
  ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE;
