-- 015_videos.sql ile eklenen örnek videolar sahte YouTube kimlikleri taşıdığı için sitede kırık
-- küçük resim (i.ytimg.com 404) gösteriyordu. Adresi hâlâ örnek değerde olan kayıtlar silinir;
-- editörün gerçek bir YouTube linki girdiği kayıtlara dokunulmaz.
DELETE FROM videos
 WHERE youtube_url IN (
   'https://www.youtube.com/watch?v=demo-ozet01',
   'https://www.youtube.com/watch?v=demo-soylesi02',
   'https://youtu.be/demo-sanat03'
 );
