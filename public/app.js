const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const toast = (message) => { const el = $('.toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('visible'), 2600); };

function weatherDescription(code) {
  const descriptions = new Map([[0, 'Açık'], [1, 'Çoğunlukla açık'], [2, 'Parçalı bulutlu'], [3, 'Kapalı'], [45, 'Sisli'], [48, 'Sisli'], [51, 'Hafif çisenti'], [53, 'Çisenti'], [55, 'Yoğun çisenti'], [56, 'Dondurucu çisenti'], [57, 'Yoğun dondurucu çisenti'], [61, 'Hafif yağmur'], [63, 'Yağmurlu'], [65, 'Kuvvetli yağmur'], [66, 'Dondurucu yağmur'], [67, 'Kuvvetli dondurucu yağmur'], [71, 'Hafif kar'], [73, 'Kar yağışlı'], [75, 'Kuvvetli kar'], [77, 'Kar taneleri'], [80, 'Hafif sağanak'], [81, 'Sağanak'], [82, 'Kuvvetli sağanak'], [85, 'Kar sağanağı'], [86, 'Kuvvetli kar sağanağı'], [95, 'Gök gürültülü fırtına'], [96, 'Dolu ihtimalli fırtına'], [99, 'Kuvvetli dolu ihtimalli fırtına']]);
  return descriptions.get(Number(code)) || 'Hava durumu';
}

function formatWidgetDate(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' }).format(date);
}

async function setupBriefingWidgets() {
  const container = $('[data-briefing-widgets]');
  if (!container) return;
  try {
    const response = await fetch('/api/public/briefing-widgets', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Widget verileri alınamadı.');
    const data = await response.json();
    const weather = data.weather;
    if (weather) {
      $('[data-weather-temperature]', container).textContent = `${Math.round(Number(weather.temperature))}°`;
      $('[data-weather-condition]', container).textContent = weatherDescription(weather.weatherCode);
      $('[data-weather-details]', container).textContent = `Bugün ${Math.round(Number(weather.temperatureMin))}° / ${Math.round(Number(weather.temperatureMax))}° · hissedilen ${Math.round(Number(weather.apparentTemperature))}° · nem %${Math.round(Number(weather.humidity))}`;
      $('[data-weather-updated]', container).textContent = `${formatWidgetDate(weather.date)} · tahmin verisi`;
    } else {
      $('[data-weather-condition]', container).textContent = 'Hava verisi şu an alınamıyor.';
      $('[data-weather-details]', container).textContent = 'Bir süre sonra yeniden deneyin.';
    }
    const market = data.market;
    const number = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value)) : '—';
    if (market) {
      $('[data-market-usd]', container).textContent = number(market.usdTry);
      $('[data-market-eur]', container).textContent = number(market.eurTry);
      $('[data-market-details]', container).textContent = 'Günlük merkez bankası referans kurudur; canlı işlem fiyatı değildir.';
      $('[data-market-updated]', container).textContent = `${formatWidgetDate(market.date)} · günlük veri`;
    } else {
      $('[data-market-usd]', container).textContent = '—';
      $('[data-market-eur]', container).textContent = '—';
      $('[data-market-details]', container).textContent = 'Kur verisi şu an alınamıyor. Bir süre sonra yeniden deneyin.';
    }
  } catch {
    $('[data-weather-condition]', container).textContent = 'Hava verisi şu an alınamıyor.';
    $('[data-weather-details]', container).textContent = 'Bir süre sonra yeniden deneyin.';
    $('[data-market-details]', container).textContent = 'Kur verisi şu an alınamıyor. Bir süre sonra yeniden deneyin.';
  }
}

setupBriefingWidgets();
let currentAdminRole = '';
let openArticleEditor = null;

const integrationProviders = {
  'google-gmail': {
    name: 'Google Gmail (bülten gönderimi)',
    help: 'Bülten gönderimi için Google OAuth projesinde Gmail API etkin ve OAuth izni gmail.send kapsamını içermeli. OAuth yenileme tokenı ve gönderen Gmail adresini gir.',
    fields: [
      ['oauth-client-id', 'OAuth istemci kimliği', 'password'],
      ['oauth-client-secret', 'OAuth istemci gizlisi', 'password'],
      ['oauth-refresh-token', 'Gmail API yenileme tokenı', 'password'],
      ['sender-email', 'Gönderen e-posta adresi', 'text']
    ]
  },
  'google-ads': {
    name: 'Google Ads',
    help: 'Google Ads erişim seviyesi artık Google Cloud projesine bağlı. OAuth veya hizmet hesabı kimliğini ve proje numaranı kaydet; müşteri numarası gerekir. Yönetici hesabı üzerinden erişiyorsan MCC numarasını da gir. Eski developer tokenı isteğe bağlıdır.',
    fields: [
      ['cloud-project-id', 'Google Cloud proje kimliği', 'text'],
      ['customer-id', 'Müşteri numarası', 'text', 'Hedef Google Ads hesabının tire olmadan 10 haneli numarası.'],
      ['login-customer-id', 'Yönetici (MCC) müşteri numarası', 'text', 'Yönetici hesabı üzerinden erişiyorsan doldur.'],
      ['oauth-client-id', 'OAuth istemci kimliği', 'password'],
      ['oauth-client-secret', 'OAuth istemci gizlisi', 'password'],
      ['oauth-refresh-token', 'OAuth yenileme tokenı', 'password'],
      ['service-account-json', 'Hizmet hesabı JSON anahtarı', 'textarea', 'OAuth kullanıcı akışına alternatif kimlik doğrulama yöntemi.'],
      ['legacy-developer-token', 'Eski developer token (isteğe bağlı)', 'password', 'Google, 9 Eylül 2026 tarihinde developer token modelini sonlandırdı; eski kurulum bilgisi olarak saklanabilir.']
    ]
  },
  'google-analytics': {
    name: 'Google Analytics 4',
    help: 'Raporlama için GA4 mülk numarasını ve aşağıdaki kimlik doğrulama yöntemlerinden birini kaydet. Hizmet hesabına Analytics mülkünde ayrıca erişim verilmelidir.',
    fields: [
      ['property-id', 'GA4 mülk numarası', 'text'],
      ['service-account-json', 'Hizmet hesabı JSON anahtarı', 'textarea'],
      ['oauth-client-id', 'OAuth istemci kimliği', 'password'],
      ['oauth-client-secret', 'OAuth istemci gizlisi', 'password'],
      ['oauth-refresh-token', 'OAuth yenileme tokenı', 'password']
    ]
  },
  'search-console': {
    name: 'Google Search Console',
    help: 'Search Console özel site verisine OAuth 2.0 ile erişir. Hizmet hesabı kullanıyorsan Search Console mülküne bu hesabı ayrıca eklemelisin.',
    fields: [
      ['site-property', 'Search Console mülk adresi', 'text', 'Ör. https://www.ornek.com/ veya sc-domain:ornek.com'],
      ['service-account-json', 'Hizmet hesabı JSON anahtarı', 'textarea'],
      ['oauth-client-id', 'OAuth istemci kimliği', 'password'],
      ['oauth-client-secret', 'OAuth istemci gizlisi', 'password'],
      ['oauth-refresh-token', 'OAuth yenileme tokenı', 'password']
    ]
  },
  'youtube-live': {
    name: 'YouTube API ve canlı yayın',
    help: 'YouTube canlı yayın oluşturma/yönetme işlemleri OAuth ister. API anahtarı yalnızca herkese açık veriler içindir. RTMP sunucu ve yayın anahtarını encoder ayarlarınla eşleştir.',
    fields: [
      ['channel-id', 'YouTube kanal kimliği', 'text'],
      ['api-key', 'Google API anahtarı', 'password', 'Genel erişimli API istekleri için.'],
      ['oauth-client-id', 'OAuth istemci kimliği', 'password'],
      ['oauth-client-secret', 'OAuth istemci gizlisi', 'password'],
      ['oauth-refresh-token', 'OAuth yenileme tokenı', 'password'],
      ['rtmp-server', 'RTMP sunucu adresi', 'text'],
      ['stream-key', 'Canlı yayın anahtarı', 'password'],
      ['playback-url', 'Yayın izleme adresi', 'text']
    ]
  },
  'google-other': {
    name: 'Diğer Google API',
    help: 'Başka bir Google servisini bağlamak için ilgili proje kimliği ve servisin kabul ettiği API key, OAuth veya hizmet hesabı bilgilerini gir.',
    fields: [
      ['cloud-project-id', 'Google Cloud proje kimliği', 'text'],
      ['api-key', 'API anahtarı', 'password'],
      ['oauth-client-id', 'OAuth istemci kimliği', 'password'],
      ['oauth-client-secret', 'OAuth istemci gizlisi', 'password'],
      ['oauth-refresh-token', 'OAuth yenileme tokenı', 'password'],
      ['service-account-json', 'Hizmet hesabı JSON anahtarı', 'textarea']
    ]
  },
  'live-stream': {
    name: 'Diğer canlı yayın sağlayıcısı (RTMP)',
    help: 'Yayın platformunun verdiği RTMP ingest adresi ve stream key değerlerini kaydet. Bu bilgiler canlı yayın bağlantısı kodlandığında kullanılacak.',
    fields: [
      ['provider-name', 'Yayın sağlayıcısı', 'text'],
      ['rtmp-server', 'RTMP sunucu adresi', 'text'],
      ['stream-key', 'Canlı yayın anahtarı', 'password'],
      ['playback-url', 'Yayın izleme adresi', 'text'],
      ['stream-username', 'RTMP kullanıcı adı (varsa)', 'password'],
      ['stream-password', 'RTMP parolası (varsa)', 'password']
    ]
  },
  tmdb: {
    name: 'TMDB (vizyondaki filmler)',
    help: 'Burçlar ve Filmler sayfasındaki vizyon listesi her gün TMDB\'den çekilir. themoviedb.org > Ayarlar > API sayfasındaki "API Okuma Erişim Anahtarı" (uzun olan) ya da "API Anahtarı" girilebilir.',
    fields: [
      ['api-key', 'TMDB API anahtarı', 'password']
    ]
  },
  anthropic: {
    name: 'Anthropic (günlük burç yorumları)',
    help: 'İsteğe bağlı. Girilirse 12 burcun günlük yorumu her sabah yapay zekâyla yazılır; girilmezse burçlar elle düzenlenir. Anahtar console.anthropic.com adresinden alınır ve kullanım ücretlidir.',
    fields: [
      ['api-key', 'Anthropic API anahtarı', 'password']
    ]
  },
  custom: { name: '', help: 'Yeni bir API ya da entegrasyon için servis adını, bilgi adını ve değerini gir.', fields: [] }
};

$$('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  const name = button.dataset.tab;
  $$('.admin-tab').forEach((tab) => {
    const selected = tab === button;
    tab.classList.toggle('selected', selected);
    if (selected) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
  $$('.admin-content').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
}));
$$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  $$('.filter').forEach((filter) => filter.classList.toggle('active', filter === button));
  $$('.news-card').forEach((card) => card.classList.toggle('hidden-card', button.dataset.filter !== 'Tümü' && card.dataset.category !== button.dataset.filter));
}));
$$('[data-theme]').forEach((button) => button.addEventListener('click', () => document.body.classList.toggle('dark')));
$$('[data-menu]').forEach((button) => {
  const navWrap = $('.nav-wrap');
  const setOpen = (open) => {
    navWrap?.classList.toggle('menu-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
  };
  button.addEventListener('click', () => setOpen(!navWrap?.classList.contains('menu-open')));
  navWrap?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
});
$$('[data-pause]').forEach((button) => button.addEventListener('click', () => {
  const track = $('.ticker-track'); const paused = track.style.animationPlayState === 'paused';
  track.style.animationPlayState = paused ? 'running' : 'paused'; button.textContent = paused ? 'Ⅱ' : '▶';
}));

function setupHeroSliders() {
  $$('[data-hero-slider]').forEach((slider) => {
    const slides = $$('[data-hero-slide]', slider);
    if (slides.length < 2) return;
    let current = Math.max(0, slides.findIndex((slide) => !slide.hidden));
    const update = (next) => {
      current = (next + slides.length) % slides.length;
      slides.forEach((slide, index) => {
        const active = index === current;
        slide.hidden = !active;
        slide.setAttribute('aria-hidden', String(!active));
        $('[data-slider-position]', slide)?.replaceChildren(`${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`);
        const leadCounter = $('.lead-counter', slide);
        if (leadCounter) leadCounter.innerHTML = `${String(index + 1).padStart(2, '0')} <i>/</i> ${String(slides.length).padStart(2, '0')}`;
      });
    };
    slider.addEventListener('click', (event) => {
      if (event.target.closest('[data-slider-prev]')) { event.preventDefault(); event.stopPropagation(); update(current - 1); }
      if (event.target.closest('[data-slider-next]')) { event.preventDefault(); event.stopPropagation(); update(current + 1); }
    });
  });
}
setupHeroSliders();

$$('[data-toast]').forEach((button) => button.addEventListener('click', () => toast(button.dataset.toast)));
$$('[data-tab="haber"], [data-tab="reklam"], [data-tab="crm"]').filter((button) => !button.classList.contains('admin-tab')).forEach((button) => button.addEventListener('click', () => {
  const target = $(`.admin-tab[data-tab="${button.dataset.tab}"]`); target?.click(); $('.admin-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
$$('[data-live]').forEach((button) => button.addEventListener('click', () => toast('Canlı yayın bağlantısı hazır olduğunda burada açılacak.')));

const searchButton = $('[data-search]');
searchButton?.addEventListener('click', () => {
  const overlay = document.createElement('div'); overlay.className = 'search-overlay'; overlay.innerHTML = '<div class="search-box"><button class="search-close" aria-label="Aramayı kapat">×</button><label for="site-search">Art World TV\'de ara</label><div><input id="site-search" type="search" placeholder="Haber, konu veya kişi ara"><button data-submit-search>Ara</button></div></div>';
  document.body.append(overlay); const input = $('#site-search', overlay); input.focus();
  $('.search-close', overlay).addEventListener('click', () => overlay.remove()); overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  $('[data-submit-search]', overlay).addEventListener('click', () => {
    const query = input.value.trim();
    if (query.length >= 2) window.location.assign(`/arama?q=${encodeURIComponent(query)}`);
    else { input.focus(); input.setCustomValidity('Arama için en az 2 karakter yazın.'); input.reportValidity(); }
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('[data-submit-search]', overlay).click(); if (event.key === 'Escape') overlay.remove(); });
});

$$('[data-newsletter]').forEach((form) => form.addEventListener('submit', async (event) => {
  event.preventDefault(); const input = $('input[type="email"]', form); const consent = $('input[name="consent"]', form); const message = $('[data-form-message]', form); const button = $('button[type="submit"]', form);
  if (!input?.value || !consent?.checked) { message.textContent = 'E-posta adresi ve bülten izni gerekli.'; return; }
  button.disabled = true; message.textContent = 'Kaydınız işleniyor…';
  try {
    await apiRequest('/api/newsletter/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.value, consent: true, noticeVersion: 'newsletter-v1' }) });
    message.textContent = 'Aboneliği tamamlamak için e-postanıza gönderilen bağlantıyı doğrulayın.'; form.reset();
  } catch (error) { message.textContent = error.message || 'Kayıt sırasında bir hata oluştu.'; }
  finally { button.disabled = false; }
}));

$$('[data-newsletter-action]').forEach((form) => form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type="submit"]', form);
  const message = $('[data-form-message]', form);
  button.disabled = true;
  try {
    await apiRequest(`/api/newsletter/${form.dataset.newsletterAction}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: form.elements.token.value }) });
    message.textContent = form.dataset.newsletterAction === 'confirm' ? 'Bülten aboneliğiniz doğrulandı.' : 'Bülten aboneliğiniz sonlandırıldı.';
    button.hidden = true;
  } catch (error) { message.textContent = error.message || 'İşlem tamamlanamadı.'; button.disabled = false; }
}));

$$('[data-share]').forEach((button) => button.addEventListener('click', async () => {
  const value = button.dataset.shareUrl || location.href;
  try { await navigator.clipboard.writeText(value); button.textContent = 'Bağlantı kopyalandı'; }
  catch { button.textContent = value; }
}));

$$('[data-ad-impression]').forEach((slot) => {
  let variants = [];
  try { variants = JSON.parse(slot.dataset.adVariants || '[]'); } catch { variants = []; }
  const image = $('[data-ad-creative-image]', slot);
  image?.addEventListener('error', () => slot.remove(), { once: true });
  const selectedVariant = () => {
    if (!image?.currentSrc) return null;
    const source = new URL(image.currentSrc, location.href).href;
    return variants.find((variant) => new URL(variant.source, location.href).href === source) || null;
  };
  const clickLink = $('[data-ad-click]', slot);
  clickLink?.addEventListener('click', () => { const variant = selectedVariant(); if (variant) clickLink.href = variant.click; });
  const track = () => { if (slot.dataset.impressionSent) return; slot.dataset.impressionSent = 'true'; const variant = selectedVariant(); fetch(variant?.impression || slot.dataset.adImpression, { credentials: 'same-origin', keepalive: true }).catch(() => {}); };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { track(); observer.disconnect(); } }, { threshold: 0.5 });
    observer.observe(slot);
  } else track();
});
$$('[data-load]').forEach((button) => button.addEventListener('click', () => { button.textContent = 'ŞU AN TÜM HABERLER LİSTELENİYOR'; button.disabled = true; }));

const dashboard = $('.dashboard-page');
if (dashboard) initializeAdminPanel();

async function initializeAdminPanel() {
  try {
    const session = await apiRequest('/api/auth/session');
    if (!session.authenticated) return window.location.replace('/giris');
    currentAdminRole = session.user.role;
    window.currentAdminUserId = session.user.id;
    $('#admin-user').textContent = `${session.user.displayName} · ${session.user.roleLabel}`;
    applyDashboardPermissions(currentAdminRole);

    $('#logout-button').addEventListener('click', async () => {
      const button = $('#logout-button');
      button.disabled = true;
      try { await apiRequest('/api/auth/logout', { method: 'POST' }); window.location.assign('/giris'); }
      catch (error) { button.disabled = false; toast(error.message); }
    });

    const canEditNews = ['admin', 'editor_in_chief', 'editor', 'reporter'].includes(currentAdminRole);
    const summary = await apiRequest('/api/dashboard');
    renderSummary(summary);
    if (canEditNews) {
      setupArticleList();
      setupArticleDialog(summary.categories || []);
    }
    setupAdminInnerTabs();
    if (['admin', 'ad_sales'].includes(currentAdminRole)) setupAdvertisingManagement();
    if (['admin', 'crm_manager'].includes(currentAdminRole)) setupCrmManagement();
    if (currentAdminRole === 'admin') { setupAdminManagement(); setupActivityLog(); }
  } catch (error) {
    if (error.status === 401) return window.location.replace('/giris');
    toast(error.message || 'Yönetim verileri alınamadı.');
  }
}

function applyDashboardPermissions(role) {
  const access = {
    admin: ['genel', 'haber', 'reklam', 'crm', 'kullanicilar', 'ayarlar', 'site-kimligi', 'aktivite', 'sayfa', 'sayfalar', 'makaleler', 'galeriler', 'videolar', 'yorumlar', 'footer-linkleri', 'botlar', 'anketler', 'ziyaretci-haberleri', 'resmi-ilanlar', 'burc-film', 'hakkimizda-ayarlari', 'modul-ayarlari', 'tema-ayarlari', 'cron-ayarlari', 'sosyal-medya'],
    editor_in_chief: ['genel', 'haber', 'makaleler', 'galeriler', 'videolar', 'yorumlar', 'anketler', 'sayfalar', 'footer-linkleri', 'ziyaretci-haberleri', 'botlar', 'resmi-ilanlar', 'burc-film'],
    editor: ['genel', 'haber', 'makaleler', 'galeriler', 'videolar', 'yorumlar', 'anketler', 'sayfalar', 'footer-linkleri', 'ziyaretci-haberleri', 'botlar', 'resmi-ilanlar', 'burc-film'],
    reporter: ['genel', 'haber'],
    ad_sales: ['genel', 'reklam'],
    crm_manager: ['genel', 'crm']
  };
  const allowed = new Set(access[role] || ['genel']);
  $$('.admin-tab').forEach((tab) => { tab.hidden = !allowed.has(tab.dataset.tab); });
  $$('.admin-content').forEach((panel) => {
    const visible = allowed.has(panel.dataset.panel);
    panel.hidden = !visible;
    panel.classList.toggle('hidden', !visible || panel.dataset.panel !== 'genel');
  });
  $$('.admin-content[data-panel="genel"] [data-tab="haber"]').forEach((button) => { button.hidden = !allowed.has('haber'); });
  const generalTab = $('.admin-tab[data-tab="genel"]');
  if (generalTab) { generalTab.classList.add('selected'); generalTab.setAttribute('aria-current', 'page'); }
}

function setupAdminInnerTabs() {
  function build(panelName, label, sections) {
    const panel = $(`.admin-content[data-panel="${panelName}"]`);
    if (!panel) return;
    const prepared = sections.map((section) => ({ ...section, nodes: section.nodes.filter(Boolean) })).filter((section) => section.nodes.length);
    if (prepared.length < 2) return;

    const tablist = document.createElement('div');
    tablist.className = 'admin-inner-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', label);
    const tabs = [];
    prepared.forEach((section, index) => {
      const tabId = `admin-${panelName}-inner-tab-${index + 1}`;
      const paneId = `admin-${panelName}-inner-panel-${index + 1}`;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = tabId;
      tab.dataset.innerTab = paneId;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', paneId);
      tab.setAttribute('aria-selected', String(index === 0));
      tab.tabIndex = index === 0 ? 0 : -1;
      tab.textContent = section.title;

      const pane = document.createElement('section');
      pane.id = paneId;
      pane.className = 'admin-inner-panel';
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', tabId);
      pane.hidden = index !== 0;
      section.nodes.forEach((node) => pane.append(node));
      tab.addEventListener('click', () => {
        tabs.forEach(({ button, content }) => {
          const selected = button === tab;
          button.setAttribute('aria-selected', String(selected));
          button.tabIndex = selected ? 0 : -1;
          content.hidden = !selected;
        });
      });
      tabs.push({ button: tab, content: pane });
      tablist.append(tab);
      panel.append(pane);
    });
    tablist.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.findIndex(({ button }) => button.getAttribute('aria-selected') === 'true');
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].button.focus();
      tabs[next].button.click();
    });
    const firstPane = tabs[0]?.content;
    panel.insertBefore(tablist, firstPane || null);
  }

  const tableFor = (panel, childId) => panel.querySelector(`#${childId}`)?.closest('.admin-table');
  const ads = $('.admin-content[data-panel="reklam"]');
  if (ads) build('reklam', 'Reklam yönetimi bölümleri', [
    { title: 'Raporlar', nodes: [ads.querySelector('.workflow'), ads.querySelector('.ad-report')] },
    { title: 'Kampanyalar', nodes: [ads.querySelector('#campaign-form'), tableFor(ads, 'campaign-list')] },
    { title: 'Kreatifler', nodes: [ads.querySelector('#creative-form'), tableFor(ads, 'creative-list')] },
    { title: 'Reklam alanları', nodes: [tableFor(ads, 'placement-list')] }
  ]);

  const crm = $('.admin-content[data-panel="crm"]');
  if (crm) build('crm', 'CRM bölümleri', [
    { title: 'Okur kayıtları', nodes: [crm.querySelector('.workflow'), crm.querySelector('#crm-form'), tableFor(crm, 'crm-list')] },
    { title: 'Bülten gönderimi', nodes: [crm.querySelector('#newsletter-send-form')] }
  ]);

  const news = $('.admin-content[data-panel="haber"]');
  if (news) build('haber', 'Haber yönetimi bölümleri', [
    { title: 'İçerik özeti', nodes: [news.querySelector('.workflow')] },
    { title: 'Haber kuyruğu', nodes: [news.querySelector('.admin-table')] }
  ]);
}

async function setupSiteIdentityManagement() {
  const form = $('#site-identity-form');
  if (!form) return;
  const feedback = $('#site-identity-feedback');
  const logoInput = $('#site-logo-file');
  const logoPreview = $('#site-logo-preview');
  let logoUrl = '';
  const fields = ['slogan', 'publisher', 'representative', 'editorInChief', 'address', 'phone', 'emails', 'website', 'uets', 'hostingProvider', 'hostingAddress', 'corporateLinks'];
  try {
    const settings = await apiRequest('/api/admin/site-identity');
    for (const field of fields) if (typeof settings[field] === 'string') form.elements[field].value = settings[field];
    logoUrl = settings.logoUrl || '';
    if (logoUrl) { logoPreview.src = logoUrl; logoPreview.hidden = false; }
  } catch (error) { feedback.textContent = error.message; }
  logoInput.addEventListener('change', async () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024) {
      feedback.textContent = 'JPG, PNG veya WebP biçiminde, 6 MB veya daha küçük logo seç.';
      logoInput.value = '';
      return;
    }
    feedback.textContent = 'Logo yükleniyor…';
    logoInput.disabled = true;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Logo okunamadı.'));
        reader.readAsDataURL(file);
      });
      const result = await apiRequest('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalName: file.name, dataUrl }) });
      logoUrl = result.media.url;
      logoPreview.src = logoUrl;
      logoPreview.hidden = false;
      feedback.textContent = 'Logo yüklendi. Değişiklikleri kaydet.';
    } catch (error) { feedback.textContent = error.message || 'Logo yüklenemedi.'; }
    finally { logoInput.disabled = false; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form);
    const body = Object.fromEntries(fields.map((field) => [field, form.elements[field].value]));
    body.logoUrl = logoUrl;
    button.disabled = true;
    feedback.textContent = 'Kaydediliyor…';
    try {
      await apiRequest('/api/admin/site-identity', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      feedback.textContent = 'Site kimliği kaydedildi. Değişiklikler birkaç saniye içinde sitede görünür.';
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function setupAdminManagement() {
  const staffForm = $('#staff-create-form');
  const integrationForm = $('#integration-form');
  if (!staffForm || !integrationForm) return;
  setupSiteIdentityManagement();
  staffForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = $('#staff-create-feedback');
    const button = $('button[type="submit"]', staffForm);
    const form = new FormData(staffForm);
    button.disabled = true;
    feedback.textContent = '';
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: form.get('displayName'), email: form.get('email'), role: form.get('role'), password: form.get('password') })
      });
      staffForm.reset();
      feedback.textContent = 'Personel hesabı oluşturuldu.';
      await refreshAdminUsers();
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#staff-refresh')?.addEventListener('click', refreshAdminUsers);
  const providerSelect = $('#integration-provider');
  renderIntegrationProviderFields(providerSelect.value);
  providerSelect.addEventListener('change', () => renderIntegrationProviderFields(providerSelect.value));
  integrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = $('#integration-feedback');
    const button = $('button[type="submit"]', integrationForm);
    const providerKey = providerSelect.value;
    const provider = integrationProviders[providerKey];
    const integrationName = providerKey === 'custom'
      ? $('#integration-fields [name="integrationName"]').value.trim()
      : provider.name;
    const credentials = providerKey === 'custom'
      ? (() => {
          const fieldName = $('#integration-fields [name="customFieldName"]').value.trim();
          const value = $('#integration-fields [name="customSecretValue"]').value;
          return value.trim() && fieldName ? [{ fieldKey: settingKeyFromName(fieldName), fieldName, value }] : [];
        })()
      : $$('#integration-fields [data-credential]').map((field) => ({
          fieldKey: field.dataset.fieldKey,
          fieldName: field.dataset.fieldName,
          value: field.value
        })).filter((entry) => entry.value.trim());
    if (!integrationName || !credentials.length) {
      feedback.textContent = 'Servis adını gir ve kaydetmek istediğin en az bir alanı doldur.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Kaydediliyor';
    integrationForm.setAttribute('aria-busy', 'true');
    feedback.textContent = '';
    try {
      await apiRequest('/api/admin/integrations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration: providerKey === 'custom' ? integrationName : providerKey, integrationName, credentials })
      });
      integrationForm.reset();
      renderIntegrationProviderFields(providerSelect.value);
      feedback.textContent = 'Gizli bilgi şifreli olarak kaydedildi.';
      await refreshIntegrations();
    } catch (error) { feedback.textContent = error.message; }
    finally {
      button.textContent = 'Girilen bilgileri şifreli kaydet';
      button.disabled = $('#integration-encryption-status').dataset.encryptionReady !== 'true';
      integrationForm.removeAttribute('aria-busy');
    }
  });
  $('#integration-refresh')?.addEventListener('click', refreshIntegrations);
  refreshAdminUsers().catch((error) => { $('#staff-create-feedback').textContent = error.message; });
  refreshIntegrations().catch((error) => { $('#integration-feedback').textContent = error.message; });
}

function settingKeyFromName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function renderIntegrationProviderFields(providerKey) {
  const fields = $('#integration-fields');
  const help = $('#integration-provider-help');
  const provider = integrationProviders[providerKey] || integrationProviders.custom;
  fields.replaceChildren();
  help.textContent = provider.help;
  const appendField = ({ key, label: labelText, type = 'password', note = '', name = '', credential = true }) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    let control;
    if (type === 'textarea') {
      control = document.createElement('textarea'); control.rows = 4; control.spellcheck = false;
    } else {
      control = document.createElement('input'); control.type = type;
    }
    control.maxLength = 50_000;
    control.autocomplete = 'new-password';
    if (credential) control.dataset.credential = 'true';
    if (key) control.dataset.fieldKey = key;
    if (name) control.name = name;
    control.dataset.fieldName = labelText;
    label.append(control);
    if (note) { const hint = document.createElement('small'); hint.textContent = note; label.append(hint); }
    fields.append(label);
  };
  if (providerKey === 'custom') {
    appendField({ name: 'integrationName', label: 'Servis / entegrasyon adı', type: 'text', credential: false });
    appendField({ name: 'customFieldName', label: 'Bilgi alanı adı', type: 'text', credential: false });
    appendField({ name: 'customSecretValue', label: 'API anahtarı veya gizli değer', type: 'password' });
    return;
  }
  provider.fields.forEach(([key, label, type, note]) => appendField({ key, label, type, note }));
}

async function refreshAdminUsers() {
  const result = await apiRequest('/api/admin/users');
  const list = $('#staff-list');
  list.replaceChildren();
  if (!result.users.length) {
    const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Henüz personel hesabı yok.'; list.append(empty); return;
  }
  result.users.forEach((person) => {
    const row = document.createElement('form'); row.className = 'admin-managed-row staff-managed-row';
    const username = document.createElement('input'); username.type = 'hidden'; username.name = 'username'; username.autocomplete = 'username'; username.value = person.email;
    const identity = document.createElement('div'); identity.className = 'managed-identity';
    const name = document.createElement('strong'); name.textContent = person.display_name;
    const email = document.createElement('span'); email.textContent = person.email;
    identity.append(name, email);
    const role = document.createElement('label'); role.textContent = 'Rol';
    const select = document.createElement('select'); select.name = 'role'; select.setAttribute('aria-label', `${person.display_name} rolü`);
    result.roles.forEach((entry) => { const option = document.createElement('option'); option.value = entry.key; option.textContent = entry.label; option.selected = entry.key === person.role; select.append(option); });
    role.append(select);
    const activeLabel = document.createElement('label'); activeLabel.className = 'managed-active';
    const active = document.createElement('input'); active.type = 'checkbox'; active.name = 'isActive'; active.checked = person.is_active; active.setAttribute('aria-label', `${person.display_name} hesabı etkin`);
    activeLabel.append(active, document.createTextNode(' Etkin'));
    const password = document.createElement('label'); password.textContent = 'Yeni parola (isteğe bağlı)';
    const passwordInput = document.createElement('input'); passwordInput.type = 'password'; passwordInput.name = 'password'; passwordInput.minLength = 14; passwordInput.maxLength = 256; passwordInput.autocomplete = 'new-password'; password.append(passwordInput);
    const save = document.createElement('button'); save.className = 'secondary-action'; save.type = 'submit'; save.textContent = 'Değişiklikleri kaydet';
    const feedback = document.createElement('p'); feedback.className = 'form-feedback'; feedback.setAttribute('role', 'status');
    const self = Number(person.id) === Number(window.currentAdminUserId);
    if (self) { select.disabled = true; active.disabled = true; }
    row.append(username, identity, role, activeLabel, password, save, feedback);
    row.addEventListener('submit', async (event) => {
      event.preventDefault(); save.disabled = true; feedback.textContent = '';
      const changes = { isActive: active.checked };
      if (!self) changes.role = select.value;
      if (passwordInput.value) changes.password = passwordInput.value;
      try {
        await apiRequest(`/api/admin/users/${person.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
        feedback.textContent = 'Erişim bilgileri kaydedildi.';
        passwordInput.value = '';
        await refreshAdminUsers();
      } catch (error) { feedback.textContent = error.message; save.disabled = false; }
    });
    list.append(row);
  });
}

async function refreshIntegrations() {
  const result = await apiRequest('/api/admin/integrations');
  const status = $('#integration-encryption-status');
  status.textContent = result.encryptionReady
    ? 'Şifreleme anahtarı etkin. Bu anahtarı güvenli yedekte tutun; kaydedilen API bilgilerini çözmek için gerekir.'
    : 'API bilgisi kaydetmeden önce .env dosyasına 64 karakterlik SETTINGS_ENCRYPTION_KEY ekleyip sunucuyu yeniden başlatın.';
  status.classList.toggle('notice-error', !result.encryptionReady);
  status.dataset.encryptionReady = String(result.encryptionReady);
  const saveButton = $('#integration-form button[type="submit"]');
  if (saveButton) saveButton.disabled = !result.encryptionReady;
  const list = $('#integration-list'); list.replaceChildren();
  if (!result.credentials.length) {
    const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Henüz API veya entegrasyon bilgisi kaydedilmedi.'; list.append(empty); return;
  }
  result.credentials.forEach((credential) => {
    const row = document.createElement('div'); row.className = 'admin-managed-row integration-managed-row';
    const details = document.createElement('div'); details.className = 'managed-identity';
    const title = document.createElement('strong'); title.textContent = `${credential.integration_name} · ${credential.field_name}`;
    const meta = document.createElement('span'); meta.textContent = `Gizli değer kayıtlı · ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(credential.updated_at))}`;
    details.append(title, meta);
    const replace = document.createElement('button'); replace.className = 'secondary-action'; replace.type = 'button'; replace.textContent = 'Yeni değer gir';
    replace.addEventListener('click', () => {
      const providerSelect = $('#integration-provider');
      const knownProvider = integrationProviders[credential.integration_key] && credential.integration_key !== 'custom';
      providerSelect.value = knownProvider ? credential.integration_key : 'custom';
      renderIntegrationProviderFields(providerSelect.value);
      if (knownProvider) {
        const field = $(`#integration-fields [data-field-key="${credential.field_key}"]`);
        field?.focus();
      } else {
        $('#integration-fields [name="integrationName"]').value = credential.integration_name;
        $('#integration-fields [name="customFieldName"]').value = credential.field_name;
        $('#integration-fields [name="customSecretValue"]').dataset.fieldName = credential.field_name;
        $('#integration-fields [name="customSecretValue"]').focus();
      }
      $('#integration-provider').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const remove = document.createElement('button'); remove.className = 'secondary-action destructive-action'; remove.type = 'button'; remove.textContent = 'Sil';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`${credential.integration_name} · ${credential.field_name} kaydını silmek istiyor musunuz?`)) return;
      remove.disabled = true;
      try { await apiRequest(`/api/admin/integrations/${credential.id}`, { method: 'DELETE' }); await refreshIntegrations(); }
      catch (error) { toast(error.message); remove.disabled = false; }
    });
    row.append(details, replace, remove); list.append(row);
  });
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(result?.error || 'İstek tamamlanamadı.');
    error.status = response.status;
    throw error;
  }
  return result;
}

