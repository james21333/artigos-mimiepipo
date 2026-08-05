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
  const filterBtns = [...document.querySelectorAll('.filter-btn[data-variant]')];

  let accountsCache = [];
  const params = new URLSearchParams(window.location.search);
  const initialVariant = String(params.get('variant') || 'music-only')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  let currentVariant = ['music-only', 'talking-heads', 'all', 'character'].includes(initialVariant)
    ? initialVariant
    : 'music-only';

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

  function variantLabel(obj) {
    if (obj.source === 'character') return 'Character remix';
    if (obj.musicLock === true || obj.remixVariant === 'music-only' || obj.remixVariant === 'music') {
      return 'Music-Only';
    }
    if (obj.musicLock === false || obj.remixVariant === 'talking-heads') {
      return 'Talking Heads';
    }
    return 'Remix 2';
  }

  function displayName(obj) {
    if (obj.source === 'character') {
      const base = String(obj.key || '').split('/').pop() || 'remix';
      return base.replace(/\.mp4$/i, '').replace(/_/g, ' ');
    }
    const job = obj.jobId || String(obj.key || '').split('/')[1] || 'job';
    const short = job.length > 10 ? `${job.slice(0, 8)}…` : job;
    return `${variantLabel(obj)} · ${short}`;
  }

  function uploadedMs(obj) {
    if (!obj || !obj.uploaded) return 0;
    const t = new Date(obj.uploaded).getTime();
    return Number.isFinite(t) ? t : 0;
  }

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

  function syncFilterButtons() {
    filterBtns.forEach((btn) => {
      const active = btn.getAttribute('data-variant') === currentVariant;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('ghost', !active);
    });
  }

  function syncUrl() {
    try {
      const url = new URL(window.location.href);
      if (currentVariant === 'music-only') url.searchParams.delete('variant');
      else url.searchParams.set('variant', currentVariant);
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
  }

  function renderItems(objects, { taggable } = { taggable: true }) {
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
    galleryStatus.textContent = `${videos.length} video${videos.length === 1 ? '' : 's'}`;

    const numbered = withSequenceNumbers(videos).sort((a, b) => {
      const diff = uploadedMs(b) - uploadedMs(a);
      if (diff !== 0) return diff;
      return String(b.key || '').localeCompare(String(a.key || ''));
    });

    for (const obj of numbered) {
      const src = obj.downloadPath;
      const card = document.createElement('article');
      card.className = 'gallery-card';

      const media = document.createElement('div');
      media.className = 'gallery-media';

      const badge = document.createElement('span');
      badge.className = 'gallery-seq';
      badge.textContent = String(obj.seq);
      badge.setAttribute('aria-label', `Remix ${obj.seq}`);
      media.appendChild(badge);

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
      title.textContent = `#${obj.seq} · ${displayName(obj)}`;

      const info = document.createElement('p');
      info.className = 'muted-line';
      const bits = [variantLabel(obj), formatWhen(obj.uploaded), formatBytes(obj.size)].filter(Boolean);
      info.textContent = bits.join(' · ');

      meta.appendChild(title);
      if (bits.length) meta.appendChild(info);

      if (taggable) {
        const tagRow = document.createElement('div');
        tagRow.className = 'tag-row';
        const label = document.createElement('label');
        label.textContent = 'Tag for account';
        const select = document.createElement('select');
        select.className = 'account-select';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— Choose account —';
        select.appendChild(placeholder);
        accountsCache.forEach((name) => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          select.appendChild(opt);
        });
        select.addEventListener('change', async () => {
          if (!select.value) return;
          select.disabled = true;
          try {
            const { ok, data } = await api('/api/contentstation/accounts', {
              method: 'POST',
              body: JSON.stringify({ action: 'tag', key: obj.key, account: select.value }),
            });
            if (!ok) {
              throw new Error((data && (data.message || data.error)) || 'Could not tag video.');
            }
            card.remove();
            if (!galleryGrid.children.length) {
              galleryGrid.hidden = true;
              galleryEmpty.hidden = false;
              galleryStatus.textContent = 'Library empty';
            } else {
              galleryStatus.textContent = `${galleryGrid.children.length} untagged video${
                galleryGrid.children.length === 1 ? '' : 's'
              }`;
            }
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
            select.value = '';
          } finally {
            select.disabled = false;
          }
        });
        label.appendChild(select);
        tagRow.appendChild(label);
        meta.appendChild(tagRow);
      }

      const actions = document.createElement('p');
      actions.className = 'gallery-actions';
      const open = document.createElement('a');
      open.className = 'btn-link';
      open.href = src;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Open MP4';
      actions.appendChild(open);

      const dl = document.createElement('a');
      dl.className = 'btn-link';
      dl.href = `${src}${src.includes('?') ? '&' : '?'}download=1`;
      dl.textContent = 'Download';
      dl.setAttribute('download', '');
      actions.appendChild(document.createTextNode(' '));
      actions.appendChild(dl);

      if (taggable) {
        const readyLink = document.createElement('a');
        readyLink.className = 'btn-link';
        readyLink.href = './ready.html';
        readyLink.textContent = 'Ready For Upload';
        actions.appendChild(document.createTextNode(' '));
        actions.appendChild(readyLink);
      }

      if (obj.tiktokUrl && /^https?:\/\//i.test(obj.tiktokUrl)) {
        const source = document.createElement('a');
        source.className = 'btn-link';
        source.href = obj.tiktokUrl;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = 'Source TikTok';
        actions.appendChild(document.createTextNode(' '));
        actions.appendChild(source);
      }

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
    filterBtns.forEach((b) => {
      b.disabled = true;
    });
    try {
      if (currentVariant === 'character') {
        const listRes = await api('/api/contentstation/character-remix?action=list&limit=100');
        if (!listRes.ok) {
          throw new Error(
            (listRes.data && (listRes.data.message || listRes.data.error)) ||
              'Could not load character remix library.',
          );
        }
        const objects = (listRes.data.objects || []).map((o) => ({ ...o, source: 'character' }));
        renderItems(objects, { taggable: false });
        return;
      }

      const [listRes, accountsRes] = await Promise.all([
        api(
          `/api/contentstation/character-remix-2-og?action=list&variant=${encodeURIComponent(
            currentVariant,
          )}&limit=80`,
        ),
        api('/api/contentstation/accounts?action=list'),
      ]);
      if (!listRes.ok) {
        throw new Error(
          (listRes.data && (listRes.data.message || listRes.data.error)) ||
            'Could not load Remix 2 finals.',
        );
      }
      accountsCache =
        accountsRes.ok && accountsRes.data && Array.isArray(accountsRes.data.accounts)
          ? accountsRes.data.accounts.map((a) => a.name)
          : [];
      const untagged = (listRes.data.objects || []).filter((o) => o && o.key && !o.account);
      renderItems(untagged, { taggable: true });
      if (untagged.length) {
        galleryStatus.textContent = `${untagged.length} untagged video${
          untagged.length === 1 ? '' : 's'
        }`;
      }
    } catch (err) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = true;
      galleryStatus.textContent = 'Could not load';
      setError(err && err.message ? err.message : String(err));
    } finally {
      refreshBtn.disabled = false;
      filterBtns.forEach((b) => {
        b.disabled = false;
      });
    }
  }

  async function refreshSession() {
    const { ok, data } = await api('/api/contentstation/session');
    if (ok && data && data.authenticated) {
      if (window.CSAuth && !window.CSAuth.gatePage(data, 'character-remixes')) return false;
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

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-variant') || 'music-only';
      if (next === currentVariant) return;
      currentVariant = next;
      syncFilterButtons();
      syncUrl();
      loadGallery().catch(() => {});
    });
  });

  syncFilterButtons();
  syncUrl();

  refreshSession()
    .then((authed) => {
      if (authed) return loadGallery();
    })
    .catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
