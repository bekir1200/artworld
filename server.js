require('./config/env');
const http = require('node:http');
const { handleRequest } = require('./site-handler');
const { runScheduledTasks } = require('./routes/scheduled-tasks');

// Vercel bu dosyayı bir işleyici (handler) olarak alır: yalnızca handleRequest dışa aktarılır.
// Sunucu ve zamanlayıcılar yalnızca "npm start" (node server.js) ile doğrudan çalıştırıldığında başlar.
module.exports = handleRequest;

if (require.main === module) {
  const port = Number(process.env.PORT || 3003);
  http.createServer(handleRequest).listen(port, () => console.log(`Art World TV hazır: http://localhost:${port}`));

  const scheduleTimer = setInterval(() => {
    runScheduledTasks().catch((error) => console.error('Zamanlanmış işler çalıştırılamadı:', error?.stack || error));
  }, 60_000);
  scheduleTimer.unref();
}