const adminJson = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const dateLabel = (value) => value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(value)) : 'Tarih belirlenmedi';
const statusLabels = { draft: 'Taslak', awaiting_approval: 'Onay bekliyor', scheduled: 'Planlandı', active: 'Aktif', paused: 'Duraklatıldı', completed: 'Tamamlandı', cancelled: 'İptal edildi' };

async function setupAdvertisingManagement() {
  const list = $('#campaign-list');
  const form = $('#campaign-form');
  if (!list || !form) return;
  let campaigns = [];
  const reportForm = $('#ad-report-filters');
  const reportDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (reportForm) {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' })); const from = new Date(today); from.setDate(from.getDate() - 29);
    reportForm.elements.from.value = reportDate(from); reportForm.elements.to.value = reportDate(today);
  }
  const refreshReport = async () => {
    if (!reportForm) return;
    const feedback = $('#ad-report-feedback'); feedback.textContent = '';
    const query = new URLSearchParams(Object.fromEntries(new FormData(reportForm)));
    const data = await apiRequest(`/api/admin/advertising/report?${query}`);
    $('#ad-report-impressions').textContent = Number(data.totals.impressions).toLocaleString('tr-TR');
    $('#ad-report-clicks').textContent = Number(data.totals.clicks).toLocaleString('tr-TR');
    $('#ad-report-ctr').textContent = `${(Number(data.totals.ctr) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%`;
    const rows = $('#ad-report-rows'); rows.replaceChildren();
    if (!data.rows.length) { const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Seçilen tarih ve reklam alanında gösterim veya tıklama bulunamadı.'; rows.append(empty); return; }
    data.rows.forEach((entry) => {
      const row = document.createElement('div'); row.className = 'admin-managed-row ad-report-row';
      const identity = document.createElement('div'); identity.className = 'managed-identity';
      const title = document.createElement('strong'); title.textContent = entry.campaign_name;
      const details = document.createElement('span'); details.textContent = `${entry.company_name} · ${entry.placement_name} · ${entry.page_area}`;
      identity.append(title, details);
      const impressions = document.createElement('span'); impressions.className = 'managed-summary'; impressions.textContent = `${Number(entry.impressions).toLocaleString('tr-TR')} gösterim`;
      const clicks = document.createElement('span'); clicks.className = 'managed-summary'; clicks.textContent = `${Number(entry.clicks).toLocaleString('tr-TR')} tıklama`;
      const ctr = document.createElement('span'); ctr.className = 'managed-summary'; const count = Number(entry.impressions); ctr.textContent = `${(count ? Number(entry.clicks) / count * 100 : 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}% TO`;
      row.append(identity, impressions, clicks, ctr); rows.append(row);
    });
  };
  const refresh = async () => {
    const data = await apiRequest('/api/admin/advertising');
    campaigns = data.campaigns;
    $('#ads-active-count').textContent = campaigns.filter((row) => row.status === 'active').length;
    $('#ads-pending-count').textContent = campaigns.filter((row) => row.status === 'awaiting_approval').length;
    $('#ads-placement-count').textContent = data.placements.filter((row) => row.is_active).length;
    $('#ads-impressions-count').textContent = campaigns.reduce((sum, row) => sum + Number(row.impressions || 0), 0).toLocaleString('tr-TR');
    const placementSelect = $('#campaign-placement');
    placementSelect.replaceChildren(new Option('Reklam alanı seçin', ''));
    data.placements.filter((row) => row.is_active).forEach((row) => placementSelect.add(new Option(`${row.display_name} · ${row.format}`, row.id)));
    const reportPlacement = reportForm?.elements.placementId;
    if (reportPlacement) {
      const selectedPlacement = reportPlacement.value;
      reportPlacement.replaceChildren(new Option('Tüm reklam alanları', ''));
      data.placements.forEach((row) => reportPlacement.add(new Option(`${row.display_name} · ${row.page_area}`, row.id)));
      reportPlacement.value = selectedPlacement;
    }
    const placementList = $('#placement-list'); placementList.replaceChildren();
    data.placements.forEach((row) => {
      const item = document.createElement('div'); item.className = 'admin-managed-row';
      item.innerHTML = `<div class="managed-identity"><strong></strong><span></span></div><span></span>`;
      $('strong', item).textContent = row.display_name; $('.managed-identity span', item).textContent = `${row.page_area} · ${row.format}`;
      item.lastElementChild.textContent = row.is_active ? 'Etkin' : 'Kapalı'; placementList.append(item);
    });
    renderCampaignRows();
    const campaignSelect = $('#creative-campaign');
    if (campaignSelect) {
      const selectedCampaign = campaignSelect.value;
      campaignSelect.replaceChildren(new Option('Kampanya seçin', ''));
      campaigns.filter((item) => !['cancelled', 'completed'].includes(item.status)).forEach((item) => campaignSelect.add(new Option(`${item.name} · ${item.company_name}`, item.id)));
      campaignSelect.value = selectedCampaign;
      updateCreativeFormatHelp();
    }
    renderCreativeRows(data.creatives || []);
    await refreshReport();
  };
  const renderCampaignRows = () => {
    list.replaceChildren();
    const selected = $('#campaign-status-filter').value;
    const visible = campaigns.filter((campaign) => selected === 'all' || campaign.status === selected);
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Bu filtrede kampanya yok. Yukarıdaki formdan yeni kampanya ekleyin.'; list.append(empty); return; }
    visible.forEach((campaign) => {
      const row = document.createElement('div'); row.className = 'admin-managed-row campaign-row';
      const identity = document.createElement('div'); identity.className = 'managed-identity';
      const title = document.createElement('strong'); title.textContent = campaign.name;
      const description = document.createElement('span'); description.textContent = `${campaign.company_name} · ${campaign.placements || 'Alan seçilmedi'}${campaign.regulatory_reference ? ` · BİK: ${campaign.regulatory_reference}` : ''} · ${dateLabel(campaign.starts_at)} – ${dateLabel(campaign.ends_at)}`;
      identity.append(title, description);
      const budget = document.createElement('span'); budget.className = 'managed-summary'; budget.textContent = campaign.budget == null ? 'Bütçe belirtilmedi' : `${Number(campaign.budget).toLocaleString('tr-TR')} ₺`;
      const events = document.createElement('span'); events.className = 'managed-summary'; events.textContent = `${Number(campaign.impressions).toLocaleString('tr-TR')} gösterim · ${Number(campaign.clicks).toLocaleString('tr-TR')} tıklama`;
      const allowed = { draft: ['awaiting_approval', 'cancelled'], awaiting_approval: ['draft', 'scheduled', 'active', 'cancelled'], scheduled: ['awaiting_approval', 'active', 'paused', 'cancelled'], active: ['paused', 'completed', 'cancelled'], paused: ['awaiting_approval', 'active', 'completed', 'cancelled'], completed: [], cancelled: [] };
      const removeCampaign = document.createElement('button'); removeCampaign.type = 'button'; removeCampaign.className = 'secondary-action destructive-action'; removeCampaign.textContent = 'Sil'; removeCampaign.setAttribute('aria-label', `${campaign.name} kampanyasını sil`);
      removeCampaign.hidden = currentAdminRole !== 'admin';
      removeCampaign.addEventListener('click', async () => {
        if (!confirm('Bu kampanya silinsin mi?')) return;
        removeCampaign.disabled = true;
        try { await apiRequest(`/api/admin/advertising/campaigns/${campaign.id}`, { method: 'DELETE' }); await refresh(); }
        catch (error) { toast(error.message); removeCampaign.disabled = false; }
      });
      const transitions = allowed[campaign.status] || [];
      if (transitions.length && (currentAdminRole === 'admin' || transitions.some((status) => !(currentAdminRole === 'ad_sales' && ['scheduled', 'active', 'paused', 'completed', 'cancelled'].includes(status))))) {
        const select = document.createElement('select'); select.setAttribute('aria-label', `${campaign.name} kampanya durumu`);
        select.add(new Option(statusLabels[campaign.status], campaign.status));
        transitions.filter((status) => currentAdminRole === 'admin' || !['scheduled', 'active', 'paused', 'completed', 'cancelled'].includes(status)).forEach((status) => select.add(new Option(statusLabels[status], status)));
        select.addEventListener('change', async () => { select.disabled = true; try { await apiRequest(`/api/admin/advertising/campaigns/${campaign.id}`, adminJson('PATCH', { status: select.value })); await refresh(); } catch (error) { toast(error.message); select.value = campaign.status; } finally { select.disabled = false; } });
        row.append(identity, budget, events, select);
      } else row.append(identity, budget, events);
      // Silme sunucuda yalnız admin'e açık (gösterim kaydı yoksa); diğer roller iptal eder.
      if (currentAdminRole === 'admin') row.append(removeCampaign);
      list.append(row);
    });
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(form)); const feedback = $('#campaign-feedback');
    const button = $('button[type="submit"]', form); button.disabled = true; feedback.textContent = '';
    try { await apiRequest('/api/admin/advertising/campaigns', adminJson('POST', values)); form.reset(); feedback.textContent = currentAdminRole === 'admin' ? 'Kampanya oluşturuldu. Şimdi aşağıdan reklam görselini ekleyin.' : 'Kampanya taslağı oluşturuldu.'; await refresh(); }
    catch (error) { feedback.textContent = error.message; } finally { button.disabled = false; }
  });
  $('#ads-refresh').addEventListener('click', () => refresh().catch((error) => toast(error.message)));
  reportForm?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('button[type="submit"]', reportForm); button.disabled = true;
    try { await refreshReport(); } catch (error) { $('#ad-report-feedback').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#campaign-status-filter').addEventListener('change', renderCampaignRows);
  $('#creative-campaign')?.addEventListener('change', updateCreativeFormatHelp);
  $('#creative-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const creativeForm = $('#creative-form'); const values = Object.fromEntries(new FormData(creativeForm));
    const file = $('input[name="creativeImage"]', creativeForm).files?.[0]; const feedback = $('#creative-feedback'); const button = $('button[type="submit"]', creativeForm);
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024) { feedback.textContent = 'JPG, PNG veya WebP biçiminde ve 6 MB altında görsel seçin.'; return; }
    button.disabled = true; feedback.textContent = 'Görsel yükleniyor…';
    try {
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Görsel okunamadı.')); reader.readAsDataURL(file); });
      const uploaded = await apiRequest('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalName: file.name, dataUrl }) });
      await apiRequest('/api/admin/advertising/creatives', adminJson('POST', { campaignId: values.campaignId, headline: values.headline, targetUrl: values.targetUrl, mediaId: uploaded.media.id }));
      creativeForm.reset(); feedback.textContent = currentAdminRole === 'admin' ? 'Reklam yayına alındı.' : 'Kreatif yönetici incelemesine gönderildi.'; await refresh();
    } catch (error) { feedback.textContent = error.message; } finally { button.disabled = false; }
  });
  try { await refresh(); } catch (error) { toast(error.message); }

  function updateCreativeFormatHelp() {
    const campaign = campaigns.find((item) => String(item.id) === $('#creative-campaign')?.value);
    $('#creative-format-help').textContent = campaign?.formats
      ? `Bu kampanya için kabul edilen ölçüler: ${campaign.formats}. Her ölçü için ayrı kreatif ekleyebilirsiniz.`
      : 'Kampanya seçince kabul edilen Basın İlan Kurumu ölçüleri burada görünür.';
  }
}

