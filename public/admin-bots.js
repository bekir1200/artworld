/* Yönetim paneli - İçerik Botları modülü.
   Ajans RSS adresi ve aktif/pasif yapılandırması ile manuel "Şimdi çek" işlemini yönetir.
   Çekilen haberler TASLAK olarak düşer; yayım editör onayıyla yapılır.
   Panel gizli olsa da render edilir. Harici kütüphane yok; tüm dinamik değerler textContent ile basılır. */
(function(){
  'use strict';

  const panel = document.querySelector('.admin-content[data-panel="botlar"]');
  if(!panel) return;

  const API = '/api/admin/bots';
  const NOTE = 'Aktif ajanlar Cron ayarlarındaki aralıkla otomatik çekilir. Çekilen haberler TASLAK olarak Haber Yönetimi\'ne düşer; editör onayıyla yayımlanır. "Otomatik yayınla" işaretli ajansların haberleri onay beklemeden doğrudan yayına girer. Son 48 saatte başka bir kaynaktan aynı olay eklenmişse (benzer başlık) haber tekrar eklenmez.';

  const state = { bots: [], busy: false };
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
    panel.querySelectorAll('button, input').forEach((node) => { node.disabled = flag; });
  }

  /* ---------- İskelet ---------- */
  function buildShell(){
    panel.textContent = '';
    refs.feedback = el('p', { className: 'form-feedback', role: 'status', hidden: true });
    refs.list = el('div', { className: 'admin-managed-list' });
    refs.empty = el('p', { className: 'panel-intro', text: 'Kayıtlı ajans bulunamadı.', hidden: true });

    panel.appendChild(el('div', { className: 'panel-intro' }, [
      el('p', { text: NOTE })
    ]));
    refs.newName = el('input', { type: 'text', className: 'bot-new-name', maxlength: 100, required: true, placeholder: 'Ajans adı', 'aria-label': 'Yeni ajans adı' });
    refs.newUrl = el('input', { type: 'url', className: 'bot-new-rss', placeholder: 'https://ajans.example/rss', 'aria-label': 'Yeni ajans RSS adresi' });
    refs.newActive = el('input', { type: 'checkbox', className: 'bot-new-active', 'aria-label': 'Yeni ajans aktif durumu' });
    refs.newAutoPublish = el('input', { type: 'checkbox', className: 'bot-new-auto-publish', 'aria-label': 'Yeni ajans haberlerini otomatik yayınla' });
    panel.appendChild(el('p', { className: 'section-kicker', text: 'Yeni ajans ekle' }));
    panel.appendChild(el('form', {
      className: 'bot-create-form',
      onsubmit: (event) => { event.preventDefault(); createBot(); }
    }, [
      refs.newName,
      refs.newUrl,
      el('div', { className: 'bot-status' }, [
        el('label', { className: 'bot-toggle' }, [refs.newActive, ' Aktif']),
        el('label', { className: 'bot-toggle' }, [refs.newAutoPublish, ' Otomatik yayınla'])
      ]),
      el('button', { type: 'submit', className: 'primary-action', text: 'Yeni bot' })
    ]));
    panel.appendChild(el('p', { className: 'section-kicker', text: 'Haber Ajansları' }));
    panel.appendChild(el('div', { className: 'admin-table' }, [
      el('div', { className: 'table-heading' }, [
        el('span', { text: 'Ajans' }),
        el('span', { text: 'RSS adresi' }),
        el('span', { text: 'Durum' }),
        el('span', { text: 'İşlem' })
      ]),
      refs.list,
      refs.empty
    ]));
    panel.appendChild(refs.feedback);
  }

  /* ---------- Satır ---------- */
  function describeRun(bot){
    if(!bot.last_run_at) return 'Henüz çekilmedi.';
    const when = new Date(bot.last_run_at);
    const whenText = Number.isNaN(when.valueOf()) ? '' : when.toLocaleString('tr-TR');
    return 'Son çalışma: ' + whenText + (bot.last_result ? ' — ' + bot.last_result : '');
  }

  function buildRow(bot){
    const urlInput = el('input', {
      type: 'url',
      className: 'bot-rss-input',
      value: bot.rss_url || '',
      placeholder: 'https://ajans.example/rss',
      'aria-label': bot.agency_name + ' RSS adresi'
    });
    const toggle = el('input', {
      type: 'checkbox',
      className: 'bot-active-toggle',
      'aria-label': bot.agency_name + ' aktif durumu'
    });
    toggle.checked = bot.is_active === true;

    const statePill = el('span', { className: 'pill', text: toggle.checked ? 'AKTİF' : 'PASİF' });
    toggle.addEventListener('change', () => {
      statePill.textContent = toggle.checked ? 'AKTİF' : 'PASİF';
    });

    const autoPublish = el('input', {
      type: 'checkbox',
      className: 'bot-auto-publish-toggle',
      'aria-label': bot.agency_name + ' haberlerini otomatik yayınla'
    });
    autoPublish.checked = bot.auto_publish === true;

    const saveButton = el('button', { type: 'button', className: 'primary-action', text: 'Kaydet' });
    saveButton.addEventListener('click', () => saveBot(bot.id, urlInput, toggle, autoPublish, saveButton));

    const runButton = el('button', { type: 'button', className: 'secondary-action', text: 'Şimdi çek' });
    runButton.addEventListener('click', () => runAgency(bot, runButton));

    const deleteButton = el('button', { type: 'button', className: 'secondary-action', text: 'Sil' });
    deleteButton.addEventListener('click', () => deleteBot(bot, deleteButton));

    const meta = el('small', { className: 'bot-run-meta', text: describeRun(bot) });

    return el('div', { className: 'admin-managed-row', 'data-bot-id': bot.id }, [
      el('strong', { text: bot.agency_name }),
      urlInput,
      el('div', { className: 'bot-status' }, [
        el('label', { className: 'bot-toggle' }, [toggle, ' Aktif', statePill]),
        el('label', { className: 'bot-toggle' }, [autoPublish, ' Otomatik yayınla'])
      ]),
      el('div', { className: 'bot-actions' }, [saveButton, runButton, deleteButton, meta])
    ]);
  }

  function renderList(){
    refs.list.textContent = '';
    refs.empty.hidden = state.bots.length > 0;
    state.bots.forEach((bot) => refs.list.appendChild(buildRow(bot)));
  }

  /* ---------- Veri ---------- */
  async function loadBots(){
    try {
      const data = await api(API);
      state.bots = Array.isArray(data && data.bots) ? data.bots : [];
      renderList();
    } catch(err){
      showFeedback(err.message || 'Ajans listesi yüklenemedi.', true);
    }
  }

  async function saveBot(id, urlInput, toggle, autoPublish, button){
    if(state.busy) return;
    const rssUrl = urlInput.value.trim();
    if(rssUrl !== '' && !/^https?:\/\/\S+$/i.test(rssUrl)){
      showFeedback('RSS adresi boş olabilir ya da http(s):// ile başlamalıdır.', true);
      return;
    }
    setBusy(true);
    try {
      await api(API + '/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: { rssUrl: rssUrl, isActive: toggle.checked, autoPublish: autoPublish.checked }
      });
      showFeedback('Ajans ayarları kaydedildi.', false);
      await loadBots();
    } catch(err){
      showFeedback(err.message || 'Kayıt sırasında hata oluştu.', true);
    } finally {
      setBusy(false);
      button.disabled = false;
    }
  }

  async function runAgency(bot, runButton){
    if(state.busy) return;
    setBusy(true);
    runButton.textContent = 'Çekiliyor…';
    try {
      const data = await api(API + '/' + encodeURIComponent(bot.id) + '/run', { method: 'POST' });
      const result = (data && data.result) || {};
      if(result.error){
        showFeedback(result.error, true);
      } else {
        showFeedback(bot.agency_name + ': ' + (result.inserted || 0) + (bot.auto_publish === true ? ' yeni haber yayınlandı, ' : ' yeni taslak eklendi, ') + (result.skipped || 0) + ' mevcut veya atlandı'
          + (result.similar ? ', ' + result.similar + ' benzer haber (başka kaynakta zaten var) atlandı' : '') + '.', false);
      }
      await loadBots();
    } catch(err){
      showFeedback(err.message || 'Çekim sırasında hata oluştu.', true);
    } finally {
      setBusy(false);
      runButton.textContent = 'Şimdi çek';
    }
  }

  async function createBot(){
    if(state.busy) return;
    const name = refs.newName.value.trim();
    const rssUrl = refs.newUrl.value.trim();
    const nameLength = Array.from(name).length;
    if(nameLength < 2 || nameLength > 100){
      showFeedback('Ajans adı 2-100 karakter olmalıdır.', true);
      return;
    }
    if(rssUrl !== '' && !/^https?:\/\/\S+$/i.test(rssUrl)){
      showFeedback('RSS adresi boş olabilir ya da http(s):// ile başlamalıdır.', true);
      return;
    }
    setBusy(true);
    try {
      await api(API, {
        method: 'POST',
        body: { name: name, rssUrl: rssUrl, isActive: refs.newActive.checked, autoPublish: refs.newAutoPublish.checked }
      });
      refs.newName.value = '';
      refs.newUrl.value = '';
      refs.newActive.checked = false;
      refs.newAutoPublish.checked = false;
      showFeedback('Yeni ajans eklendi.', false);
      await loadBots();
    } catch(err){
      showFeedback(err.message || 'Ajans eklenirken hata oluştu.', true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBot(bot, button){
    if(state.busy) return;
    if(!confirm('Bu bot silinsin mi?')) return;
    setBusy(true);
    try {
      await api(API + '/' + encodeURIComponent(bot.id), { method: 'DELETE' });
      showFeedback(bot.agency_name + ' silindi.', false);
      await loadBots();
    } catch(err){
      showFeedback(err.message || 'Silme sırasında hata oluştu.', true);
    } finally {
      setBusy(false);
      button.disabled = false;
    }
  }

  /* ---------- Başlat ---------- */
  buildShell();
  loadBots();
})();
