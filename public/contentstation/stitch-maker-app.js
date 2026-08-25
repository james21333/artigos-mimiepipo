(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const characterFile = document.getElementById('character-file');
  const characterPreview = document.getElementById('character-preview');
  const saveCharacterBtn = document.getElementById('save-character-btn');
  const startStitchBtn = document.getElementById('start-stitch-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const errorEl = document.getElementById('stitch-error');
  const notesEl = document.getElementById('stitch-notes');

  const STORAGE_KEY = 'cs_stitch_maker_v1';

  let characterKey = '';

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
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

  function setStatus(line, detail) {
    if (statusLine) {
      statusLine.hidden = !line;
      statusLine.textContent = line || '';
    }
    if (statusDetail) {
      statusDetail.hidden = !detail;
      statusDetail.textContent = detail || '';
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          characterKey,
          notes: notesEl?.value || '',
        }),
      );
    } catch {
      /* ignore */
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.characterKey) {
        characterKey = String(data.characterKey);
        showPreview(characterKey);
      }
      if (notesEl && typeof data?.notes === 'string') notesEl.value = data.notes;
    } catch {
      /* ignore */
    }
  }

  function mediaUrl(key) {
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function showPreview(key) {
    if (!characterPreview || !key) return;
    characterPreview.hidden = false;
    characterPreview.innerHTML = `<img alt="Character" src="${mediaUrl(key)}" style="max-width:180px;border-radius:2px;">`;
    if (startStitchBtn) startStitchBtn.disabled = false;
  }

  function showGate() {
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) {
      sessionMeta.textContent = `Signed in · ${session.role || 'kenneth'}`;
    }
    if (window.CSAuth) window.CSAuth.applyNav(session.role || 'kenneth');
    if (window.CSAuth) window.CSAuth.applyBrand(session.role || 'kenneth');
    loadLocal();
  }

  async function uploadCharacter(file) {
    const form = new FormData();
    form.append('file', file, file.name || 'character.jpg');
    form.append('prefix', 'stitch-maker/characters/');
    const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
    if (!ok || !data?.object?.key) {
      throw new Error(data?.message || data?.error || 'Upload failed');
    }
    return data.object.key;
  }

  saveCharacterBtn?.addEventListener('click', async () => {
    setError('');
    const file = characterFile?.files?.[0];
    if (!file) {
      setError('Choose a character image first.');
      return;
    }
    saveCharacterBtn.disabled = true;
    setStatus('Uploading character…', '');
    try {
      characterKey = await uploadCharacter(file);
      showPreview(characterKey);
      saveLocal();
      setStatus('Character saved.', characterKey);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('', '');
    } finally {
      saveCharacterBtn.disabled = false;
    }
  });

  notesEl?.addEventListener('input', saveLocal);

  startStitchBtn?.addEventListener('click', () => {
    setError('');
    setStatus(
      'Stitch pipeline coming next.',
      'Character is saved. We’ll wire generation / timeline here.',
    );
  });

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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-maker')) return;
    location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      showGate();
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-maker')) return;
    showApp(data);
  }

  boot().catch((err) => {
    showGate();
    if (gateError) {
      gateError.hidden = false;
      gateError.textContent = err?.message || String(err);
    }
  });
})();
