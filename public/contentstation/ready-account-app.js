(function () {
  const params = new URLSearchParams(window.location.search);
  const accountName = (params.get('account') || '').trim();

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const galleryStatus = document.getElementById('gallery-status');
  const galleryError = document.getElementById('gallery-error');
  const galleryGrid = document.getElementById('gallery-grid');
  const galleryEmpty = document.getElementById('gallery-empty');
  const refreshBtn = document.getElementById('refresh-btn');
  const accountTitle = document.getElementById('account-title');
  const accountSub = document.getElementById('account-sub');

  let accountsCache = [];

  if (accountName) {
    accountTitle.textContent = accountName;
    accountSub.textContent = accountName;
    document.title = `Content Station | ${accountName}`;
  }

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
    sessionMeta.textContent = 'Signed in';
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
      return new Date(iso).toLocaleString();
    } catch {
      return '';
    }
  }

  function displayName(key) {
    const base = String(key || '').split('/').pop() || key;
    return base.replace(/\.mp4$/i, '');
  }

  async function loadAccountOptions() {
    const { ok, data } = await api('/api/contentstation/accounts?action=list');
    if (ok && data && Array.isArray(data.accounts)) {
      accountsCache = data.accounts.map((a) => a.name);
    }
  }

  async function retag(key, account) {
    const { ok, data } = await api('/api/contentstation/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'tag', key, account: account || '' }),
    });
    if (!ok) {
      throw new Error((data && (data.message || data.error)) || 'Could not update tag.');
    }
    if (data.accounts) {
      accountsCache = data.accounts.map((a) => a.name);
    }
  }

  function renderItems(videos) {
    galleryGrid.innerHTML = '';
    const list = videos || [];
    if (!list.length) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'Queue empty';
      return;
    }
    galleryEmpty.hidden = true;
    galleryGrid.hidden = false;
    galleryStatus.textContent = `${list.length} video${list.length === 1 ? '' : 's'}`;

    for (const obj of list) {
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
      info.textContent = [formatWhen(obj.uploaded), formatBytes(obj.size)].filter(Boolean).join(' · ');

      const tagRow = document.createElement('div');
      tagRow.className = 'tag-row';
      const label = document.createElement('label');
      label.textContent = 'Account';
      const select = document.createElement('select');
      select.className = 'account-select';
      const unt = document.createElement('option');
      unt.value = '';
      unt.textContent = '— Untagged (Cleaned videos) —';
      select.appendChild(unt);
      const names = new Set(accountsCache);
      if (accountName) names.add(accountName);
      [...names].sort((a, b) => a.localeCompare(b)).forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === accountName) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await retag(obj.key, select.value);
          if (select.value !== accountName) {
            card.remove();
            if (!galleryGrid.children.length) {
              galleryGrid.hidden = true;
              galleryEmpty.hidden = false;
              galleryStatus.textContent = 'Queue empty';
            } else {
              galleryStatus.textContent = `${galleryGrid.children.length} video${
                galleryGrid.children.length === 1 ? '' : 's'
              }`;
            }
          }
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
          select.value = accountName;
        } finally {
          select.disabled = false;
        }
      });
      label.appendChild(select);
      tagRow.appendChild(label);

      const actions = document.createElement('p');
      actions.className = 'gallery-actions';
      const dl = document.createElement('a');
      dl.className = 'btn-link';
      dl.href = `${src}${src.includes('?') ? '&' : '?'}download=1`;
      dl.textContent = 'Download';
      dl.setAttribute('download', '');
      actions.appendChild(dl);

      meta.appendChild(title);
      if (info.textContent) meta.appendChild(info);
      meta.appendChild(tagRow);
      meta.appendChild(actions);

      card.appendChild(media);
      card.appendChild(meta);
      galleryGrid.appendChild(card);
    }
  }

  async function loadGallery() {
    if (!accountName) {
      setError('Missing account name in the URL.');
      galleryStatus.textContent = 'No account';
      return;
    }
    setError('');
    galleryStatus.textContent = 'Loading…';
    refreshBtn.disabled = true;
    try {
      await loadAccountOptions();
      const { ok, data } = await api(
        `/api/contentstation/accounts?action=videos&account=${encodeURIComponent(accountName)}`,
      );
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not load videos.');
      }
      renderItems(data.videos || []);
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
