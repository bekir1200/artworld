'use strict';
/* Süper Lig puan durumu ve maç programı.
   Kaynak: ESPN'in herkese açık (belgelenmemiş, resmî olmayan) site API'si. Anahtar istemez; biçimi
   haber vermeden değişebilir. Bu yüzden her hata yakalanır, son başarılı veri 15 dk önbellekte tutulur
   ve veri alınamazsa bölüm sayfada hiç çizilmez. ESPN'de yalnız Süper Lig (tur.1) var. */

const LEAGUE = 'tur.1';
const BASE = 'https://site.api.espn.com/apis';
const TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const TZ = 'Europe/Istanbul';
const MATCH_DAYS = 4; // bir hafta (cuma–pazartesi) çoğunlukla 3–4 maç günü

// ESPN takım adları Türkçe karaktersiz gelir; kelime kelime düzeltilir.
const WORD_FIX = {
  besiktas: 'Beşiktaş', kasimpasa: 'Kasımpaşa', fenerbahce: 'Fenerbahçe', basaksehir: 'Başakşehir',
  goztepe: 'Göztepe', caykur: 'Çaykur', genclerbirligi: 'Gençlerbirliği', genclerbirli: 'Gençlerbirliği',
  eyupspor: 'Eyüpspor', karagumruk: 'Karagümrük', istanbul: 'İstanbul', istanbulspor: 'İstanbulspor',
  ankaragucu: 'Ankaragücü', umraniyespor: 'Ümraniyespor', bandirmaspor: 'Bandırmaspor', igdir: 'Iğdır',
  corum: 'Çorum', sanliurfaspor: 'Şanlıurfaspor', eskisehirspor: 'Eskişehirspor', boluspor: 'Boluspor',
  keciorengucu: 'Keçiörengücü', erzurumspor: 'Erzurumspor'
};
// Kısaltma ya da farklı yazılan takımlar (ESPN takım kimliği → ad).
const TEAM_FIX = {
  7914: 'Başakşehir', 19267: 'Erzurumspor FK', 996: 'Gençlerbirliği', 20070: 'Gaziantep FK'
};

const NOTE_FIX = [
  [/^champions league qualifying/i, 'Şampiyonlar Ligi ön eleme'],
  [/^champions league/i, 'Şampiyonlar Ligi'],
  [/^europa league qualifying/i, 'Avrupa Ligi ön eleme'],
  [/^europa league/i, 'Avrupa Ligi'],
  [/^conference league qualifying/i, 'Konferans Ligi ön eleme'],
  [/^conference league/i, 'Konferans Ligi'],
  [/relegat/i, 'Küme düşme']
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

async function fetchStandings() {
  const data = await getJson(`/v2/sports/soccer/${LEAGUE}/standings`);
  const group = data && data.children && data.children[0];
  const entries = group && group.standings && Array.isArray(group.standings.entries) ? group.standings.entries : [];
  if (!entries.length) throw new Error('Puan tablosu boş');
  const rows = entries.map((entry) => ({
    rank: stat(entry, 'rank'),
    team: teamName(entry.team),
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
  const season = String((group && group.abbreviation) || '').replace('-', '/');
  return { season, rows };
}

function ymd(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date).replaceAll('-', '');
}

function toMatch(event) {
  const comp = event.competitions && event.competitions[0];
  if (!comp) return null;
  const side = (homeAway) => {
    const c = (comp.competitors || []).find((x) => x.homeAway === homeAway);
    return c ? { team: teamName(c.team), logo: safeLogo(c.team && c.team.logo), score: c.score === undefined ? '' : String(c.score) } : null;
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
    home,
    away
  };
}

// Maç programı: ESPN takviminden bugüne en yakın geçmiş ve gelecek maç günleri.
async function fetchFixtures(now = new Date()) {
  const board = await getJson(`/site/v2/sports/soccer/${LEAGUE}/scoreboard`);
  const calendar = (board.leagues && board.leagues[0] && board.leagues[0].calendar) || [];
  const today = ymd(now);
  const days = [...new Set(calendar.map((d) => ymd(new Date(d))))].sort();
  const past = days.filter((d) => d < today).slice(-MATCH_DAYS);
  const next = days.filter((d) => d >= today).slice(0, MATCH_DAYS);
  const results = await Promise.allSettled([...past, ...next].map((d) => getJson(`/site/v2/sports/soccer/${LEAGUE}/scoreboard?dates=${d}`)));
  const matches = [];
  const seen = new Set();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value.events || []) {
      const match = toMatch(event);
      if (match && !seen.has(match.id)) { seen.add(match.id); matches.push(match); }
    }
  }
  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    recent: matches.filter((m) => m.state === 'post').slice(-9),
    live: matches.filter((m) => m.state === 'in'),
    upcoming: matches.filter((m) => m.state === 'pre').slice(0, 9)
  };
}

const cache = { value: null, expiresAt: 0, promise: null };

// { season, rows, recent, live, upcoming, updatedAt } ya da null. Hata atmaz.
async function loadFootball() {
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  if (!cache.promise) {
    cache.promise = Promise.allSettled([fetchStandings(), fetchFixtures()])
      .then(([standings, fixtures]) => {
        if (standings.status === 'rejected') console.warn(`[football] puan durumu alınamadı: ${standings.reason && standings.reason.message}`);
        if (fixtures.status === 'rejected') console.warn(`[football] maç programı alınamadı: ${fixtures.reason && fixtures.reason.message}`);
        if (standings.status === 'rejected' && fixtures.status === 'rejected') return cache.value; // eski veri (varsa) kalsın
        const value = {
          league: 'Trendyol Süper Lig',
          season: standings.status === 'fulfilled' ? standings.value.season : (cache.value && cache.value.season) || '',
          rows: standings.status === 'fulfilled' ? standings.value.rows : (cache.value && cache.value.rows) || [],
          ...(fixtures.status === 'fulfilled' ? fixtures.value : { recent: [], live: [], upcoming: [] }),
          updatedAt: new Date().toISOString()
        };
        cache.value = value;
        cache.expiresAt = Date.now() + (standings.status === 'fulfilled' && fixtures.status === 'fulfilled' ? TTL_MS : 60 * 1000);
        return value;
      })
      .catch(() => cache.value)
      .finally(() => { cache.promise = null; });
  }
  return cache.promise;
}

module.exports = { loadFootball, teamName };
