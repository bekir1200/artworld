(function(){
  const panel = document.querySelector('.admin-content[data-panel="resmi-ilanlar"]');
  if(!panel) return;

  const API = '/api/admin/announcements';
  const STATUS_LABELS = { draft:'Taslak', published:'Yayında', archived:'Arşiv' };
  const STATUS_PILL = { draft:'draft-pill', published:'live-pill', archived:'pill' };
  let items = [];
  let editingId = null;
  const ui = {};

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

  function formatDateTime(value){
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('tr-TR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function formatRange(item){
    if (!item.publish_at && !item.ends_at) return 'Süresiz';
    return `${formatDateTime(item.publish_at)} – ${formatDateTime(item.ends_at)}`;
  }

  // datetime-local değerini (yerel saat) ISO'ya çevirir; boş ise boş string döner.
  function toIsoValue(localValue){
    if (!localValue) return '';
    const date = new Date(localValue);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  // ISO değerini datetime-local biçimine (yerel saat) çevirir.
  function toLocalInputValue(iso){
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  async function request(path, options){
    const opts = Object.assign({ credentials:'same-origin', headers:{ 'Accept':'application/json' } }, options || {});
    const response = await fetch(path, opts);
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'İşlem başarısız.');
    return data;
  }

  function setFeedback(message, isError){
    if (!ui.feedback) return;
    ui.feedback.textContent = message || '';
    ui.feedback.style.color = isError ? '' : 'var(--green)';
  }

  function resetForm(){
    ui.form.reset();
    editingId = null;
    ui.submit.textContent = 'İlanı kaydet';
    ui.cancel.hidden = true;
  }

  function startEdit(item){
    editingId = item.id;
    ui.fields.title.value = item.title || '';
    ui.fields.ilanNo.value = item.ilan_no || '';
    ui.fields.body.value = item.body || '';
    ui.fields.attachmentUrl.value = item.attachment_url || '';
    ui.fields.publishAt.value = toLocalInputValue(item.publish_at);
    ui.fields.endsAt.value = toLocalInputValue(item.ends_at);
    ui.fields.status.value = item.status;
    ui.submit.textContent = 'Değişiklikleri kaydet';
    ui.cancel.hidden = false;
    ui.form.scrollIntoView({ behavior:'smooth', block:'start' });
    setFeedback(`"${item.title}" düzenleniyor.`, false);
  }

  // Sabit iskelet (kullanıcı verisi içermez); dinamik içerik DOM API ile eklenir.
  function buildShell(){
    panel.textContent = '';

    const refresh = el('button', { className:'secondary-action', id:'announcements-refresh', type:'button', text:'Listeyi yenile' });
    panel.appendChild(el('div', { className:'panel-intro' }, [
      el('div', null, [
        el('span', { className:'section-kicker', text:'RESMİ KAYITLAR' }),
        el('h3', { text:'Resmi ilanlar' }),
        el('p', { text:'Resmi ilan metinleri, ek dosyaları ve yayın takvimi. Taslaklar yayınlanana kadar sitede görünmez.' })
      ]),
      refresh
    ]));

    ui.stats = el('div', { className:'workflow', id:'announcements-stats' });
    panel.appendChild(ui.stats);

    ui.feedback = el('p', { className:'form-feedback', id:'announcements-feedback', role:'status' });
    ui.submit = el('button', { className:'primary-action', type:'submit', text:'İlanı kaydet' });
    ui.cancel = el('button', { className:'secondary-action', type:'button', text:'Düzenlemeyi iptal et', hidden:'hidden' });

    ui.fields = {
      title: el('input', { name:'title', required:'required', maxlength:'200' }),
      ilanNo: el('input', { name:'ilanNo', maxlength:'100' }),
      body: el('textarea', { name:'body', rows:'8', maxlength:'50000' }),
      attachmentUrl: el('input', { name:'attachmentUrl', type:'text', placeholder:'https://... veya /dosyalar/ilan.pdf', maxlength:'2000' }),
      publishAt: el('input', { name:'publishAt', type:'datetime-local' }),
      endsAt: el('input', { name:'endsAt', type:'datetime-local' }),
      status: el('select', { name:'status' }, Object.keys(STATUS_LABELS).map(value =>
        el('option', { value, text:STATUS_LABELS[value] })
      ))
    };

    ui.form = el('form', { className:'admin-form-grid', id:'announcements-form' });
    ui.form.appendChild(el('div', { className:'form-wide' }, [
      el('span', { className:'section-kicker', text:'YENİ İLAN' }),
      el('h4', { text:'İlan bilgileri' })
    ]));
    ui.form.appendChild(el('label', null, [document.createTextNode('Başlık'), ui.fields.title]));
    ui.form.appendChild(el('label', null, [document.createTextNode('İlan no'), ui.fields.ilanNo]));
    ui.form.appendChild(el('label', { className:'form-wide' }, [document.createTextNode('Metin'), ui.fields.body]));
    ui.form.appendChild(el('label', { className:'form-wide' }, [document.createTextNode('Ek dosya URL'), ui.fields.attachmentUrl]));
    ui.form.appendChild(el('label', null, [document.createTextNode('Yayın başlangıcı'), ui.fields.publishAt]));
    ui.form.appendChild(el('label', null, [document.createTextNode('Bitiş'), ui.fields.endsAt]));
    ui.form.appendChild(el('label', null, [document.createTextNode('Durum'), ui.fields.status]));
    ui.form.appendChild(ui.submit);
    ui.form.appendChild(ui.cancel);
    ui.form.appendChild(ui.feedback);
    panel.appendChild(ui.form);

    ui.count = el('span', { id:'announcements-count', text:'0 ilan' });
    ui.list = el('div', { className:'admin-managed-list', id:'announcements-list', 'aria-live':'polite' });
    panel.appendChild(el('div', { className:'admin-table' }, [
      el('div', { className:'table-heading' }, [
        el('strong', { text:'İlan listesi' }),
        ui.count
      ]),
      ui.list
    ]));

    refresh.addEventListener('click', () => loadItems(refresh));
    ui.cancel.addEventListener('click', () => {
      resetForm();
      setFeedback('Düzenleme iptal edildi.', false);
    });

    ui.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        title: ui.fields.title.value.trim(),
        ilanNo: ui.fields.ilanNo.value.trim(),
        body: ui.fields.body.value.trim(),
        attachmentUrl: ui.fields.attachmentUrl.value.trim(),
        status: ui.fields.status.value,
        publishAt: toIsoValue(ui.fields.publishAt.value),
        endsAt: toIsoValue(ui.fields.endsAt.value)
      };
      if (!payload.title) {
        setFeedback('Başlık zorunludur.', true);
        return;
      }
      if (payload.publishAt && payload.endsAt && new Date(payload.endsAt) <= new Date(payload.publishAt)) {
        setFeedback('Bitiş tarihi yayın başlangıcından sonra olmalıdır.', true);
        return;
      }
      const isEdit = editingId !== null;
      ui.submit.disabled = true;
      setFeedback('Kaydediliyor...', false);
      try {
        await request(isEdit ? `${API}/${encodeURIComponent(editingId)}` : API, {
          method: isEdit ? 'PATCH' : 'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify(payload)
        });
        resetForm();
        setFeedback(isEdit ? 'İlan güncellendi.' : 'İlan kaydedildi.', false);
        await loadItems();
      } catch (error) {
        setFeedback(error.message, true);
      } finally {
        ui.submit.disabled = false;
      }
    });
  }

  function renderStats(){
    if (!ui.stats) return;
    const count = status => items.filter(item => item.status === status).length;
    const stats = [
      ['Toplam', items.length],
      ['Yayında', count('published')],
      ['Taslak', count('draft')],
      ['Arşiv', count('archived')]
    ];
    ui.stats.textContent = '';
    stats.forEach(([label, value]) => {
      ui.stats.appendChild(el('div', null, [
        el('b', { text:String(value) }),
        el('span', { text:label })
      ]));
    });
  }

  async function changeItem(item, body, button){
    button.disabled = true;
    try {
      await request(`${API}/${encodeURIComponent(item.id)}`, {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify(body)
      });
      setFeedback('İlan güncellendi.', false);
      await loadItems();
    } catch (error) {
      setFeedback(error.message, true);
      button.disabled = false;
    }
  }

  async function removeItem(item, button){
    if (!window.confirm(`"${item.title}" ilanı kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    button.disabled = true;
    try {
      await request(`${API}/${encodeURIComponent(item.id)}`, { method:'DELETE' });
      if (editingId === item.id) resetForm();
      setFeedback('İlan silindi.', false);
      await loadItems();
    } catch (error) {
      setFeedback(error.message, true);
      button.disabled = false;
    }
  }

  function renderList(){
    if (!ui.list) return;
    ui.count.textContent = `${items.length} ilan`;
    ui.list.textContent = '';

    if (!items.length) {
      ui.list.appendChild(el('div', { className:'admin-managed-row' }, [
        el('p', { text:'Henüz resmi ilan yok.' })
      ]));
      return;
    }

    items.forEach(item => {
      const toggleTarget = item.status === 'published' ? 'draft' : 'published';
      const toggleLabel = item.status === 'published' ? 'Taslağa al' : 'Yayınla';
      const toggleButton = el('button', { className:'secondary-action', type:'button', text:toggleLabel });
      toggleButton.addEventListener('click', () => changeItem(item, { status: toggleTarget }, toggleButton));

      const children = [
        el('div', { className:'managed-identity' }, [
          el('strong', { text:item.title }),
          el('small', { text:`İlan no: ${item.ilan_no || '—'}` })
        ]),
        el('span', { className:`pill ${STATUS_PILL[item.status] || ''}`.trim(), text:STATUS_LABELS[item.status] || item.status }),
        el('time', { datetime: item.publish_at || '', text: formatRange(item) }),
        toggleButton
      ];

      if (item.status !== 'archived') {
        const archiveButton = el('button', { className:'secondary-action', type:'button', text:'Arşivle' });
        archiveButton.addEventListener('click', () => changeItem(item, { status: 'archived' }, archiveButton));
        children.push(archiveButton);
      }

      const editButton = el('button', { className:'secondary-action', type:'button', text:'Düzenle' });
      editButton.addEventListener('click', () => startEdit(item));
      children.push(editButton);

      const deleteButton = el('button', { className:'secondary-action', type:'button', text:'Sil' });
      deleteButton.addEventListener('click', () => removeItem(item, deleteButton));
      children.push(deleteButton);

      ui.list.appendChild(el('div', { className:'admin-managed-row' }, children));
    });
  }

  async function loadItems(button){
    if (button) button.disabled = true;
    try {
      const data = await request(API);
      items = Array.isArray(data.announcements) ? data.announcements : [];
      renderStats();
      renderList();
    } catch (error) {
      setFeedback(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  buildShell();
  loadItems();
})();
