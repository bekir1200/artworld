require('../config/env');
const pool = require('../db/pool');

async function main() {
  try {
    const { rows } = await pool.query(
      'SELECT current_database() AS database, current_setting(\'server_version\') AS version'
    );
    console.log(`PostgreSQL bağlantısı başarılı: ${rows[0].database} (PostgreSQL ${rows[0].version})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('PostgreSQL bağlantısı başarısız:', error.message);
  process.exitCode = 1;
});
