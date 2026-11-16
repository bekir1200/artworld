(function(){
  const panel = document.querySelector('.admin-content[data-panel="makaleler"]');
  if(!panel) return;

  const API = '/api/admin/columns';
  const STATUS_LABELS = { draft:'Taslak', published:'Yayında', scheduled:'Planlandı', archived:'Arşiv' };
  const FILTERS = [
    ['all', 'Tümü'],
    ['published', 'Yayında'],
    ['draft', 'Taslak'],
    ['scheduled', 'İleri tarihli'],
    ['archived', 'Arşiv']
  ];
  let columns = [];   // tüm makaleler (istatistikler için)
  let visible = [];   // seçili filtreye göre listelenen makaleler
  let filter = 'all';

  function el(tag, attrs, children){
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(key => {
        if (key === 'text') node.textContent = attrs[key];
        else if (key === 'className') node.className = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(child => { if (child) node.appendChild(child); });
    return node;
  }

  function formatDate(value){
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('tr-TR', { day:'2-digit', month:'short', year:'numeric' });
  }

  // Planlı yayın zamanı: "20 Kasım 14:00" biçiminde.
  function formatSchedule(value){
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('tr-TR', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
  }

  async function request(path, options){
    const opts = Object.assign({ credentials:'same-origin', headers:{ 'Accept':'application/json' } }, options || {});
    const response = await fetch(path, opts);
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'İşlem başarısız.');
    return data;
  }

  function setFeedback(node, message, isError){
    node.textContent = message || '';
    node.style.color = isError ? '' : 'var(--green)';
  }

  // Sabit iskelet (kullanıcı verisi içermez); dinamik içerik DOM API ile eklenir.
  function buildShell(){
    panel.textContent = '';

    const refreshButton = el('button', { className:'secondary-action', id:'columns-refresh', type:'button', text:'Listeyi yenile' });
    panel.appendChild(el('div', { className:'panel-intro' }, [
      el('div', null, [
        el('span', { className:'section-kicker', text:'İÇERİK OPERASYONU' }),
        el('h3', { text:'Makale yönetimi' }),
        el('p', { text:'Köşe yazıları ve makaleler: taslak, yayın ve arşiv takibi.' })
      ]),
      refreshButton
    ]));

    panel.appendChild(el('div', { className:'workflow', id:'columns-stats' }));

    const feedbackNode = el('p', { className:'form-feedback', id:'columns-feedback', role:'status' });
    const form = el('form', { className:'admin-form-grid', id:'columns-form' });
    const titleInput = el('input', { name:'title', required:'required', maxlength:'200' });
    const authorInput = el('input', { name:'authorName', required:'required', maxlength:'200' });
    const summaryInput = el('textarea', { name:'summary', rows:'2', maxlength:'1000' });
    const bodyInput = el('textarea', { name:'body', rows:'10', maxlength:'50000' });
    const statusSelect = el('select', { name:'status' }, Object.keys(STATUS_LABELS).map(value =>
      el('option', { value, text:STATUS_LABELS[value] })
    ));
    const scheduleInput = el('input', { name:'publishAt', type:'datetime-local' });
    const scheduleLabel = el('label', { className:'schedule-field' }, [document.createTextNode('Yayın zamanı'), scheduleInput]);
    scheduleLabel.style.display = 'none';
    const submitButton = el('button', { className:'primary-action', type:'submit', text:'Makaleyi kaydet' });

    // "Planlandı / İleri tarihli" seçilince yayın zamanı görünür ve zorunlu olur.
    function syncSchedule(){
      const scheduled = statusSelect.value === 'scheduled';
      scheduleLabel.style.display = scheduled ? '' : 'none';
      scheduleInput.required = scheduled;
      if (!scheduled) scheduleInput.value = '';
    }
    statusSelect.addEventListener('change', syncSchedule);

    form.appendChild(el('div', { className:'form-wide' }, [
      el('span', { className:'section-kicker', text:'YENİ MAKALE' }),
      el('h4', { text:'Makale oluştur' })
    ]));
    form.appendChild(el('label', null, [document.createTextNode('Başlık'), titleInput]));
    form.appendChild(el('label', null, [document.createTextNode('Yazar'), authorInput]));
    form.appendChild(el('label', { className:'form-wide' }, [document.createTextNode('Özet'), summaryInput]));
    form.appendChild(el('label', { className:'form-wide' }, [document.createTextNode('İçerik'), bodyInput]));
    form.appendChild(el('label', null, [document.createTextNode('Durum'), statusSelect]));
    form.appendChild(scheduleLabel);
    form.appendChild(submitButton);
    form.appendChild(feedbackNode);
    panel.appendChild(form);

    const filterBar = el('div', { className:'table-heading', id:'columns-filters', style:'flex-wrap:wrap;gap:8px' });
    FILTERS.forEach(([value, label]) => {
      filterBar.appendChild(el('button', { type:'button', className:'secondary-action', 'data-filter':value, text:label }));
    });

    panel.appendChild(el('div', { className:'admin-table' }, [
      el('div', { className:'table-heading' }, [
        el('strong', { text:'Makale listesi' }),
        el('span', { id:'columns-count', text:'0 makale' })
      ]),
      filterBar,
      el('div', { className:'admin-managed-list', id:'columns-list', 'aria-live':'polite' })
    ]));

    refreshButton.addEventListener('click', () => loadColumns(refreshButton));

    filterBar.addEventListener('click', (event) => {
      const button = event.target.closest ? event.target.closest('[data-filter]') : null;
      if (!button) return;
      filter = button.getAttribute('data-filter') || 'all';
      renderFilters();
      loadColumns();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        title: titleInput.value.trim(),
        authorName: authorInput.value.trim(),
        summary: summaryInput.value.trim(),
        body: bodyInput.value.trim(),
        status: statusSelect.value
      };
      if (!payload.title || !payload.authorName) {
        setFeedback(feedbackNode, 'Başlık ve yazar adı zorunludur.', true);
        return;
      }
      if (payload.status === 'scheduled') {
        if (!scheduleInput.value) {
          setFeedback(feedbackNode, 'İleri tarihli makale için yayın zamanı zorunludur.', true);
          return;
        }
        payload.publishAt = new Date(scheduleInput.value).toISOString();
      }
      submitButton.disabled = true;
      setFeedback(feedbackNode, 'Kaydediliyor...', false);
      try {
        await request(API, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify(payload)
        });
        form.reset();
        syncSchedule();
        setFeedback(feedbackNode, 'Makale kaydedildi.', false);
        await loadColumns();
      } catch (error) {
        setFeedback(feedbackNode, error.message, true);
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function renderFilters(){
    const bar = panel.querySelector('#columns-filters');
    if (!bar) return;
    bar.querySelectorAll('[data-filter]').forEach(button => {
      const active = button.getAttribute('data-filter') === filter;
      button.className = active ? 'primary-action' : 'secondary-action';
    });
  }

  function renderStats(){
    const stats = panel.querySelector('#columns-stats');
    if (!stats) return;
    const count = status => columns.filter(item => item.status === status).length;
    const items = [
      ['Toplam', columns.length],
      ['Taslak', count('draft')],
      ['Yayında', count('published')],
      ['Planlandı', count('scheduled')]
    ];
    stats.textContent = '';
    items.forEach(([label, value]) => {
      stats.appendChild(el('div', null, [
        el('b', { text:String(value) }),
        el('span', { text:label })
      ]));
    });
  }

  function renderList(){
    const list = panel.querySelector('#columns-list');
    const countNode = panel.querySelector('#columns-count');
    if (!list) return;
    if (countNode) countNode.textContent = `${visible.length} makale`;
    list.textContent = '';

    if (!visible.length) {
      list.appendChild(el('div', { className:'admin-managed-row' }, [
        el('p', { text: columns.length ? 'Bu filtrede makale yok.' : 'Henüz makale yok.' })
      ]));
      return;
    }

    visible.forEach(item => {
      const deleteButton = el('button', { className:'secondary-action', type:'button', text:'Sil' });
      deleteButton.addEventListener('click', () => removeColumn(item, deleteButton));

      const identity = [
        el('strong', { text:item.title }),
        el('small', { text:`Yazar: ${item.author_name}` })
      ];
      if (item.status === 'scheduled' && item.publish_at) {
        identity.push(el('small', { text:`Yayın: ${formatSchedule(item.publish_at)}` }));
      }

      list.appendChild(el('div', { className:'admin-managed-row' }, [
        el('div', { className:'managed-identity' }, identity),
        el('span', { className:'pill', text:STATUS_LABELS[item.status] || item.status }),
        el('time', { datetime: item.published_at || item.created_at || '', text: formatDate(item.published_at || item.created_at) }),
        deleteButton
      ]));
    });
  }

  async function loadColumns(button){
    if (button) button.disabled = true;
    const feedbackNode = panel.querySelector('#columns-feedback');
    try {
      const all = await request(API);
      columns = Array.isArray(all.columns) ? all.columns : [];
      if (filter === 'all') {
        visible = columns;
      } else {
        const filtered = await request(`${API}?status=${encodeURIComponent(filter)}`);
        visible = Array.isArray(filtered.columns) ? filtered.columns : [];
      }
      renderStats();
      renderFilters();
      renderList();
    } catch (error) {
      if (feedbackNode) setFeedback(feedbackNode, error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function removeColumn(item, button){
    if (!window.confirm(`"${item.title}" makalesi kalıcı olarak silinsin mi?`)) return;
    button.disabled = true;
    const feedbackNode = panel.querySelector('#columns-feedback');
    try {
      await request(`${API}/${encodeURIComponent(item.id)}`, { method:'DELETE' });
      setFeedback(feedbackNode, 'Makale silindi.', false);
      await loadColumns();
    } catch (error) {
      setFeedback(feedbackNode, error.message, true);
      button.disabled = false;
    }
  }

  function init(){
    buildShell();
    loadColumns();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
