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

  function compareAccountNames(a, b) {
    const sa = String(a || '');
    const sb = String(b || '');
    const ma = sa.match(/^(\d+)/);
    const mb = sb.match(/^(\d+)/);
    if (ma && mb) {
      const na = Number(ma[1]);
      const nb = Number(mb[1]);
      if (na !== nb) return na - nb;
    } else if (ma && !mb) {
      return -1;
    } else if (!ma && mb) {
      return 1;
    }
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
  }

  function renderAccounts(accounts) {
    accountList.innerHTML = '';
    const list = [...(accounts || [])].sort((a, b) =>
      compareAccountNames(a?.name || a, b?.name || b),
    );
    if (!list.length) {
      accountList.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'No archived accounts';
      return;
    }
    galleryEmpty.hidden = true;
    accountList.hidden = false;
    galleryStatus.textContent = `${list.length} archived account${list.length === 1 ? '' : 's'}`;

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
        n === 1 ? '1 video tagged' : `${n} videos tagged`;

      row.appendChild(link);
      if (canEditAccounts()) {
        const actions = document.createElement('div');
        actions.className = 'account-card-actions';

        const unarchiveBtn = document.createElement('button');
        unarchiveBtn.type = 'button';
        unarchiveBtn.className = 'ghost';
        unarchiveBtn.textContent = 'Unarchive';
        unarchiveBtn.addEventListener('click', (e) => {
          e.preventDefault();
          unarchiveAccount(a.name).catch(() => {});
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'ghost account-delete-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', (e) => {
          e.preventDefault();
          deleteAccount(a.name).catch(() => {});
        });

        actions.appendChild(unarchiveBtn);
        actions.appendChild(deleteBtn);
        row.appendChild(actions);
      }
      li.appendChild(row);
      accountList.appendChild(li);
    }
  }

  async function unarchiveAccount(name) {
    setError('');
    const { ok, data } = await api('/api/contentstation/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'unarchive', name }),
    });
    if (!ok) {
      setError((data && (data.message || data.error)) || 'Could not unarchive.');
      return;
    }
    renderAccounts(data.archivedAccounts || []);
  }

  async function deleteAccount(name) {
    setError('');
    if (
      !window.confirm(
        `Permanently delete “${name}”? Videos stay in storage but will be untagged. This cannot be undone.`,
      )
    ) {
      return;
    }
    const { ok, data } = await api('/api/contentstation/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', name }),
    });
    if (!ok) {
      setError((data && (data.message || data.error)) || 'Could not delete.');
      return;
    }
    renderAccounts(data.archivedAccounts || []);
  }

  async function loadAccounts() {
    setError('');
    galleryStatus.textContent = 'Loading…';
    refreshBtn.disabled = true;
    try {
      const { ok, data } = await api('/api/contentstation/accounts?action=archived');
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not load archived accounts.');
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
      if (window.CSAuth && !window.CSAuth.gatePage(data, 'ready-archived')) return false;
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

  refreshSession()
    .then((authed) => {
      if (authed) return loadAccounts();
    })
    .catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
