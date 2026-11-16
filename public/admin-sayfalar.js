/* Yönetim paneli - Sayfalar modülü (statik sayfa CRUD).
   Panel gizli olsa da render edilir. Harici kütüphane yok; metinler textContent ile basılır. */
(function(){
  'use strict';

  const panel = document.querySelector('.admin-content[data-panel="sayfalar"]');
  if(!panel) return;

  const API = '/api/admin/static-pages';
  const STATUS_TEXT = { published: 'YAYINDA', draft: 'TASLAK' };
  const STATUS_PILL = { published: 'live-pill', draft: 'draft-pill' };

  const state = {
    pages: [],
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
        else if(key === 'style') node.setAttribute('style', value);
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
    panel.querySelectorAll('button, input, select, textarea').forEach((node) => { node.disabled = flag; });
  }

  function formatDate(value){
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('tr-TR');
  }

  /* ---------- Iskelet ---------- */
  function buildShell(){
    panel.textContent = '';

    refs.feedback = el('p', { className: 'form-feedback', hidden: true });

    refs.summary = el('div', { className: 'workflow' });

    const intro = el('div', { className: 'panel-intro' }, [
      el('div', null, [
        el('span', { className: 'section-kicker', text: 'KURUMSAL İÇERİK' }),
        el('h3', { text: 'Sayfa yönetimi' }),
        el('p', { text: 'Hakkımızda, künye ve benzeri sabit sayfaları oluşturun; başlık, slug ve içeriklerini düzenleyin.' })
      ])
    ]);

    refs.titleInput = el('input', { name: 'title', maxlength: 200, required: true });
    refs.slugInput = el('input', { name: 'slug', maxlength: 120, placeholder: 'ornek-sayfa' });
    refs.statusSelect = el('select', { name: 'status' }, [
      el('option', { value: 'draft', text: 'Taslak' }),
      el('option', { value: 'published', text: 'Yayında' })
    ]);
    refs.contentInput = el('textarea', { name: 'content', rows: 6, maxlength: 100000 });
    refs.submitButton = el('button', { className: 'primary-action', type: 'submit', text: 'Sayfayı kaydet' });

    const form = el('form', { className: 'admin-form-grid' }, [
      el('label', null, ['Sayfa başlığı', refs.titleInput]),
      el('label', null, ['Slug (adres, opsiyonel)', refs.slugInput]),
      el('label', null, ['Yayın durumu', refs.statusSelect]),
      el('label', { className: 'form-wide' }, ['İçerik', refs.contentInput]),
      refs.submitButton
    ]);
    form.addEventListener('submit', onCreate);
    refs.form = form;

    refs.listHeading = el('div', { className: 'table-heading' }, [
      el('strong', { text: 'Sayfa listesi' }),
      el('span', { text: '' })
    ]);
    refs.list = el('div', { className: 'admin-managed-list' });
    refs.table = el('div', { className: 'admin-table' }, [refs.listHeading, refs.list]);

    panel.appendChild(refs.feedback);
    panel.appendChild(intro);
    panel.appendChild(refs.summary);
    panel.appendChild(form);
    panel.appendChild(refs.table);
  }

  /* ---------- Render ---------- */
  function renderSummary(){
    const total = state.pages.length;
    const published = state.pages.filter((page) => page.status === 'published').length;
    const draft = total - published;
    refs.summary.textContent = '';
    [['Toplam sayfa', total], ['Yayında', published], ['Taslak', draft]].forEach(([label, count]) => {
      refs.summary.appendChild(el('div', null, [
        el('span', { text: label }),
        el('b', { text: String(count) })
      ]));
    });
  }

  function renderList(){
    refs.listHeading.lastChild.textContent = `${state.pages.length} kayıt`;
    refs.list.textContent = '';

    if(!state.pages.length){
      refs.list.appendChild(el('div', { className: 'table-row' }, [
        el('span', { text: 'Henüz sayfa yok. Yukarıdaki formla ilk sayfanızı ekleyin.' })
      ]));
      return;
    }

    state.pages.forEach((page) => {
      const status = STATUS_TEXT[page.status] ? page.status : 'draft';
      const row = el('div', { className: 'table-row' }, [
        el('span', { className: `status-dot ${status}` }),
        el('div', null, [
          el('strong', { text: page.title || '' }),
          el('small', { text: page.slug ? `/${page.slug}` : '' })
        ]),
        el('span', { className: `pill ${STATUS_PILL[status]}`, text: STATUS_TEXT[status] }),
        el('time', { text: formatDate(page.updated_at) }),
        el('button', {
          className: 'secondary-action',
          type: 'button',
          text: 'Sil',
          onclick: () => onDelete(page)
        })
      ]);
      refs.list.appendChild(row);
    });
  }

  function render(){
    renderSummary();
    renderList();
  }

  /* ---------- Veri ---------- */
  async function load(){
    try {
      const data = await api(API);
      state.pages = Array.isArray(data && data.pages) ? data.pages : [];
      render();
    } catch(error){
      showFeedback(error.message, true);
    }
  }

  async function onCreate(event){
    event.preventDefault();
    if(state.busy) return;

    const title = refs.titleInput.value.trim();
    if(!title){
      showFeedback('Sayfa başlığı zorunludur.', true);
      refs.titleInput.focus();
      return;
    }

    const body = {
      title,
      slug: refs.slugInput.value.trim(),
      content: refs.contentInput.value,
      status: refs.statusSelect.value
    };

    setBusy(true);
    try {
      await api(API, { method: 'POST', body });
      refs.form.reset();
      showFeedback('Sayfa kaydedildi.', false);
      await load();
    } catch(error){
      showFeedback(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(page){
    if(state.busy) return;
    const label = page.title || 'Bu sayfa';
    if(!window.confirm(`"${label}" sayfası silinsin mi? Bu işlem geri alınamaz.`)) return;

    setBusy(true);
    try {
      await api(`${API}/${encodeURIComponent(page.id)}`, { method: 'DELETE' });
      showFeedback('Sayfa silindi.', false);
      await load();
    } catch(error){
      showFeedback(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Başlat ---------- */
  buildShell();
  load();
})();
