/* Yönetim paneli listeleri için sayfalama.
   Listeler mevcut betiklerce (app.js, admin-*.js) tam olarak çizilir; bu betik yalnızca
   satırları sayfa sayfa gösterir. Liste yeniden çizildiğinde (kaydet, filtre, yenile)
   kendiliğinden güncellenir; bulunulan sayfa korunur, liste kısaldıysa son sayfaya iner. */
(function () {
  'use strict';

  var PAGE_SIZE = 20;
  var HIDDEN = 'pager-hidden';
  var pages = new WeakMap();
  var pagers = new WeakMap();

  // [liste kabı seçicisi, satır seçicisi]. Kontrol paneli özet tablosu (5 satır) hariç.
  var TARGETS = [
    ['.admin-content .admin-managed-list', ':scope > *'],
    ['.admin-content[data-panel="haber"] .admin-table', ':scope > .table-row']
  ];

  function rowsOf(container, rowSelector) {
    return Array.prototype.filter.call(container.querySelectorAll(rowSelector), function (row) {
      return !row.classList.contains('admin-pager');
    });
  }

  function button(label, action, disabled, ariaLabel) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondary-action';
    b.textContent = label;
    b.setAttribute('data-pager', action);
    if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
    b.disabled = disabled;
    return b;
  }

  function ensurePager(container) {
    var pager = pagers.get(container);
    if (pager && pager.isConnected && pager.previousElementSibling === container) return pager;
    if (pager) pager.remove();
    pager = document.createElement('nav');
    pager.className = 'admin-pager';
    pager.setAttribute('aria-label', 'Liste sayfaları');
    pager.addEventListener('click', function (event) {
      var target = event.target.closest('[data-pager]');
      if (!target || target.disabled) return;
      var page = pages.get(container) || 1;
      var action = target.getAttribute('data-pager');
      if (action === 'prev') page -= 1;
      else if (action === 'next') page += 1;
      else page = Number(action) || 1;
      pages.set(container, page);
      apply(container, container.__pagerRowSelector);
      var top = (container.closest('.admin-table') || container).getBoundingClientRect().top;
      if (top < 0) (container.closest('.admin-table') || container).scrollIntoView({ block: 'start' });
    });
    container.insertAdjacentElement('afterend', pager);
    pagers.set(container, pager);
    return pager;
  }

  // Gösterilecek sayfa numaraları: ilk, son ve bulunulan sayfanın komşuları; aralar "…".
  function pageList(current, total) {
    var list = [];
    for (var p = 1; p <= total; p += 1) {
      if (p === 1 || p === total || Math.abs(p - current) <= 1) list.push(p);
      else if (list[list.length - 1] !== '…') list.push('…');
    }
    return list;
  }

  function apply(container, rowSelector) {
    container.__pagerRowSelector = rowSelector;
    var rows = rowsOf(container, rowSelector);
    var total = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    var page = Math.min(Math.max(pages.get(container) || 1, 1), total);
    pages.set(container, page);

    var start = (page - 1) * PAGE_SIZE;
    rows.forEach(function (row, index) {
      row.classList.toggle(HIDDEN, index < start || index >= start + PAGE_SIZE);
    });

    var existing = pagers.get(container);
    if (rows.length <= PAGE_SIZE) {
      if (existing) existing.hidden = true;
      return;
    }
    var pager = ensurePager(container);
    pager.hidden = false;
    var info = document.createElement('span');
    info.className = 'admin-pager-info';
    info.textContent = (start + 1) + '–' + Math.min(start + PAGE_SIZE, rows.length) + ' / ' + rows.length + ' kayıt';
    var parts = [button('‹ Önceki', 'prev', page === 1, 'Önceki sayfa')];
    pageList(page, total).forEach(function (p) {
      if (p === '…') {
        var gap = document.createElement('span');
        gap.className = 'admin-pager-gap';
        gap.textContent = '…';
        parts.push(gap);
      } else {
        var b = button(String(p), String(p), false, p + '. sayfa');
        if (p === page) {
          b.className = 'primary-action';
          b.setAttribute('aria-current', 'page');
        }
        parts.push(b);
      }
    });
    parts.push(button('Sonraki ›', 'next', page === total, 'Sonraki sayfa'));
    parts.push(info);
    pager.replaceChildren.apply(pager, parts);
  }

  function scan() {
    TARGETS.forEach(function (target) {
      document.querySelectorAll(target[0]).forEach(function (container) {
        apply(container, target[1]);
      });
    });
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      scan();
    });
  }

  function init() {
    var root = document.querySelector('#dashboard') || document.body;
    new MutationObserver(function (records) {
      // Sayfalayıcının kendi değişiklikleri yeniden tarama tetiklemesin.
      for (var i = 0; i < records.length; i += 1) {
        var node = records[i].target;
        if (!(node.closest && node.closest('.admin-pager'))) { schedule(); return; }
      }
    }).observe(root, { childList: true, subtree: true });
    scan();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
