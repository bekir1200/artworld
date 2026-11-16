require('../config/env');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db/pool');

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
const lockKey = 724190381;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    for (const name of files) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE migration_name = $1', [name]
      );
      if (alreadyApplied.rowCount) {
        console.log(`Atlandı: ${name}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
        await client.query('INSERT INTO schema_migrations (migration_name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Uygulandı: ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [lockKey]); } catch {}
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration başarısız:', error.message);
  process.exitCode = 1;
});
