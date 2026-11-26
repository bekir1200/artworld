'use strict';
/* Puan durumu ve maç programı HTML'i: ana sayfa bölümü (bsx-sections-2) ve /puan-durumu sayfası
   (public-modules) aynı parçaları kullanır. Stil: public/football.css (parçayla birlikte bağlanır). */

const STYLE = '<link rel="stylesheet" href="/football.css">';
const TZ = 'Europe/Istanbul';

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

// Puan tablosu. compact: ana sayfa (O, AV, P); tam: O G B M A Y AV P.
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
    return `<tr${mark}${title}><td class="fb-num${r.noteColor ? ' fb-marked' : ''}">${r.rank}</td><th scope="row" class="fb-team">${logo(r.logo)}<span>${esc(r.team)}</span></th>${cells}<td class="fb-pts">${r.points}</td></tr>`;
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

function matchRow(m) {
  let middle;
  if (m.postponed) middle = '<span class="fb-score fb-score-pre">Ert.</span>';
  else if (m.state === 'pre') middle = `<span class="fb-score fb-score-pre">${esc(timeOf(m.date))}</span>`;
  else middle = `<span class="fb-score${m.state === 'in' ? ' fb-score-live' : ''}">${esc(m.home.score)} - ${esc(m.away.score)}</span>`;
  const live = m.state === 'in' ? `<span class="fb-live">CANLI${m.clock ? ` ${esc(m.clock)}` : ''}</span>` : '';
  return `<li class="fb-match"><span class="fb-side fb-home"><span>${esc(m.home.team)}</span>${logo(m.home.logo)}</span>${middle}<span class="fb-side fb-away">${logo(m.away.logo)}<span>${esc(m.away.team)}</span></span>${live}</li>`;
}

// Maçları güne göre gruplar.
function matchList(matches) {
  if (!matches.length) return '';
  const groups = [];
  matches.forEach((m) => {
    const day = dayOf(m.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m); else groups.push({ day, items: [m] });
  });
  return groups.map((g) => `<div class="fb-day"><h4 class="fb-day-title">${esc(g.day)}</h4><ul class="fb-matches">${g.items.map(matchRow).join('')}</ul></div>`).join('');
}

function source(data) {
  const time = data.updatedAt ? timeOf(data.updatedAt) : '';
  return `<p class="fb-source">Kaynak: ESPN${time ? ` · Güncelleme ${esc(time)}` : ''}</p>`;
}

// Ana sayfa bölümü içeriği (başlık dışı): solda kısa tablo, sağda maçlar.
function homeBlock(data) {
  if (!data || (!data.rows.length && !data.upcoming.length && !data.recent.length)) return '';
  const fixtures = data.live.length ? data.live.concat(data.upcoming).slice(0, 6) : data.upcoming.slice(0, 6);
  const fixturesTitle = data.live.length ? 'Canlı ve sıradaki maçlar' : 'Sıradaki maçlar';
  const matches = fixtures.length
    ? `<h3 class="fb-col-title">${fixturesTitle}</h3>${matchList(fixtures)}`
    : (data.recent.length ? `<h3 class="fb-col-title">Son sonuçlar</h3>${matchList(data.recent.slice(-6))}` : '');
  const table = data.rows.length ? `<h3 class="fb-col-title">${esc(data.league)}${data.season ? ` ${esc(data.season)}` : ''}</h3>${standingsTable(data.rows, { compact: true })}` : '';
  return `${STYLE}<div class="fb-home"><div class="fb-col">${table}</div><div class="fb-col">${matches}<a class="fb-more" href="/puan-durumu">Tüm tablo ve sonuçlar ›</a></div></div>${source(data)}`;
}

// /puan-durumu sayfası içeriği.
function pageBlock(data) {
  if (!data) return '';
  const table = data.rows.length ? `${standingsTable(data.rows)}${legend(data.rows)}` : '<p class="public-empty">Puan durumu şu an alınamadı.</p>';
  const upcoming = data.live.concat(data.upcoming);
  return `${STYLE}<div class="fb-page"><section class="fb-block"><h2>Puan durumu${data.season ? ` · ${esc(data.season)}` : ''}</h2>${table}</section>`
    + `<div class="fb-page-cols"><section class="fb-block"><h2>Fikstür</h2>${upcoming.length ? matchList(upcoming) : '<p class="public-empty">Yaklaşan maç bulunamadı.</p>'}</section>`
    + `<section class="fb-block"><h2>Son sonuçlar</h2>${data.recent.length ? matchList(data.recent.slice().reverse()) : '<p class="public-empty">Sonuç bulunamadı.</p>'}</section></div>`
    + `${source(data)}</div>`;
}

module.exports = { homeBlock, pageBlock, standingsTable, matchList };
