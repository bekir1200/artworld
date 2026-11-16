const pool = require('../db/pool');

// Planlı yayın tablolarının yapılandırması. Tablo adları sabit değerlerdir (kullanıcı girdisi değil).
const TARGETS = [
  { table: 'columns', entity: 'column', key: 'columns' },
  { table: 'galleries', entity: 'gallery', key: 'galleries' },
  { table: 'videos', entity: 'video', key: 'videos' }
];

// Bir tablodaki zamanı gelmiş ('scheduled' ve publish_at <= NOW()) kayıtları yayına alır.
// Her tablo kendi transaction'ında çalışır; bir tablodaki hata diğerlerini engellemez.
async function publishTable({ table, entity }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE ${table}
          SET status = 'published',
              published_at = COALESCE(publish_at, NOW()),
              publish_at = NULL,
              updated_at = NOW()
        WHERE id IN (
          SELECT id FROM ${table}
           WHERE status = 'scheduled' AND publish_at <= NOW()
           ORDER BY publish_at, id
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
    );
    const ids = rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, after_data)
         SELECT 'scheduled.published', $1, x.id, $2::jsonb
           FROM unnest($3::bigint[]) AS x(id)`,
        [entity, JSON.stringify({ status: 'published' }), ids]
      );
    }
    await client.query('COMMIT');
    return ids.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Zamanı gelen planlı içerikleri yayınlar. Asla throw etmez; hata olursa loglar ve
// o ana kadar yayınlanan sayıları döner.
async function publishDue() {
  const counts = { columns: 0, galleries: 0, videos: 0 };
  for (const target of TARGETS) {
    try {
      counts[target.key] = await publishTable(target);
    } catch (err) {
      console.error(`Planlı yayın hatası (${target.table}):`, err.message);
    }
  }
  return counts;
}

module.exports = { publishDue };
