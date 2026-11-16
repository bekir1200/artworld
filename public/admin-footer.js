/* Yönetim paneli - Footer linkleri modülü.
   Panel gizli olsa da render edilir. Harici kütüphane yok; tüm dinamik metinler textContent ile basılır. */
(function(){
  'use strict';

  const panel = document.querySelector('.admin-content[data-panel="footer-linkleri"]');
  if(!panel) return;

  const API = '/api/admin/footer-links';

  const state = {
    categories: [],
    links: [],
    busy: false
  };

  const refs = {};

  /* ---------- Yardımcılar ---------- */
  function el(tag, props, children){
    const node = document.createElement(tag);
    if(props){
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if(value === undefined || value === null || value === false) return;
        if(key === 'className') node.className = value;
        else if(key === 'text') node.textContent = value;
        else if(key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    (children || []).forEach((child) => {
      if(child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  async function api(path, options){
    const opts = options || {};
    const init = { credentials: 'same-origin', method: opts.method || 'GET', headers: {} };
    if(opts.body !== undefined){
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const response = await fetch(path, init);
    let data = null;
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
    panel.querySelectorAll('button').forEach((button) => { button.disabled = flag; });
  }

  async function run(task){
    if(state.busy) return;
    setBusy(true);
    try {
      await task();
    } catch(err){
      showFeedback((err && err.message) || 'İşlem başarısız.', true);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Veri ---------- */
  async function loadAll(){
    const [categoryData, linkData] = await Promise.all([
      api(API + '/categories'),
      api(API)
    ]);
    state.categories = (categoryData && categoryData.categories) || [];
    state.links = (linkData && linkData.links) || [];
    renderCategories();
    renderCategorySelect();
    renderLinks();
  }

  async function addCategory(){
    const name = refs.categoryInput.value.trim();
    if(!name){
      showFeedback('Kategori adı zorunludur.', true);
      refs.categoryInput.focus();
      return;
    }
    await run(async () => {
      await api(API + '/categories', { method: 'POST', body: { name } });
      refs.categoryInput.value = '';
      await loadAll();
      showFeedback('Kategori eklendi.', false);
    });
  }

  async function deleteCategory(category){
    if(!window.confirm('"' + category.name + '" kategorisi silinsin mi? Bağlı bağlantılar kategorisiz kalır.')) return;
    await run(async () => {
      await api(API + '/categories/' + encodeURIComponent(category.id), { method: 'DELETE' });
      await loadAll();
      showFeedback('Kategori silindi.', false);
    });
  }

  async function addLink(){
    const label = refs.linkLabel.value.trim();
    const url = refs.linkUrl.value.trim();
    if(!label){
      showFeedback('Etiket zorunludur.', true);
      refs.linkLabel.focus();
      return;
    }
    if(!url){
      showFeedback('Bağlantı adresi zorunludur.', true);
      refs.linkUrl.focus();
      return;
    }
    const categoryValue = refs.categorySelect.value;
    const categoryId = categoryValue ? Number(categoryValue) : null;
    await run(async () => {
      await api(API, { method: 'POST', body: { categoryId, label, url } });
      refs.linkLabel.value = '';
      refs.linkUrl.value = '';
      await loadAll();
      showFeedback('Bağlantı eklendi.', false);
    });
  }

  async function deleteLink(link){
    if(!window.confirm('"' + link.label + '" bağlantısı silinsin mi?')) return;
    await run(async () => {
      await api(API + '/' + encodeURIComponent(link.id), { method: 'DELETE' });
      await loadAll();
      showFeedback('Bağlantı silindi.', false);
    });
  }

  /* ---------- Arayüz ---------- */
  function buildShell(){
    while(panel.firstChild) panel.removeChild(panel.firstChild);

    refs.feedback = el('p', { className: 'form-feedback', hidden: true, 'data-tone': 'success' });

    const intro = el('div', { className: 'panel-intro' }, [
      el('div', null, [
        el('span', { className: 'section-kicker', text: 'SİTE ALT BİLGİ' }),
        el('h3', { text: 'Footer linkleri' }),
        el('p', { text: 'Alt bilgi bağlantılarını kategorilere göre düzenleyin.' })
      ])
    ]);

    /* (a) Kategoriler */
    refs.categoryInput = el('input', { name: 'categoryName', maxlength: '120', placeholder: 'Örn. Kurumsal' });
    const categoryForm = el('form', {
      className: 'admin-form-grid',
      onsubmit: (event) => { event.preventDefault(); addCategory(); }
    }, [
      el('label', null, ['Kategori adı', refs.categoryInput]),
      el('button', { className: 'primary-action', type: 'submit', text: 'Kategori ekle' })
    ]);
    refs.categoryTable = el('div', { className: 'admin-table' });
    const categorySection = el('div', { className: 'admin-managed-list' }, [
      el('h4', { text: 'Kategoriler' }),
      categoryForm,
      refs.categoryTable
    ]);

    /* (b) Linkler */
    refs.categorySelect = el('select', { name: 'category' });
    refs.linkLabel = el('input', { name: 'label', maxlength: '120', placeholder: 'Örn. Hakkımızda' });
    refs.linkUrl = el('input', { name: 'url', maxlength: '500', placeholder: '/hakkimizda veya https://' });
    const linkForm = el('form', {
      className: 'admin-form-grid',
      onsubmit: (event) => { event.preventDefault(); addLink(); }
    }, [
      el('label', null, ['Kategori', refs.categorySelect]),
      el('label', null, ['Etiket', refs.linkLabel]),
      el('label', { className: 'form-wide' }, ['Bağlantı (https:// veya /site-yolu)', refs.linkUrl]),
      el('button', { className: 'primary-action', type: 'submit', text: 'Bağlantıyı ekle' })
    ]);
    refs.linkTable = el('div', { className: 'admin-table' });
    const linkSection = el('div', { className: 'admin-managed-list' }, [
      el('h4', { text: 'Bağlantılar' }),
      linkForm,
      refs.linkTable
    ]);

    panel.appendChild(intro);
    panel.appendChild(refs.feedback);
    panel.appendChild(categorySection);
    panel.appendChild(linkSection);
  }

  function tableRow(title, subtitle, actions){
    return el('div', { className: 'table-row shell-row' }, [
      el('div', null, [
        el('strong', { text: title }),
        el('small', { text: subtitle })
      ]),
      el('div', { className: 'shell-actions' }, actions)
    ]);
  }

  function tableHeading(title, countText){
    return el('div', { className: 'table-heading' }, [
      el('strong', { text: title }),
      el('span', { text: countText })
    ]);
  }

  function renderCategories(){
    const table = refs.categoryTable;
    table.textContent = '';
    table.appendChild(tableHeading('Kategori listesi', state.categories.length + ' kategori'));
    if(!state.categories.length){
      table.appendChild(el('div', { className: 'table-row shell-row' }, [
        el('small', { text: 'Henüz kategori yok.' })
      ]));
      return;
    }
    state.categories.forEach((category) => {
      const count = Number(category.link_count) || 0;
      table.appendChild(tableRow(
        category.name,
        (category.slug || '-') + ' · ' + count + ' bağlantı',
        [
          el('span', { className: 'pill', text: count + ' link' }),
          el('button', {
            className: 'secondary-action',
            type: 'button',
            text: 'Sil',
            onclick: () => deleteCategory(category)
          })
        ]
      ));
    });
  }

  function renderCategorySelect(){
    const select = refs.categorySelect;
    const previous = select.value;
    select.textContent = '';
    select.appendChild(el('option', { value: '', text: 'Kategorisiz' }));
    state.categories.forEach((category) => {
      select.appendChild(el('option', { value: String(category.id), text: category.name }));
    });
    const stillExists = state.categories.some((category) => String(category.id) === previous);
    select.value = stillExists ? previous : '';
  }

  function renderLinks(){
    const table = refs.linkTable;
    table.textContent = '';
    table.appendChild(tableHeading('Bağlantı listesi', state.links.length + ' bağlantı'));
    if(!state.links.length){
      table.appendChild(el('div', { className: 'table-row shell-row' }, [
        el('small', { text: 'Henüz bağlantı yok.' })
      ]));
      return;
    }
    state.links.forEach((link) => {
      table.appendChild(tableRow(
        link.label,
        link.url + ' · ' + (link.category_name || 'Kategorisiz'),
        [
          el('button', {
            className: 'secondary-action',
            type: 'button',
            text: 'Sil',
            onclick: () => deleteLink(link)
          })
        ]
      ));
    });
  }

  /* ---------- Başlat ---------- */
  buildShell();
  renderCategories();
  renderCategorySelect();
  renderLinks();
  run(loadAll);
})();
