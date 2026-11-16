(function () {
  'use strict';

  var panel = document.querySelector('.admin-content[data-panel="kullanicilar"]');
  if (!panel || panel.querySelector('#admin-password-form')) return;

  var card = document.createElement('div');
  card.className = 'admin-table';

  var heading = document.createElement('div');
  heading.className = 'table-heading';
  var title = document.createElement('strong');
  title.textContent = 'Personel parolası sıfırla';
  var hint = document.createElement('span');
  hint.textContent = 'Yalnızca yöneticiler kullanabilir.';
  heading.appendChild(title);
  heading.appendChild(hint);

  var form = document.createElement('form');
  form.id = 'admin-password-form';
  form.className = 'admin-form-grid';
  form.setAttribute('novalidate', '');

  var userLabel = document.createElement('label');
  userLabel.textContent = 'Personel';
  var userSelect = document.createElement('select');
  userSelect.name = 'userId';
  userSelect.required = true;
  userSelect.setAttribute('aria-label', 'Parolası sıfırlanacak personel');
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Personel seçin';
  userSelect.appendChild(placeholder);
  userLabel.appendChild(userSelect);

  var passwordLabel = document.createElement('label');
  passwordLabel.textContent = 'Yeni parola';
  var passwordInput = document.createElement('input');
  passwordInput.name = 'password';
  passwordInput.type = 'password';
  passwordInput.required = true;
  passwordInput.minLength = 14;
  passwordInput.maxLength = 256;
  passwordInput.autocomplete = 'new-password';
  passwordLabel.appendChild(passwordInput);

  var confirmLabel = document.createElement('label');
  confirmLabel.textContent = 'Yeni parola (tekrar)';
  var confirmInput = document.createElement('input');
  confirmInput.name = 'passwordConfirm';
  confirmInput.type = 'password';
  confirmInput.required = true;
  confirmInput.minLength = 14;
  confirmInput.maxLength = 256;
  confirmInput.autocomplete = 'new-password';
  confirmLabel.appendChild(confirmInput);

  var warning = document.createElement('p');
  warning.className = 'form-wide';
  warning.textContent = 'Kullanıcının tüm açık oturumları kapatılır. Kendi parolanızı değiştiriyorsanız oturumunuz da kapanır.';

  var submit = document.createElement('button');
  submit.className = 'primary-action';
  submit.type = 'submit';
  submit.textContent = 'Parolayı güncelle';

  var feedback = document.createElement('p');
  feedback.className = 'form-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');

  form.appendChild(userLabel);
  form.appendChild(passwordLabel);
  form.appendChild(confirmLabel);
  form.appendChild(warning);
  form.appendChild(submit);
  form.appendChild(feedback);

  card.appendChild(heading);
  card.appendChild(form);
  panel.appendChild(card);

  function setFeedback(text) {
    feedback.textContent = text || '';
  }

  function loadUsers() {
    return fetch('/api/admin/users', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Personel listesi alınamadı.');
          return Array.isArray(data.users) ? data.users : [];
        });
      })
      .then(function (users) {
        var selected = userSelect.value;
        while (userSelect.options.length > 1) userSelect.remove(1);
        users.forEach(function (user) {
          var option = document.createElement('option');
          option.value = String(user.id);
          option.textContent = (user.display_name || user.email) + ' (' + user.email + ')' + (user.is_active ? '' : ' - pasif');
          userSelect.appendChild(option);
        });
        if (selected) userSelect.value = selected;
      })
      .catch(function (error) {
        setFeedback(error.message || 'Personel listesi alınamadı.');
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    setFeedback('');
    var userId = userSelect.value;
    var password = passwordInput.value;

    if (!/^[1-9]\d*$/.test(userId)) {
      setFeedback('Parolası sıfırlanacak personeli seçin.');
      userSelect.focus();
      return;
    }
    if (password.length < 14 || password.length > 256) {
      setFeedback('Parola 14-256 karakter olmalı.');
      passwordInput.focus();
      return;
    }
    if (password !== confirmInput.value) {
      setFeedback('Parolalar eşleşmiyor.');
      confirmInput.focus();
      return;
    }

    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    fetch('/api/admin/user-password/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: password })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || 'Parola güncellenemedi.');
          return data;
        });
      })
      .then(function (data) {
        passwordInput.value = '';
        confirmInput.value = '';
        var text = 'Parola güncellendi. Kullanıcının açık oturumları kapatıldı.';
        if (data.selfChanged) text += ' Kendi hesabınızın parolasını değiştirdiniz; yeni parolanızla yeniden giriş yapın.';
        setFeedback(text);
        loadUsers();
      })
      .catch(function (error) {
        setFeedback(error.message || 'Parola güncellenemedi.');
      })
      .then(function () {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      });
  });

  loadUsers();
  var tab = document.querySelector('.admin-tab[data-tab="kullanicilar"]');
  if (tab) tab.addEventListener('click', loadUsers);
})();
