// Zamanlanmış işler tek yerde toplanır: yerel sunucu (server.js) aralıklı çalıştırır,
// Vercel ise /api/cron/run adresini zamanlayıcıdan çağırarak aynı işleri yürütür.
const { publishScheduledArticles } = require('./api');
const { publishDue } = require('./scheduler');
const { runDueBots } = require('./bot-runner');
const pool = require('../db/pool');

async function runScheduledTasks() {
  const result = {};
  for (const [name, task] of [
    ['articles', publishScheduledArticles],
    ['modules', publishDue],
    ['bots', runDueBots]
  ]) {
    try {
      const value = await task();
      result[name] = Array.isArray(value) ? value.length : 'ok';
    } catch (error) {
      console.error(`Zamanlanmış iş başarısız (${name}):`, error?.stack || error);
      result[name] = 'hata';
    }
  }
  return result;
}

// Planlı içerikleri ziyaret trafiğiyle zamanında yayınlar.
// Vercel'deki cron günde bir kez çalıştığı için, sayfa isteklerinde (sunucu örneği başına
// en fazla dakikada bir) zamanı gelmiş içerik var mı diye tek bir hafif sorguyla bakılır;
// yalnızca varsa yayın işleri çalışır. Bot çekimi (ağ isteği) burada yapılmaz.
const DUE_CHECK_INTERVAL_MS = 60_000;
let lastDueCheck = 0;
let dueCheckInFlight = null;

async function publishDueContent() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM articles WHERE status = 'scheduled' AND scheduled_at <= NOW()) AS articles,
            (EXISTS (SELECT 1 FROM columns WHERE status = 'scheduled' AND publish_at <= NOW())
             OR EXISTS (SELECT 1 FROM galleries WHERE status = 'scheduled' AND publish_at <= NOW())
             OR EXISTS (SELECT 1 FROM videos WHERE status = 'scheduled' AND publish_at <= NOW())) AS modules`
  );
  if (rows[0].articles) await publishScheduledArticles();
  if (rows[0].modules) await publishDue();
}

// Asla throw etmez. Kontrol sürerken gelen istekler aynı kontrolü bekler (çift yayın olmaz).
function publishDueContentThrottled() {
  if (dueCheckInFlight) return dueCheckInFlight;
  const now = Date.now();
  if (now - lastDueCheck < DUE_CHECK_INTERVAL_MS) return Promise.resolve();
  lastDueCheck = now;
  dueCheckInFlight = publishDueContent()
    .catch((error) => console.error('Planlı içerik kontrolü başarısız:', error?.stack || error))
    .finally(() => { dueCheckInFlight = null; });
  return dueCheckInFlight;
}

module.exports = { runScheduledTasks, publishDueContentThrottled };
