const pool = require('../db/pool');

// Site ayarlarının varsayılanları. Anahtarlar site_settings tablosunda saklanır;
// tabloda kaydı olmayan anahtar için bu değerler geçerlidir.
const DEFAULTS = {
  'module.comments': 'on',
  'module.polls': 'on',
  'module.visitorPosts': 'on',
  'module.horoscope': 'on',
  'module.movies': 'on',
  'module.breaking': 'on',
  'module.strip': 'on',
  'module.featured': 'on',
  'module.fx': 'on',
  'module.columnists': 'on',
  'module.photos': 'on',
  'module.videos': 'on',
  'module.announcements': 'on',
  'module.liveButton': 'on',
  'live.url': '',
  'module.weather': 'on',
  'module.prayer': 'on',
  'module.local': 'on',
  'module.popup': 'off',
  'module.pharmacy': 'off',
  'module.papers': 'off',
  'module.standings': 'on',
  'module.onlinePaper': 'off',
  'module.lottery': 'off',
  'module.directory': 'off',
  'module.traffic': 'off',
  'blog.1': 'kultur-sanat',
  'blog.2': 'spor',
  'numbered.category': '',
  'tabs.categories': '',
  'module.city': 'Antalya',
  'league.default': 'super-lig',
  'popup.hours': '24',
  'theme.primary': '',
  'theme.accent': '',
  'theme.defaultDark': 'off',
  'cron.botsEnabled': 'on',
  'cron.botIntervalMinutes': '30',
  'social.fb': '',
  'social.x': '',
  'social.ig': '',
  'social.yt': '',
  'social.li': '',
  'social.tumblr': '',
  'social.wa': '',
  'social.tg': '',
  'social.pin': ''
};

// Veri kaynağı henüz bağlanmadığı için her zaman 'off' kalan modüller.
const PENDING_MODULE_KEYS = [
  'module.pharmacy', 'module.papers', 'module.onlinePaper',
  'module.lottery', 'module.directory', 'module.traffic'
];

// Plaka sırasıyla 81 il (01 Adana ... 81 Düzce).
const CITIES = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir',
  'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir',
  'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir',
  'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman',
  'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye',
  'Düzce'
];

const KEYS = Object.keys(DEFAULTS);
const TTL_MS = 10000;
const ERROR_BACKOFF_MS = 5000;

// cache.values her zaman "son bilinen" değerleri tutar; expiresAt yenileme zamanıdır.
let cache = { values: { ...DEFAULTS }, expiresAt: 0 };
let inflight = null;

async function loadFromDb() {
  const { rows } = await pool.query(
    'SELECT setting_key, setting_value FROM site_settings WHERE setting_key = ANY($1::text[])',
    [KEYS]
  );
  const values = { ...DEFAULTS };
  for (const row of rows) {
    values[row.setting_key] = String(row.setting_value);
  }
  // API bağlanana kadar bu modüller DB'de ne yazarsa yazsın kapalı kalır.
  for (const key of PENDING_MODULE_KEYS) values[key] = 'off';
  return values;
}

// Asla throw etmez: DB hatasında son bilinen değerler (ilk durumda DEFAULTS) döner.
async function getSettings() {
  if (cache.expiresAt > Date.now()) return { ...cache.values };

  if (!inflight) {
    inflight = loadFromDb()
      .then((values) => {
        cache = { values, expiresAt: Date.now() + TTL_MS };
        return cache.values;
      })
      .catch((error) => {
        console.error('Site ayarları okunamadı, son bilinen değerler kullanılıyor:', error.message);
        cache = { values: cache.values, expiresAt: Date.now() + ERROR_BACKOFF_MS };
        return cache.values;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return { ...(await inflight) };
}

// Senkron: son bilinen değerler; henüz yüklenmediyse DEFAULTS.
function getCachedSettings() {
  return { ...cache.values };
}

// Bir sonraki getSettings çağrısında DB'den yeniden okunmasını sağlar.
function invalidate() {
  cache = { values: cache.values, expiresAt: 0 };
}

module.exports = { DEFAULTS, PENDING_MODULE_KEYS, CITIES, getSettings, getCachedSettings, invalidate };