function renderCreativeRows(creatives) {
  const list = $('#creative-list'); if (!list) return; list.replaceChildren();
  if (!creatives.length) { const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Henüz reklam kreatifi eklenmedi.'; list.append(empty); return; }
  const labels = { pending: 'İnceleme bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', retired: 'Kaldırıldı' };
  creatives.forEach((creative) => {
    const row = document.createElement('div'); row.className = 'admin-managed-row creative-row';
    const image = document.createElement('img'); image.className = 'creative-thumbnail'; if (creative.media_key) image.src = `/media/${creative.media_key}`; image.alt = '';
    const identity = document.createElement('div'); identity.className = 'managed-identity';
    const title = document.createElement('strong'); title.textContent = creative.headline;
    const campaign = document.createElement('span'); campaign.textContent = `${creative.campaign_name} · ${creative.width && creative.height ? `${creative.width}×${creative.height}` : ''} · ${creative.target_url}`;
    identity.append(title, campaign);
    const state = document.createElement('span'); state.className = 'managed-summary'; state.textContent = labels[creative.status] || creative.status;
    row.append(image, identity, state);
    const actions = creative.status === 'pending' && currentAdminRole === 'admin' ? [['approved', 'Onayla', 'secondary-action'], ['rejected', 'Reddet', 'secondary-action destructive-action']] : creative.status === 'approved' && currentAdminRole === 'admin' ? [['retired', 'Yayından kaldır', 'secondary-action destructive-action']] : [];
    for (const [value, label, className] of actions) {
      const action = document.createElement('button'); action.type = 'button'; action.className = className; action.textContent = label;
      action.addEventListener('click', async () => { action.disabled = true; try { await apiRequest(`/api/admin/advertising/creatives/${creative.id}`, adminJson('PATCH', { status: value })); $('#ads-refresh')?.click(); } catch (error) { toast(error.message); action.disabled = false; } });
      row.append(action);
    }
    list.append(row);
  });
}
async function setupActivityLog() {
  const list = $('#activity-list');
  if (!list) return;
  const labels = {
    'article.created': 'Haber oluşturuldu', 'article.updated': 'Haber güncellendi',
    'article.imported': 'Arşiv haberi aktarıldı', 'user.created': 'Personel hesabı oluşturuldu',
    'user.updated': 'Personel erişimi güncellendi', 'integration.credentials.saved': 'Entegrasyon bilgisi kaydedildi',
    'integration.credential.deleted': 'Entegrasyon bilgisi silindi', 'ad.campaign.created': 'Reklam kampanyası oluşturuldu',
    'ad.campaign.status_changed': 'Reklam kampanyası durumu değişti',
    'ad.creative.created': 'Reklam kreatifi gönderildi', 'ad.creative.status_changed': 'Reklam kreatifi durumu değişti',
    'crm.contact.created': 'CRM kaydı oluşturuldu', 'crm.contact.updated': 'CRM kaydı güncellendi'
    , 'newsletter.sent': 'Bülten e-postası gönderildi', 'newsletter.subscribed': 'Bültene abone olundu',
    'newsletter.unsubscribed': 'Bülten aboneliğinden ayrıldı',
  };
  const refresh = async () => {
    const { events } = await apiRequest('/api/admin/activity'); list.replaceChildren();
    if (!events.length) { const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Henüz yönetim işlemi yok.'; list.append(empty); return; }
    events.forEach((event) => {
      const row = document.createElement('div'); row.className = 'admin-managed-row activity-row';
      const identity = document.createElement('div'); identity.className = 'managed-identity';
      const action = document.createElement('strong'); action.textContent = labels[event.action] || event.action;
      const entity = document.createElement('span');
      const detail = event.after_data && typeof event.after_data === 'object' ? event.after_data.headline || event.after_data.name || event.after_data.email || event.after_data.integration || '' : '';
      entity.textContent = `${event.entity_type}${event.entity_id ? ` · #${event.entity_id}` : ''}${detail ? ` · ${detail}` : ''}`;
      identity.append(action, entity);
      const actor = document.createElement('span'); actor.textContent = event.actor_name || 'Sistem aktarımı';
      const date = document.createElement('time'); date.textContent = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at));
      row.append(identity, actor, date); list.append(row);
    });
  };
  $('#activity-refresh')?.addEventListener('click', () => refresh().catch((error) => toast(error.message)));
  try { await refresh(); } catch (error) { toast(error.message); }
}

