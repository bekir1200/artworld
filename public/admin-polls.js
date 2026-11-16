/* Yönetim paneli - Anketler modülü.
   Panel gizli olsa da render edilir. Harici kütüphane yok; metinler textContent ile basılır. */
(function(){
  'use strict';

  const panel = document.querySelector('.admin-content[data-panel="anketler"]');
  if(!panel) return;

  const API = '/api/admin/polls';
  const MIN_OPTIONS = 2;
  const MAX_OPTIONS = 10;
  const STATUS_TEXT = { active: 'YAYINDA', closed: 'KAPALI' };

  const state = {
    polls: [],
    formOptions: ['', ''],
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
    panel.querySelectorAll('button').forEach((button) => { button.disabled = flag; });
    if(!flag) refs.addOptionButton.disabled = state.formOptions.length >= MAX_OPTIONS;
  }

  function formatDate(value){
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('tr-TR');
  }

  function percent(votes, total){
    return total > 0 ? Math.round((votes / total) * 100) : 0;
  }

  /* ---------- Iskelet ---------- */
  function buildShell(){
    panel.textContent = '';

    refs.feedback = el('p', { className: 'form-feedback', hidden: true });

    const intro = el('div', { className: 'panel-intro' }, [
      el('div', null, [
        el('span', { className: 'section-kicker', text: 'OKUR GERİ BİLDİRİMİ' }),
        el('h3', { text: 'Anketler' }),
        el('p', { text: 'Soru ve seçenekleri tanımlayın; anketin yayın durumunu ve oy dağılımını takip edin.' })
      ]),
      el('button', { className: 'secondary-action', type: 'button', text: 'Yenile', onclick: () => loadPolls() })
    ]);

    refs.stats = el('div', { className: 'workflow' });

    refs.questionInput = el('input', { name: 'question', maxlength: 280 });
    refs.optionRows = el('div', { className: 'admin-form-grid' });
    refs.addOptionButton = el('button', {
      className: 'secondary-action', type: 'button', text: 'Seçenek ekle',
      onclick: () => {
        if(state.formOptions.length >= MAX_OPTIONS) return showFeedback(`En fazla ${MAX_OPTIONS} seçenek eklenebilir.`, true);
        state.formOptions.push('');
        renderOptionRows();
      }
    });

    const form = el('form', { className: 'admin-form-grid', novalidate: true, onsubmit: (event) => { event.preventDefault(); submitPoll(); } }, [
      el('label', { className: 'form-wide' }, ['Soru', refs.questionInput]),
      refs.optionRows,
      refs.addOptionButton,
      el('button', { className: 'primary-action', type: 'submit', text: 'Anketi kaydet' })
    ]);

    refs.listHeading = el('span', { text: 'Yükleniyor...' });
    refs.list = el('div', { className: 'admin-managed-list' });

    const table = el('div', { className: 'admin-table' }, [
      el('div', { className: 'table-heading' }, [el('strong', { text: 'Anket listesi' }), refs.listHeading]),
      refs.list
    ]);

    panel.appendChild(intro);
    panel.appendChild(refs.feedback);
    panel.appendChild(refs.stats);
    panel.appendChild(form);
    panel.appendChild(table);

    renderOptionRows();
  }

  /* ---------- Ekleme formu ---------- */
  function renderOptionRows(){
    const host = refs.optionRows;
    host.textContent = '';
    state.formOptions.forEach((value, index) => {
      const input = el('input', { name: `option${index + 1}`, maxlength: 160, value: value });
      input.addEventListener('input', () => { state.formOptions[index] = input.value; });
      host.appendChild(el('label', null, [`Seçenek ${index + 1}`, input]));
      if(index >= MIN_OPTIONS){
        host.appendChild(el('button', {
          className: 'secondary-action', type: 'button', text: 'Kaldır',
          onclick: () => {
            state.formOptions.splice(index, 1);
            renderOptionRows();
          }
        }));
      }
    });
    refs.addOptionButton.disabled = state.formOptions.length >= MAX_OPTIONS;
  }

  async function submitPoll(){
    if(state.busy) return;
    const question = refs.questionInput.value.trim();
    const options = state.formOptions.map((o) => o.trim()).filter(Boolean);

    if(!question) return showFeedback('Anket sorusu zorunludur.', true);
    if(options.length < MIN_OPTIONS) return showFeedback(`En az ${MIN_OPTIONS} dolu seçenek girmelisiniz.`, true);

    setBusy(true);
    try {
      await api(API, { method: 'POST', body: { question, options } });
      refs.questionInput.value = '';
      state.formOptions = ['', ''];
      renderOptionRows();
      showFeedback('Anket kaydedildi.', false);
      await loadPolls({ keepFeedback: true });
    } catch(err){
      showFeedback(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Liste ---------- */
  function renderStats(){
    const active = state.polls.filter((p) => p.status === 'active').length;
    const closed = state.polls.length - active;
    const totalVotes = state.polls.reduce((sum, p) => sum + p.totalVotes, 0);
    refs.stats.textContent = '';
    [
      [state.polls.length, 'Toplam anket'],
      [active, 'Yayında'],
      [closed, 'Kapalı'],
      [totalVotes, 'Toplam oy']
    ].forEach(([value, label]) => {
      refs.stats.appendChild(el('div', null, [el('b', { text: String(value) }), el('span', { text: label })]));
    });
  }

  function renderOptionBars(poll){
    return poll.options.map((option) => {
      const pct = percent(option.votes, poll.totalVotes);
      return el('div', { style: 'margin:6px 0' }, [
        el('div', { text: `${option.label} - ${option.votes} oy (%${pct})`, style: 'font-size:0.9em' }),
        el('div', { style: 'height:6px;border-radius:3px;overflow:hidden;background:rgba(127,127,127,0.25)' }, [
          el('i', { style: `display:block;height:100%;width:${pct}%;background:currentColor` })
        ])
      ]);
    });
  }

  function renderPollRow(poll){
    const toggleLabel = poll.status === 'active' ? 'Kapat' : 'Aç';
    return el('div', { className: 'table-row shell-row' }, [
      el('div', null, [
        el('strong', { text: poll.question }),
        el('small', { text: `Toplam oy: ${poll.totalVotes} · ${formatDate(poll.created_at)}` })
      ].concat(renderOptionBars(poll))),
      el('span', { className: 'pill', text: STATUS_TEXT[poll.status] || poll.status }),
      el('div', { className: 'shell-actions' }, [
        el('button', { className: 'secondary-action', type: 'button', text: toggleLabel, onclick: () => togglePoll(poll) }),
        el('button', { className: 'secondary-action', type: 'button', text: 'Sil', onclick: () => deletePoll(poll) })
      ])
    ]);
  }

  function renderList(){
    refs.list.textContent = '';
    refs.listHeading.textContent = `${state.polls.length} anket`;
    if(!state.polls.length){
      refs.list.appendChild(el('p', { className: 'form-feedback', text: 'Henüz anket yok.' }));
      return;
    }
    state.polls.forEach((poll) => refs.list.appendChild(renderPollRow(poll)));
  }

  async function loadPolls(options){
    const opts = options || {};
    try {
      const data = await api(API);
      state.polls = Array.isArray(data.polls) ? data.polls : [];
      renderStats();
      renderList();
      if(!opts.keepFeedback) showFeedback('', false);
    } catch(err){
      refs.listHeading.textContent = 'Yüklenemedi';
      showFeedback(err.message, true);
    }
  }

  async function togglePoll(poll){
    if(state.busy) return;
    const nextStatus = poll.status === 'active' ? 'closed' : 'active';
    setBusy(true);
    try {
      await api(`${API}/${poll.id}`, { method: 'PATCH', body: { status: nextStatus } });
      showFeedback(nextStatus === 'closed' ? 'Anket kapatıldı.' : 'Anket yeniden açıldı.', false);
      await loadPolls({ keepFeedback: true });
    } catch(err){
      showFeedback(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function deletePoll(poll){
    if(state.busy) return;
    if(!window.confirm(`"${poll.question}" anketi ve tüm seçenekleri silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`)) return;
    setBusy(true);
    try {
      await api(`${API}/${poll.id}`, { method: 'DELETE' });
      showFeedback('Anket silindi.', false);
      await loadPolls({ keepFeedback: true });
    } catch(err){
      showFeedback(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Başlat ---------- */
  buildShell();
  loadPolls();
})();
