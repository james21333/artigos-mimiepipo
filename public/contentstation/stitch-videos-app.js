(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
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
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  function setError(msg) {
    if (!galleryError) return;
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

  function mediaGet(key) {
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function render(objects) {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';
    if (!objects.length) {
      galleryGrid.hidden = true;
      if (galleryEmpty) galleryEmpty.hidden = false;
      if (galleryStatus) galleryStatus.textContent = 'No stitch videos yet';
      return;
    }
    if (galleryEmpty) galleryEmpty.hidden = true;
    galleryGrid.hidden = false;
    if (galleryStatus) {
      galleryStatus.textContent = `${objects.length} stitch video${objects.length === 1 ? '' : 's'}`;
    }

    for (const obj of objects) {
      const key = obj.key;
      const jobId = obj.jobId || String(key || '').split('/')[1] || '';
      const href = obj.downloadPath || mediaGet(key);
      const card = document.createElement('article');
      card.className = 'gallery-card';
      card.innerHTML = `
        <video controls playsinline preload="metadata" src="${href}"></video>
        <div class="gallery-card-meta">
          <p class="gallery-card-title">Stitch · ${jobId.slice(0, 10)}</p>
          <p class="muted-line">${formatWhen(obj.uploaded)} · ${formatBytes(obj.size)}</p>
          <p class="row" style="gap:0.75rem;flex-wrap:wrap;">
            <a href="${href}" target="_blank" rel="noopener">Open / download</a>
          </p>
        </div>
      `;
      galleryGrid.appendChild(card);
    }
  }

  async function load() {
    setError('');
    if (galleryStatus) galleryStatus.textContent = 'Loading…';
    const { ok, data } = await api(
      '/api/contentstation/character-remix-2-og?action=list&variant=stitch-maker&limit=100',
    );
    if (!ok) {
      setError(data?.message || data?.error || 'Could not load stitch videos');
      if (galleryStatus) galleryStatus.textContent = 'Load failed';
      return;
    }
    render(Array.isArray(data?.objects) ? data.objects : []);
  }

  function showGate() {
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${session.role || 'kenneth'}`;
    if (window.CSAuth) window.CSAuth.applyNav(session.role || 'kenneth');
    if (window.CSAuth) window.CSAuth.applyBrand(session.role || 'kenneth');
  }

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (gateError) gateError.hidden = true;
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password: passwordInput?.value || '' }),
    });
    if (!ok || !data?.authenticated) {
      if (gateError) {
        gateError.hidden = false;
        gateError.textContent = data?.error || data?.message || 'Sign-in failed.';
      }
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-videos')) return;
    location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  refreshBtn?.addEventListener('click', () => {
    load().catch((err) => setError(err?.message || String(err)));
  });

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      showGate();
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-videos')) return;
    showApp(data);
    await load();
  }

  boot().catch((err) => {
    showGate();
    if (gateError) {
      gateError.hidden = false;
      gateError.textContent = err?.message || String(err);
    }
  });
})();
