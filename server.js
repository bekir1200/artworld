require('./config/env');
const http = require('node:http');
const { handleRequest } = require('./app');
const { runScheduledTasks } = require('./routes/scheduled-tasks');

const port = Number(process.env.PORT || 3003);

// Yerel geliştirme ve kendi sunucunuz için: istekleri dinler, zamanlanmış işleri aralıklı çalıştırır.
// Vercel bu dosyayı kullanmaz; api/index.js yalnızca app.js'i dışa aktarır.
http.createServer(handleRequest).listen(port, () => console.log(`Art World TV hazır: http://localhost:${port}`));

const scheduleTimer = setInterval(() => {
  runScheduledTasks().catch((error) => console.error('Zamanlanmış işler çalıştırılamadı:', error?.stack || error));
}, 60_000);
scheduleTimer.unref();
