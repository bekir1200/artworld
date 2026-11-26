/* Hızlı reklam ekle: reklam alanı + görsel + bağlantı ile tek adımda reklam.
   Reklam alanları görselin belirli ölçülerde olmasını ister (ör. 1280×250). Bu form yüklenen görseli
   tarayıcıda o alanın en yakın oranlı ölçüsüne ortadan kırpıp boyutlandırır, sonra mevcut uçlarla
   kampanya ve kreatif oluşturur. Ayrıntılı kampanya akışı (Kampanyalar / Kreatifler) aynen durur.
   app.js'teki apiRequest, adminJson ve currentAdminRole kullanılır. */
(function () {
  'use strict';

  var MAX_FILE = 15 * 1024 * 1024;
  var placements = [];
  var prepared = { desktop: null, mobile: null };

  function $(selector, root) { return (root || document).querySelector(selector); }

  function sizeText(size) { return size[0] + '×' + size[1]; }

  function sizesOf(placement, group) {
    var sizes = (placement && placement.supported_sizes && placement.supported_sizes[group]) || [];
    return sizes.filter(function (s) { return Array.isArray(s) && s[0] > 0 && s[1] > 0; });
  }

  // Görselin oranına en yakın ölçü; eşitlikte büyük olan.
  function closestSize(sizes, width, height) {
    var ratio = width / height;
    var best = null;
    var bestDiff = Infinity;
    sizes.forEach(function (s) {
      var diff = Math.abs(Math.log(ratio / (s[0] / s[1])));
      if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) < 1e-9 && s[0] > best[0])) { best = s; bestDiff = diff; }
    });
    return best;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () { resolve({ image: image, url: url }); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Görsel açılamadı. JPG, PNG veya WebP seçin.')); };
      image.src = url;
    });
  }

  // Görseli hedef ölçüye ortadan kırpar. Kaynak yeterince büyükse 2x/3x (retina) üretir.
  function fitImage(image, size) {
    var iw = image.naturalWidth;
    var ih = image.naturalHeight;
    var scale = Math.max(1, Math.min(3, Math.floor(Math.min(iw / size[0], ih / size[1]))));
    var tw = size[0] * scale;
    var th = size[1] * scale;
    var targetRatio = tw / th;
    var sw = iw;
    var sh = ih;
    if (iw / ih > targetRatio) sw = Math.round(ih * targetRatio); else sh = Math.round(iw / targetRatio);
    var sx = Math.round((iw - sw) / 2);
    var sy = Math.round((ih - sh) / 2);
    var canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, tw, th);
    var cropped = 1 - (sw * sh) / (iw * ih);
    return { canvas: canvas, size: size, scale: scale, cropped: cropped, upscaled: iw < size[0] || ih < size[1] };
  }

  function selectedPlacement(form) {
    var id = form.elements.placementId.value;
    return placements.find(function (p) { return String(p.id) === id; }) || null;
  }

  function hasSeparateMobile(placement) {
    var desktop = sizesOf(placement, 'desktop').map(sizeText).join(',');
    var mobile = sizesOf(placement, 'mobile').map(sizeText).join(',');
    return mobile && mobile !== desktop;
  }

  function updateHelp(form) {
    var placement = selectedPlacement(form);
    var help = $('#quick-ad-size-help', form);
    var mobileRow = $('#quick-ad-mobile-row', form);
    if (!placement) {
      help.textContent = 'Reklam alanı seçince görselin hangi ölçüye getirileceği burada görünür.';
      mobileRow.hidden = true;
      return;
    }
    var desktop = sizesOf(placement, 'desktop').map(sizeText).join(', ');
    var mobile = sizesOf(placement, 'mobile').map(sizeText).join(', ');
    help.textContent = 'Bu alanın ölçüleri: bilgisayarda ' + desktop + (hasSeparateMobile(placement) ? ', telefonda ' + mobile : '')
      + '. Görselinizi olduğu gibi yükleyin; en yakın ölçüye otomatik kırpılır. Önizlemeye bakmanız yeterli.';
    mobileRow.hidden = !hasSeparateMobile(placement);
  }

  async function prepare(form, kind) {
    var input = form.elements[kind === 'desktop' ? 'desktopImage' : 'mobileImage'];
    var preview = $('#quick-ad-preview-' + kind, form);
    var note = $('#quick-ad-note-' + kind, form);
    prepared[kind] = null;
    preview.replaceChildren();
    note.textContent = '';
    var file = input.files && input.files[0];
    var placement = selectedPlacement(form);
    if (!file) return;
    if (!placement) { note.textContent = 'Önce reklam alanını seçin.'; input.value = ''; return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > MAX_FILE) {
      note.textContent = 'JPG, PNG veya WebP biçiminde, 15 MB veya daha küçük görsel seçin.';
      input.value = '';
      return;
    }
    try {
      var loaded = await loadImage(file);
      var sizes = sizesOf(placement, kind === 'desktop' ? 'desktop' : 'mobile');
      if (!sizes.length) sizes = sizesOf(placement, 'desktop');
      var size = closestSize(sizes, loaded.image.naturalWidth, loaded.image.naturalHeight);
      var result = fitImage(loaded.image, size);
      URL.revokeObjectURL(loaded.url);
      result.name = file.name.replace(/\.[^.]+$/, '') + '-' + size[0] + 'x' + size[1] + '.jpg';
      prepared[kind] = result;
      result.canvas.className = 'quick-ad-canvas';
      result.canvas.setAttribute('role', 'img');
      result.canvas.setAttribute('aria-label', 'Reklam önizlemesi ' + sizeText(size));
      preview.append(result.canvas);
      var parts = ['Görsel ' + sizeText(size) + ' ölçüsüne getirildi' + (result.scale > 1 ? ' (' + result.scale + 'x keskin)' : '') + '.'];
      if (result.cropped > 0.15) parts.push('Kenarlardan %' + Math.round(result.cropped * 100) + ' kırpıldı; önemli yazı kesildiyse bu orana yakın bir görsel yükleyin.');
      if (result.upscaled) parts.push('Görsel bu alan için küçük; bulanık görünebilir.');
      note.textContent = parts.join(' ');
    } catch (error) {
      note.textContent = error.message;
      input.value = '';
    }
  }

  function canvasDataUrl(canvas) {
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  async function uploadPrepared(item) {
    var result = await apiRequest('/api/media', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalName: item.name, dataUrl: canvasDataUrl(item.canvas) })
    });
    return result.media.id;
  }

  async function submit(form) {
    var feedback = $('#quick-ad-feedback', form);
    var button = $('button[type="submit"]', form);
    var placement = selectedPlacement(form);
    var title = form.elements.title.value.trim();
    var target = form.elements.targetUrl.value.trim();
    if (!placement) { feedback.textContent = 'Reklam alanını seçin.'; return; }
    if (title.length < 2) { feedback.textContent = 'Reklam adını yazın.'; return; }
    if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(target)) { feedback.textContent = 'Tıklanınca açılacak adresi https:// ile başlayarak yazın.'; return; }
    if (!prepared.desktop) { feedback.textContent = 'Reklam görselini seçin.'; return; }
    var startsAt = form.elements.startsAt.value;
    var endsAt = form.elements.endsAt.value;
    if (startsAt && endsAt && endsAt < startsAt) { feedback.textContent = 'Bitiş tarihi başlangıçtan önce olamaz.'; return; }

    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    var campaignId = null;
    try {
      feedback.textContent = 'Görsel yükleniyor…';
      var desktopId = await uploadPrepared(prepared.desktop);
      var mobileId = prepared.mobile && !$('#quick-ad-mobile-row', form).hidden ? await uploadPrepared(prepared.mobile) : null;
      feedback.textContent = 'Reklam oluşturuluyor…';
      var campaign = await apiRequest('/api/admin/advertising/campaigns', adminJson('POST', {
        name: title,
        companyName: form.elements.companyName.value.trim() || 'Art World TV',
        placementId: placement.id,
        startsAt: startsAt || '',
        endsAt: endsAt || ''
      }));
      campaignId = campaign.id;
      var creative = { campaignId: campaignId, headline: title, targetUrl: target };
      await apiRequest('/api/admin/advertising/creatives', adminJson('POST', Object.assign({ mediaId: desktopId }, creative)));
      if (mobileId) await apiRequest('/api/admin/advertising/creatives', adminJson('POST', Object.assign({ mediaId: mobileId }, creative)));
      var isAdmin = typeof currentAdminRole === 'string' && currentAdminRole === 'admin';
      if (!isAdmin) await apiRequest('/api/admin/advertising/campaigns/' + campaignId, adminJson('PATCH', { status: 'awaiting_approval' }));
      campaignId = null;
      form.reset();
      prepared = { desktop: null, mobile: null };
      ['desktop', 'mobile'].forEach(function (kind) { $('#quick-ad-preview-' + kind, form).replaceChildren(); $('#quick-ad-note-' + kind, form).textContent = ''; });
      updateHelp(form);
      feedback.textContent = isAdmin
        ? (startsAt && startsAt > new Date().toISOString().slice(0, 10) ? 'Reklam kaydedildi; ' + startsAt + ' tarihinde yayına girecek.' : 'Reklam yayında. Sitede görmek için sayfayı yenileyin.')
        : 'Reklam yönetici onayına gönderildi.';
      document.dispatchEvent(new CustomEvent('ads:changed'));
    } catch (error) {
      // Yarım kalan kampanyayı geri al (yalnız yönetici silebilir; diğer rollerde taslak kalır).
      if (campaignId) { try { await apiRequest('/api/admin/advertising/campaigns/' + campaignId, { method: 'DELETE' }); } catch (ignore) { /* taslak kalır */ } }
      feedback.textContent = error.message || 'Reklam eklenemedi.';
    } finally {
      button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  }

  async function init() {
    var form = $('#quick-ad-form');
    if (!form) return;
    form.elements.placementId.addEventListener('change', function () {
      updateHelp(form);
      // Alan değişince ölçü de değişir: seçili görselleri yeniden hazırla.
      prepare(form, 'desktop');
      prepare(form, 'mobile');
    });
    form.elements.desktopImage.addEventListener('change', function () { prepare(form, 'desktop'); });
    form.elements.mobileImage.addEventListener('change', function () { prepare(form, 'mobile'); });
    form.addEventListener('submit', function (event) { event.preventDefault(); submit(form); });
    updateHelp(form);
    try {
      var data = await apiRequest('/api/admin/advertising');
      placements = (data.placements || []).filter(function (p) { return p.is_active; });
      var select = form.elements.placementId;
      select.replaceChildren(new Option('Reklam alanı seçin', ''));
      placements.forEach(function (p) { select.add(new Option(p.display_name + ' · ' + p.page_area, p.id)); });
    } catch (error) {
      if (error.status !== 403 && error.status !== 401) $('#quick-ad-feedback', form).textContent = error.message || 'Reklam alanları alınamadı.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