async function setupCrmManagement() {
  const form = $('#crm-form'); const list = $('#crm-list');
  if (!form || !list) return;
  let contacts = []; let crmStaff = [];
  const refresh = async () => {
    const params = new URLSearchParams();
    const query = $('#crm-search').value.trim(); const type = $('#crm-type-filter').value; const status = $('#crm-status-filter').value;
    if (query) params.set('q', query); if (type !== 'all') params.set('type', type); if (status !== 'all') params.set('status', status);
    const data = await apiRequest(`/api/admin/crm?${params}`); contacts = data.contacts; crmStaff = data.staff;
    $('#crm-total-count').textContent = data.summary.total;
    $('#crm-open-count').textContent = data.summary.open;
    $('#crm-newsletter-count').textContent = data.summary.newsletter_consents;
    $('#crm-adlead-count').textContent = data.summary.advertising_leads;
    renderContacts();
  };
  const renderContacts = () => {
    list.replaceChildren();
    if (!contacts.length) { const empty = document.createElement('p'); empty.className = 'dialog-empty'; empty.textContent = 'Bu filtrede CRM kaydı bulunamadı.'; list.append(empty); return; }
    contacts.forEach((contact) => {
      const row = document.createElement('div'); row.className = 'admin-managed-row crm-row';
      const identity = document.createElement('div'); identity.className = 'managed-identity';
      const title = document.createElement('strong'); title.textContent = contact.display_name || contact.email;
      const email = document.createElement('span'); email.textContent = contact.display_name ? contact.email : 'Ad bilgisi yok';
      identity.append(title, email);
      const details = document.createElement('div'); details.className = 'managed-identity';
      const type = document.createElement('strong'); type.textContent = ({ newsletter: 'Bülten', advertising_lead: 'Reklam talebi', reader_feedback: 'Okur geri bildirimi', correction_request: 'Düzeltme talebi' })[contact.contact_type];
      const note = document.createElement('span'); note.textContent = contact.notes || (contact.consent_status === 'granted' ? 'Bülten izni kayıtlı' : 'Ek not yok');
      details.append(type, note);
      const noteEditor = document.createElement('details'); noteEditor.className = 'crm-note-editor';
      const noteSummary = document.createElement('summary'); noteSummary.textContent = 'Notu düzenle';
      const noteInput = document.createElement('textarea'); noteInput.maxLength = 5000; noteInput.rows = 2; noteInput.value = contact.notes || ''; noteInput.setAttribute('aria-label', `${contact.email} notu`);
      const noteSave = document.createElement('button'); noteSave.type = 'button'; noteSave.className = 'secondary-action'; noteSave.textContent = 'Notu kaydet';
      noteSave.addEventListener('click', async () => { noteSave.disabled = true; try { await apiRequest(`/api/admin/crm/${contact.id}`, adminJson('PATCH', { status: contact.status, notes: noteInput.value })); await refresh(); } catch (error) { toast(error.message); } finally { noteSave.disabled = false; } });
      noteEditor.append(noteSummary, noteInput, noteSave);
      const assignee = document.createElement('select'); assignee.setAttribute('aria-label', `${contact.email} sorumlusu`);
      assignee.add(new Option('Atanmamış', '', false, !contact.assigned_name));
      crmStaff.forEach((member) => assignee.add(new Option(member.display_name, member.id, false, Number(member.id) === Number(contact.assigned_to))));
      assignee.addEventListener('change', async () => { assignee.disabled = true; try { await apiRequest(`/api/admin/crm/${contact.id}`, adminJson('PATCH', { status: contact.status, assignedTo: assignee.value || null })); await refresh(); } catch (error) { toast(error.message); } finally { assignee.disabled = false; } });
      const created = document.createElement('time'); created.textContent = dateLabel(contact.created_at);
      const select = document.createElement('select'); select.setAttribute('aria-label', `${contact.email} CRM durumu`);
      const choices = [['open','Açık'],['in_progress','Takipte'],['resolved','Çözüldü']]; if (contact.contact_type === 'newsletter') choices.push(['unsubscribed','Abonelikten ayrıldı']);
      choices.forEach(([value,label])=>select.add(new Option(label,value,false,value===contact.status)));
      select.addEventListener('change', async () => { select.disabled = true; try { await apiRequest(`/api/admin/crm/${contact.id}`, adminJson('PATCH', { status: select.value })); await refresh(); } catch (error) { toast(error.message); select.value = contact.status; } finally { select.disabled = false; } });
      if (currentAdminRole === 'admin') {
        const removeContact = document.createElement('button'); removeContact.type = 'button'; removeContact.className = 'secondary-action destructive-action'; removeContact.textContent = 'Sil'; removeContact.setAttribute('aria-label', `${contact.email} kişisini sil`);
        removeContact.addEventListener('click', async () => {
          if (!confirm('Bu kişi kalıcı olarak silinsin mi? (KVKK silme talebi)')) return;
          removeContact.disabled = true;
          try { await apiRequest(`/api/admin/crm/${contact.id}`, { method: 'DELETE' }); await refresh(); }
          catch (error) { toast(error.message); removeContact.disabled = false; }
        });
        row.append(identity, details, noteEditor, assignee, created, select, removeContact);
      } else row.append(identity, details, noteEditor, assignee, created, select);
      list.append(row);
    });
  };
  const typeSelect = $('select[name="contactType"]', form);
  const updateConsent = () => { $('.crm-consent-label', form).hidden = typeSelect.value !== 'newsletter'; };
  typeSelect.addEventListener('change', updateConsent); updateConsent();
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(form)); values.consent = $('input[name="consent"]', form).checked;
    const feedback = $('#crm-feedback'); const button = $('button[type="submit"]', form); button.disabled = true; feedback.textContent = '';
    try { await apiRequest('/api/admin/crm', adminJson('POST', values)); form.reset(); updateConsent(); feedback.textContent = 'CRM kaydı oluşturuldu.'; await refresh(); }
    catch (error) { feedback.textContent = error.message; } finally { button.disabled = false; }
  });
  $('#crm-refresh').addEventListener('click', () => refresh().catch((error) => toast(error.message)));
  $('#crm-export')?.addEventListener('click', () => { window.location.assign('/api/admin/crm/export.csv'); });
  $('#crm-type-filter').addEventListener('change', () => refresh().catch((error) => toast(error.message)));
  $('#crm-status-filter').addEventListener('change', () => refresh().catch((error) => toast(error.message)));
  let searchTimer; $('#crm-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh().catch((error) => toast(error.message)), 250); });
  const newsletterForm = $('#newsletter-send-form');
  newsletterForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(newsletterForm)); const feedback = $('#newsletter-send-feedback'); const button = $('button[type="submit"]', newsletterForm);
    if (!window.confirm('Bülten izni olan abonelere bu e-posta gönderilsin mi?')) return;
    button.disabled = true; feedback.textContent = 'E-postalar gönderiliyor…';
    try { const result = await apiRequest('/api/admin/crm/newsletter/send', adminJson('POST', values)); feedback.textContent = `${result.sent} / ${result.total} e-posta gönderildi. Gönderilemeyen: ${result.failed}.`; newsletterForm.reset(); }
    catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  });
  try { await refresh(); } catch (error) { toast(error.message); }
}

