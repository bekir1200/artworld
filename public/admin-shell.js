/* Yönetim paneli - sidebar grup aç/kapa (accordion) ve mobil menü toggle.
   Sekme/panel geçişi app.js'te; bu dosya sekme mantığına karışmaz. */
(() => {
  'use strict';

  const nav = document.getElementById('admin-sidebar');
  if (!nav) return;

  const layout = nav.closest('.admin-layout');
  const toggle = document.querySelector('.admin-nav-toggle');
  const mobileQuery = window.matchMedia('(max-width: 900px)');

  // (a) Grup accordion: grup başlığı aria-expanded ile açılıp kapanır.
  // Seçili sekmeyi içeren grup ilk açılışta açık gelir.
  nav.querySelectorAll('.admin-group-toggle').forEach((button) => {
    const items = document.getElementById(button.getAttribute('aria-controls') || '');
    if (!items) return;
    const hasSelected = Boolean(items.querySelector('.admin-tab.selected'));
    button.setAttribute('aria-expanded', hasSelected ? 'true' : 'false');
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // (b) Mobil toggle: sidebar overlay olarak açılır/kapanır.
  if (!layout || !toggle) return;

  const setOpen = (open) => {
    layout.classList.toggle('is-nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const isOpen = () => layout.classList.contains('is-nav-open');

  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => setOpen(!isOpen()));

  // Menü dışına tıklayınca (arka plan dahil) kapat
  document.addEventListener('click', (event) => {
    if (!isOpen()) return;
    if (nav.contains(event.target) || toggle.contains(event.target)) return;
    setOpen(false);
  });

  // Mobilde bir sekme seçilince menüyü kapat
  nav.addEventListener('click', (event) => {
    if (mobileQuery.matches && event.target.closest('.admin-tab')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  // Masaüstüne geçince overlay durumunu sıfırla
  const onChange = () => { if (!mobileQuery.matches) setOpen(false); };
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onChange);
  else if (mobileQuery.addListener) mobileQuery.addListener(onChange);
})();
