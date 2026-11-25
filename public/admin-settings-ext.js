(() => {
  'use strict';

  const SETTINGS_API = '/api/admin/settings-ext';
  const ABOUT_API = '/api/admin/settings-ext/about';
  const META_API = '/api/admin/settings-ext/meta';
  const ABOUT_MAX_CONTENT = 100000;
  const INTERVAL_MIN = 5;
  const INTERVAL_MAX = 1440;
  const POPUP_HOURS_MIN = 1;
  const POPUP_HOURS_MAX = 720;
  const TAB_MAX_CATEGORIES = 8;

  function el(tag, options, children) {
    const node = document.createElement(tag);
    const opts = options || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.type) node.type = opts.type;
    if (opts.name) node.name = opts.name;
    if (opts.href) node.href = opts.href;
    if (opts.target) node.target = opts.target;
    if (opts.rel) node.rel = opts.rel;
    if (opts.rows) node.rows = opts.rows;
    if (opts.min !== undefined) node.min = String(opts.min);
    if (opts.max !== undefined) node.max = String(opts.max);
    if (opts.step !== undefined) node.step = String(opts.step);
    if (opts.maxLength !== undefined) node.maxLength = opts.maxLength;
    if (opts.ariaLabel) node.setAttribute('aria-label', opts.ariaLabel);
    if (opts.role) node.setAttribute('role', opts.role);
    if (opts.ariaLive) node.setAttribute('aria-live', opts.ariaLive);
    (children || []).forEach((child) => {
      if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  async function request(method, url, body) {
    const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new Error('Sunucuya ulaşılamadı.');
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) throw new Error(data.error || 'İşlem başarısız oldu.');
    return data;
  }

  function setFeedback(box, message, isError) {
    box.textContent = message;
    box.dataset.state = isError ? 'error' : 'success';
  }

  function makeFeedback() {
    return el('p', { className: 'form-feedback', role: 'status', ariaLive: 'polite' });
  }

  async function runSave(button, feedback, task) {
    button.disabled = true;
    try {
      const message = await task();
      setFeedback(feedback, message, false);
    } catch (error) {
      setFeedback(feedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function markUnavailable(feedback, submit, what) {
    setFeedback(feedback, `${what} yüklenemedi. Sayfayı yenileyip tekrar deneyin.`, true);
    submit.disabled = true;
  }

  // ---------- Hakkımızda ----------
  function buildAbout(panel) {
    const feedback = makeFeedback();
    const status = el('select', { name: 'status' }, [
      new Option('Taslak', 'draft'),
      new Option('Yayında', 'published')
    ]);
    const content = el('textarea', { name: 'content', rows: 14, maxLength: ABOUT_MAX_CONTENT, ariaLabel: 'Hakkımızda içeriği' });
    const submit = el('button', { className: 'primary-action', type: 'submit', text: 'Kaydet' });
    submit.disabled = true;
    const hint = el('small', { text: 'Düz metin girin. Boş satır yeni paragraf oluşturur.' });

    const form = el('form', { className: 'admin-form-grid' }, [
      el('label', null, ['Durum', status]),
      el('label', { className: 'form-wide' }, ['İçerik', content, hint]),
      el('div', { className: 'form-wide' }, [
        el('a', { className: 'secondary-action', href: '/hakkimizda', target: '_blank', rel: 'noopener', text: 'Sitedeki sayfayı görüntüle' }),
        submit
      ]),
      feedback
    ]);

    let ready = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!ready) return;
      const body = { content: content.value, status: status.value };
      if (body.content.length > ABOUT_MAX_CONTENT) {
        setFeedback(feedback, `İçerik en fazla ${ABOUT_MAX_CONTENT} karakter olabilir.`, true);
        return;
      }
      runSave(submit, feedback, async () => {
        const data = await request('PUT', ABOUT_API, body);
        status.value = data.page ? data.page.status : status.value;
        return 'Hakkımızda sayfası kaydedildi.';
      });
    });

    panel.textContent = '';
    panel.append(
      el('p', { className: 'section-kicker', text: 'Kurumsal sayfa' }),
      el('p', { className: 'panel-intro', text: 'Boş veya taslaksa sitede varsayılan kurumsal metin gösterilir.' }),
      form
    );

    return {
      fill(data) {
        if (!data.aboutOk) return markUnavailable(feedback, submit, 'Hakkımızda sayfası');
        const page = data.about;
        status.value = page && page.status === 'published' ? 'published' : 'draft';
        content.value = page && page.content ? page.content : '';
        ready = true;
        submit.disabled = false;
      }
    };
  }

  // ---------- Modül Ayarları (basınsoft düzeni) ----------
  const MODULE_TABS = [
    ['Genel Ayarlar', 'site-kimligi', false],
    ['Hakkımızda Ayarları', 'hakkimizda-ayarlari', false],
    ['Modül Ayarları', 'modul-ayarlari', true],
    ['API Ayarları', 'ayarlar', false],
    ['Tema Ayarları', 'tema-ayarlari', false],
    ['Cron Ayarları', 'cron-ayarlari', false]
  ];

  // [ayar anahtarı, kart adı, tür]
  const MODULE_CARDS = [
    ['module.breaking', 'Son Dakika', 'toggle'],
    ['module.strip', 'Yatay Manşet', 'toggle'],
    ['module.featured', 'Spot', 'toggle'],
    ['module.fx', 'Döviz Kurları', 'toggle'],
    ['module.columnists', 'Yazarlar', 'toggle'],
    ['module.photos', 'Foto Galeri', 'toggle'],
    ['module.videos', 'Video Galeri', 'toggle'],
    ['module.announcements', 'Resmi İlanlar', 'toggle'],
    ['module.weather', 'Hava Durumu', 'toggle'],
    ['module.prayer', 'Namaz Vakitleri', 'toggle'],
    ['module.pharmacy', 'Nöbetçi Eczaneler', 'pending'],
    ['module.papers', 'Gazete Manşetleri', 'pending'],
    ['module.horoscope', 'Burç Yorumları', 'toggle'],
    ['module.standings', 'Puan Durumu', 'pending'],
    ['league.default', 'Default Lig', 'league'],
    ['module.local', 'Yerel Haberler', 'toggle'],
    ['module.onlinePaper', 'Online Gazete', 'pending'],
    ['module.movies', 'Vizyondaki Filmler', 'toggle'],
    ['module.lottery', 'Şans Oyunları', 'pending'],
    ['module.directory', 'Firma Rehberi', 'pending'],
    ['module.traffic', 'Trafik Durumu', 'pending'],
    ['module.comments', 'Yorumlar', 'toggle'],
    ['blog.1', '1. Blog', 'category'],
    ['blog.2', '2. Blog', 'category'],
    ['tabs.categories', 'Tab Menü', 'tabs'],
    ['numbered.category', 'Numaralı Haberler', 'numbered'],
    ['module.popup', 'Popup Reklam', 'toggle'],
    ['popup.hours', 'Popup Reklam Süresi', 'hours'],
    ['module.city', 'Modül Şehir', 'city'],
    ['module.polls', 'Anketler', 'toggle'],
    ['module.visitorPosts', 'Ziyaretçi Haberleri', 'toggle']
  ];

  const LEAGUE_OPTIONS = [
    ['super-lig', 'Süper Lig'],
    ['tff-1', 'TFF 1. Lig'],
    ['tff-2', 'TFF 2. Lig'],
    ['tff-3', 'TFF 3. Lig']
  ];

  function moduleCard(name, body, extra) {
    return el('div', { className: 'mod-card' }, [
      el('div', { className: 'mod-card-head' }, [
        el('strong', { className: 'mod-card-title', text: name }),
        el('span', { className: 'mod-badge', text: 'v1.0' })
      ]),
      el('div', { className: 'mod-card-sub', text: 'Art World TV' }),
      body,
      extra
    ]);
  }

  function buildModules(panel) {
    const feedback = makeFeedback();
    const controls = {};
    const populate = [];
    const tabsBox = el('div', { className: 'mod-check-list' });
    const tabsHint = el('small', { className: 'mod-hint' });
    let tabChecks = [];

    function updateTabsHint() {
      const count = tabChecks.filter((item) => item.box.checked).length;
      tabsHint.textContent = count === 0 ? 'Otomatik' : `Seçili: ${count}/${TAB_MAX_CATEGORIES}`;
    }

    const cards = MODULE_CARDS.map(([key, name, kind]) => {
      if (kind === 'toggle') {
        const select = el('select', { name: key, ariaLabel: name }, [
          new Option('Aktif', 'on'),
          new Option('Pasif', 'off')
        ]);
        controls[key] = {
          value: () => select.value,
          set: (v) => { select.value = v === 'off' ? 'off' : 'on'; }
        };
        return moduleCard(name, select);
      }

      if (kind === 'pending') {
        // Veri kaynağı bağlanana kadar kapalı; değer kaydedilmez.
        const select = el('select', { name: key, ariaLabel: name }, [new Option('Pasif', 'off')]);
        select.disabled = true;
        return moduleCard(name, select, el('small', { className: 'mod-hint', text: 'API bağlanınca çalışır' }));
      }

      if (kind === 'league') {
        const select = el('select', { name: key, ariaLabel: name }, LEAGUE_OPTIONS.map(([value, text]) => new Option(text, value)));
        controls[key] = {
          value: () => select.value,
          set: (v) => { select.value = v || 'super-lig'; }
        };
        return moduleCard(name, select, el('small', { className: 'mod-hint', text: "Puan Durumu API'si bağlanınca kullanılır" }));
      }

      if (kind === 'category' || kind === 'numbered') {
        const withAll = kind === 'numbered';
        const select = el('select', { name: key, ariaLabel: name });
        controls[key] = {
          value: () => select.value,
          set: (v) => { select.value = v || ''; }
        };
        populate.push((meta) => {
          select.textContent = '';
          if (withAll) select.appendChild(new Option('Tüm haberler', ''));
          meta.categories.forEach((category) => select.appendChild(new Option(category.name, category.slug)));
        });
        return moduleCard(name, select);
      }

      if (kind === 'tabs') {
        controls[key] = {
          value: () => tabChecks.filter((item) => item.box.checked).map((item) => item.slug).join(','),
          set: (v) => {
            const list = (v || '').split(',').filter(Boolean);
            tabChecks.forEach((item) => { item.box.checked = list.includes(item.slug); });
            updateTabsHint();
          }
        };
        populate.push((meta) => {
          tabsBox.textContent = '';
          tabChecks = meta.categories.map((category) => {
            const box = el('input', { type: 'checkbox', name: 'tabs.categories', ariaLabel: category.name });
            box.addEventListener('change', () => {
              if (box.checked && tabChecks.filter((item) => item.box.checked).length > TAB_MAX_CATEGORIES) {
                box.checked = false;
                setFeedback(feedback, `Tab Menü için en fazla ${TAB_MAX_CATEGORIES} kategori seçebilirsiniz.`, true);
              }
              updateTabsHint();
            });
            tabsBox.appendChild(el('label', null, [box, ' ', category.name]));
            return { slug: category.slug, box };
          });
        });
        return moduleCard(name, tabsBox, tabsHint);
      }

      if (kind === 'hours') {
        const input = el('input', {
          type: 'number', name: key, min: POPUP_HOURS_MIN, max: POPUP_HOURS_MAX, step: 1, ariaLabel: name
        });
        controls[key] = {
          value: () => input.value.trim(),
          set: (v) => { input.value = v || '24'; }
        };
        return moduleCard(name, input, el('small', { className: 'mod-hint', text: `Saat cinsinden (${POPUP_HOURS_MIN}-${POPUP_HOURS_MAX})` }));
      }

      // kind === 'city'
      const select = el('select', { name: key, ariaLabel: name });
      controls[key] = {
        value: () => select.value,
        set: (v) => { select.value = v || ''; }
      };
      populate.push((meta) => {
        select.textContent = '';
        meta.cities.forEach((city) => select.appendChild(new Option(city, city)));
      });
      return moduleCard(name, select);
    });

    const submit = el('button', { className: 'primary-action', type: 'submit', text: 'Kaydet' });
    submit.disabled = true;

    const form = el('form', { className: 'mod-form' }, [
      el('div', { className: 'mod-grid' }, cards),
      el('div', { className: 'mod-save-row' }, [submit]),
      feedback
    ]);

    let ready = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!ready) return;
      const body = {};
      Object.keys(controls).forEach((key) => { body[key] = controls[key].value(); });

      const hours = body[`popup.hours`];
      if (!/^\d+$/.test(hours) || Number(hours) < POPUP_HOURS_MIN || Number(hours) > POPUP_HOURS_MAX) {
        setFeedback(feedback, `Popup Reklam Süresi ${POPUP_HOURS_MIN}-${POPUP_HOURS_MAX} saat arasında tam sayı olmalıdır.`, true);
        return;
      }
      body['popup.hours'] = Number(hours);

      runSave(submit, feedback, async () => {
        await request('PUT', SETTINGS_API, body);
        return 'Modül ayarları kaydedildi.';
      });
    });

    const tabRow = el('div', { className: 'mod-tabs' }, MODULE_TABS.map(([label, target, active]) => {
      const button = el('button', { type: 'button', className: active ? 'mod-tab is-active' : 'mod-tab', text: label });
      button.addEventListener('click', () => {
        document.querySelector(`.admin-tab[data-tab="${target}"]`)?.click();
      });
      return button;
    }));

    const note = el('div', { className: 'mod-note' }, [
      el('strong', { text: 'Önemli Not' }),
      el('p', {
        text: "Popup reklam süresi, popup reklamın aynı ziyaretçiye hangi aralıklarla gösterileceğini belirler (varsayılan 24 saat). Popup Reklam modülünü açmadan önce Reklam Yönetimi'nden 'Popup' alanına aktif bir reklam ekleyin."
      })
    ]);

    panel.textContent = '';
    panel.append(
      el('h2', { className: 'mod-title', text: 'Modül Ayarları' }),
      tabRow,
      note,
      form
    );

    return {
      fill(data) {
        if (!data.settingsOk || !data.metaOk) {
          setFeedback(feedback, 'Modül ayarları yüklenemedi. Sayfayı yenileyip tekrar deneyin.', true);
          submit.disabled = true;
          return;
        }
        populate.forEach((run) => run(data.meta));
        Object.keys(controls).forEach((key) => controls[key].set(data.settings[key]));
        updateTabsHint();
        ready = true;
        submit.disabled = false;
      }
    };
  }

  // ---------- Tema Ayarları ----------
  function colorField(labelText, fallback) {
    let value = '';
    const input = el('input', { type: 'color', ariaLabel: labelText });
    const note = el('small');
    const reset = el('button', { className: 'secondary-action', type: 'button', text: 'Varsayılana dön' });

    function render() {
      input.value = value || fallback;
      note.textContent = value ? `Özel renk: ${value}` : `Varsayılan renk kullanılıyor (${fallback})`;
    }

    input.addEventListener('input', () => {
      value = input.value.toLowerCase();
      note.textContent = `Özel renk: ${value}`;
    });
    reset.addEventListener('click', () => {
      value = '';
      render();
    });

    return {
      node: el('div', { className: 'color-field' }, [el('span', { text: labelText }), input, note, reset]),
      get: () => value,
      set: (next) => {
        value = next || '';
        render();
      }
    };
  }

  function buildTheme(panel) {
    const feedback = makeFeedback();
    const primary = colorField('Ana renk', '#e02424');
    const accent = colorField('Vurgu rengi', '#1e293b');
    const defaultDark = el('input', { type: 'checkbox', name: 'theme.defaultDark' });
    const submit = el('button', { className: 'primary-action', type: 'submit', text: 'Kaydet' });
    submit.disabled = true;

    const form = el('form', null, [
      el('div', { className: 'admin-form-grid' }, [
        primary.node,
        accent.node,
        el('label', { className: 'form-wide' }, [defaultDark, ' Siteyi varsayılan olarak koyu temada aç'])
      ]),
      el('p', { className: 'panel-intro', text: 'Ana renk: bölüm başlıkları, son dakika, butonlar ve bağlantı vurguları. Vurgu rengi: footer, koyu bantlar ve numaralı haberler. "Varsayılana dön" basınsoft renklerine döndürür. Koyu tema seçiliyse ziyaretçi kendi tercihini başlıktaki ay düğmesiyle değiştirebilir.' }),
      el('div', { className: 'form-wide' }, [submit]),
      feedback
    ]);

    let ready = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!ready) return;
      const body = {
        'theme.primary': primary.get(),
        'theme.accent': accent.get(),
        'theme.defaultDark': defaultDark.checked ? 'on' : 'off'
      };
      runSave(submit, feedback, async () => {
        await request('PUT', SETTINGS_API, body);
        return 'Tema ayarları kaydedildi.';
      });
    });

    panel.textContent = '';
    panel.append(
      el('p', { className: 'section-kicker', text: 'Görünüm' }),
      form
    );

    return {
      fill(data) {
        if (!data.settingsOk) return markUnavailable(feedback, submit, 'Tema ayarları');
        primary.set(data.settings['theme.primary']);
        accent.set(data.settings['theme.accent']);
        defaultDark.checked = data.settings['theme.defaultDark'] === 'on';
        ready = true;
        submit.disabled = false;
      }
    };
  }

  // ---------- Cron Ayarları ----------
  function buildCron(panel) {
    const feedback = makeFeedback();
    const botsEnabled = el('input', { type: 'checkbox', name: 'cron.botsEnabled' });
    const interval = el('input', {
      type: 'number', name: 'cron.botIntervalMinutes', min: INTERVAL_MIN, max: INTERVAL_MAX, step: 1
    });
    const submit = el('button', { className: 'primary-action', type: 'submit', text: 'Kaydet' });
    submit.disabled = true;

    const form = el('form', null, [
      el('div', { className: 'admin-form-grid' }, [
        el('label', { className: 'form-wide' }, [botsEnabled, ' İçerik botları otomatik çalışsın']),
        el('label', null, ['Çekme aralığı (dakika)', interval])
      ]),
      el('p', { className: 'panel-intro', text: 'Planlı (ileri tarihli) içerikler, zamanı geldikten sonra siteye gelen ilk ziyaretle (en geç birkaç dakika içinde) yayımlanır. Bot çekimi ise canlı sitede (Vercel) günde bir kez, 03:00\'te çalışır; çekme aralığı ancak daha sık çalışan harici bir zamanlayıcıyla etkili olur. Bir ajansı istediğiniz an İçerik Botları sayfasındaki "Şimdi çek" ile çekebilirsiniz.' }),
      el('div', { className: 'form-wide' }, [submit]),
      feedback
    ]);

    let ready = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!ready) return;
      const minutes = Number(interval.value);
      if (!Number.isInteger(minutes) || minutes < INTERVAL_MIN || minutes > INTERVAL_MAX) {
        setFeedback(feedback, `Çekme aralığı ${INTERVAL_MIN}-${INTERVAL_MAX} dakika arasında tam sayı olmalıdır.`, true);
        return;
      }
      const body = {
        'cron.botsEnabled': botsEnabled.checked ? 'on' : 'off',
        'cron.botIntervalMinutes': minutes
      };
      runSave(submit, feedback, async () => {
        const data = await request('PUT', SETTINGS_API, body);
        if (data.settings) interval.value = data.settings['cron.botIntervalMinutes'];
        return 'Cron ayarları kaydedildi.';
      });
    });

    panel.textContent = '';
    panel.append(
      el('p', { className: 'section-kicker', text: 'Zamanlayıcı' }),
      form
    );

    return {
      fill(data) {
        if (!data.settingsOk) return markUnavailable(feedback, submit, 'Cron ayarları');
        botsEnabled.checked = data.settings['cron.botsEnabled'] !== 'off';
        interval.value = data.settings['cron.botIntervalMinutes'];
        ready = true;
        submit.disabled = false;
      }
    };
  }

  // ---------- Sosyal medya ----------
  const SOCIAL = [
    ['social.fb', 'Facebook', ''],
    ['social.x', 'X / Twitter', ''],
    ['social.ig', 'Instagram', ''],
    ['social.yt', 'YouTube', ''],
    ['social.li', 'LinkedIn', ''],
    ['social.tumblr', 'Tumblr', ''],
    ['social.wa', 'WhatsApp', 'https://wa.me/905xxxxxxxxx'],
    ['social.tg', 'Telegram', ''],
    ['social.pin', 'Pinterest', '']
  ];

  function buildSocial(panel) {
    const feedback = makeFeedback();
    const inputs = {};
    const fields = SOCIAL.map(([key, label, placeholder]) => {
      const input = el('input', { type: 'url', name: key, ariaLabel: label });
      input.placeholder = placeholder || 'https://';
      input.maxLength = 500;
      inputs[key] = input;
      return el('label', { className: 'form-wide' }, [label, input]);
    });
    const submit = el('button', { className: 'primary-action', type: 'submit', text: 'Kaydet' });
    submit.disabled = true;

    const form = el('form', null, [
      el('div', { className: 'admin-form-grid' }, fields),
      el('div', { className: 'form-wide' }, [submit]),
      feedback
    ]);

    let ready = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!ready) return;
      const body = {};
      SOCIAL.forEach(([key]) => { body[key] = inputs[key].value.trim(); });
      runSave(submit, feedback, async () => {
        await request('PUT', SETTINGS_API, body);
        return 'Sosyal medya ayarları kaydedildi.';
      });
    });

    panel.textContent = '';
    panel.append(
      el('p', { className: 'section-kicker', text: 'Sosyal medya hesapları' }),
      el('p', { className: 'panel-intro', text: 'Boş bıraktığınız hesabın ikonu sitede görünmez. Ana sayfanın üst bar ve footer\'ındaki ikonlar buradan beslenir.' }),
      form
    );

    return {
      fill(data) {
        if (!data.settingsOk) return markUnavailable(feedback, submit, 'Sosyal medya ayarları');
        SOCIAL.forEach(([key]) => { inputs[key].value = data.settings[key] || ''; });
        ready = true;
        submit.disabled = false;
      }
    };
  }

  const BUILDERS = {
    'hakkimizda-ayarlari': buildAbout,
    'modul-ayarlari': buildModules,
    'tema-ayarlari': buildTheme,
    'cron-ayarlari': buildCron,
    'sosyal-medya': buildSocial
  };

  async function init() {
    const instances = [];
    Object.keys(BUILDERS).forEach((name) => {
      const panel = document.querySelector(`.admin-content[data-panel="${name}"]`);
      if (panel) instances.push(BUILDERS[name](panel));
    });
    if (instances.length === 0) return;

    const [settingsResult, aboutResult, metaResult] = await Promise.allSettled([
      request('GET', SETTINGS_API),
      request('GET', ABOUT_API),
      request('GET', META_API)
    ]);

    const data = {
      settingsOk: settingsResult.status === 'fulfilled',
      settings: settingsResult.status === 'fulfilled' ? settingsResult.value.settings : null,
      aboutOk: aboutResult.status === 'fulfilled',
      about: aboutResult.status === 'fulfilled' ? aboutResult.value.page : null,
      metaOk: metaResult.status === 'fulfilled',
      meta: metaResult.status === 'fulfilled' ? metaResult.value : null
    };
    instances.forEach((instance) => instance.fill(data));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
