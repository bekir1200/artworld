'use strict';
/* Futbol: lig puan durumları, maç programları ve Türk takımlarının Avrupa maçları.
   Kaynak: ESPN'in herkese açık (belgelenmemiş, resmî olmayan) site API'si. Anahtar istemez; biçimi
   haber vermeden değişebilir. Bu yüzden her hata yakalanır, son başarılı veri lig başına 15 dk
   önbellekte tutulur ve veri alınamazsa ilgili bölüm sayfada çizilmez. */

const BASE = 'https://site.api.espn.com/apis';
const TTL_MS = 15 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const TZ = 'Europe/Istanbul';
const MATCH_DAYS = 4;            // ligde bir hafta çoğunlukla 3–4 maç günü
const CUP_PAST_DAYS = 14;        // kupalarda geriye bakılan gün
const CUP_NEXT_DAYS = 21;        // kupalarda ileriye bakılan gün
const CUP_WEEKDAYS = new Set([2, 3, 4]); // UEFA maçları salı–perşembe

// Sayfa sekmeleri bu sırayla çizilir. key: adres (/puan-durumu/<key>), slug: ESPN lig kodu.
const LEAGUES = [
  { key: 'super-lig', slug: 'tur.1', name: 'Trendyol Süper Lig', short: 'Süper Lig', type: 'league' },
  { key: 'premier-lig', slug: 'eng.1', name: 'İngiltere Premier Lig', short: 'Premier Lig', type: 'league' },
  { key: 'la-liga', slug: 'esp.1', name: 'İspanya LaLiga', short: 'LaLiga', type: 'league' },
  { key: 'serie-a', slug: 'ita.1', name: 'İtalya Serie A', short: 'Serie A', type: 'league' },
  { key: 'bundesliga', slug: 'ger.1', name: 'Almanya Bundesliga', short: 'Bundesliga', type: 'league' },
  { key: 'ligue-1', slug: 'fra.1', name: 'Fransa Ligue 1', short: 'Ligue 1', type: 'league' },
  { key: 'sampiyonlar-ligi', slug: 'uefa.champions', name: 'UEFA Şampiyonlar Ligi', short: 'Şampiyonlar Ligi', type: 'cup' },
  { key: 'avrupa-ligi', slug: 'uefa.europa', name: 'UEFA Avrupa Ligi', short: 'Avrupa Ligi', type: 'cup' },
  { key: 'konferans-ligi', slug: 'uefa.europa.conf', name: 'UEFA Konferans Ligi', short: 'Konferans Ligi', type: 'cup' }
];
const LEAGUE_BY_KEY = new Map(LEAGUES.map((l) => [l.key, l]));
const CUPS = LEAGUES.filter((l) => l.type === 'cup');

// Süper Lig tablosu alınamazsa da tanınsın diye bilinen Türk takımı ESPN kimlikleri.
const KNOWN_TURKISH_IDS = ['432', '436', '1895', '997', '7914', '6870', '789', '7656', '996', '20729', '9078', '7648', '11429', '20070', '995', '19267', '132334', '132335'];

// ESPN takım adları Türkçe karaktersiz gelir; kelime kelime düzeltilir.
const WORD_FIX = {
  besiktas: 'Beşiktaş', kasimpasa: 'Kasımpaşa', fenerbahce: 'Fenerbahçe', basaksehir: 'Başakşehir',
  goztepe: 'Göztepe', caykur: 'Çaykur', genclerbirligi: 'Gençlerbirliği', genclerbirli: 'Gençlerbirliği',
  eyupspor: 'Eyüpspor', karagumruk: 'Karagümrük', istanbulspor: 'İstanbulspor',
  ankaragucu: 'Ankaragücü', umraniyespor: 'Ümraniyespor', bandirmaspor: 'Bandırmaspor', igdir: 'Iğdır',
  corum: 'Çorum', sanliurfaspor: 'Şanlıurfaspor', eskisehirspor: 'Eskişehirspor',
  keciorengucu: 'Keçiörengücü', erzurumspor: 'Erzurumspor'
};
// Kısaltma ya da farklı yazılan takımlar (ESPN takım kimliği → ad).
const TEAM_FIX = { 7914: 'Başakşehir', 19267: 'Erzurumspor FK', 996: 'Gençlerbirliği', 20070: 'Gaziantep FK' };

// Tablo notları (sıra renkleri). Sıra önemli: özel olan önce.
const NOTE_FIX = [
  [/^champions league qualifying/i, 'Şampiyonlar Ligi ön eleme'],
  [/^champions league/i, 'Şampiyonlar Ligi'],
  [/^europa league qualifying/i, 'Avrupa Ligi ön eleme'],
  [/^europa league/i, 'Avrupa Ligi'],
  [/^conference league qualifying/i, 'Konferans Ligi ön eleme'],
  [/^conference league/i, 'Konferans Ligi'],
  [/relegation playoff/i, 'Küme düşme play-off'],
  [/relegat/i, 'Küme düşme'],
  [/round of 16/i, 'Son 16 turu'],
  [/playoffs? - seeded/i, 'Play-off turu (seri başı)'],
  [/playoffs? - unseeded/i, 'Play-off turu'],
  [/playoff/i, 'Play-off turu'],
  [/eliminated/i, 'Elendi']
];

