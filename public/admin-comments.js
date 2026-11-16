(function () {
  'use strict';

  var panel = document.querySelector('.admin-content[data-panel="yorumlar"]');
  if (!panel) return;

  var API = '/api/admin/comments';
  var FILTERS = [
    ['all', 'Tümü'],
    ['pending', 'Bekleyen'],
    ['approved', 'Onaylanan'],
    ['rejected', 'Reddedilen'],
    ['spam', 'Spam']
  ];
  var COUNTS = [
    ['pending', 'Bekleyen'],
    ['approved', 'Onaylanan'],
    ['rejected', 'Reddedilen'],
    ['spam', 'Spam']
  ];
  var STATUS_LABELS = { pending: 'BEKLİYOR', approved: 'ONAYLANDI', rejected: 'REDDEDİLDİ', spam: 'SPAM' };
  var STATUS_MESSAGES = { approved: 'Yorum onaylandı.', rejected: 'Yorum reddedildi.', spam: 'Yorum spam olarak işaretlendi.', pending: 'Yorum beklemeye alındı.' };

  var state = { filter: 'all', comments: [], counts: null, busy: false, seq: 0 };
  var refs = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function formatDate(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function setFeedback(message, isError) {
    if (!refs.feedback) return;
    refs.feedback.textContent = message || '';
    refs.feedback.classList.toggle('is-error', Boolean(isError));
  }

  function readResponse(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || 'İşlem başarısız.');
      return data;
    });
  }

  function buildShell() {
    panel.innerHTML =
      '<p class="form-feedback" role="status" aria-live="polite"></p>' +
      '<div class="panel-intro"><div><span class="section-kicker">MODERASYON</span><h3>Yorumlar</h3>' +
      '<p>Okur yorumlarını onaylayın, reddedin veya silin.</p></div>' +
      '<button class="secondary-action" type="button" data-action="refresh">Yenile</button></div>' +
      '<div class="workflow" aria-label="Yorum sayaçları"></div>' +
      '<div class="admin-table">' +
      '<div class="table-heading"><strong>Moderasyon kuyruğu</strong>' +
      '<div class="crm-filters" role="group" aria-label="Duruma göre filtrele"></div></div>' +
      '<div class="admin-managed-list" aria-live="polite"></div>' +
      '</div>';

    refs.feedback = panel.querySelector('.form-feedback');
    refs.workflow = panel.querySelector('.workflow');
    refs.filters = panel.querySelector('.crm-filters');
    refs.list = panel.querySelector('.admin-managed-list');

    refs.filters.innerHTML = FILTERS.map(function (f) {
      return '<button class="secondary-action" type="button" data-action="filter" data-status="' + f[0] + '">' + esc(f[1]) + '</button>';
    }).join('');
  }

  function renderCounts() {
    var counts = state.counts || {};
    refs.workflow.innerHTML = COUNTS.map(function (c) {
      var value = state.counts ? Number(counts[c[0]] || 0) : '—';
      return '<div><b>' + esc(value) + '</b><span>' + esc(c[1]) + '</span></div>';
    }).join('');
  }

  function renderFilters() {
    refs.filters.querySelectorAll('[data-action="filter"]').forEach(function (btn) {
      var active = btn.getAttribute('data-status') === state.filter;
      btn.classList.toggle('primary-action', active);
      btn.classList.toggle('secondary-action', !active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function renderRow(item) {
    var id = Number(item.id);
    var current = item.status;
    var actions = [
      ['approved', 'Onayla', 'primary-action'],
      ['rejected', 'Reddet', 'secondary-action'],
      ['spam', 'Spam', 'secondary-action']
    ].map(function (a) {
      return '<button class="' + a[2] + '" type="button" data-action="set-status" data-id="' + id +
        '" data-status="' + a[0] + '"' + (current === a[0] ? ' disabled' : '') + '>' + a[1] + '</button>';
    }).join('');
    actions += '<button class="secondary-action" type="button" data-action="delete" data-id="' + id + '">Sil</button>';

    return '<div class="table-row comment-row">' +
      '<div><strong>' + esc(item.author_name) + '</strong>' +
      (item.author_email ? ' <small>' + esc(item.author_email) + '</small>' : '') +
      '<p style="white-space:pre-wrap;margin:6px 0">' + esc(item.body) + '</p>' +
      '<small>Haber: ' + esc(item.article_title || 'Başlık belirtilmemiş') + ' · ' + esc(formatDate(item.created_at)) + '</small></div>' +
      '<span class="pill">' + esc(STATUS_LABELS[current] || current) + '</span>' +
      '<div class="shell-actions">' + actions + '</div>' +
      '</div>';
  }

  function renderList() {
    if (!state.comments.length) {
      refs.list.innerHTML = '<div class="table-row"><span>Bu filtrede yorum yok.</span></div>';
      return;
    }
    refs.list.innerHTML = state.comments.map(renderRow).join('');
  }

  function load() {
    var seq = ++state.seq;
    var query = state.filter === 'all' ? '' : '?status=' + encodeURIComponent(state.filter);
    return fetch(API + query, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(readResponse)
      .then(function (data) {
        if (seq !== state.seq) return;
        state.comments = Array.isArray(data.comments) ? data.comments : [];
        state.counts = data.counts || null;
        renderCounts();
        renderFilters();
        renderList();
      })
      .catch(function (err) {
        if (seq !== state.seq) return;
        setFeedback(err.message || 'Yorumlar yüklenemedi.', true);
      });
  }

  function mutate(url, options, successMessage) {
    if (state.busy) return;
    state.busy = true;
    options.credentials = 'same-origin';
    options.headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    return fetch(url, options)
      .then(readResponse)
      .then(function () {
        setFeedback(successMessage, false);
        return load();
      })
      .catch(function (err) {
        setFeedback(err.message || 'İşlem başarısız.', true);
      })
      .then(function () { state.busy = false; });
  }

  function setStatus(id, status) {
    return mutate(API + '/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    }, STATUS_MESSAGES[status] || 'Durum güncellendi.');
  }

  function removeComment(id) {
    if (!window.confirm('Bu yorum kalıcı olarak silinecek. Devam edilsin mi?')) return;
    return mutate(API + '/' + encodeURIComponent(id), { method: 'DELETE' }, 'Yorum silindi.');
  }

  function bindEvents() {
    panel.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-action]');
      if (!btn || !panel.contains(btn) || btn.disabled) return;
      var action = btn.getAttribute('data-action');

      if (action === 'refresh') {
        setFeedback('', false);
        load();
      } else if (action === 'filter') {
        state.filter = btn.getAttribute('data-status') || 'all';
        setFeedback('', false);
        renderFilters();
        load();
      } else if (action === 'set-status') {
        setStatus(Number(btn.getAttribute('data-id')), btn.getAttribute('data-status'));
      } else if (action === 'delete') {
        removeComment(Number(btn.getAttribute('data-id')));
      }
    });
  }

  function init() {
    buildShell();
    bindEvents();
    renderCounts();
    renderFilters();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
