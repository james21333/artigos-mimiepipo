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

  function showApp(session) {
    gate.hidden = true;
    app.hidden = false;
    const bits = [];
    if (session.ready || session.cleanReady) bits.push('Ready');
    else bits.push('Setup incomplete');
    if (session.uploadReady) bits.push('Library on');
    sessionMeta.textContent = bits.join(' · ');
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
    const base = String(key || '').split('/').pop() || 'video';
    return base.replace(/\.mp4$/i, '').replace(/_/g, ' ');
  }

  function uploadedMs(obj) {
    if (!obj || !obj.uploaded) return 0;
    const t = new Date(obj.uploaded).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  /** Stable completion order: oldest uploaded = 1. Ties broken by key. */
  function withSequenceNumbers(videos) {
    const byAge = [...videos].sort((a, b) => {
      const diff = uploadedMs(a) - uploadedMs(b);
      if (diff !== 0) return diff;
      return String(a.key || '').localeCompare(String(b.key || ''));
    });
    const seqByKey = new Map();
    byAge.forEach((obj, i) => {
      seqByKey.set(obj.key, i + 1);
    });
    return videos.map((obj) => ({ ...obj, seq: seqByKey.get(obj.key) }));
  }

  function renderItems(objects, cleanMap) {
    galleryGrid.innerHTML = '';
    const videos = (objects || []).filter((o) => o && o.key && !o.key.endsWith('/'));
    const map = cleanMap && typeof cleanMap === 'object' ? cleanMap : {};
    if (!videos.length) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'Library empty';
      return;
    }
    galleryEmpty.hidden = true;
    galleryGrid.hidden = false;
    const cleanedCount = videos.filter((v) => map[v.key] && map[v.key].cleanedKey).length;
    galleryStatus.textContent = `${videos.length} video${videos.length === 1 ? '' : 's'}${
      cleanedCount ? ` · ${cleanedCount} already cleaned` : ''
    }`;

    // Numbers = completion order (oldest = 1). Grid shows newest first.
    const numbered = withSequenceNumbers(videos).sort((a, b) => {
      const diff = uploadedMs(b) - uploadedMs(a);
      if (diff !== 0) return diff;
      return String(b.key || '').localeCompare(String(a.key || ''));
    });

    for (const obj of numbered) {
      const src = obj.downloadPath;
      const cleanInfo = map[obj.key] || null;
      const card = document.createElement('article');
      card.className = 'gallery-card';

      const media = document.createElement('div');
      media.className = 'gallery-media';

      const badge = document.createElement('span');
      badge.className = 'gallery-seq';
      badge.textContent = String(obj.seq);
      badge.setAttribute('aria-label', `Downloaded video ${obj.seq}`);
      media.appendChild(badge);

      if (cleanInfo && cleanInfo.cleanedKey) {
        const cleanedBadge = document.createElement('span');
        cleanedBadge.className = 'gallery-cleaned-badge';
        cleanedBadge.textContent = 'Cleaned';
        cleanedBadge.title = cleanInfo.cleanedAt
          ? `Cleaned ${formatWhen(cleanInfo.cleanedAt)}`
          : 'Has a cleaned copy';
        media.appendChild(cleanedBadge);
      }

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
      title.textContent = `#${obj.seq} · ${displayName(obj.key)}`;

      const info = document.createElement('p');
      info.className = 'muted-line';
      const bits = [formatWhen(obj.uploaded), formatBytes(obj.size)].filter(Boolean);
      if (cleanInfo && cleanInfo.cleanedKey) {
        bits.push(
          cleanInfo.account
            ? `Cleaned → ${cleanInfo.account}`
            : 'Cleaned copy saved',
        );
      }
      info.textContent = bits.join(' · ');

      const actions = document.createElement('p');
      actions.className = 'gallery-actions';
      const dl = document.createElement('a');
      dl.className = 'btn-link';
      dl.href = `${src}${src.includes('?') ? '&' : '?'}download=1`;
      dl.textContent = 'Download original';
      dl.setAttribute('download', '');
      actions.appendChild(dl);

      if (cleanInfo && cleanInfo.cleanedKey) {
        const cleanedDl = document.createElement('a');
        cleanedDl.className = 'btn-link';
        const cleanedPath = `/api/contentstation/media?action=get&key=${encodeURIComponent(cleanInfo.cleanedKey)}`;
        cleanedDl.href = `${cleanedPath}&download=1`;
        cleanedDl.textContent = 'Open cleaned';
        cleanedDl.setAttribute('download', '');
        actions.appendChild(document.createTextNode(' '));
        actions.appendChild(cleanedDl);
        if (cleanInfo.account) {
          const ready = document.createElement('a');
          ready.className = 'btn-link';
          ready.href = `./ready-account.html?account=${encodeURIComponent(cleanInfo.account)}`;
          ready.textContent = 'Ready For Upload';
          actions.appendChild(document.createTextNode(' '));
          actions.appendChild(ready);
        }
      } else {
        const cleanLink = document.createElement('a');
        cleanLink.className = 'btn-link gallery-jump';
        cleanLink.href = `./?media=${encodeURIComponent(obj.key)}`;
        cleanLink.textContent = 'Clean this video';
        actions.appendChild(document.createTextNode(' '));
        actions.appendChild(cleanLink);
      }

      meta.appendChild(title);
      if (bits.length) meta.appendChild(info);
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
      const [listRes, mapRes] = await Promise.all([
        api('/api/contentstation/media?action=list&prefix=tiktok/&limit=100'),
        api('/api/contentstation/media?action=clean-map'),
      ]);
      if (!listRes.ok) {
        throw new Error(
          (listRes.data && (listRes.data.message || listRes.data.error)) ||
            'Could not load library.',
        );
      }
      const cleanMap = mapRes.ok && mapRes.data ? mapRes.data.map || {} : {};
      renderItems(listRes.data.objects || [], cleanMap);
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
      if (window.CSAuth && !window.CSAuth.gatePage(data, 'downloaded')) return false;
      if (window.CSAuth) window.CSAuth.applyNav(data.role);
      window.__csSession = data;
      showApp(data);
      return true;
    }
    window.__csSession = null;
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
