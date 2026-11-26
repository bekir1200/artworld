'use strict';

// Haberlerdeki kural (routes/api.js publishers) diğer içerik modüllerinde de geçerli olsun:
// yayına almak, planlamak, arşivlemek ve yayındaki içeriği değiştirip silmek yalnız yayın yetkili rollerin işi.
// Editör taslak hazırlar; yayın kararını yönetici ya da genel yayın yönetmeni verir.
const pool = require('../db/pool');

const PUBLISHERS = new Set(['admin', 'editor_in_chief']);
const PUBLISHING_STATUSES = new Set(['published', 'scheduled', 'archived']);
const LIVE_STATUSES = new Set(['published', 'scheduled']);
const TABLES = new Set(['columns', 'galleries', 'videos', 'announcements', 'static_pages']);

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function canPublish(user) {
  return Boolean(user && PUBLISHERS.has(user.role));
}

// İstenen durum yayın kararı gerektiriyorsa reddeder.
function assertCanSetStatus(user, status) {
  if (canPublish(user) || status === undefined || status === null) return;
  if (PUBLISHING_STATUSES.has(String(status))) {
    throw forbidden('Yayına alma, planlama ve arşivleme yalnızca yönetici veya genel yayın yönetmeni tarafından yapılabilir.');
  }
}

// Kayıt yayında ya da planlıysa değiştirmeyi/silmeyi reddeder. Kayıt yoksa modülün kendi 404'ü devreye girer.
async function assertCanEditExisting(user, table, id) {
  if (canPublish(user)) return;
  if (!TABLES.has(table)) throw new Error(`publish-guard: bilinmeyen tablo ${table}`);
  const { rows } = await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id]);
  if (rows[0] && LIVE_STATUSES.has(rows[0].status)) {
    throw forbidden('Yayındaki içeriği yalnızca yönetici veya genel yayın yönetmeni değiştirebilir.');
  }
}

module.exports = { canPublish, assertCanSetStatus, assertCanEditExisting };