function renderSummary(summary) {
  const metrics = $$('.metric');
  if (metrics.length >= 4) {
    metrics[0].querySelector('strong').textContent = summary.articles?.today ?? '—';
    metrics[0].querySelector('small').textContent = summary.articles ? 'Bugün oluşturulan haber' : 'Bu rolün erişimi yok';
    metrics[1].querySelector('strong').textContent = '—';
    metrics[1].querySelector('small').textContent = 'Analitik bağlantısı bekleniyor';
    metrics[2].querySelector('strong').textContent = summary.advertising?.active ?? '—';
    metrics[2].querySelector('small').textContent = summary.advertising ? `${summary.advertising.pending} onay bekliyor` : 'Bu rolün erişimi yok';
    metrics[3].querySelector('strong').textContent = summary.crm?.total ?? '—';
    metrics[3].querySelector('small').textContent = summary.crm ? `${summary.crm.open} açık kayıt` : 'Bu rolün erişimi yok';
  }
  const workflow = $('.admin-content[data-panel="haber"] .workflow');
  if (workflow) {
    const counts = summary.articles ? [summary.articles.draft || 0, summary.articles.in_review || 0, summary.articles.scheduled || 0, summary.articles.published || 0] : ['—', '—', '—', '—'];
    $$('.workflow > div b', workflow).forEach((element, index) => { element.textContent = counts[index] ?? 0; });
  }
  const ads = $('.admin-content[data-panel="reklam"] .workflow');
  if (ads) {
    const values = summary.advertising ? [summary.advertising.active, summary.advertising.placements, '—', summary.advertising.pending] : ['—', '—', '—', '—'];
    $$('.workflow > div b', ads).forEach((element, index) => { element.textContent = values[index] ?? '—'; });
    const fillLabel = ads.children[2]?.querySelector('span');
    if (fillLabel) fillLabel.textContent = 'Teslimat ölçümü';
  }
  const crm = $('.admin-content[data-panel="crm"] .workflow');
  if (crm) {
    const values = summary.crm ? [summary.crm.total, '—', summary.crm.open, '—'] : ['—', '—', '—', '—'];
    $$('.workflow > div b', crm).forEach((element, index) => { element.textContent = values[index] ?? '—'; });
    const labels = ['CRM kaydı', 'Bülten izni', 'Açık kayıt', 'Memnuniyet ölçümü'];
    $$('.workflow > div span', crm).forEach((element, index) => { element.textContent = labels[index] ?? element.textContent; });
  }
}

