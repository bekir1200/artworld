'use strict';

// YouTube bağlantısından video kimliğini çıkarır (watch, youtu.be, embed, shorts, live). Geçersizse null.
function youtubeId(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] || null;
  } else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = match ? match[1] : null;
    }
  }

  return id && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null;
}

module.exports = { youtubeId };
