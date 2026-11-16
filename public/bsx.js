// BSX ana sayfa davranışları. Sözleşme: TASARIM-BSX.md §6.
// Eksik öğe varsa sessizce atlanır; hiçbir kısım hata fırlatmaz.
(function () {
  'use strict';

  var reduceMotion = false;
  try {
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { reduceMotion = false; }

  function $$(root, sel) {
    return root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : [];
  }

  function setActive(list, index) {
    list.forEach(function (el, i) { el.classList.toggle('is-active', i === index); });
  }

  // Ticker: [data-bsx-ticker] > [data-bsx-tick], 5 sn'de bir döner.
  function initTicker(root) {
    var ticks = $$(root, '[data-bsx-tick]');
    if (!ticks.length) return;
    var idx = 0;
    setActive(ticks, 0);
    function go(n) {
      idx = (n + ticks.length) % ticks.length;
      setActive(ticks, idx);
    }
    var prev = root.querySelector('[data-bsx-prev]');
    var next = root.querySelector('[data-bsx-next]');
    if (prev) prev.addEventListener('click', function () { go(idx - 1); restart(); });
    if (next) next.addEventListener('click', function () { go(idx + 1); restart(); });
    var timer = null;
    function restart() {
      if (reduceMotion || ticks.length < 2) return;
      clearInterval(timer);
      timer = setInterval(function () { go(idx + 1); }, 5000);
    }
    restart();
  }

  // Slider: [data-bsx-slider] içinde [data-bsx-slide]; numaralar [data-bsx-goto="N"] (bölüm kapsamında).
  function initSlider(root) {
    var slides = $$(root, '[data-bsx-slide]');
    if (!slides.length) return;
    var scope = root.closest('.bsx-sec') || root.parentElement || root;
    var gotos = $$(scope, '[data-bsx-goto]');
    var idx = 0;
    var timer = null;
    var delay = parseInt(root.getAttribute('data-bsx-auto'), 10) || 0;

    function show(n) {
      idx = (n + slides.length) % slides.length;
      setActive(slides, idx);
      gotos.forEach(function (g) {
        g.classList.toggle('is-active', parseInt(g.getAttribute('data-bsx-goto'), 10) === idx);
      });
    }
    function stop() { clearInterval(timer); timer = null; }
    function start() {
      if (reduceMotion || delay <= 0 || slides.length < 2) return;
      stop();
      timer = setInterval(function () { show(idx + 1); }, delay);
    }

    gotos.forEach(function (g) {
      var n = parseInt(g.getAttribute('data-bsx-goto'), 10);
      if (isNaN(n)) return;
      g.addEventListener('click', function (e) { e.preventDefault(); show(n); start(); });
      g.addEventListener('mouseenter', function () { show(n); start(); });
    });
    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);

    show(0);
    start();
  }

  // Carousel: [data-bsx-carousel] > [data-bsx-track]; ok bir kart genişliği + gap kaydırır.
  function initCarousel(root) {
    var track = root.querySelector('[data-bsx-track]');
    if (!track) return;
    function step(dir) {
      var first = track.firstElementChild;
      if (!first) return;
      var cs = window.getComputedStyle(track);
      var gap = parseFloat(cs.columnGap || cs.gap) || 0;
      var amount = first.getBoundingClientRect().width + gap;
      track.scrollBy({ left: dir * amount, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    var prev = root.querySelector('[data-bsx-prev]');
    var next = root.querySelector('[data-bsx-next]');
    if (prev) prev.addEventListener('click', function () { step(-1); });
    if (next) next.addEventListener('click', function () { step(1); });

    // Taşma yoksa ya da uç noktadaysa ilgili oku gizle.
    function update() {
      var overflow = track.scrollWidth > track.clientWidth + 2;
      if (!overflow) {
        if (prev) prev.hidden = true;
        if (next) next.hidden = true;
        return;
      }
      if (prev) prev.hidden = track.scrollLeft <= 2;
      if (next) next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    }
    var queued = false;
    function queue() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () { queued = false; update(); });
    }
    track.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    $$(track, 'img').forEach(function (img) {
      if (!img.complete) img.addEventListener('load', queue);
    });
    update();
  }

  function initTotop() {
    var btn = document.querySelector('.bsx-totop');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  function initMenu() {
    var btn = document.querySelector('[data-bsx-menu]');
    if (!btn) return;
    function set(open) {
      document.body.classList.toggle('bsx-menu-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function () {
      set(!document.body.classList.contains('bsx-menu-open'));
    });
    $$(document, '.bsx-mobile a').forEach(function (a) {
      a.addEventListener('click', function () { set(false); });
    });
  }

  function initDropdowns() {
    var dropdowns = $$(document, '[data-bsx-dropdown]');
    if (!dropdowns.length) return;
    function closeAll(except) {
      dropdowns.forEach(function (d) {
        if (d === except) return;
        d.classList.remove('is-open');
        var t = d.querySelector('[data-bsx-dropdown-toggle]');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    }
    dropdowns.forEach(function (d) {
      var t = d.querySelector('[data-bsx-dropdown-toggle]');
      if (!t) return;
      t.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !d.classList.contains('is-open');
        closeAll(d);
        d.classList.toggle('is-open', open);
        t.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    document.addEventListener('click', function () { closeAll(null); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  }

  // Koyu tema: sunucu varsayılanı body.bsx-dark ile gelir; ziyaretçinin kendi seçimi
  // localStorage 'bsx-dark' ('on'|'off') içinde saklanır ve varsayılanın üstüne yazar.
  function initTheme() {
    var btn = document.querySelector('[data-bsx-theme]');
    if (!btn) return;
    function set(on) {
      document.body.classList.toggle('bsx-dark', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var saved = null;
    try { saved = window.localStorage.getItem('bsx-dark'); } catch (e) { saved = null; }
    set(saved === 'on' || saved === 'off' ? saved === 'on' : document.body.classList.contains('bsx-dark'));
    btn.addEventListener('click', function () {
      var on = !document.body.classList.contains('bsx-dark');
      set(on);
      try { window.localStorage.setItem('bsx-dark', on ? 'on' : 'off'); } catch (e) { /* depo yok: sessizce geç */ }
    });
  }

  // Sekmeler: [data-bsx-tabs] içinde [data-bsx-tab="N"] (role=tab) ve [data-bsx-pane="N"] (role=tabpanel).
  function initTabs(root) {
    var tabs = $$(root, '[data-bsx-tab]');
    var panes = $$(root, '[data-bsx-pane]');
    if (!tabs.length) return;

    function keyOf(el, attr) { return parseInt(el.getAttribute(attr), 10); }
    function activate(pos, focus) {
      pos = (pos + tabs.length) % tabs.length;
      var key = keyOf(tabs[pos], 'data-bsx-tab');
      tabs.forEach(function (t, i) {
        var on = i === pos;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.setAttribute('tabindex', on ? '0' : '-1');
        if (on && focus) t.focus();
      });
      panes.forEach(function (p) { p.hidden = keyOf(p, 'data-bsx-pane') !== key; });
    }
    function current() {
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('is-active')) return i;
      }
      return 0;
    }

    var canHover = false;
    try { canHover = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches); } catch (e) { canHover = false; }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { activate(i, false); });
      if (canHover) t.addEventListener('mouseenter', function () { activate(i, false); });
      t.addEventListener('keydown', function (e) {
        var cur = current();
        if (e.key === 'ArrowRight') { e.preventDefault(); activate(cur + 1, true); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); activate(cur - 1, true); }
        else if (e.key === 'Home') { e.preventDefault(); activate(0, true); }
        else if (e.key === 'End') { e.preventDefault(); activate(tabs.length - 1, true); }
      });
    });

    activate(current(), false);
  }

  // Popup reklam: [data-bsx-popup] (data-hours saat). Son gösterim localStorage 'bsx-popup-last' ile takip edilir.
  function initPopup(root) {
    var KEY = 'bsx-popup-last';
    var hours = parseFloat(root.getAttribute('data-hours')) || 24;
    var last = null;
    try { last = parseInt(window.localStorage.getItem(KEY), 10); } catch (e) { last = null; }
    if (last && !isNaN(last) && Date.now() - last <= hours * 3600000) return;

    var opener = null;
    function onKey(e) { if (e.key === 'Escape') close(); }
    function open() {
      opener = document.activeElement;
      root.hidden = false;
      document.body.classList.add('bsx-popup-open');
      document.addEventListener('keydown', onKey);
      try { window.localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* depo yok: sessizce geç */ }
      var c = root.querySelector('[data-bsx-popup-close]');
      if (c) c.focus();
    }
    function close() {
      if (root.hidden) return;
      root.hidden = true;
      document.body.classList.remove('bsx-popup-open');
      document.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function') opener.focus();
    }

    var closeBtn = root.querySelector('[data-bsx-popup-close]');
    if (closeBtn) closeBtn.addEventListener('click', close);
    root.addEventListener('click', function (e) { if (e.target === root) close(); });

    setTimeout(open, 1500);
  }

  function boot() {
    $$(document, '[data-bsx-popup]').forEach(initPopup);
    $$(document, '[data-bsx-tabs]').forEach(initTabs);
    $$(document, '[data-bsx-ticker]').forEach(initTicker);
    $$(document, '[data-bsx-slider]').forEach(initSlider);
    $$(document, '[data-bsx-carousel]').forEach(initCarousel);
    initTotop();
    initMenu();
    initDropdowns();
    initTheme();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
