/* Yonetim paneli - Ziyaretci Haberleri modulu.
   Panel gizli olsa da render edilir. Harici kutuphane yok; dinamik degerler esc() ile kacirilir. */
(function(){
  'use strict';

  var panel = document.querySelector('.admin-content[data-panel="ziyaretci-haberleri"]');
  if(!panel) return;

  var API = '/api/admin/visitor-posts';
  var FILTERS = [['', 'Tümü'], ['pending', 'Bekleyen'], ['approved', 'Onaylanan'], ['rejected', 'Reddedilen']];
  var STATUS_TEXT = { pending: 'Bekleyen', approved: 'Onaylandı', rejected: 'Reddedildi' };
  var SUMMARY_LIMIT = 220;

  var state = {
    filter: '',
    posts: [],
    counts: { pending: 0, approved: 0, rejected: 0 },
    busy: false
  };

  var refs = {};

  /* ---------- Yardimcilar ---------- */
  function esc(value){
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function(ch){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function summarize(text){
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > SUMMARY_LIMIT ? clean.slice(0, SUMMARY_LIMIT - 1) + '…' : clean;
  }

  function formatDate(value){
    var date = new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function api(path, options){
    var opts = options || {};
    var init = { credentials: 'same-origin', method: opts.method || 'GET', headers: {} };
    if(opts.body !== undefined){
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var response = await fetch(path, init);
    var data = null;
    try { data = await response.json(); } catch(_) { data = null; }
    if(!response.ok) throw new Error((data && data.error) || 'İşlem başarısız.');
    return data;
  }

  function showFeedback(message, isError){
    refs.feedback.textContent = message || '';
    refs.feedback.hidden = !message;
    refs.feedback.setAttribute('data-tone', isError ? 'error' : 'success');
  }

  function setBusy(flag){
    state.busy = flag;
    panel.querySelectorAll('button').forEach(function(button){ button.disabled = flag; });
  }

  /* ---------- Iskelet ---------- */
  function buildShell(){
    var filterButtons = FILTERS.map(function(f){
      return '<button class="secondary-action" type="button" data-action="filter" data-status="' + esc(f[0]) + '">' + esc(f[1]) + '</button>';
    }).join('');

    panel.innerHTML =
      '<div class="panel-intro"><div><span class="section-kicker">OKUR KATKISI</span><h3>Ziyaretçi Haberleri</h3>' +
      '<p>Okurlardan gelen haber başvurularını inceleyin, onaylayın veya reddedin.</p></div>' +
      '<button class="secondary-action" type="button" data-action="refresh">Yenile</button></div>' +
      '<p class="form-feedback" role="status" aria-live="polite" hidden></p>' +
      '<div class="workflow" aria-label="Başvuru sayaçları"></div>' +
      '<div class="admin-table">' +
      '<div class="table-heading"><strong>Başvuru kuyruğu</strong><div class="visitor-filters">' + filterButtons + '</div></div>' +
      '<div class="admin-managed-list" aria-live="polite"></div>' +
      '</div>';

    refs.feedback = panel.querySelector('.form-feedback');
    refs.workflow = panel.querySelector('.workflow');
    refs.filters = panel.querySelector('.visitor-filters');
    refs.list = panel.querySelector('.admin-managed-list');
  }

  function renderWorkflow(){
    var c = state.counts;
    refs.workflow.innerHTML =
      '<div><span>Bekleyen</span><b>' + esc(c.pending) + '</b></div>' +
      '<div><span>Onaylanan</span><b>' + esc(c.approved) + '</b></div>' +
      '<div><span>Reddedilen</span><b>' + esc(c.rejected) + '</b></div>';
  }

  function renderFilters(){
    refs.filters.querySelectorAll('button[data-action="filter"]').forEach(function(button){
      var active = button.getAttribute('data-status') === state.filter;
      button.classList.toggle('primary-action', active);
      button.classList.toggle('secondary-action', !active);
    });
  }

  function renderRow(post){
    var id = Number(post.id);
    var email = post.submitter_email ? esc(post.submitter_email) : '—';
    var summary = summarize(post.body) || 'Metin eklenmemiş.';
    return '<article class="admin-managed-row" data-id="' + id + '">' +
      '<div><strong>' + esc(post.title) + '</strong>' +
      '<span class="meta">' + esc(post.submitter_name) + ' · ' + email + ' · ' + esc(formatDate(post.created_at)) + '</span>' +
      '<p>' + esc(summary) + '</p></div>' +
      '<div><span class="pill">' + esc(STATUS_TEXT[post.status] || post.status) + '</span></div>' +
      '<div>' +
      '<button class="primary-action" type="button" data-action="approve" data-id="' + id + '"' + (post.status === 'approved' ? ' disabled' : '') + '>Onayla</button> ' +
      '<button class="secondary-action" type="button" data-action="reject" data-id="' + id + '"' + (post.status === 'rejected' ? ' disabled' : '') + '>Reddet</button> ' +
      '<button class="secondary-action" type="button" data-action="delete" data-id="' + id + '">Sil</button>' +
      '</div></article>';
  }

  function renderList(){
    if(!state.posts.length){
      refs.list.innerHTML = '<p class="form-feedback">Bu filtrede başvuru yok.</p>';
      return;
    }
    refs.list.innerHTML = state.posts.map(renderRow).join('');
  }

  /* ---------- Veri ---------- */
  async function load(){
    try {
      var query = state.filter ? '?status=' + encodeURIComponent(state.filter) : '';
      var data = await api(API + query);
      state.posts = Array.isArray(data.posts) ? data.posts : [];
      state.counts = data.counts || state.counts;
      renderWorkflow();
      renderFilters();
      renderList();
    } catch(error) {
      showFeedback(error.message, true);
    }
  }

  async function changeStatus(id, status){
    setBusy(true);
    try {
      await api(API + '/' + id, { method: 'PATCH', body: { status: status } });
      showFeedback(status === 'approved' ? 'Başvuru onaylandı.' : 'Başvuru reddedildi.', false);
      setBusy(false);
      await load();
    } catch(error) {
      showFeedback(error.message, true);
      setBusy(false);
    }
  }

  async function removePost(id){
    if(!window.confirm('Bu başvuru kalıcı olarak silinecek. Devam edilsin mi?')) return;
    setBusy(true);
    try {
      await api(API + '/' + id, { method: 'DELETE' });
      showFeedback('Başvuru silindi.', false);
      setBusy(false);
      await load();
    } catch(error) {
      showFeedback(error.message, true);
      setBusy(false);
    }
  }

  /* ---------- Olaylar ---------- */
  function bindEvents(){
    panel.addEventListener('click', function(event){
      var button = event.target.closest('button[data-action]');
      if(!button || state.busy || button.disabled) return;

      var action = button.getAttribute('data-action');
      var id = Number(button.getAttribute('data-id'));

      if(action === 'refresh'){ load(); return; }
      if(action === 'filter'){
        state.filter = button.getAttribute('data-status') || '';
        load();
        return;
      }
      if(action === 'approve'){ changeStatus(id, 'approved'); return; }
      if(action === 'reject'){ changeStatus(id, 'rejected'); return; }
      if(action === 'delete'){ removePost(id); }
    });
  }

  /* ---------- Baslat ---------- */
  buildShell();
  bindEvents();
  load();
})();
