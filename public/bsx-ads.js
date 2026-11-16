// Yeni ana sayfada (BSX) reklam gösterim/tıklama sayımı. Eski app.js'teki davranışın aynısı:
// reklam en az %50 görünür olunca bir kez gösterim kaydı gönderilir, tıklamada doğru varyantın linki kullanılır.
(function () {
  'use strict';
  function init() {
    document.querySelectorAll('[data-ad-impression]').forEach(function (slot) {
      var variants = [];
      try { variants = JSON.parse(slot.dataset.adVariants || '[]'); } catch (e) { variants = []; }
      var image = slot.querySelector('[data-ad-creative-image]');
      if (image) image.addEventListener('error', function () { slot.remove(); }, { once: true });
      function selectedVariant() {
        if (!image || !image.currentSrc) return null;
        var source = new URL(image.currentSrc, location.href).href;
        return variants.find(function (v) { return new URL(v.source, location.href).href === source; }) || null;
      }
      var clickLink = slot.querySelector('[data-ad-click]');
      if (clickLink) clickLink.addEventListener('click', function () { var v = selectedVariant(); if (v) clickLink.href = v.click; });
      function track() {
        if (slot.dataset.impressionSent) return;
        slot.dataset.impressionSent = 'true';
        var v = selectedVariant();
        fetch((v && v.impression) || slot.dataset.adImpression, { credentials: 'same-origin', keepalive: true }).catch(function () {});
      }
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          if (entries.some(function (entry) { return entry.isIntersecting; })) { track(); observer.disconnect(); }
        }, { threshold: 0.5 });
        observer.observe(slot);
      } else { track(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
