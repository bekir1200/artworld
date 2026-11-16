// storage/media klasöründeki eski görselleri veritabanındaki content sütununa taşır.
// Kullanım: DATABASE_URL'in hedef veritabanına (ör. Neon) işaret ettiğinden emin olun, sonra: node scripts/migrate-media-to-db.js
require('../config/env');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db/pool');

const mediaDir = path.join(__dirname, '..', 'storage', 'media');

async function main() {
  const { rows } = await pool.query('SELECT id, storage_key FROM media_assets WHERE content IS NULL ORDER BY id');
  let moved = 0;
  let missing = 0;
  for (const row of rows) {
    try {
      const bytes = await fs.readFile(path.join(mediaDir, row.storage_key));
      await pool.query('UPDATE media_assets SET content = $1 WHERE id = $2', [bytes, row.id]);
      moved += 1;
    } catch (error) {
      if (error.code === 'ENOENT') missing += 1;
      else throw error;
    }
  }
  console.log(`Taşındı: ${moved}, dosyası diskte bulunmayan: ${missing}, toplam bekleyen: ${rows.length}`);
}

main()
  .catch((error) => { console.error('Taşıma başarısız:', error.message); process.exitCode = 1; })
  .finally(() => pool.end());
