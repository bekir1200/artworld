UPDATE ad_placements
SET format = 'Masaüstü: 1280×250, 1170×150, 980×220, 970×150, 900×100 · Mobil: 320×100, 300×100'
WHERE placement_key IN ('home-leaderboard', 'article-inline');

UPDATE ad_placements
SET format = 'Masaüstü ve mobil: 300×250'
WHERE placement_key IN ('home-feature', 'article-sidebar');

UPDATE ad_placements
SET format = 'Masaüstü: 970×150, 900×100 · Mobil: 320×100, 300×100'
WHERE placement_key = 'category-top';

UPDATE ad_placements
SET format = 'Masaüstü ve mobil: 1280×720'
WHERE placement_key = 'video-sponsor';
