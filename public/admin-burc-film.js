(function(){
  const panel = document.querySelector('.admin-content[data-panel="burc-film"]');
  if(!panel) return;

  const HOROSCOPE_API = '/api/admin/horoscopes';
  const MOVIE_API = '/api/admin/movies';
  const MOVIE_STATUS_LABELS = { draft:'Taslak', published:'Yayında' };
  const MOVIE_STATUS_PILL = { draft:'draft-pill', published:'live-pill' };
  let horoscopes = [];
  let movies = [];
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

  async function request(path, options){
    const opts = Object.assign({ credentials:'same-origin', headers:{ 'Accept':'application/json' } }, options || {});
    const response = await fetch(path, opts);
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'İşlem başarısız.');
    return data;
  }

  function jsonOptions(method, body){
    return {
      method,
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify(body)
    };
  }

  function setFeedback(node, message, isError){
    if (!node) return;
    node.textContent = message || '';
    node.style.color = isError ? '' : 'var(--green)';
  }

  // Sabit iskelet (kullanıcı verisi içermez); dinamik içerik DOM API ile eklenir.
  function buildShell(){
    panel.textContent = '';

    const refresh = el('button', { className:'secondary-action', id:'burc-film-refresh', type:'button', text:'Yenile' });
    panel.appendChild(el('div', { className:'panel-intro' }, [
      el('div', null, [
        el('span', { className:'section-kicker', text:'İÇERİK OPERASYONU' }),
        el('h3', { text:'Burçlar ve vizyondaki filmler' }),
        el('p', { text:'Burç yorumları her sabah yapay zekâyla yazılır, vizyondaki filmler her gün TMDB’den çekilir. Gerekirse buradan elle düzenleyebilir ya da hemen yeniletebilirsiniz.' })
      ]),
      refresh
    ]));
    refresh.addEventListener('click', () => loadAll(refresh));

    // ---- Burçlar ----
    ui.horoscopeCount = el('span', { id:'horoscope-count', text:'0 burç' });
    ui.horoscopeList = el('div', { className:'admin-managed-list', id:'horoscope-list', 'aria-live':'polite' });
    panel.appendChild(el('div', { className:'admin-table' }, [
      el('div', { className:'table-heading' }, [
        el('strong', { text:'Günlük burç yorumları' }),
        ui.horoscopeCount
      ]),
      ui.horoscopeList
    ]));
    ui.horoscopeFeedback = el('p', { className:'form-feedback', id:'horoscope-feedback', role:'status' });
    panel.appendChild(ui.horoscopeFeedback);
    ui.horoscopeAuto = buildAutoBar('Şimdi üret', `${HOROSCOPE_API}/generate`, ui.horoscopeFeedback, loadHoroscopes,
      'Otomatik yorum kapalı: isterseniz Ayarlar > API ve entegrasyonlar\'dan Anthropic anahtarı girin. Yorumlar burada elle de düzenlenebilir.');
    ui.horoscopeList.parentNode.insertBefore(ui.horoscopeAuto.node, ui.horoscopeList);

    // ---- Vizyondaki filmler ----
    ui.movieFeedback = el('p', { className:'form-feedback', id:'movie-feedback', role:'status' });
    ui.movieSubmit = el('button', { className:'primary-action', type:'submit', text:'Filmi ekle' });
    ui.movieFields = {
      title: el('input', { name:'title', required:'required', maxlength:'200' }),
      genre: el('input', { name:'genre', maxlength:'60' }),
      durationMin: el('input', { name:'durationMin', type:'number', min:'1', max:'600', step:'1' }),
      releaseDate: el('input', { name:'releaseDate', type:'date' }),
      rating: el('input', { name:'rating', type:'number', min:'0', max:'10', step:'0.1' }),
      posterUrl: el('input', { name:'posterUrl', type:'text', placeholder:'https://... veya /gorseller/afis.jpg', maxlength:'2000' }),
      summary: el('textarea', { name:'summary', rows:'3', maxlength:'2000' }),
      status: el('select', { name:'status' }, Object.keys(MOVIE_STATUS_LABELS).map(value =>
        el('option', { value, text:MOVIE_STATUS_LABELS[value] })
      ))
    };

    ui.movieForm = el('form', { className:'admin-form-grid', id:'movie-form' });
    ui.movieForm.appendChild(el('div', { className:'form-wide' }, [
      el('span', { className:'section-kicker', text:'YENİ FİLM' }),
      el('h4', { text:'Vizyondaki film ekle' })
    ]));
    ui.movieForm.appendChild(el('label', null, [document.createTextNode('Ad'), ui.movieFields.title]));
    ui.movieForm.appendChild(el('label', null, [document.createTextNode('Tür'), ui.movieFields.genre]));
    ui.movieForm.appendChild(el('label', null, [document.createTextNode('Süre (dk)'), ui.movieFields.durationMin]));
    ui.movieForm.appendChild(el('label', null, [document.createTextNode('Vizyon tarihi'), ui.movieFields.releaseDate]));
    ui.movieForm.appendChild(el('label', null, [document.createTextNode('Puan (0-10)'), ui.movieFields.rating]));
    ui.movieForm.appendChild(el('label', null, [document.createTextNode('Durum'), ui.movieFields.status]));
    ui.movieForm.appendChild(el('label', { className:'form-wide' }, [document.createTextNode('Afiş URL'), ui.movieFields.posterUrl]));
    ui.movieForm.appendChild(el('label', { className:'form-wide' }, [document.createTextNode('Özet'), ui.movieFields.summary]));
    ui.movieForm.appendChild(ui.movieSubmit);
    ui.movieForm.appendChild(ui.movieFeedback);
    panel.appendChild(ui.movieForm);

    ui.movieCount = el('span', { id:'movie-count', text:'0 film' });
    ui.movieList = el('div', { className:'admin-managed-list', id:'movie-list', 'aria-live':'polite' });
    panel.appendChild(el('div', { className:'admin-table' }, [
      el('div', { className:'table-heading' }, [
        el('strong', { text:'Vizyondaki filmler' }),
        ui.movieCount
      ]),
      ui.movieList
    ]));
    ui.movieAuto = buildAutoBar('TMDB’den çek', `${MOVIE_API}/sync`, ui.movieFeedback, loadMovies,
      'Otomatik film çekimi için Ayarlar > API ve entegrasyonlar\'dan TMDB anahtarı girin.');
    ui.movieList.parentNode.insertBefore(ui.movieAuto.node, ui.movieList);

    ui.movieForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const f = ui.movieFields;
      const payload = {
        title: f.title.value.trim(),
        genre: f.genre.value.trim(),
        durationMin: f.durationMin.value,
        releaseDate: f.releaseDate.value,
        rating: f.rating.value,
        posterUrl: f.posterUrl.value.trim(),
        summary: f.summary.value.trim(),
        status: f.status.value
      };
      if (!payload.title) {
        setFeedback(ui.movieFeedback, 'Film adı zorunludur.', true);
        return;
      }
      ui.movieSubmit.disabled = true;
      setFeedback(ui.movieFeedback, 'Kaydediliyor...', false);
      try {
        await request(MOVIE_API, jsonOptions('POST', payload));
        ui.movieForm.reset();
        setFeedback(ui.movieFeedback, 'Film kaydedildi.', false);
        await loadMovies();
      } catch (error) {
        setFeedback(ui.movieFeedback, error.message, true);
      } finally {
        ui.movieSubmit.disabled = false;
      }
    });
  }

  // ---------- Otomatik içerik durumu ----------

  // Liste başında: son otomatik çalışma bilgisi ve "hemen çalıştır" butonu.
  function buildAutoBar(label, path, feedbackNode, reload, missingText){
    const info = el('small', { className:'auto-feed-info', text:'Otomatik içerik durumu yükleniyor…' });
    const button = el('button', { className:'secondary-action', type:'button', text:label });
    const node = el('div', { className:'auto-feed-bar' }, [info, button]);
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Çalışıyor…';
      setFeedback(feedbackNode, '', false);
      try {
        const data = await request(path, { method:'POST', headers:{ 'Accept':'application/json' } });
        setFeedback(feedbackNode, data.result || '', !data.ok);
        await reload();
      } catch (error) {
        setFeedback(feedbackNode, error.message, true);
      } finally {
        button.textContent = label;
        button.disabled = !bar.configured;
      }
    });
    const bar = {
      node,
      configured: false,
      update(auto){
        bar.configured = Boolean(auto && auto.configured);
        button.disabled = !bar.configured;
        if (!auto) { info.textContent = ''; return; }
        if (!auto.configured) { info.textContent = missingText; return; }
        info.textContent = auto.last_run_at
          ? `Otomatik: son çalışma ${formatDateTime(auto.last_run_at)} — ${auto.last_result}`
          : 'Otomatik: henüz çalışmadı.';
      }
    };
    return bar;
  }

  // ---------- Burç satırları ----------

  function renderHoroscopes(){
    ui.horoscopeCount.textContent = `${horoscopes.length} burç`;
    ui.horoscopeList.textContent = '';

    if (!horoscopes.length) {
      ui.horoscopeList.appendChild(el('div', { className:'admin-managed-row' }, [
        el('p', { text:'Burç kaydı bulunamadı.' })
      ]));
      return;
    }

    horoscopes.forEach(sign => {
      const feedback = el('small', { className:'form-feedback', role:'status' });
      const dateInput = el('input', { type:'text', maxlength:'60', value: sign.date_range || '', 'aria-label': `${sign.sign_name} tarih aralığı` });
      const textArea = el('textarea', { rows:'3', maxlength:'2000', 'aria-label': `${sign.sign_name} günlük yorum` });
      textArea.value = sign.daily_text || '';
      const saveButton = el('button', { className:'primary-action', type:'button', text:'Kaydet' });

      saveButton.addEventListener('click', async () => {
        const dateRange = dateInput.value.trim();
        if (!dateRange) {
          setFeedback(feedback, 'Tarih aralığı zorunludur.', true);
          return;
        }
        saveButton.disabled = true;
        setFeedback(feedback, 'Kaydediliyor...', false);
        try {
          const data = await request(`${HOROSCOPE_API}/${encodeURIComponent(sign.sign_key)}`, jsonOptions('PATCH', {
            dailyText: textArea.value.trim(),
            dateRange
          }));
          Object.assign(sign, data.horoscope || {});
          setFeedback(feedback, 'Kaydedildi.', false);
        } catch (error) {
          setFeedback(feedback, error.message, true);
        } finally {
          saveButton.disabled = false;
        }
      });

      ui.horoscopeList.appendChild(el('div', { className:'admin-managed-row' }, [
        el('div', { className:'managed-identity' }, [
          el('strong', { text:`${sign.symbol || ''} ${sign.sign_name}` }),
          el('small', { text:`Güncelleme: ${formatDateTime(sign.updated_at)}` })
        ]),
        el('div', { className:'admin-form-grid' }, [
          el('label', null, [document.createTextNode('Tarih aralığı'), dateInput]),
          el('label', { className:'form-wide' }, [document.createTextNode('Günlük yorum'), textArea])
        ]),
        saveButton,
        feedback
      ]));
    });
  }

  // ---------- Film satırları ----------

  function renderMovies(){
    ui.movieCount.textContent = `${movies.length} film`;
    ui.movieList.textContent = '';

    if (!movies.length) {
      ui.movieList.appendChild(el('div', { className:'admin-managed-row' }, [
        el('p', { text:'Henüz film eklenmedi.' })
      ]));
      return;
    }

    movies.forEach(movie => {
      const toggleTarget = movie.status === 'published' ? 'draft' : 'published';
      const toggleLabel = movie.status === 'published' ? 'Taslağa al' : 'Yayınla';
      const toggleButton = el('button', { className:'secondary-action', type:'button', text:toggleLabel });
      toggleButton.addEventListener('click', () => changeMovie(movie, { status: toggleTarget }, toggleButton));

      const deleteButton = el('button', { className:'secondary-action', type:'button', text:'Sil' });
      deleteButton.addEventListener('click', () => removeMovie(movie, deleteButton));

      const details = [
        movie.genre,
        movie.duration_min ? `${movie.duration_min} dk` : null,
        movie.release_date ? `Vizyon: ${movie.release_date}` : null,
        movie.source === 'tmdb' ? 'TMDB' : null
      ].filter(Boolean).join(' · ');

      ui.movieList.appendChild(el('div', { className:'admin-managed-row' }, [
        el('div', { className:'managed-identity' }, [
          el('strong', { text:movie.title }),
          el('small', { text: details || 'Ek bilgi yok' })
        ]),
        el('span', { className:`pill ${MOVIE_STATUS_PILL[movie.status] || ''}`.trim(), text:MOVIE_STATUS_LABELS[movie.status] || movie.status }),
        el('span', { text: movie.rating !== null && movie.rating !== undefined ? `Puan ${movie.rating}` : 'Puan yok' }),
        toggleButton,
        deleteButton
      ]));
    });
  }

  async function changeMovie(movie, body, button){
    button.disabled = true;
    try {
      await request(`${MOVIE_API}/${encodeURIComponent(movie.id)}`, jsonOptions('PATCH', body));
      setFeedback(ui.movieFeedback, 'Film güncellendi.', false);
      await loadMovies();
    } catch (error) {
      setFeedback(ui.movieFeedback, error.message, true);
      button.disabled = false;
    }
  }

  async function removeMovie(movie, button){
    if (!window.confirm(`"${movie.title}" filmi listeden kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    button.disabled = true;
    try {
      await request(`${MOVIE_API}/${encodeURIComponent(movie.id)}`, { method:'DELETE' });
      setFeedback(ui.movieFeedback, 'Film silindi.', false);
      await loadMovies();
    } catch (error) {
      setFeedback(ui.movieFeedback, error.message, true);
      button.disabled = false;
    }
  }

  function formatDateTime(value){
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('tr-TR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  // ---------- Yükleme ----------

  async function loadHoroscopes(){
    try {
      const data = await request(HOROSCOPE_API);
      horoscopes = Array.isArray(data.horoscopes) ? data.horoscopes : [];
      ui.horoscopeAuto.update(data.auto);
      renderHoroscopes();
    } catch (error) {
      setFeedback(ui.horoscopeFeedback, error.message, true);
    }
  }

  async function loadMovies(){
    try {
      const data = await request(MOVIE_API);
      movies = Array.isArray(data.movies) ? data.movies : [];
      ui.movieAuto.update(data.auto);
      renderMovies();
    } catch (error) {
      setFeedback(ui.movieFeedback, error.message, true);
    }
  }

  async function loadAll(button){
    if (button) button.disabled = true;
    try {
      await Promise.all([loadHoroscopes(), loadMovies()]);
    } finally {
      if (button) button.disabled = false;
    }
  }

  buildShell();
  loadAll();
})();