function teamName(team) {
  if (!team) return '';
  if (TEAM_FIX[team.id]) return TEAM_FIX[team.id];
  return String(team.displayName || team.shortDisplayName || '')
    .split(' ')
    .map((word) => WORD_FIX[word.toLowerCase()] || word)
    .join(' ');
}

function noteText(note) {
  const raw = note && note.description ? String(note.description) : '';
  if (!raw) return '';
  const hit = NOTE_FIX.find(([pattern]) => pattern.test(raw));
  return hit ? hit[1] : raw;
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : '';
}

function safeLogo(value) {
  return /^https:\/\/a\.espncdn\.com\/[\w./-]+\.png$/.test(String(value || '')) ? value : '';
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (news-site standings widget)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function stat(entry, name) {
  const item = (entry.stats || []).find((s) => s.name === name);
  const n = item ? Number(item.value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// ---------- Türk takımları ----------
const turkish = { ids: new Set(KNOWN_TURKISH_IDS) };
function isTurkish(teamId) {
  return turkish.ids.has(String(teamId));
}

async function fetchStandings(league) {
  const data = await getJson(`/v2/sports/soccer/${league.slug}/standings`);
  const group = data && data.children && data.children[0];
  const entries = group && group.standings && Array.isArray(group.standings.entries) ? group.standings.entries : [];
  if (!entries.length) throw new Error('Puan tablosu boş');
  // Süper Lig tablosundaki takımlar Türk takımı listesine eklenir (terfi edenler dahil).
  if (league.slug === 'tur.1') entries.forEach((entry) => entry.team && turkish.ids.add(String(entry.team.id)));
  const rows = entries.map((entry) => ({
    rank: stat(entry, 'rank'),
    team: teamName(entry.team),
    teamId: entry.team ? String(entry.team.id) : '',
    turkish: league.slug !== 'tur.1' && Boolean(entry.team && isTurkish(entry.team.id)),
    logo: safeLogo(entry.team && entry.team.logos && entry.team.logos[0] && entry.team.logos[0].href),
    played: stat(entry, 'gamesPlayed'),
    won: stat(entry, 'wins'),
    drawn: stat(entry, 'ties'),
    lost: stat(entry, 'losses'),
    goalsFor: stat(entry, 'pointsFor'),
    goalsAgainst: stat(entry, 'pointsAgainst'),
    goalDiff: stat(entry, 'pointDifferential'),
    points: stat(entry, 'points'),
    note: noteText(entry.note),
    noteColor: safeColor(entry.note && entry.note.color)
  })).sort((a, b) => a.rank - b.rank);
  const label = String((group && (group.abbreviation || group.name)) || '');
  const seasonMatch = label.match(/(\d{4})[-/](\d{2,4})/);
  const season = seasonMatch ? `${seasonMatch[1]}/${seasonMatch[2].length === 2 ? `20${seasonMatch[2]}` : seasonMatch[2]}` : '';
  const stage = league.type === 'cup' && group && group.name && !/\d{4}/.test(group.name) ? String(group.name) : '';
  return { season, stage: /league phase/i.test(stage) ? 'Lig aşaması' : stage, rows };
}

function ymd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date).replaceAll('-', '');
}

function weekdayOf(date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

function toMatch(event, league) {
  const comp = event.competitions && event.competitions[0];
  if (!comp) return null;
  const side = (homeAway) => {
    const c = (comp.competitors || []).find((x) => x.homeAway === homeAway);
    if (!c) return null;
    return {
      team: teamName(c.team),
      teamId: c.team ? String(c.team.id) : '',
      // Süper Lig'de her takım Türk; vurgu yalnız Avrupa ligleri ve kupalarında anlamlı.
      turkish: league.slug !== 'tur.1' && Boolean(c.team && isTurkish(c.team.id)),
      logo: safeLogo(c.team && c.team.logo),
      score: c.score === undefined ? '' : String(c.score)
    };
  };
  const home = side('home');
  const away = side('away');
  if (!home || !away) return null;
  const type = (event.status && event.status.type) || {};
  return {
    id: String(event.id),
    date: event.date,
    state: type.state === 'post' ? 'post' : type.state === 'in' ? 'in' : 'pre',
    postponed: /postpon|cancel/i.test(type.name || ''),
    clock: event.status && event.status.displayClock ? String(event.status.displayClock) : '',
    venue: comp.venue && comp.venue.fullName ? String(comp.venue.fullName) : '',
    competition: league.short,
    competitionKey: league.key,
    home,
    away
  };
}

// Sorgulanacak günler: ligde ESPN takviminden en yakın maç günleri; kupalarda salı–perşembe günleri.
async function fixtureDays(league, now) {
  const today = ymd(now);
  if (league.type === 'cup') {
    const days = [];
    for (let offset = -CUP_PAST_DAYS; offset <= CUP_NEXT_DAYS; offset += 1) {
      const day = new Date(now.getTime() + offset * 86400000);
      if (CUP_WEEKDAYS.has(weekdayOf(day))) days.push(ymd(day));
    }
    return days;
  }
  const board = await getJson(`/site/v2/sports/soccer/${league.slug}/scoreboard`);
  const calendar = (board.leagues && board.leagues[0] && board.leagues[0].calendar) || [];
  const days = [...new Set(calendar.filter((d) => typeof d === 'string').map((d) => ymd(new Date(d))))].sort();
  return [...days.filter((d) => d < today).slice(-MATCH_DAYS), ...days.filter((d) => d >= today).slice(0, MATCH_DAYS)];
}

async function fetchFixtures(league, now = new Date()) {
  const days = await fixtureDays(league, now);
  const results = await Promise.allSettled(days.map((d) => getJson(`/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${d}`)));
  if (results.length && results.every((r) => r.status === 'rejected')) throw new Error('Maç günleri alınamadı');
  const matches = [];
  const seen = new Set();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value.events || []) {
      const match = toMatch(event, league);
      if (match && !seen.has(match.id)) { seen.add(match.id); matches.push(match); }
    }
  }
  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  const limit = league.type === 'cup' ? 40 : 12;
  return {
    recent: matches.filter((m) => m.state === 'post').slice(-limit),
    live: matches.filter((m) => m.state === 'in'),
    upcoming: matches.filter((m) => m.state === 'pre').slice(0, limit)
  };
}