function makeArticleRow(article) {
  const row = document.createElement('div');
  row.className = 'table-row article-row';
  const dot = document.createElement('span');
  dot.className = `status-dot ${article.status === 'published' ? 'published' : article.status === 'in_review' ? 'review' : 'draft'}`;
  const title = document.createElement('span');
  title.textContent = article.headline;
  const category = document.createElement('small');
  category.textContent = article.category_name || article.author_name || 'Kategori seçilmedi';
  const state = document.createElement('span');
  state.className = `pill ${article.status === 'published' ? 'live-pill' : article.status === 'in_review' ? 'review-pill' : 'draft-pill'}`;
  state.textContent = ({ draft: 'TASLAK', in_review: 'EDİTÖRDE', approved: 'ONAYLANDI', scheduled: 'PLANLANDI', published: 'YAYINDA', archived: 'ARŞİV' })[article.status] || article.status;
  const time = document.createElement('time');
  time.dateTime = article.updated_at;
  time.textContent = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(article.updated_at));
  const edit = document.createElement('button');
  edit.className = 'secondary-action article-row-action';
  edit.type = 'button';
  edit.textContent = 'Düzenle';
  edit.setAttribute('aria-label', `“${article.headline}” haberini düzenle`);
  edit.addEventListener('click', () => openArticleEditor?.(article.id));
  row.append(dot, title, category, state, time, edit);
  return row;
}

