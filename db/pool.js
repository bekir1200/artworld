require('../config/env');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL ayarlı değil. .env.example dosyasını .env olarak kopyalayıp bağlantıyı girin.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined
});

pool.on('error', (error) => {
  console.error('Boşta duran PostgreSQL bağlantısında hata oluştu:', error.message);
});

module.exports = pool;
