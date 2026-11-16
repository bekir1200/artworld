(function () {
  'use strict';

  var form = document.getElementById('login-form');
  if (!form) return;

  var mode = form.getAttribute('data-mode');
  var errorText = document.getElementById('login-error');
  var submitButton = form.querySelector('button[type="submit"]');
  var idleLabel = submitButton ? submitButton.textContent : '';

  function showError(message) {
    errorText.textContent = message || '';
  }

  function setBusy(busy, label) {
    submitButton.disabled = busy;
    if (busy) {
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = label;
    } else {
      submitButton.removeAttribute('aria-busy');
      submitButton.textContent = idleLabel;
    }
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        return { ok: response.ok, result: result };
      });
    });
  }

  function failureMessage(payload) {
    return (payload.result && payload.result.error) || 'İşlem tamamlanamadı. Yeniden deneyin.';
  }

  function networkMessage() {
    return 'Sunucuya ulaşılamadı. Yeniden deneyin.';
  }

  function initForgot() {
    var message = document.getElementById('forgot-message');
    var note = document.getElementById('forgot-note');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      showError('');
      setBusy(true, 'Gönderiliyor');
      var email = form.elements.email.value.trim();

      postJson('/api/auth/forgot', { email: email }).then(function (payload) {
        if (!payload.ok) throw new Error(failureMessage(payload));
        form.hidden = true;
        message.textContent = payload.result.message || 'Bu e-posta kayıtlıysa parola sıfırlama bağlantısı gönderildi.';
        message.hidden = false;
        if (!payload.result.emailEnabled) {
          note.textContent = 'E-posta gönderimi henüz yapılandırılmamış. Parolanızı sıfırlaması için site yöneticinize başvurun.';
          note.hidden = false;
        }
      }).catch(function (error) {
        showError(error && error.message ? error.message : networkMessage());
        setBusy(false);
        form.elements.email.focus();
      });
    });
  }

  function initReset() {
    var message = document.getElementById('reset-message');
    var done = document.getElementById('reset-done');
    var token = new URLSearchParams(window.location.search).get('token') || '';

    // Token adres çubuğunda ve geçmişte kalmasın.
    try { window.history.replaceState(null, '', window.location.pathname); } catch (error) { /* yoksay */ }

    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      showError('Bağlantı geçersiz veya süresi dolmuş.');
      submitButton.disabled = true;
      return;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      showError('');
      var password = form.elements.password.value;
      var confirmation = form.elements.passwordConfirm.value;

      if (password.length < 14 || password.length > 256) {
        showError('Parola 14-256 karakter olmalı.');
        form.elements.password.focus();
        return;
      }
      if (password !== confirmation) {
        showError('Parolalar eşleşmiyor.');
        form.elements.passwordConfirm.focus();
        return;
      }

      setBusy(true, 'Kaydediliyor');
      postJson('/api/auth/reset', { token: token, password: password }).then(function (payload) {
        if (!payload.ok) throw new Error(failureMessage(payload));
        form.hidden = true;
        message.hidden = false;
        done.hidden = false;
      }).catch(function (error) {
        showError(error && error.message ? error.message : networkMessage());
        setBusy(false);
        form.elements.password.focus();
      });
    });
  }

  if (mode === 'forgot') initForgot();
  else if (mode === 'reset') initReset();
})();