function fillArticleTable(table, articles, emptyText) {
  const heading = $('.table-heading', table);
  table.replaceChildren(heading);
  if (!articles.length) {
    const empty = document.createElement('p');
    empty.className = 'dialog-empty';
    empty.textContent = emptyText;
    table.append(empty);
    return;
  }
  articles.forEach((article) => table.append(makeArticleRow(article)));
}

/* Haber yönetimi listesi: her sayfa sunucudan ayrı istenir; arama ve durum filtresi de sunucuda
   uygulanır, böylece bütün haberler (yalnız son yüklenenler değil) listelenebilir. */
const articleListState = { page: 1, request: 0 };

function articlePageList(current, total) {
  const list = [];
  for (let p = 1; p <= total; p += 1) {
    if (p === 1 || p === total || Math.abs(p - current) <= 1) list.push(p);
    else if (list[list.length - 1] !== '…') list.push('…');
  }
  return list;
}

function renderArticlePager(table, result) {
  let pager = table.nextElementSibling?.classList.contains('article-pager') ? table.nextElementSibling : null;
  if (!pager) {
    pager = document.createElement('nav');
    pager.className = 'admin-pager article-pager';
    pager.setAttribute('aria-label', 'Haber listesi sayfaları');
    pager.addEventListener('click', (event) => {
      const target = event.target.closest('[data-page]');
      if (!target || target.disabled) return;
      articleListState.page = Number(target.dataset.page) || 1;
      loadArticleLists({ scroll: true });
    });
    table.insertAdjacentElement('afterend', pager);
  }
  const { page, pages, total, limit } = result;
  pager.hidden = total === 0;
  const button = (label, targetPage, disabled, ariaLabel, current = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = current ? 'primary-action' : 'secondary-action';
    b.textContent = label;
    b.dataset.page = String(targetPage);
    b.disabled = disabled;
    if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
    if (current) b.setAttribute('aria-current', 'page');
    return b;
  };
  const parts = [];
  if (pages > 1) {
    parts.push(button('‹ Önceki', page - 1, page === 1, 'Önceki sayfa'));
    for (const p of articlePageList(page, pages)) {
      if (p === '…') {
        const gap = document.createElement('span');
        gap.className = 'admin-pager-gap';
        gap.textContent = '…';
        parts.push(gap);
      } else parts.push(button(String(p), p, false, `${p}. sayfa`, p === page));
    }
    parts.push(button('Sonraki ›', page + 1, page === pages, 'Sonraki sayfa'));
  }
  const info = document.createElement('span');
  info.className = 'admin-pager-info';
  const first = (page - 1) * limit + 1;
  info.textContent = `${first}–${Math.min(first + limit - 1, total)} / ${total.toLocaleString('tr-TR')} kayıt`;
  parts.push(info);
  pager.replaceChildren(...parts);
}

async function loadArticleLists({ scroll = false } = {}) {
  const request = ++articleListState.request;
  const newsTable = $('.admin-content[data-panel="haber"] .admin-table');
  const overviewTable = $('.admin-content[data-panel="genel"] .admin-table');
  const params = new URLSearchParams({ page: String(articleListState.page), limit: '20' });
  const status = $('#article-status-filter')?.value || 'all';
  const query = ($('#article-search')?.value || '').trim();
  if (status !== 'all') params.set('status', status);
  if (query) params.set('q', query);
  newsTable?.setAttribute('aria-busy', 'true');
  try {
    const [result, overview] = await Promise.all([
      apiRequest(`/api/articles?${params}`),
      overviewTable ? apiRequest('/api/articles?limit=5') : Promise.resolve(null)
    ]);
    if (request !== articleListState.request) return; // daha yeni bir istek var
    articleListState.page = result.page;
    if (newsTable) {
      fillArticleTable(newsTable, result.items, query || status !== 'all' ? 'Bu aramaya uyan haber yok.' : 'Bu listede henüz haber yok.');
      renderArticlePager(newsTable, result);
      if (scroll && newsTable.getBoundingClientRect().top < 0) newsTable.scrollIntoView({ block: 'start' });
    }
    if (overviewTable && overview) fillArticleTable(overviewTable, overview.items, 'Bu listede henüz haber yok.');
  } catch (error) {
    if (request === articleListState.request) toast(error.message || 'Haber listesi alınamadı.');
  } finally {
    if (request === articleListState.request) newsTable?.removeAttribute('aria-busy');
  }
}

function setupArticleList() {
  let timer = 0;
  $('#article-status-filter')?.addEventListener('change', () => { articleListState.page = 1; loadArticleLists(); });
  $('#article-search')?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { articleListState.page = 1; loadArticleLists(); }, 300);
  });
  return loadArticleLists();
}

function replaceUnimplementedRows(selector, message) {
  const table = $(selector);
  if (!table) return;
  const heading = $('.table-heading', table);
  table.replaceChildren(heading);
  const empty = document.createElement('p');
  empty.className = 'dialog-empty';
  empty.textContent = message;
  table.append(empty);
}

