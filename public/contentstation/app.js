(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const ghostcutOut = document.getElementById('ghostcut-out');
  const mediaOut = document.getElementById('media-out');
  const runpodOut = document.getElementById('runpod-out');

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
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
    bits.push(session.ghostcutConfigured ? 'GhostCut env: ok' : 'GhostCut env: missing');
    bits.push(session.passwordConfigured ? 'Password env: ok' : 'Password env: missing');
    sessionMeta.textContent = bits.join(' · ');
  }

  async function refreshSession() {
    const { ok, data } = await api('/api/contentstation/session');
    if (ok && data && data.authenticated) {
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
    await refreshSession();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  document.getElementById('balance-btn').addEventListener('click', async () => {
    ghostcutOut.textContent = 'Loading balance…';
    const { status, data } = await api('/api/contentstation/balance');
    ghostcutOut.textContent = JSON.stringify({ status, data }, null, 2);
  });

  document.getElementById('status-demo-btn').addEventListener('click', async () => {
    ghostcutOut.textContent = 'Probing work/status (empty idWorks)…';
    const { status, data } = await api(
      '/api/contentstation/ghostcut/v-w-c/gateway/ve/work/status',
      {
        method: 'POST',
        body: JSON.stringify({ idWorks: [] }),
      },
    );
    ghostcutOut.textContent = JSON.stringify({ status, data }, null, 2);
  });

  document.getElementById('media-btn').addEventListener('click', async () => {
    mediaOut.textContent = 'Probing…';
    const { status, data } = await api('/api/contentstation/media');
    mediaOut.textContent = JSON.stringify({ status, data }, null, 2);
  });

  document.getElementById('runpod-btn').addEventListener('click', async () => {
    runpodOut.textContent = 'Probing…';
    const { status, data } = await api('/api/contentstation/runpod');
    runpodOut.textContent = JSON.stringify({ status, data }, null, 2);
  });

  // Soft client gate: UI hidden until session check; real protection is on /api/*
  refreshSession().catch(() => showGate('Could not reach session API (deploy Functions + set secrets).'));
})();
