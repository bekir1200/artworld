require('../config/env');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const pool = require('../db/pool');
const { hashPassword } = require('../auth/password');

async function main() {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const email = (await terminal.question('Yönetici e-posta adresi: ')).trim().toLowerCase();
    const displayName = (await terminal.question('Yönetici görünen adı: ')).trim();
    const password = process.env.ADMIN_PASSWORD;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Geçerli bir e-posta adresi girin.');
    if (!displayName || displayName.length > 100) throw new Error('Ad 1-100 karakter olmalı.');
    if (!password || password.length < 14) throw new Error('ADMIN_PASSWORD ortam değişkeni en az 14 karakter olmalı.');

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, email, display_name, role`,
      [email, passwordHash, displayName]
    );
    console.log(`Yönetici oluşturuldu: ${result.rows[0].email} (${result.rows[0].role})`);
  } finally {
    terminal.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Yönetici oluşturulamadı:', error.code === '23505' ? 'Bu e-posta zaten kayıtlı.' : error.message);
  process.exitCode = 1;
});