// ---------- Önbellek (lig başına) ----------
const caches = new Map();

function cachedLoad(key, loader) {
  let entry = caches.get(key);
  if (!entry) { entry = { value: null, expiresAt: 0, promise: null }; caches.set(key, entry); }
  if (entry.value && entry.expiresAt > Date.now()) return Promise.resolve(entry.value);
  if (!entry.promise) {
    entry.promise = loader(entry.value)
      .then(({ value, complete }) => {
        if (value) {
          entry.value = value;
          entry.expiresAt = Date.now() + (complete ? TTL_MS : RETRY_MS);
        }
        return entry.value;
      })
      .catch(() => entry.value)
      .finally(() => { entry.promise = null; });
  }
  return entry.promise;
}

// Bir ligin verisi: { league, season, stage, rows, recent, live, upcoming, updatedAt } ya da null.
function loadLeague(key) {
  const league = LEAGUE_BY_KEY.get(key);
  if (!league) return Promise.resolve(null);
  return cachedLoad(`league:${key}`, async (previous) => {
    // Kupalarda Türk takımlarını tanımak için Süper Lig tablosu önce yüklenmiş olsun.
    if (league.type === 'cup') await loadLeague('super-lig');
    const [standings, fixtures] = await Promise.allSettled([fetchStandings(league), fetchFixtures(league)]);
    if (standings.status === 'rejected') console.warn(`[football] ${league.slug} puan durumu alınamadı: ${standings.reason && standings.reason.message}`);
    if (fixtures.status === 'rejected') console.warn(`[football] ${league.slug} maç programı alınamadı: ${fixtures.reason && fixtures.reason.message}`);
    if (standings.status === 'rejected' && fixtures.status === 'rejected') return { value: previous, complete: false };
    const value = {
      league: { key: league.key, name: league.name, short: league.short, type: league.type },
      season: standings.status === 'fulfilled' ? standings.value.season : (previous && previous.season) || '',
      stage: standings.status === 'fulfilled' ? standings.value.stage : (previous && previous.stage) || '',
      rows: standings.status === 'fulfilled' ? standings.value.rows : (previous && previous.rows) || [],
      ...(fixtures.status === 'fulfilled' ? fixtures.value : (previous ? { recent: previous.recent, live: previous.live, upcoming: previous.upcoming } : { recent: [], live: [], upcoming: [] })),
      updatedAt: new Date().toISOString()
    };
    return { value, complete: standings.status === 'fulfilled' && fixtures.status === 'fulfilled' };
  });
}

// Süper Lig (ana sayfa bölümü için geriye dönük ad).
function loadFootball() {
  return loadLeague('super-lig');
}

// Türk takımlarının Avrupa kupalarındaki maçları ve kupa tablolarındaki yerleri.
async function loadTurkishEurope() {
  const cups = await Promise.all(CUPS.map((cup) => loadLeague(cup.key)));
  const available = cups.filter(Boolean);
  if (!available.length) return null;
  const involves = (m) => m.home.turkish || m.away.turkish;
  const all = (field) => available.flatMap((c) => c[field].filter(involves)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const teams = available.flatMap((c) => c.rows.filter((r) => r.turkish).map((r) => ({ ...r, competition: c.league.short, competitionKey: c.league.key })));
  return {
    recent: all('recent'),
    live: all('live'),
    upcoming: all('upcoming'),
    teams,
    updatedAt: available.map((c) => c.updatedAt).sort().pop()
  };
}

function leagueList() {
  return LEAGUES.map(({ key, name, short, type }) => ({ key, name, short, type }));
}

module.exports = { loadFootball, loadLeague, loadTurkishEurope, leagueList, teamName, isTurkish };
