'use strict';
/* Futbol HTML'i: ana sayfa bölümü (bsx-sections-2), /puan-durumu spor merkezi sayfaları
   (public-modules) ve Spor kategorisindeki lig şeridi aynı parçaları kullanır.
   Stil: public/football.css (parçayla birlikte bağlanır). */

const STYLE = '<link rel="stylesheet" href="/football.css">';
const TZ = 'Europe/Istanbul';
const BASE_PATH = '/puan-durumu';
const EUROPE_KEY = 'turk-takimlari';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function logo(src) {
  return src ? `<img class="fb-logo" src="${esc(src)}" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer">` : '<span class="fb-logo fb-logo-empty" aria-hidden="true"></span>';
}

const dayFormat = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const timeFormat = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

function dayOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dayFormat.format(d);
}

function timeOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFormat.format(d);
}

function leagueHref(key) {
  return key === 'super-lig' ? BASE_PATH : `${BASE_PATH}/${key}`;
}

// Lig sekmeleri: Süper Lig, Türk takımları Avrupa'da, Avrupa ligleri, UEFA kupaları.
function tabsNav(leagues, activeKey) {
  const item = (key, label) => `<a class="fb-tab${key === activeKey ? ' is-active' : ''}" href="${esc(leagueHref(key))}"${key === activeKey ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  const domestic = leagues.filter((l) => l.key === 'super-lig').map((l) => item(l.key, l.short));
  const europe = item(EUROPE_KEY, 'Türk Takımları Avrupa’da');
  const leaguesHtml = leagues.filter((l) => l.type === 'league' && l.key !== 'super-lig').map((l) => item(l.key, l.short));
  const cups = leagues.filter((l) => l.type === 'cup').map((l) => item(l.key, l.short));
  return `<nav class="fb-tabs" aria-label="Ligler ve kupalar">`
    + `<div class="fb-tab-group"><span class="fb-tab-label">Türkiye</span>${domestic.join('')}${europe}</div>`
    + `<div class="fb-tab-group"><span class="fb-tab-label">Avrupa ligleri</span>${leaguesHtml.join('')}</div>`
    + `<div class="fb-tab-group"><span class="fb-tab-label">UEFA kupaları</span>${cups.join('')}</div></nav>`;
}

// Puan tablosu. compact: ana sayfa (O, AV, P); tam: O G B M A Y AV P. Türk takımı satırı vurgulanır.
function standingsTable(rows, { compact = false, limit = 0 } = {}) {
  const list = limit ? rows.slice(0, limit) : rows;
  if (!list.length) return '';
  const head = compact
    ? '<tr><th scope="col" class="fb-num">#</th><th scope="col">Takım</th><th scope="col" title="Oynanan">O</th><th scope="col" title="Averaj">AV</th><th scope="col" title="Puan">P</th></tr>'
    : '<tr><th scope="col" class="fb-num">#</th><th scope="col">Takım</th><th scope="col" title="Oynanan">O</th><th scope="col" title="Galibiyet">G</th><th scope="col" title="Beraberlik">B</th><th scope="col" title="Mağlubiyet">M</th><th scope="col" title="Attığı gol">A</th><th scope="col" title="Yediği gol">Y</th><th scope="col" title="Averaj">AV</th><th scope="col" title="Puan">P</th></tr>';
  const body = list.map((r) => {
    const mark = r.noteColor ? ` style="--fb-mark:${esc(r.noteColor)}"` : '';
    const title = r.note ? ` title="${esc(r.note)}"` : '';
    const diff = r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff);
    const cells = compact
      ? `<td>${r.played}</td><td>${esc(diff)}</td>`
      : `<td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${esc(diff)}</td>`;
    const flag = r.turkish ? '<span class="fb-flag" title="Türk takımı" aria-label="Türk takımı">TR</span>' : '';
    return `<tr${mark}${title}${r.turkish ? ' class="fb-row-tr"' : ''}><td class="fb-num${r.noteColor ? ' fb-marked' : ''}">${r.rank}</td><th scope="row" class="fb-team">${logo(r.logo)}<span>${esc(r.team)}</span>${flag}</th>${cells}<td class="fb-pts">${r.points}</td></tr>`;
  }).join('');
  return `<div class="fb-table-wrap"><table class="fb-table${compact ? ' fb-table-compact' : ''}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// Tablo altındaki renk açıklaması (Şampiyonlar Ligi, küme düşme …).
function legend(rows) {
  const seen = new Map();
  rows.forEach((r) => { if (r.note && r.noteColor && !seen.has(r.note)) seen.set(r.note, r.noteColor); });
  if (!seen.size) return '';
  return `<ul class="fb-legend">${[...seen].map(([note, color]) => `<li><span style="--fb-mark:${esc(color)}"></span>${esc(note)}</li>`).join('')}</ul>`;
}

function sideHtml(side, align) {
  const name = `<span class="fb-name${side.turkish ? ' fb-name-tr' : ''}">${esc(side.team)}</span>`;
  return align === 'home' ? `${name}${logo(side.logo)}` : `${logo(side.logo)}${name}`;
}

function matchRow(m, { showCompetition = false } = {}) {
  let middle;
  if (m.postponed) middle = '<span class="fb-score fb-score-pre">Ert.</span>';
  else if (m.state === 'pre') middle = `<span class="fb-score fb-score-pre">${esc(timeOf(m.date))}</span>`;
  else middle = `<span class="fb-score${m.state === 'in' ? ' fb-score-live' : ''}">${esc(m.home.score)} - ${esc(m.away.score)}</span>`;
  const extra = [];
  if (m.state === 'in') extra.push(`<span class="fb-live">CANLI${m.clock ? ` ${esc(m.clock)}` : ''}</span>`);
  if (showCompetition && m.competition) extra.push(`<span class="fb-comp">${esc(m.competition)}</span>`);
  const turkishMatch = m.home.turkish || m.away.turkish;
  return `<li class="fb-match${turkishMatch ? ' fb-match-tr' : ''}"><span class="fb-side fb-home">${sideHtml(m.home, 'home')}</span>${middle}<span class="fb-side fb-away">${sideHtml(m.away, 'away')}</span>${extra.length ? `<span class="fb-extra">${extra.join('')}</span>` : ''}</li>`;
}

// Maçları güne göre gruplar.
function matchList(matches, options = {}) {
  if (!matches.length) return '';
  const groups = [];
  matches.forEach((m) => {
    const day = dayOf(m.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m); else groups.push({ day, items: [m] });
  });
  return groups.map((g) => `<div class="fb-day"><h4 class="fb-day-title">${esc(g.day)}</h4><ul class="fb-matches">${g.items.map((m) => matchRow(m, options)).join('')}</ul></div>`).join('');
}

function source(data) {
  const time = data && data.updatedAt ? timeOf(data.updatedAt) : '';
  return `<p class="fb-source">Kaynak: ESPN${time ? ` · Güncelleme ${esc(time)}` : ''}</p>`;
}

// Lig kısayolları (ana sayfa ve Spor kategorisi için).
function leagueChips(leagues) {
  const chips = [`<a class="fb-chip fb-chip-tr" href="${esc(leagueHref(EUROPE_KEY))}">Türk Takımları Avrupa’da</a>`]
    .concat(leagues.map((l) => `<a class="fb-chip" href="${esc(leagueHref(l.key))}">${esc(l.short)}</a>`));
  return `<nav class="fb-chips" aria-label="Puan durumu ve fikstür">${chips.join('')}</nav>`;
}

// Ana sayfa bölümü içeriği (başlık dışı): Süper Lig tablosu + sıradaki maçlar + Türk takımları Avrupa'da.
function homeBlock(data, { europe = null, leagues = [] } = {}) {
  if (!data || (!data.rows.length && !data.upcoming.length && !data.recent.length)) return '';
  const fixtures = data.live.length ? data.live.concat(data.upcoming).slice(0, 6) : data.upcoming.slice(0, 6);
  const fixturesTitle = data.live.length ? 'Canlı ve sıradaki maçlar' : 'Sıradaki maçlar';
  const matches = fixtures.length
    ? `<h3 class="fb-col-title">${fixturesTitle}</h3>${matchList(fixtures)}`
    : (data.recent.length ? `<h3 class="fb-col-title">Son sonuçlar</h3>${matchList(data.recent.slice(-6))}` : '');
  const euroMatches = europe ? europe.live.concat(europe.upcoming).slice(0, 4) : [];
  const euroLast = europe && !euroMatches.length ? europe.recent.slice(-4) : [];
  const euroHtml = euroMatches.length || euroLast.length
    ? `<div class="fb-euro"><h3 class="fb-col-title">Türk takımları Avrupa’da</h3>${matchList(euroMatches.length ? euroMatches : euroLast, { showCompetition: true })}<a class="fb-more" href="${esc(leagueHref(EUROPE_KEY))}">Tüm Avrupa maçları ›</a></div>`
    : '';
  const table = data.rows.length ? `<h3 class="fb-col-title">${esc(data.league.name)}${data.season ? ` ${esc(data.season)}` : ''}</h3>${standingsTable(data.rows, { compact: true })}` : '';
  return `${STYLE}<div class="fb-home"><div class="fb-col">${table}</div><div class="fb-col">${matches}<a class="fb-more" href="${BASE_PATH}">Tüm tablo ve sonuçlar ›</a>${euroHtml}</div></div>`
    + `${leagues.length ? leagueChips(leagues) : ''}${source(data)}`;
}

// Bir lig ya da kupa sayfası.
function leaguePage(data) {
  const isCup = data.league.type === 'cup';
  const parts = [];
  if (isCup) {
    const involves = (m) => m.home.turkish || m.away.turkish;
    const trMatches = data.live.concat(data.upcoming).filter(involves).concat(data.recent.filter(involves).reverse());
    if (trMatches.length) parts.push(`<section class="fb-block fb-block-tr"><h2>Türk takımlarının maçları</h2>${matchList(data.live.concat(data.upcoming).filter(involves))}${matchList(data.recent.filter(involves).slice().reverse())}</section>`);
  }
  const tableTitle = `${isCup ? (data.stage || 'Puan durumu') : 'Puan durumu'}${data.season ? ` · ${esc(data.season)}` : ''}`;
  const table = data.rows.length ? `${standingsTable(data.rows)}${legend(data.rows)}` : '<p class="public-empty">Puan durumu şu an alınamadı.</p>';
  parts.push(`<section class="fb-block"><h2>${tableTitle}</h2>${table}</section>`);
  const upcoming = data.live.concat(data.upcoming);
  parts.push(`<div class="fb-page-cols"><section class="fb-block"><h2>Fikstür</h2>${upcoming.length ? matchList(upcoming) : '<p class="public-empty">Yakın tarihte maç yok.</p>'}</section>`
    + `<section class="fb-block"><h2>Son sonuçlar</h2>${data.recent.length ? matchList(data.recent.slice().reverse()) : '<p class="public-empty">Sonuç bulunamadı.</p>'}</section></div>`);
  return parts.join('');
}

// Türk takımları Avrupa'da sayfası.
function europePage(europe) {
  if (!europe) return '<p class="public-empty">Avrupa kupası verisi şu an alınamadı.</p>';
  const teams = europe.teams.length
    ? `<ul class="fb-tr-teams">${europe.teams.map((t) => `<li><a href="${esc(leagueHref(t.competitionKey))}">${logo(t.logo)}<span class="fb-tr-team">${esc(t.team)}</span><span class="fb-tr-comp">${esc(t.competition)}</span><span class="fb-tr-rank">${t.rank}. sıra · ${t.points} puan</span>${t.note ? `<span class="fb-tr-note">${esc(t.note)}</span>` : ''}</a></li>`).join('')}</ul>`
    : '';
  const upcoming = europe.live.concat(europe.upcoming);
  return `${teams ? `<section class="fb-block"><h2>Kupalardaki durum</h2>${teams}</section>` : ''}`
    + `<div class="fb-page-cols"><section class="fb-block"><h2>Sıradaki maçlar</h2>${upcoming.length ? matchList(upcoming, { showCompetition: true }) : '<p class="public-empty">Yakın tarihte Türk takımının Avrupa maçı yok.</p>'}</section>`
    + `<section class="fb-block"><h2>Son sonuçlar</h2>${europe.recent.length ? matchList(europe.recent.slice().reverse(), { showCompetition: true }) : '<p class="public-empty">Son iki haftada Avrupa maçı oynanmadı.</p>'}</section></div>`;
}

// /puan-durumu sayfa içeriği: sekmeler + seçili lig (ya da Türk takımları Avrupa'da).
function pageBlock({ leagues, activeKey, data, europe }) {
  const body = activeKey === EUROPE_KEY ? europePage(europe) : (data ? leaguePage(data) : '<p class="public-empty">Bu lig için veri şu an alınamadı. Lütfen biraz sonra tekrar deneyin.</p>');
  return `${STYLE}<div class="fb-page">${tabsNav(leagues, activeKey)}${body}${source(activeKey === EUROPE_KEY ? europe : data)}</div>`;
}

module.exports = { homeBlock, pageBlock, leagueChips, standingsTable, matchList, EUROPE_KEY, BASE_PATH };