function setupArticleDialog(categories) {
  const dialog = $('#article-dialog');
  const form = $('#article-form');
  const error = $('#article-error');
  const heading = $('#article-dialog-title');
  const history = $('#article-history');
  const historyList = $('ol', history);
  const categorySelect = $('#article-category');
  const coverInput = $('#article-cover');
  const coverIdInput = $('#article-cover-id');
  const coverPreview = $('#article-cover-preview');
  const coverImage = $('#article-cover-image');
  const coverName = $('#article-cover-name');
  const coverStatus = $('#article-cover-status');
  const submitButtons = $$('button[type="submit"]', form);
  const scheduleButton = $('button[value="scheduled"]', form);
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.append(option);
  }
  const extraCategorySelect = $('#article-extra-categories');
  for (const category of categories) {
    const option = document.createElement('option'); option.value = category.id; option.textContent = category.name; extraCategorySelect.append(option);
  }
  const openButton = $('.admin-content[data-panel="haber"] .primary-action');
  openButton?.addEventListener('click', () => {
    error.textContent = '';
    form.reset();
    delete form.dataset.articleId;
    heading.textContent = 'Haber taslağı';
    history.hidden = true;
    submitButtons[0].value = 'draft';
    submitButtons[0].textContent = 'Taslağı kaydet';
    submitButtons[1].hidden = false;
    submitButtons[1].value = 'in_review';
    submitButtons[1].textContent = 'Editöre gönder';
    scheduleButton.hidden = true;
    $('#article-editor-seo').open = false;
    resetCover();
    dialog.showModal();
    $('#article-headline').focus();
  });
  $$('[data-close-dialog]', dialog).forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  openArticleEditor = async (articleId) => {
    error.textContent = '';
    try {
      const { article } = await apiRequest(`/api/articles/${articleId}`);
      form.dataset.articleId = article.id;
      form.elements.headline.value = article.headline;
      form.elements.standfirst.value = article.standfirst || '';
      form.elements.categoryId.value = article.primary_category_id || '';
      form.elements.body.value = article.body || '';
      form.elements.homepageSliderSlot.value = article.homepage_slider_slot || 'auto';
      form.elements.isBreaking.checked = Boolean(article.is_breaking);
      form.elements.isInBriefing.checked = article.is_in_briefing !== false;
      form.elements.isInLatest.checked = article.is_in_latest !== false;
      form.elements.scheduledAt.value = article.scheduled_at ? new Date(article.scheduled_at).toISOString().slice(0, 16) : '';
      form.elements.sourceName.value = article.source_name || '';
      form.elements.sourceUrl.value = article.source_url || '';
      form.elements.seoTitle.value = article.seo_title || '';
      form.elements.seoDescription.value = article.seo_description || '';
      form.elements.coverAltText.value = article.cover_alt_text || '';
      form.elements.tags.value = (article.tags || []).join(', ');
      for (const option of extraCategorySelect.options) option.selected = (article.category_ids || []).includes(Number(option.value)) && Number(option.value) !== Number(article.primary_category_id);
      $('#article-editor-seo').open = Boolean(article.source_name || article.source_url || article.seo_title || article.seo_description);
      coverInput.value = '';
      coverIdInput.value = article.cover_media_id || '';
      showCover(article.cover_url, article.cover_storage_key || 'Mevcut kapak görseli');
      coverStatus.textContent = article.cover_url ? 'Mevcut kapak görseli korunuyor.' : '';
      heading.textContent = 'Haberi düzenle';
      historyList.replaceChildren();
      for (const revision of article.revisions || []) {
        const item = document.createElement('li');
        const date = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(revision.created_at));
        item.textContent = `Sürüm ${revision.revision_number} · ${revision.author_name || 'Kullanıcı'} · ${date} · ${revision.change_note}`;
        historyList.append(item);
      }
      history.hidden = !article.revisions?.length;
      configureArticleActions(article);
      dialog.showModal();
      $('#article-headline').focus();
    } catch (requestError) {
      toast(requestError.message || 'Haber açılamadı.');
    }
  };
  function resetCover() {
    coverInput.value = '';
    coverIdInput.value = '';
    coverImage.removeAttribute('src');
    coverName.textContent = '';
    coverPreview.hidden = true;
    coverStatus.textContent = '';
  }
  function showCover(url, name) {
    if (!url) { resetCover(); return; }
    coverImage.src = url;
    coverName.textContent = name || 'Kapak görseli';
    coverPreview.hidden = false;
  }
  coverInput.addEventListener('change', async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      error.textContent = 'JPG, PNG veya WebP biçiminde bir görsel seçin.';
      coverInput.value = '';
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      error.textContent = 'Kapak görseli 6 MB veya daha küçük olmalı.';
      coverInput.value = '';
      return;
    }
    error.textContent = '';
    coverStatus.textContent = 'Görsel yükleniyor…';
    coverInput.disabled = true;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Görsel okunamadı.'));
        reader.readAsDataURL(file);
      });
      const result = await apiRequest('/api/media', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalName: file.name, dataUrl })
      });
      coverIdInput.value = result.media.id;
      showCover(result.media.url, result.media.original_name);
      coverStatus.textContent = 'Yüklendi. Haber kaydedildiğinde kapak görseli bağlanır.';
    } catch (uploadError) {
      error.textContent = uploadError.message || 'Kapak görseli yüklenemedi.';
      coverStatus.textContent = '';
    } finally {
      coverInput.disabled = false;
    }
  });
  $('#article-cover-remove').addEventListener('click', () => {
    resetCover();
    coverStatus.textContent = 'Kapak görseli haberden kaldırılacak.';
  });
  function configureArticleActions(article) {
    const publisher = ['admin', 'editor_in_chief'].includes(currentAdminRole);
    const editor = ['admin', 'editor_in_chief', 'editor'].includes(currentAdminRole);
    const actions = publisher ? {
      draft: [['draft', 'Değişiklikleri kaydet'], ['in_review', 'İncelemeye gönder']],
      in_review: [['in_review', 'Değişiklikleri kaydet'], ['approved', 'Onayla']],
      approved: [['approved', 'Değişiklikleri kaydet'], ['published', 'Yayınla']],
      scheduled: [['scheduled', 'Planı kaydet'], ['published', 'Şimdi yayınla']],
      published: [['published', 'Güncelle'], ['archived', 'Arşivle']],
      archived: [['archived', 'Arşivde tut'], ['draft', 'Taslağa al']]
    } : editor ? {
      draft: [['draft', 'Değişiklikleri kaydet'], ['in_review', 'İncelemeye gönder']],
      in_review: [['in_review', 'Değişiklikleri kaydet'], ['draft', 'Taslağa geri al']],
      approved: [['in_review', 'Yeniden incelemeye gönder']],
      scheduled: [['in_review', 'İncelemeye geri gönder']],
      published: [['in_review', 'Düzeltme için incelemeye gönder']],
      archived: [['in_review', 'Yeniden incelemeye gönder']]
    } : {
      draft: [['draft', 'Taslağı kaydet'], ['in_review', 'Editöre gönder']],
      in_review: [['draft', 'Taslağa geri al']]
    };
    const choices = [...(actions[article.status] || [])];
    const canEdit = choices.length > 0;
    scheduleButton.hidden = !(canEdit && publisher && ['in_review', 'approved', 'scheduled'].includes(article.status));
    submitButtons.filter((button) => button !== scheduleButton).forEach((button, index) => {
      const choice = choices[index];
      button.hidden = !choice;
      button.disabled = !choice;
      if (choice) { button.value = choice[0]; button.textContent = choice[1]; }
    });
    if (!scheduleButton.hidden) scheduleButton.textContent = article.status === 'scheduled' ? 'Planı kaydet' : 'Planla';
    form.querySelectorAll('input, textarea, select, #article-cover-remove').forEach((field) => { field.disabled = !canEdit; });
    if (!canEdit) error.textContent = 'Bu haberin mevcut durumunda düzenleme yetkiniz yok.';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const headline = form.elements.headline.value.trim();
    const standfirst = form.elements.standfirst.value.trim();
    const body = form.elements.body.value.trim();
    const categoryId = form.elements.categoryId.value;
    if (headline.length < 8) { error.textContent = 'Başlık en az 8 karakter olmalı.'; form.elements.headline.focus(); return; }
    const buttons = submitButtons;
    const editingId = form.dataset.articleId;
    const nextStatus = event.submitter?.value || 'draft';
    if (nextStatus === 'scheduled' && !form.elements.scheduledAt.value) { error.textContent = 'Planlı yayın için tarih ve saat seçin.'; form.elements.scheduledAt.focus(); return; }
    if (nextStatus === 'scheduled' && new Date(form.elements.scheduledAt.value) <= new Date()) { error.textContent = 'Planlı yayın saati gelecekte olmalı.'; form.elements.scheduledAt.focus(); return; }
    buttons.forEach((button) => { button.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    error.textContent = '';
    try {
      await apiRequest(editingId ? `/api/articles/${editingId}` : '/api/articles', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline, standfirst, body, categoryId,
          categoryIds: [...extraCategorySelect.selectedOptions].map((option) => Number(option.value)),
          tags: form.elements.tags.value, coverMediaId: coverIdInput.value || null, coverAltText: form.elements.coverAltText.value,
          homepageSliderSlot: form.elements.homepageSliderSlot.value, isBreaking: form.elements.isBreaking.checked,
          isInBriefing: form.elements.isInBriefing.checked, isInLatest: form.elements.isInLatest.checked,
          scheduledAt: form.elements.scheduledAt.value || null, sourceName: form.elements.sourceName.value,
          sourceUrl: form.elements.sourceUrl.value, seoTitle: form.elements.seoTitle.value,
          seoDescription: form.elements.seoDescription.value, status: nextStatus })
      });
      dialog.close();
      delete form.dataset.articleId;
      const [summary] = await Promise.all([apiRequest('/api/dashboard'), loadArticleLists()]);
      renderSummary(summary);
      const statusMessages = { in_review: 'Haber editör incelemesine gönderildi.', approved: 'Haber onaylandı.', published: 'Haber yayımlandı.', scheduled: 'Haber planlanan zamanda yayımlanacak.', archived: 'Haber arşivlendi.', draft: editingId ? 'Taslak güncellendi.' : 'Haber taslağı kaydedildi.' };
      toast(statusMessages[nextStatus] || 'Haber güncellendi.');
    } catch (requestError) {
      error.textContent = requestError.message || 'Haber kaydedilemedi.';
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      form.removeAttribute('aria-busy');
    }
  });
}
