(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const galleryStatus = document.getElementById('gallery-status');
  const galleryError = document.getElementById('gallery-error');
  const accountList = document.getElementById('account-list');
  const galleryEmpty = document.getElementById('gallery-empty');
  const refreshBtn = document.getElementById('refresh-btn');
  const createForm = document.getElementById('create-account-form');
  const newAccountName = document.getElementById('new-account-name');

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
    sessionMeta.textContent =
      session && session.role === 'ready' ? 'Ready For Upload access' : 'Signed in';
    window.__csRole = (session && session.role) || 'admin';
    // Download-only sessions shouldn't manage Ready accounts here.
    if (createForm) {
      createForm.hidden = window.__csRole === 'download';
    }
  }

  function canEditAccounts() {
    return window.__csRole !== 'download';
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

  function renderAccounts(accounts) {
    accountList.innerHTML = '';
    const list = accounts || [];
    if (!list.length) {
      accountList.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'No accounts';
      return;
    }
    galleryEmpty.hidden = true;
    accountList.hidden = false;
    galleryStatus.textContent = `${list.length} account${list.length === 1 ? '' : 's'}`;

    for (const a of list) {
      const li = document.createElement('li');
      li.className = 'account-list-item';

      const row = document.createElement('div');
      row.className = 'account-card-row';

      const link = document.createElement('a');
      link.className = 'account-card-link';
      link.href = `./ready-account.html?account=${encodeURIComponent(a.name)}`;
      link.innerHTML = `
        <span class="account-card-name"></span>
        <span class="account-card-count muted-line"></span>
      `;
      link.querySelector('.account-card-name').textContent = a.name;
      const n = a.count || 0;
      link.querySelector('.account-card-count').textContent =
        n === 1 ? '1 video ready' : `${n} videos ready`;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ghost account-edit-btn';
      editBtn.textContent = 'Edit name';
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        startRename(li, a.name);
      });

      row.appendChild(link);
      if (canEditAccounts()) {
        row.appendChild(editBtn);
      }
      li.appendChild(row);
      accountList.appendChild(li);
    }
  }

  function startRename(li, currentName) {
    setError('');
    const row = document.createElement('div');
    row.className = 'account-rename-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 80;
    input.value = currentName;
    input.setAttribute('aria-label', 'New account name');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ghost';
    cancelBtn.textContent = 'Cancel';

    const finish = () => loadAccounts().catch(() => {});

    cancelBtn.addEventListener('click', () => finish());

    const save = async () => {
      const to = input.value.trim();
      if (!to) {
        setError('Enter a new account name.');
        return;
      }
      if (to === currentName) {
        finish();
        return;
      }
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      input.disabled = true;
      try {
        const { ok, data } = await api('/api/contentstation/accounts', {
          method: 'POST',
          body: JSON.stringify({ action: 'rename', from: currentName, to }),
        });
        if (!ok) {
          throw new Error((data && (data.message || data.error)) || 'Could not rename.');
        }
        renderAccounts(data.accounts || []);
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        input.disabled = false;
      }
    };

    saveBtn.addEventListener('click', () => {
      save().catch(() => {});
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save().catch(() => {});
      }
      if (e.key === 'Escape') finish();
    });

    row.appendChild(input);
    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
    li.innerHTML = '';
    li.appendChild(row);
    input.focus();
    input.select();
  }

  async function loadAccounts() {
    setError('');
    galleryStatus.textContent = 'Loading…';
    refreshBtn.disabled = true;
    try {
      const { ok, data } = await api('/api/contentstation/accounts?action=list');
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not load accounts.');
      }
      renderAccounts(data.accounts || []);
    } catch (err) {
      accountList.hidden = true;
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
      if (window.CSAuth && !window.CSAuth.gatePage(data, 'ready')) return false;
      if (window.CSAuth) window.CSAuth.applyNav(data.role);
      showApp(data);
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
    if (authed) await loadAccounts();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshBtn.addEventListener('click', () => {
    loadAccounts().catch(() => {});
  });

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const name = newAccountName.value.trim();
    if (!name) {
      setError('Enter an account name.');
      return;
    }
    const { ok, data } = await api('/api/contentstation/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', name }),
    });
    if (!ok) {
      setError((data && (data.message || data.error)) || 'Could not create account.');
      return;
    }
    newAccountName.value = '';
    renderAccounts(data.accounts || []);
  });

  refreshSession()
    .then((authed) => {
      if (authed) return loadAccounts();
    })
    .catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
