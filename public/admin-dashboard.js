/* Yönetim paneli - "Kontrol Paneli" widget'ları.
   Veriler /api/admin/dashboard-widgets uç noktasından gelir (5 dakikada bir yenilenir).
   Bir alan null ise ilgili widget "Veri şu an alınamıyor." gösterir.
   Harici kütüphane yok. Saat, karşılama ve namaz "sıradaki vakit" geri sayımı istemci tarafında canlıdır. */
(() => {
  'use strict';

  const panel = document.querySelector('.admin-content[data-panel="genel"]');
  if (!panel) return;

  const TZ_LOCALE = 'tr-TR';
  const CITY = 'Antalya';
  const REFRESH_MS = 5 * 60 * 1000;
  const UNAVAILABLE = 'Veri şu an alınamıyor.';
  const $ = (id) => document.getElementById(id);

  let data = null;
  let lastPrayerMinute = -1;

  const PRAYER_NAMES = {
    imsak: 'İmsak',
    gunes: 'Güneş',
    ogle: 'Öğle',
    ikindi: 'İkindi',
    aksam: 'Akşam',
    yatsi: 'Yatsı'
  };

  const COUNTER_LABELS = [
    ['articles', 'Haberler'],
    ['columns', 'Makaleler'],
    ['galleries', 'Galeriler'],
    ['videos', 'Videolar'],
    ['announcements', 'Resmi İlanlar'],
    ['users', 'Kullanıcılar']
  ];

  // Denetim günlüğündeki action değerleri -> okunur Türkçe. Bilinmeyenler olduğu gibi gösterilir.
  const ACTION_TEXT = {
    'article.created': 'haber oluşturdu',
    'article.updated': 'haberi güncelledi',
    'article.published': 'haberi yayımladı',
    'article.scheduled_published': 'zamanlanmış haberi yayımladı',
    'ad.campaign.created': 'reklam kampanyası oluşturdu',
    'ad.campaign.status_changed': 'reklam kampanyasının durumunu değiştirdi',
    'ad.creative.created': 'reklam kreatifi ekledi',
    'ad.creative.status_changed': 'reklam kreatifinin durumunu değiştirdi',
    'crm.contact.created': 'CRM kaydı ekledi',
    'crm.contact.updated': 'CRM kaydını güncelledi',
    'newsletter.sent': 'bülten gönderdi',
    'newsletter.subscribed': 'bülten aboneliği kaydetti',
    'newsletter.unsubscribed': 'bülten aboneliğinden ayrıldı',
    'integration.credentials.saved': 'entegrasyon bilgilerini kaydetti',
    'integration.credential.deleted': 'entegrasyon bilgisini sildi',
    'layout.published': 'sayfa düzenini yayımladı',
    'layout.draft.saved': 'sayfa düzeni taslağını kaydetti',
    'site.identity.updated': 'site kimliğini güncelledi',
    'user.created': 'kullanıcı ekledi',
    'user.updated': 'kullanıcı bilgilerini güncelledi'
  };

  // Hızlı ekleme düğmesi -> açılacak yönetim sekmesi.
  const QUICK_TABS = {
    haber: 'haber',
    makale: 'makaleler',
    galeri: 'galeriler',
    video: 'videolar',
    ilan: 'resmi-ilanlar',
    kullanici: 'kullanicilar'
  };

  /* ---------- Yardımcılar ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function field(key) {
    return data && data[key] !== undefined ? data[key] : null;
  }

  function fmtNum(n) {
    return Number(n).toLocaleString(TZ_LOCALE);
  }

  function fmtFx(n) {
    return Number(n).toLocaleString(TZ_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtChange(c) {
    if (c === null || c === undefined) return '—';
    const sign = c > 0 ? '+' : '';
    return `${sign}${Number(c).toLocaleString(TZ_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function relTime(iso) {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1) return 'az önce';
    if (minutes < 60) return `${minutes} dakika önce`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} saat önce`;
    return `${Math.floor(hours / 24)} gün önce`;
  }

  function dayLabel(isoDate) {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
  }

  function greetingFor(date) {
    const h = date.getHours();
    if (h >= 5 && h < 12) return 'İyi sabahlar';
    if (h >= 12 && h < 18) return 'İyi günler';
    if (h >= 18 && h < 22) return 'İyi akşamlar';
    return 'İyi geceler';
  }

  function hmToMinutes(hm) {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  }

  function unavailable(host, asList) {
    if (!host) return;
    host.replaceChildren(el(asList ? 'li' : 'p', 'dash-note', UNAVAILABLE));
  }

  function initialsOf(name) {
    const parts = String(name || '').split(/\s+/).filter(Boolean);
    const letters = parts.map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    return letters || '?';
  }

  /* ---------- Render fonksiyonları ---------- */

  function renderIp() {
    const ip = $('dash-ip');
    if (!ip) return;
    const label = ip.parentElement?.firstChild;
    if (label && label.nodeType === Node.TEXT_NODE) label.textContent = 'IP adresiniz: ';
    ip.textContent = field('clientIp') || '—';
  }

  function renderVisits() {
    const host = $('dash-visits');
    if (!host) return;
    const visits = field('visits');
    if (!visits) return unavailable(host);
    const items = [
      ['Bugün', visits.today],
      ['Bu Ay', visits.month],
      ['Bu Yıl', visits.year],
      ['Tüm Zamanlar', visits.all]
    ];
    host.replaceChildren(...items.map(([label, v]) => {
      const card = el('div', 'dash-visit');
      card.append(el('span', null, label));
      card.append(el('strong', null, fmtNum(v.visitors)));
      const small = el('small', null, 'ziyaretçi · ');
      small.append(el('b', null, fmtNum(v.views)), document.createTextNode(' görüntülenme'));
      card.append(small);
      return card;
    }));
  }

  function renderTrend() {
    const bars = $('dash-trend-bars');
    const labels = $('dash-trend-labels');
    const total = $('dash-trend-total');
    if (!bars || !labels) return;

    const trend = field('trend');
    if (!trend) {
      bars.replaceChildren();
      labels.replaceChildren();
      if (total) total.textContent = UNAVAILABLE;
      return;
    }

    const max = Math.max(1, ...trend.map((d) => d.visitors));
    bars.replaceChildren();
    labels.replaceChildren();
    trend.forEach((day, i) => {
      const text = `${dayLabel(day.date)}: ${fmtNum(day.visitors)} ziyaretçi`;
      const bar = el('div', 'dash-bar');
      bar.style.height = `${Math.max(4, Math.round((day.visitors / max) * 100))}%`;
      bar.title = text;
      bar.tabIndex = 0;
      bar.setAttribute('aria-label', text);
      bars.append(bar);

      const daysAgo = trend.length - 1 - i;
      labels.append(el('span', null, daysAgo % 5 === 0 ? dayLabel(day.date) : ''));
    });

    if (total) {
      const sum = trend.reduce((acc, d) => acc + d.visitors, 0);
      total.textContent = `Toplam ${fmtNum(sum)} ziyaretçi`;
    }
  }

  function renderWeather() {
    const host = $('dash-weather');
    const city = $('dash-weather-city');
    if (city) city.textContent = CITY;
    if (!host) return;
    const weather = field('weather');
    if (!weather || !weather.days || !weather.days.length) return unavailable(host);

    const [today, ...rest] = weather.days;
    const now = el('div', 'dash-weather-now');
    const left = el('div');
    left.append(el('span', null, CITY), document.createElement('br'));
    left.append(el('strong', null, today.max === null ? '—' : `${today.max}°`));
    if (today.min !== null) left.append(el('small', null, ` en düşük ${today.min}°`));
    now.append(left, el('span', null, today.label));

    const forecast = el('div', 'dash-forecast');
    const cells = [today, ...rest].slice(0, 5);
    cells.forEach((day, i) => {
      const [y, m, d] = day.date.split('-').map(Number);
      const weekday = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(TZ_LOCALE, { weekday: 'short', timeZone: 'UTC' });
      const name = i === 0 ? 'Bugün' : weekday;
      const temp = day.max === null || day.min === null ? '—' : `${day.max}° / ${day.min}°`;
      const cell = el('div');
      cell.append(el('span', null, name), el('b', null, temp), el('span', null, day.label));
      forecast.append(cell);
    });
    host.replaceChildren(now, forecast);
  }

  function renderFx() {
    const host = $('dash-fx');
    if (!host) return;
    const fx = field('fx');
    if (!fx) return unavailable(host, true);
    host.replaceChildren(...fx.map((item) => {
      const li = el('li');
      li.append(el('span', null, item.name));
      let valueText = '—';
      if (item.value !== null && item.value !== undefined) {
        valueText = item.code === 'BTC' ? `${fmtNum(item.value)} ₺` : `${fmtFx(item.value)} ₺`;
      }
      li.append(el('span', 'dash-value dash-tabular', valueText));
      const pct = item.changePct;
      const cls = pct === null || pct === undefined ? '' : (pct >= 0 ? 'dash-up' : 'dash-down');
      li.append(el('span', `dash-change ${cls}`.trim(), fmtChange(pct)));
      return li;
    }));
  }

  function renderPrayer() {
    const host = $('dash-prayer');
    const next = $('dash-prayer-next');
    const city = $('dash-prayer-city');
    if (city) city.textContent = CITY;
    if (!host) return;
    const prayer = field('prayer');
    if (!prayer) {
      unavailable(host, true);
      if (next) next.textContent = '';
      return;
    }

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const entries = Object.keys(PRAYER_NAMES).map((key) => ({ name: PRAYER_NAMES[key], hm: prayer.times[key] }));
    let nextIndex = entries.findIndex((t) => hmToMinutes(t.hm) > nowMin);
    const tomorrow = nextIndex === -1;
    if (tomorrow) nextIndex = 0;

    host.replaceChildren(...entries.map((t, i) => {
      const li = el('li', i === nextIndex ? 'dash-next' : null);
      li.append(el('span', null, t.name));
      li.append(el('span', 'dash-value dash-tabular', t.hm));
      li.append(el('span', 'dash-change'));
      return li;
    }));

    if (next) {
      const target = hmToMinutes(entries[nextIndex].hm) + (tomorrow ? 24 * 60 : 0);
      const diff = Math.max(0, target - nowMin);
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const left = h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
      next.textContent = `Sıradaki: ${entries[nextIndex].name} · ${left} kaldı`;
    }
  }

  function renderCounters() {
    const host = $('dash-counters');
    if (!host) return;
    const counters = field('counters') || {};
    host.replaceChildren(...COUNTER_LABELS.map(([key, label]) => {
      const value = counters[key];
      const card = el('div', 'dash-counter');
      card.append(el('strong', null, value === null || value === undefined ? '—' : fmtNum(value)), el('span', null, label));
      return card;
    }));
  }

  function renderActive() {
    const host = $('dash-active');
    const count = $('dash-active-count');
    const live = field('liveVisitors');
    if (count) count.textContent = live === null ? UNAVAILABLE : `${fmtNum(live)} ziyaretçi`;
    if (!host) return;

    const staff = field('staffOnline');
    if (!staff) return unavailable(host);
    if (!staff.length) {
      host.replaceChildren(el('p', 'dash-note', 'Şu anda oturumu açık personel yok.'));
      return;
    }
    host.replaceChildren(...staff.map((u) => {
      const row = el('div', 'dash-user');
      row.append(el('span', 'dash-avatar', initialsOf(u.displayName)));
      const who = el('div');
      who.append(el('strong', null, u.displayName), el('small', null, u.roleLabel));
      const dot = el('span', 'dash-online', '');
      dot.setAttribute('aria-label', 'çevrimiçi');
      row.append(who, dot);
      return row;
    }));
  }

  function renderLogs() {
    const host = $('dash-logs');
    if (!host) return;
    const logs = field('logs');
    if (!logs) return unavailable(host);
    if (!logs.length) {
      host.replaceChildren(el('p', 'dash-note', 'Henüz kayıt yok.'));
      return;
    }
    host.replaceChildren(...logs.map((log) => {
      const row = el('div', 'dash-log');
      const line = el('span');
      const text = ACTION_TEXT[log.action] || log.action;
      line.append(el('b', null, log.actor || 'Sistem'), document.createTextNode(` ${text}`));
      row.append(line, el('small', null, relTime(log.createdAt)));
      return row;
    }));
  }

  /* ---------- Canlı alanlar: karşılama, saat, tarih ---------- */

  function renderClock() {
    const now = new Date();
    const clock = $('dash-clock');
    const date = $('dash-date');
    const greet = $('dash-greeting');
    const nameEl = $('dash-admin-name');
    if (clock) clock.textContent = now.toLocaleTimeString(TZ_LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (date) date.textContent = now.toLocaleDateString(TZ_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (greet) greet.textContent = greetingFor(now);
    if (nameEl) {
      const userText = ($('admin-user')?.textContent || '').trim();
      nameEl.textContent = userText || 'Super Admin';
    }
    if (now.getMinutes() !== lastPrayerMinute) {
      lastPrayerMinute = now.getMinutes();
      renderPrayer();
    }
    syncQuickButtons();
  }

  /* ---------- Hızlı ekleme butonları ---------- */

  function quickTabOf(button) {
    const name = QUICK_TABS[button.dataset.quick];
    return name ? document.querySelector(`.admin-tab[data-tab="${name}"]`) : null;
  }

  // Rol yetkisine göre sekme yoksa ya da gizliyse düğmeyi gizle.
  function syncQuickButtons() {
    panel.querySelectorAll('[data-quick]').forEach((button) => {
      const tab = quickTabOf(button);
      button.hidden = !tab || tab.hidden;
    });
  }

  function bindQuickActions() {
    panel.querySelectorAll('[data-quick]').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = quickTabOf(button);
        if (!tab || tab.hidden) return syncQuickButtons();
        tab.click();
        document.querySelector('.admin-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ---------- Veri yükleme ---------- */

  function removeSampleLabels() {
    panel.querySelectorAll('h4 small').forEach((small) => {
      if (small.textContent.trim().toLowerCase() === 'örnek veri') small.remove();
    });
  }

  function renderAll() {
    renderIp();
    renderVisits();
    renderTrend();
    renderWeather();
    renderFx();
    renderPrayer();
    renderCounters();
    renderActive();
    renderLogs();
    syncQuickButtons();
  }

  async function load() {
    try {
      const res = await fetch('/api/admin/dashboard-widgets', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch {
      data = null;
    }
    renderAll();
  }

  /* ---------- Başlat ---------- */

  removeSampleLabels();
  bindQuickActions();
  renderClock();
  renderAll();
  load();
  setInterval(load, REFRESH_MS);
  setInterval(renderClock, 1000);
})();
