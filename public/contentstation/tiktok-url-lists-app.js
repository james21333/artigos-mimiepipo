(function () {
  const MAX_URLS = 20;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const tiktokUrls = document.getElementById('tiktok-urls');
  const urlCountEl = document.getElementById('url-count');
  const addBtn = document.getElementById('add-urls-btn');
  const itemsEl = document.getElementById('url-list-items');
  const emptyEl = document.getElementById('url-list-empty');
  const statusLine = document.getElementById('status-line');
  const errorEl = document.getElementById('lists-error');
  const selectAllBtn = document.getElementById('select-all-items-btn');
  const selectNoneBtn = document.getElementById('select-none-items-btn');
  const openSelectedBtn = document.getElementById('open-selected-btn');
  const removeSelectedBtn = document.getElementById('remove-selected-btn');

  /** @type {{ url: string, tiktokId?: string }[]} */
  let items = [];
  /** @type {Set<string>} */
  const checked = new Set();
  let busy = false;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      ...opts,
      headers: {
        ...(opts.body && !(opts.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(opts.headers || {}),
      },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  const listsUi =
    window.CSTikTokLists &&
    window.CSTikTokLists.createController({
      api,
      onChange: () => {
        loadItems().catch((err) => setError(err?.message || String(err)));
      },
    });

  function setError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function setStatus(msg) {
    if (statusLine) statusLine.textContent = msg || '';
  }

  function parseUrls(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\d+[\).:\-\s]+/, '').replace(/^[-*]\s+/, '').trim())
      .filter((u) => /^https?:\/\//i.test(u));
  }

  function updateUrlCount() {
    const n = parseUrls(tiktokUrls?.value).length;
    if (urlCountEl) {
      urlCountEl.textContent = `${n} / ${MAX_URLS} links`;
      urlCountEl.classList.toggle('error', n > MAX_URLS);
    }
  }

  function selectedListId() {
    return listsUi?.selected?.() || 'glp-1';
  }

  function selectedUrls() {
    return items.map((it) => it.url).filter((u) => checked.has(u));
  }

  function renderItems() {
    if (!itemsEl) return;
    itemsEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = items.length > 0;
    for (const item of items) {
      const url = item.url;
      if (!url) continue;
      const li = document.createElement('li');
      li.className = 'url-list-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(url);
      cb.addEventListener('change', () => {
        if (cb.checked) checked.add(url);
        else checked.delete(url);
      });
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        removeUrls([url]).catch((err) => setError(err?.message || String(err)));
      });
      li.appendChild(cb);
      li.appendChild(a);
      li.appendChild(remove);
      itemsEl.appendChild(li);
    }
  }

  async function loadItems() {
    setError('');
    const listId = encodeURIComponent(selectedListId());
    const { ok, data } = await api(`/api/contentstation/tiktok-lists?action=get&listId=${listId}`);
    if (!ok) {
      items = [];
      renderItems();
      throw new Error((data && (data.message || data.error)) || 'Could not load list.');
    }
    items = Array.isArray(data?.list?.items) ? data.list.items : [];
    const keep = new Set(items.map((it) => it.url));
    for (const u of [...checked]) {
      if (!keep.has(u)) checked.delete(u);
    }
    renderItems();
    const name = data?.list?.name || listsUi?.current?.()?.name || 'list';
    setStatus(`${items.length} URL${items.length === 1 ? '' : 's'} on ${name}`);
  }

  async function removeUrls(urls) {
    if (!urls.length) return;
    busy = true;
    setError('');
    try {
      const { ok, data } = await api('/api/contentstation/tiktok-lists', {
        method: 'POST',
        body: JSON.stringify({
          action: 'remove',
          listId: selectedListId(),
          urls,
        }),
      });
      if (!ok) throw new Error((data && (data.message || data.error)) || 'Could not remove URLs.');
      for (const u of urls) checked.delete(u);
      if (listsUi) await listsUi.load().catch(() => {});
      await loadItems();
      setStatus(`Removed ${data.removed || urls.length} URL(s).`);
    } finally {
      busy = false;
    }
  }

  tiktokUrls?.addEventListener('input', updateUrlCount);

  addBtn?.addEventListener('click', async () => {
    setError('');
    const urls = parseUrls(tiktokUrls?.value);
    if (!urls.length) {
      setError('Paste 1–20 TikTok URLs (one per line).');
      return;
    }
    if (urls.length > MAX_URLS) {
      setError(`Max ${MAX_URLS} TikTok links at a time.`);
      return;
    }
    for (const u of urls) {
      if (!/tiktok\.com\//i.test(u) && !/vm\.tiktok\.com\//i.test(u)) {
        setError(`Not a TikTok URL: ${u}`);
        return;
      }
    }
    if (busy) return;
    busy = true;
    addBtn.disabled = true;
    try {
      const { ok, data } = await api('/api/contentstation/tiktok-lists', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add',
          listId: selectedListId(),
          urls,
          addedFrom: 'url-lists-page',
        }),
      });
      if (!ok) throw new Error((data && (data.message || data.error)) || 'Could not add URLs.');
      if (tiktokUrls) tiktokUrls.value = '';
      updateUrlCount();
      if (listsUi) await listsUi.load().catch(() => {});
      await loadItems();
      const added = Number(data.added) || 0;
      setStatus(added ? `Added ${added} URL(s).` : 'Those URLs were already on this list.');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      busy = false;
      addBtn.disabled = false;
    }
  });

  selectAllBtn?.addEventListener('click', () => {
    for (const it of items) {
      if (it.url) checked.add(it.url);
    }
    renderItems();
  });

  selectNoneBtn?.addEventListener('click', () => {
    checked.clear();
    renderItems();
  });

  openSelectedBtn?.addEventListener('click', () => {
    const urls = selectedUrls();
    if (!urls.length) {
      setError('Check one or more URLs first.');
      return;
    }
    setError('');
    for (const url of urls) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setStatus(`Opened ${urls.length} tab${urls.length === 1 ? '' : 's'}.`);
  });

  removeSelectedBtn?.addEventListener('click', () => {
    const urls = selectedUrls();
    if (!urls.length) {
      setError('Check one or more URLs to remove.');
      return;
    }
    if (!window.confirm(`Remove ${urls.length} URL(s) from this list?`)) return;
    removeUrls(urls).catch((err) => setError(err?.message || String(err)));
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
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
    location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      if (gate) gate.hidden = false;
      if (app) app.hidden = true;
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-url-lists')) {
      return;
    }
    if (window.CSAuth) window.CSAuth.applyNav(data.role || 'admin');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${data.role || 'admin'}`;
    if (listsUi) await listsUi.load().catch(() => {});
    await loadItems().catch((err) => setError(err?.message || String(err)));
    updateUrlCount();
  }

  boot();
})();
