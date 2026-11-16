(function () {
  'use strict';

  var API = '/api/admin/galleries';
  var STATUS_LABELS = { draft: 'Taslak', published: 'Yayında', scheduled: 'Planlandı', archived: 'Arşiv' };
  var STATUS_PILLS = { draft: 'draft-pill', published: 'live-pill', scheduled: 'review-pill', archived: 'draft-pill' };
  var FILTERS = [
    ['all', 'Tümü'],
    ['published', 'Yayında'],
    ['draft', 'Taslak'],
    ['scheduled', 'İleri tarihli'],
    ['archived', 'Arşiv']
  ];
  var state = { categories: [], galleries: [], visible: [], filter: 'all' };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Planlı yayın zamanı: "20 Kasım 14:00" biçiminde.
  function formatSchedule(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function setFeedback(el, message, isSuccess) {
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isSuccess ? 'var(--green)' : '';
  }

  function request(method, path, body) {
    var options = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(API + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'İşlem başarısız.');
        return data;
      });
    });
  }

  function init() {
    var panel = document.querySelector('.admin-content[data-panel="galeriler"]');
    if (!panel) return;

    panel.innerHTML =
      '<div class="panel-intro">' +
        '<div><span class="section-kicker">FOTO GALERİ</span>' +
        '<h3>Galeri yönetimi</h3>' +
        '<p>Kategorileri yönetin, görsel listeleriyle galeri oluşturun ve durumlarını takip edin.</p></div>' +
        '<button type="button" class="secondary-action" data-action="refresh">Yenile</button>' +
      '</div>' +
      '<div class="workflow" data-role="summary"></div>' +
      '<p class="form-feedback form-wide" data-role="page-feedback"></p>' +

      '<form class="admin-form-grid" data-form="category" novalidate>' +
        '<label>Kategori adı' +
          '<input name="name" type="text" maxlength="120" required placeholder="Örn. Spor"></label>' +
        '<button class="primary-action" type="submit">Kategori ekle</button>' +
        '<p class="form-feedback form-wide" data-role="category-feedback"></p>' +
      '</form>' +
      '<div class="admin-table">' +
        '<div class="table-heading"><strong>Kategoriler (<span data-role="category-count">0</span>)</strong></div>' +
        '<div class="admin-managed-list" data-role="category-list"></div>' +
      '</div>' +

      '<form class="admin-form-grid" data-form="gallery" novalidate>' +
        '<label>Başlık' +
          '<input name="title" type="text" maxlength="200" required placeholder="Galeri başlığı"></label>' +
        '<label>Kategori' +
          '<select name="categoryId" data-role="category-select"></select></label>' +
        '<label>Durum' +
          '<select name="status" data-role="status-select">' +
            '<option value="draft">Taslak</option>' +
            '<option value="published">Yayında</option>' +
            '<option value="scheduled">Planlandı</option>' +
            '<option value="archived">Arşiv</option>' +
          '</select></label>' +
        '<label class="schedule-field" data-role="schedule-wrap" style="display:none">Yayın zamanı' +
          '<input name="publishAt" type="datetime-local" data-role="schedule-input"></label>' +
        '<label class="form-wide">Açıklama' +
          '<textarea name="description" rows="3" maxlength="5000"></textarea></label>' +
        '<label class="form-wide">Görsel URL\'leri (satır başına bir URL)' +
          '<textarea name="imageUrls" rows="6" placeholder="https://ornek.com/gorsel-1.jpg&#10;/media/gorsel-2.jpg"></textarea></label>' +
        '<button class="primary-action" type="submit">Galeri ekle</button>' +
        '<p class="form-feedback form-wide" data-role="gallery-feedback"></p>' +
      '</form>' +
      '<div class="admin-table">' +
        '<div class="table-heading"><strong>Galeriler (<span data-role="gallery-count">0</span>)</strong></div>' +
        '<div class="table-heading" data-role="gallery-filters" style="flex-wrap:wrap;gap:8px">' +
          FILTERS.map(function (f) {
            return '<button type="button" class="secondary-action" data-action="filter" data-filter="' + f[0] + '">' + esc(f[1]) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="admin-managed-list" data-role="gallery-list"></div>' +
      '</div>';

    var el = {
      pageFeedback: panel.querySelector('[data-role="page-feedback"]'),
      categoryFeedback: panel.querySelector('[data-role="category-feedback"]'),
      galleryFeedback: panel.querySelector('[data-role="gallery-feedback"]'),
      summary: panel.querySelector('[data-role="summary"]'),
      categoryList: panel.querySelector('[data-role="category-list"]'),
      galleryList: panel.querySelector('[data-role="gallery-list"]'),
      categoryCount: panel.querySelector('[data-role="category-count"]'),
      galleryCount: panel.querySelector('[data-role="gallery-count"]'),
      categorySelect: panel.querySelector('[data-role="category-select"]'),
      statusSelect: panel.querySelector('[data-role="status-select"]'),
      scheduleWrap: panel.querySelector('[data-role="schedule-wrap"]'),
      scheduleInput: panel.querySelector('[data-role="schedule-input"]'),
      categoryForm: panel.querySelector('[data-form="category"]'),
      galleryForm: panel.querySelector('[data-form="gallery"]')
    };

    // "Planlandı" seçilince yayın zamanı görünür ve zorunlu olur.
    function syncSchedule() {
      var scheduled = el.statusSelect.value === 'scheduled';
      el.scheduleWrap.style.display = scheduled ? '' : 'none';
      el.scheduleInput.required = scheduled;
      if (!scheduled) el.scheduleInput.value = '';
    }
    el.statusSelect.addEventListener('change', syncSchedule);

    function renderSummary() {
      var published = state.galleries.filter(function (g) { return g.status === 'published'; }).length;
      var drafts = state.galleries.filter(function (g) { return g.status === 'draft'; }).length;
      var tiles = [
        [state.categories.length, 'Kategori'],
        [state.galleries.length, 'Galeri'],
        [published, 'Yayında'],
        [drafts, 'Taslak']
      ];
      el.summary.innerHTML = tiles.map(function (t) {
        return '<div><b>' + t[0] + '</b><span>' + esc(t[1]) + '</span></div>';
      }).join('');
    }

    function renderFilters() {
      panel.querySelectorAll('[data-filter]').forEach(function (button) {
        var active = button.getAttribute('data-filter') === state.filter;
        button.className = active ? 'primary-action' : 'secondary-action';
      });
    }

    function renderCategorySelect() {
      var current = el.categorySelect.value;
      el.categorySelect.innerHTML = '<option value="">Kategorisiz</option>' + state.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      }).join('');
      if (current && state.categories.some(function (c) { return String(c.id) === current; })) {
        el.categorySelect.value = current;
      }
    }

    function renderCategoryList() {
      el.categoryCount.textContent = state.categories.length;
      if (!state.categories.length) {
        el.categoryList.innerHTML = '<p class="integration-notice">Henüz kategori yok.</p>';
        return;
      }
      el.categoryList.innerHTML = state.categories.map(function (c) {
        return '<div class="admin-managed-row">' +
          '<div class="managed-identity"><strong>' + esc(c.name) + '</strong>' +
          '<span>' + esc(c.slug) + ' · ' + esc(c.galleryCount) + ' galeri</span></div>' +
          '<span>Sıra: ' + esc(c.sortOrder) + '</span>' +
          '<button type="button" class="secondary-action destructive-action" data-action="delete-category" data-id="' +
            esc(c.id) + '" data-name="' + esc(c.name) + '">Sil</button>' +
        '</div>';
      }).join('');
    }

    function renderGalleryList() {
      el.galleryCount.textContent = state.visible.length;
      if (!state.visible.length) {
        el.galleryList.innerHTML = '<p class="integration-notice">' +
          (state.galleries.length ? 'Bu filtrede galeri yok.' : 'Henüz galeri yok.') + '</p>';
        return;
      }
      el.galleryList.innerHTML = state.visible.map(function (g) {
        var pillClass = STATUS_PILLS[g.status] || 'draft-pill';
        var label = STATUS_LABELS[g.status] || g.status;
        var schedule = (g.status === 'scheduled' && g.publishAt)
          ? '<span>Yayın: ' + esc(formatSchedule(g.publishAt)) + '</span>'
          : '';
        return '<div class="admin-managed-row">' +
          '<div class="managed-identity"><strong>' + esc(g.title) + '</strong>' +
          '<span>' + esc(g.categoryName || 'Kategorisiz') + '</span>' + schedule + '</div>' +
          '<span>' + esc(g.imageCount) + ' görsel</span>' +
          '<span class="pill ' + pillClass + '">' + esc(label) + '</span>' +
          '<button type="button" class="secondary-action destructive-action" data-action="delete" data-id="' +
            esc(g.id) + '" data-title="' + esc(g.title) + '">Sil</button>' +
        '</div>';
      }).join('');
    }

    function renderAll() {
      renderSummary();
      renderCategorySelect();
      renderCategoryList();
      renderFilters();
      renderGalleryList();
    }

    function load() {
      var requests = [request('GET', '/categories'), request('GET', '')];
      if (state.filter !== 'all') {
        requests.push(request('GET', '?status=' + encodeURIComponent(state.filter)));
      }
      return Promise.all(requests).then(function (results) {
        state.categories = results[0].categories || [];
        state.galleries = results[1].galleries || [];
        state.visible = state.filter === 'all' ? state.galleries : (results[2].galleries || []);
        renderAll();
        setFeedback(el.pageFeedback, '');
      }).catch(function (error) {
        setFeedback(el.pageFeedback, error.message || 'Galeri verileri yüklenemedi.', false);
      });
    }

    function setBusy(form, busy) {
      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = busy;
    }

    el.categoryForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = el.categoryForm.elements.name.value.trim();
      if (!name) {
        setFeedback(el.categoryFeedback, 'Kategori adı zorunludur.', false);
        return;
      }
      setBusy(el.categoryForm, true);
      setFeedback(el.categoryFeedback, '');
      request('POST', '/categories', { name: name }).then(function () {
        el.categoryForm.reset();
        setFeedback(el.categoryFeedback, 'Kategori eklendi.', true);
        return load();
      }).catch(function (error) {
        setFeedback(el.categoryFeedback, error.message, false);
      }).then(function () {
        setBusy(el.categoryForm, false);
      });
    });

    el.galleryForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var form = el.galleryForm.elements;
      var title = form.title.value.trim();
      if (!title) {
        setFeedback(el.galleryFeedback, 'Başlık zorunludur.', false);
        return;
      }
      var payload = {
        title: title,
        categoryId: form.categoryId.value ? Number(form.categoryId.value) : null,
        status: form.status.value,
        description: form.description.value.trim(),
        imageUrls: form.imageUrls.value
      };
      if (payload.status === 'scheduled') {
        if (!form.publishAt.value) {
          setFeedback(el.galleryFeedback, 'İleri tarihli galeri için yayın zamanı zorunludur.', false);
          return;
        }
        payload.publishAt = new Date(form.publishAt.value).toISOString();
      }
      setBusy(el.galleryForm, true);
      setFeedback(el.galleryFeedback, '');
      request('POST', '', payload).then(function () {
        el.galleryForm.reset();
        syncSchedule();
        setFeedback(el.galleryFeedback, 'Galeri eklendi.', true);
        return load();
      }).catch(function (error) {
        setFeedback(el.galleryFeedback, error.message, false);
      }).then(function () {
        setBusy(el.galleryForm, false);
      });
    });

    panel.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      var action = target.getAttribute('data-action');

      if (action === 'refresh') {
        load();
        return;
      }

      if (action === 'filter') {
        state.filter = target.getAttribute('data-filter') || 'all';
        load();
        return;
      }

      if (action === 'delete-category') {
        var categoryName = target.getAttribute('data-name') || 'Bu kategori';
        if (!window.confirm('"' + categoryName + '" kategorisi silinsin mi? Bağlı galeriler kategorisiz kalır.')) return;
        target.disabled = true;
        request('DELETE', '/categories/' + encodeURIComponent(target.getAttribute('data-id'))).then(function () {
          setFeedback(el.pageFeedback, 'Kategori silindi.', true);
          return load();
        }).catch(function (error) {
          setFeedback(el.pageFeedback, error.message, false);
          target.disabled = false;
        });
        return;
      }

      if (action === 'delete') {
        var title = target.getAttribute('data-title') || 'Bu galeri';
        if (!window.confirm('"' + title + '" galerisi silinsin mi? Bu işlem geri alınamaz.')) return;
        target.disabled = true;
        request('DELETE', '/' + encodeURIComponent(target.getAttribute('data-id'))).then(function () {
          setFeedback(el.pageFeedback, 'Galeri silindi.', true);
          return load();
        }).catch(function (error) {
          setFeedback(el.pageFeedback, error.message, false);
          target.disabled = false;
        });
      }
    });

    syncSchedule();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
