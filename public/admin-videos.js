(function(){
  'use strict';

  const panel = document.querySelector('.admin-content[data-panel="videolar"]');
  if (!panel) return;

  const API = '/api/admin/videos';
  const STATUS_LABELS = { draft: 'Taslak', published: 'Yayında', scheduled: 'Planlandı', archived: 'Arşiv' };
  const STATUS_PILL = { draft: 'draft-pill', published: 'live-pill', scheduled: 'review-pill', archived: 'draft-pill' };
  const STATUS_DOT = { draft: 'draft', published: 'published', scheduled: 'review', archived: 'draft' };
  const FILTERS = [
    ['all', 'Tümü'],
    ['published', 'Yayında'],
    ['draft', 'Taslak'],
    ['scheduled', 'İleri tarihli'],
    ['archived', 'Arşiv']
  ];

  let categories = [];
  let videos = [];        // tüm videolar (istatistikler için)
  let visibleVideos = []; // seçili filtreye göre listelenen videolar
  let filter = 'all';
  let busy = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // Planlı yayın zamanı: "20 Kasım 14:00" biçiminde.
  function formatSchedule(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  async function api(path, options) {
    const opts = options || {};
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const response = await fetch(path, init);
    let data = {};
    try { data = await response.json(); } catch (e) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'İşlem başarısız.');
    return data;
  }

  function setFeedback(el, message) {
    if (el) el.textContent = message || '';
  }

  function setBusy(form, state) {
    busy = state;
    form.querySelectorAll('button, input, select, textarea').forEach((el) => { el.disabled = state; });
  }

  function categoryOptions(selectedId) {
    const options = ['<option value="">Kategori yok</option>'];
    categories.forEach((c) => {
      const selected = String(c.id) === String(selectedId) ? ' selected' : '';
      options.push(`<option value="${esc(c.id)}"${selected}>${esc(c.name)}</option>`);
    });
    return options.join('');
  }

  function renderShell() {
    panel.innerHTML = `
      <div class="panel-intro">
        <div>
          <span class="section-kicker">VİDEO GALERİ</span>
          <h3>Videolar</h3>
          <p>Video galerisini ve kategorileri buradan yönetin. Videolar YouTube bağlantısıyla eklenir.</p>
        </div>
      </div>
      <div class="workflow" id="vid-summary"></div>

      <section class="admin-table" aria-labelledby="vid-cat-title">
        <div class="table-heading">
          <strong id="vid-cat-title">Kategori yönetimi</strong>
          <span id="vid-cat-count"></span>
        </div>
        <form class="admin-form-grid" id="vid-cat-form" novalidate>
          <label>Yeni kategori adı
            <input name="name" type="text" maxlength="120" required placeholder="Örn. Röportaj">
          </label>
          <button class="primary-action" type="submit">Kategori ekle</button>
          <p class="form-feedback" id="vid-cat-feedback" role="status"></p>
        </form>
        <div class="admin-managed-list" id="vid-cat-list"></div>
      </section>

      <section class="admin-table" aria-labelledby="vid-add-title">
        <div class="table-heading"><strong id="vid-add-title">Video ekle</strong></div>
        <form class="admin-form-grid" id="vid-form" novalidate>
          <label>Başlık
            <input name="title" type="text" maxlength="300" required placeholder="Video başlığı">
          </label>
          <label>Kategori
            <select name="categoryId" id="vid-category-select"></select>
          </label>
          <label>YouTube URL
            <input name="youtubeUrl" type="url" maxlength="2000" placeholder="https://www.youtube.com/watch?v=...">
          </label>
          <label>Durum
            <select name="status" id="vid-status-select">
              <option value="draft">Taslak</option>
              <option value="published">Yayında</option>
              <option value="scheduled">Planlandı</option>
              <option value="archived">Arşiv</option>
            </select>
          </label>
          <label id="vid-schedule-wrap" class="schedule-field" style="display:none">Yayın zamanı
            <input name="publishAt" id="vid-schedule-input" type="datetime-local">
          </label>
          <label style="grid-column:1/-1">Açıklama
            <textarea name="description" rows="3" maxlength="5000" placeholder="Kısa açıklama"></textarea>
          </label>
          <button class="primary-action" type="submit">Videoyu kaydet</button>
          <p class="form-feedback" id="vid-form-feedback" role="status"></p>
        </form>
      </section>

      <section class="admin-table" aria-labelledby="vid-list-title">
        <div class="table-heading">
          <strong id="vid-list-title">Video listesi</strong>
          <button type="button" id="vid-refresh">Yenile</button>
        </div>
        <div class="table-heading" id="vid-filters" style="flex-wrap:wrap;gap:8px">
          ${FILTERS.map(([value, label]) => `<button type="button" class="secondary-action" data-filter="${esc(value)}">${esc(label)}</button>`).join('')}
        </div>
        <div class="admin-managed-list" id="vid-list"></div>
        <p class="form-feedback" id="vid-list-feedback" role="status"></p>
      </section>
    `;
  }

  function renderFilters() {
    const bar = document.getElementById('vid-filters');
    if (!bar) return;
    bar.querySelectorAll('[data-filter]').forEach((button) => {
      button.className = button.getAttribute('data-filter') === filter ? 'primary-action' : 'secondary-action';
    });
  }

  function renderSummary() {
    const count = (status) => videos.filter((v) => v.status === status).length;
    const summary = document.getElementById('vid-summary');
    if (!summary) return;
    summary.innerHTML = `
      <div><span>Toplam video</span><b>${videos.length}</b></div>
      <div><span>Yayında</span><b>${count('published')}</b></div>
      <div><span>Planlanan</span><b>${count('scheduled')}</b></div>
      <div><span>Taslak</span><b>${count('draft')}</b></div>
    `;
  }

  function renderCategories() {
    const list = document.getElementById('vid-cat-list');
    const countEl = document.getElementById('vid-cat-count');
    const select = document.getElementById('vid-category-select');
    if (countEl) countEl.textContent = `${categories.length} kategori`;
    if (select) {
      const current = select.value;
      select.innerHTML = categoryOptions(current);
    }
    if (!list) return;
    if (!categories.length) {
      list.innerHTML = '<div class="table-row"><span></span><span>Henüz kategori yok.</span></div>';
      return;
    }
    list.innerHTML = categories.map((c) => `
      <div class="table-row">
        <span class="status-dot published"></span>
        <span>${esc(c.name)}</span>
        <small>${esc(c.slug || '')}</small>
        <small>${Number(c.video_count) || 0} video</small>
        <button class="secondary-action" type="button" data-cat-delete-id="${esc(c.id)}" data-title="${esc(c.name)}">Sil</button>
      </div>
    `).join('');
  }

  function renderVideos() {
    const list = document.getElementById('vid-list');
    if (!list) return;
    if (!visibleVideos.length) {
      const message = videos.length ? 'Bu filtrede video yok.' : 'Henüz video eklenmedi.';
      list.innerHTML = `<div class="table-row"><span></span><span>${message}</span></div>`;
      return;
    }
    list.innerHTML = visibleVideos.map((v) => {
      const status = v.status;
      const pill = `<span class="pill ${STATUS_PILL[status] || 'draft-pill'}">${esc(STATUS_LABELS[status] || status)}</span>`;
      const schedule = (status === 'scheduled' && v.publish_at)
        ? `<small>Yayın: ${esc(formatSchedule(v.publish_at))}</small>`
        : '';
      return `
        <div class="table-row">
          <span class="status-dot ${STATUS_DOT[status] || 'draft'}"></span>
          <span>${esc(v.title)}${schedule ? `<br>${schedule}` : ''}</span>
          <small>${esc(v.category_name || 'Kategorisiz')}</small>
          ${pill}
          <button class="secondary-action" type="button" data-delete-id="${esc(v.id)}" data-title="${esc(v.title)}">Sil</button>
        </div>
      `;
    }).join('');
  }

  function renderAll() {
    renderSummary();
    renderCategories();
    renderFilters();
    renderVideos();
  }

  async function loadCategories() {
    const data = await api(`${API}/categories`);
    categories = data.categories || [];
  }

  async function loadVideos() {
    const data = await api(API);
    videos = data.videos || [];
    if (filter === 'all') {
      visibleVideos = videos;
    } else {
      const filtered = await api(`${API}?status=${encodeURIComponent(filter)}`);
      visibleVideos = filtered.videos || [];
    }
  }

  async function loadAll() {
    const listFeedback = document.getElementById('vid-list-feedback');
    const catFeedback = document.getElementById('vid-cat-feedback');
    try {
      await Promise.all([loadCategories(), loadVideos()]);
      setFeedback(listFeedback, '');
      setFeedback(catFeedback, '');
    } catch (err) {
      setFeedback(listFeedback, err.message);
    }
    renderAll();
  }

  function bindEvents() {
    const catForm = document.getElementById('vid-cat-form');
    const catFeedback = document.getElementById('vid-cat-feedback');
    const catList = document.getElementById('vid-cat-list');
    const videoForm = document.getElementById('vid-form');
    const videoFeedback = document.getElementById('vid-form-feedback');
    const statusSelect = document.getElementById('vid-status-select');
    const scheduleWrap = document.getElementById('vid-schedule-wrap');
    const scheduleInput = document.getElementById('vid-schedule-input');
    const list = document.getElementById('vid-list');
    const listFeedback = document.getElementById('vid-list-feedback');
    const filterBar = document.getElementById('vid-filters');
    const refresh = document.getElementById('vid-refresh');

    // "Planlandı" seçilince yayın zamanı görünür ve zorunlu olur.
    function syncSchedule() {
      const scheduled = statusSelect.value === 'scheduled';
      scheduleWrap.style.display = scheduled ? '' : 'none';
      scheduleInput.required = scheduled;
      if (!scheduled) scheduleInput.value = '';
    }
    statusSelect.addEventListener('change', syncSchedule);

    catForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const name = catForm.elements.name.value.trim();
      if (!name) { setFeedback(catFeedback, 'Kategori adı zorunludur.'); return; }
      setBusy(catForm, true);
      setFeedback(catFeedback, '');
      try {
        await api(`${API}/categories`, { method: 'POST', body: { name } });
        catForm.reset();
        setFeedback(catFeedback, 'Kategori eklendi.');
        await loadCategories();
        renderCategories();
      } catch (err) {
        setFeedback(catFeedback, err.message);
      } finally {
        setBusy(catForm, false);
      }
    });

    videoForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const f = videoForm.elements;
      const title = f.title.value.trim();
      if (!title) { setFeedback(videoFeedback, 'Başlık zorunludur.'); return; }
      const youtubeUrl = f.youtubeUrl.value.trim();
      const payload = {
        title,
        categoryId: f.categoryId.value || null,
        youtubeUrl: youtubeUrl || null,
        description: f.description.value.trim() || null,
        status: f.status.value
      };
      if (payload.status === 'scheduled') {
        if (!scheduleInput.value) { setFeedback(videoFeedback, 'İleri tarihli video için yayın zamanı zorunludur.'); return; }
        payload.publishAt = new Date(scheduleInput.value).toISOString();
      }
      setBusy(videoForm, true);
      setFeedback(videoFeedback, '');
      try {
        await api(API, { method: 'POST', body: payload });
        videoForm.reset();
        syncSchedule();
        setFeedback(videoFeedback, 'Video kaydedildi.');
        await loadAll();
      } catch (err) {
        setFeedback(videoFeedback, err.message);
      } finally {
        setBusy(videoForm, false);
      }
    });

    catList.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-cat-delete-id]');
      if (!btn || busy) return;
      const id = btn.getAttribute('data-cat-delete-id');
      const name = btn.getAttribute('data-title') || '';
      if (!window.confirm(`"${name}" kategorisi silinsin mi? Bağlı videolar kategorisiz kalır.`)) return;
      busy = true;
      btn.disabled = true;
      setFeedback(catFeedback, '');
      try {
        await api(`${API}/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setFeedback(catFeedback, 'Kategori silindi.');
        await loadAll();
      } catch (err) {
        setFeedback(catFeedback, err.message);
        btn.disabled = false;
      } finally {
        busy = false;
      }
    });

    filterBar.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-filter]');
      if (!btn || busy) return;
      filter = btn.getAttribute('data-filter') || 'all';
      await loadAll();
    });

    list.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-delete-id]');
      if (!btn || busy) return;
      const id = btn.getAttribute('data-delete-id');
      const title = btn.getAttribute('data-title') || '';
      if (!window.confirm(`"${title}" videosu silinsin mi? Bu işlem geri alınamaz.`)) return;
      busy = true;
      btn.disabled = true;
      setFeedback(listFeedback, '');
      try {
        await api(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadAll();
      } catch (err) {
        setFeedback(listFeedback, err.message);
        btn.disabled = false;
      } finally {
        busy = false;
      }
    });

    refresh.addEventListener('click', () => { if (!busy) loadAll(); });
  }

  renderShell();
  bindEvents();
  loadAll();
})();
