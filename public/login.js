const form = document.querySelector('#login-form');
const errorText = document.querySelector('#login-error');
const submitButton = form.querySelector('button[type="submit"]');
const rememberBox = document.querySelector('#login-remember');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorText.textContent = '';
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  submitButton.textContent = 'Kontrol ediliyor';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: form.elements.email.value,
        password: form.elements.password.value,
        remember: Boolean(rememberBox && rememberBox.checked)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Giriş yapılamadı.');
    window.location.assign('/yonetim');
  } catch (error) {
    errorText.textContent = error.message || 'Sunucuya ulaşılamadı. Yeniden deneyin.';
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
    submitButton.textContent = 'Giriş yap';
    form.elements.password.focus();
  }
});
