(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const galleryStatus = document.getElementById('gallery-status');
  const galleryError = document.getElementById('gallery-error');
  const galleryGrid = document.getElementById('gallery-grid');
  const galleryEmpty = document.getElementById('gallery-empty');
  const refreshBtn = document.getElementById('refresh-btn');

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const headers = { ...(options.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    opts.headers = headers;
    const res = await fetch(path, opts);
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  }

  function showGate(msg) {
    gate.hidden = false;
    app.hidden = true;
    if (msg) {
      gateError.hidden = false;
      gateError.textContent = msg;
    } else {
      gateError.hidden = true;
    }
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = 'Signed in';
  }

  function setError(msg) {
    if (msg) {
      galleryError.hidden = false;
      galleryError.textContent = msg;
    } else {
      galleryError.hidden = true;
      galleryError.textContent = '';
    }
  }

  function formatBytes(n) {
    if (n == null || !Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function displayName(key) {
    const base = String(key || '').split('/').pop() || 'remix';
    return base.replace(/\.mp4$/i, '').replace(/_/g, ' ');
  }

  function uploadedMs(obj) {
    if (!obj || !obj.uploaded) return 0;
    const t = new Date(obj.uploaded).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function renderItems(objects) {
    galleryGrid.innerHTML = '';
    const videos = (objects || []).filter((o) => o && o.key && !o.key.endsWith('/'));
    if (!videos.length) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'Library empty';
      return;
    }
    galleryEmpty.hidden = true;
    galleryGrid.hidden = false;
    galleryStatus.textContent = `${videos.length} remix${videos.length === 1 ? '' : 'es'}`;

    const newestFirst = [...videos].sort((a, b) => {
      const diff = uploadedMs(b) - uploadedMs(a);
      if (diff !== 0) return diff;
      return String(b.key || '').localeCompare(String(a.key || ''));
    });

    for (const obj of newestFirst) {
      const src = obj.downloadPath;
      const card = document.createElement('article');
      card.className = 'gallery-card';

      const media = document.createElement('div');
      media.className = 'gallery-media';

      const video = document.createElement('video');
      video.src = src;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      media.appendChild(video);

      const meta = document.createElement('div');
      meta.className = 'gallery-meta';

      const title = document.createElement('p');
      title.className = 'gallery-title';
      title.textContent = displayName(obj.key);

      const info = document.createElement('p');
      info.className = 'muted-line';
      const bits = [formatWhen(obj.uploaded), formatBytes(obj.size)].filter(Boolean);
      if (obj.runpodJobId) bits.push(`job ${obj.runpodJobId}`);
      info.textContent = bits.join(' · ');

      const source = document.createElement('p');
      source.className = 'muted-line result-url';
      if (obj.tiktokUrl) {
        source.textContent = obj.tiktokUrl;
      } else if (obj.sourceKey) {
        source.textContent = obj.sourceKey;
      } else {
        source.hidden = true;
      }

      const actions = document.createElement('p');
      actions.className = 'gallery-actions';
      const dl = document.createElement('a');
      dl.className = 'btn-link';
      dl.href = `${src}${src.includes('?') ? '&' : '?'}download=1`;
      dl.textContent = 'Download';
      dl.setAttribute('download', '');
      actions.appendChild(dl);

      if (obj.tiktokUrl && /^https?:\/\//i.test(obj.tiktokUrl)) {
        const open = document.createElement('a');
        open.className = 'btn-link';
        open.href = obj.tiktokUrl;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = 'Source TikTok';
        actions.appendChild(document.createTextNode(' '));
        actions.appendChild(open);
      }

      meta.appendChild(title);
      if (bits.length) meta.appendChild(info);
      if (!source.hidden) meta.appendChild(source);
      meta.appendChild(actions);

      card.appendChild(media);
      card.appendChild(meta);
      galleryGrid.appendChild(card);
    }
  }

  async function loadGallery() {
    setError('');
    galleryStatus.textContent = 'Loading…';
    refreshBtn.disabled = true;
    try {
      const listRes = await api('/api/contentstation/facefusion-remix?action=list&limit=100');
      if (!listRes.ok) {
        throw new Error(
          (listRes.data && (listRes.data.message || listRes.data.error)) ||
            'Could not load remix library.',
        );
      }
      renderItems(listRes.data.objects || []);
    } catch (err) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = true;
      galleryStatus.textContent = 'Could not load';
      setError(err && err.message ? err.message : String(err));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  async function refreshSession() {
    const { ok, data } = await api('/api/contentstation/session');
    if (ok && data && data.authenticated) {
      if (window.CSAuth && !window.CSAuth.gatePage(data, 'facefusion-remixes')) return false;
      if (window.CSAuth) window.CSAuth.applyNav(data.role);
      showApp();
      return true;
    }
    showGate();
    return false;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    gateError.hidden = true;
    const password = document.getElementById('password').value;
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate((data && (data.message || data.error)) || 'Login failed');
      return;
    }
    document.getElementById('password').value = '';
    const authed = await refreshSession();
    if (authed) await loadGallery();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshBtn.addEventListener('click', () => {
    loadGallery().catch(() => {});
  });

  refreshSession()
    .then((authed) => {
      if (authed) return loadGallery();
    })
    .catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
