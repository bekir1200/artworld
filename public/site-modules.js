(function () {
  'use strict';

  var VOTED_KEY_PREFIX = 'artworld:poll-voted:';
  var VOTED_MESSAGE = 'Bu ankette oy kullandınız.';
  var NETWORK_ERROR = 'Bağlantı hatası oluştu. Lütfen tekrar deneyin.';
  var GENERIC_ERROR = 'Bir hata oluştu. Lütfen tekrar deneyin.';

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* Depolama kullanılamıyorsa sessizce geç. */
    }
  }

  function getStatusElement(form) {
    var status = form.querySelector('[data-form-status]');
    if (!status) {
      status = document.createElement('p');
      status.setAttribute('data-form-status', '');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      form.appendChild(status);
    }
    return status;
  }

  function setStatus(form, message, state) {
    var status = getStatusElement(form);
    status.textContent = message;
    status.dataset.state = state;
  }

  function setBusy(form, busy) {
    var controls = form.querySelectorAll('button, input[type="submit"]');
    for (var i = 0; i < controls.length; i++) {
      controls[i].disabled = busy;
    }
  }

  function readCheckbox(form, name) {
    var element = form.elements.namedItem(name);
    return !!(element && element.checked);
  }

  function readValue(form, name) {
    var element = form.elements.namedItem(name);
    return element && typeof element.value === 'string' ? element.value : '';
  }

  // Ortak gonderim: JSON POST, durum metni textContent ile yazilir.
  // onSuccess(data) basarida, onConflict(data) 409'da cagrilir (yoksa hata gibi davranir).
  function postJson(form, url, payload, handlers) {
    setBusy(form, true);
    setStatus(form, 'Gönderiliyor...', 'pending');

    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          return { ok: response.ok, status: response.status, data: data || {} };
        });
      })
      .then(function (result) {
        if (result.ok) {
          handlers.onSuccess(result.data);
        } else if (result.status === 409 && handlers.onConflict) {
          handlers.onConflict(result.data);
        } else {
          setStatus(form, result.data.error || GENERIC_ERROR, 'error');
          setBusy(form, false);
        }
      })
      .catch(function () {
        setStatus(form, NETWORK_ERROR, 'error');
        setBusy(form, false);
      });
  }

  function initCommentForm(form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var articleId = Number(form.dataset.articleId);
      postJson(form, '/api/public/comments', {
        articleId: articleId,
        name: readValue(form, 'name'),
        email: readValue(form, 'email'),
        body: readValue(form, 'body'),
        website: readValue(form, 'website'),
        consent: readCheckbox(form, 'consent')
      }, {
        onSuccess: function (data) {
          form.reset();
          setStatus(form, data.message || 'Yorumunuz alındı.', 'success');
          setBusy(form, false);
        }
      });
    });
  }

  function renderPollResults(container, poll, notice) {
    container.textContent = '';

    if (notice) {
      var noticeEl = document.createElement('p');
      noticeEl.textContent = notice;
      container.appendChild(noticeEl);
    }

    if (!poll) return;

    var question = document.createElement('p');
    question.textContent = poll.question || '';
    container.appendChild(question);

    var total = Number(poll.totalVotes) || 0;
    var options = Array.isArray(poll.options) ? poll.options : [];

    options.forEach(function (option) {
      var votes = Number(option.votes) || 0;
      var percent = total > 0 ? Math.round((votes / total) * 100) : 0;

      var row = document.createElement('div');
      row.className = 'poll-result-row';

      var head = document.createElement('div');
      head.className = 'poll-result-head';

      var label = document.createElement('span');
      label.className = 'poll-result-label';
      label.textContent = option.label || '';

      var value = document.createElement('span');
      value.className = 'poll-result-value';
      value.textContent = '%' + percent + ' (' + votes + ')';

      head.appendChild(label);
      head.appendChild(value);

      var track = document.createElement('div');
      track.className = 'poll-result-track';

      var bar = document.createElement('div');
      bar.className = 'poll-result-bar';
      bar.style.width = percent + '%';

      track.appendChild(bar);
      row.appendChild(head);
      row.appendChild(track);
      container.appendChild(row);
    });

    var totalEl = document.createElement('p');
    totalEl.className = 'poll-result-total';
    totalEl.textContent = 'Toplam ' + total + ' oy';
    container.appendChild(totalEl);
  }

  function findResultsContainer(form, pollId) {
    var candidates = document.querySelectorAll('[data-poll-results]');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].dataset.pollId === String(pollId)) return candidates[i];
    }
    var inside = form.querySelector('[data-poll-results]');
    if (inside) return inside;
    return candidates.length ? candidates[0] : null;
  }

  function showPollVoted(form, container, notice, poll) {
    form.hidden = true;
    if (container) {
      renderPollResults(container, poll, notice);
      container.hidden = false;
    }
  }

  function initPollForm(form) {
    var pollId = form.dataset.pollId;
    var storageKey = VOTED_KEY_PREFIX + pollId;
    var container = findResultsContainer(form, pollId);

    if (safeGet(storageKey) === '1') {
      // Sonuc verisi saklanmadigi icin yalnizca bilgi metni gosterilir.
      showPollVoted(form, container, VOTED_MESSAGE, null);
      return;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var selected = form.querySelector('input[name="optionId"]:checked');
      if (!selected) {
        setStatus(form, 'Lütfen bir seçenek seçin.', 'error');
        return;
      }

      postJson(form, '/api/public/polls/' + encodeURIComponent(pollId) + '/vote', {
        optionId: Number(selected.value)
      }, {
        onSuccess: function (data) {
          safeSet(storageKey, '1');
          showPollVoted(form, container, 'Oyunuz kaydedildi, teşekkürler.', data.poll);
        },
        onConflict: function (data) {
          safeSet(storageKey, '1');
          showPollVoted(form, container, data.error || VOTED_MESSAGE, data.poll);
        }
      });
    });
  }

  function initVisitorPostForm(form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      postJson(form, '/api/public/visitor-posts', {
        name: readValue(form, 'name'),
        email: readValue(form, 'email'),
        title: readValue(form, 'title'),
        body: readValue(form, 'body'),
        website: readValue(form, 'website'),
        consent: readCheckbox(form, 'consent')
      }, {
        onSuccess: function (data) {
          form.reset();
          setStatus(form, data.message || 'Haberiniz alındı.', 'success');
          setBusy(form, false);
        }
      });
    });
  }

  function init() {
    var commentForms = document.querySelectorAll('form[data-comment-form]');
    for (var i = 0; i < commentForms.length; i++) initCommentForm(commentForms[i]);

    var pollForms = document.querySelectorAll('form[data-poll-form]');
    for (var j = 0; j < pollForms.length; j++) initPollForm(pollForms[j]);

    var visitorForms = document.querySelectorAll('form[data-visitor-post-form]');
    for (var k = 0; k < visitorForms.length; k++) initVisitorPostForm(visitorForms[k]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
