// Zamanlanmış işler tek yerde toplanır: yerel sunucu (server.js) aralıklı çalıştırır,
// Vercel ise /api/cron/run adresini zamanlayıcıdan çağırarak aynı işleri yürütür.
const { publishScheduledArticles } = require('./api');
const { publishDue } = require('./scheduler');
const { runDueBots } = require('./bot-runner');

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

module.exports = { runScheduledTasks };
