(function () {
  const DIRECT_MAX = 90 * 1024 * 1024;
  const PREFIX = 'disclaimer-tmp/';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const videoFile = document.getElementById('video-file');
  const promptEl = document.getElementById('prompt');
  const burnBtn = document.getElementById('burn-btn');
  const downloadLink = document.getElementById('download-link');
  const statusLine = document.getElementById('status-line');
  const eventsPreview = document.getElementById('events-preview');
  const errorEl = document.getElementById('burn-error');

  let busy = false;
  /** @type {string[]} */
  let tmpKeys = [];

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
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text?.slice?.(0, 240) || text };
    }
    return { ok: res.ok, status: res.status, data };
  }

  function errMessage(data, fallback) {
    if (!data) return fallback;
    if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    if (typeof data.error === 'string' && data.error.trim() && data.error !== 'burn_failed') {
      return data.error.trim();
    }
    if (typeof data.raw === 'string' && data.raw.trim()) {
      return `HTTP error: ${data.raw.replace(/\s+/g, ' ').trim().slice(0, 180)}`;
    }
    return fallback;
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

  function setStatus(msg) {
    if (statusLine) statusLine.textContent = msg || '';
  }

  function setBusy(on) {
    busy = !!on;
    if (burnBtn) burnBtn.disabled = busy;
    if (videoFile) videoFile.disabled = busy;
    if (promptEl) promptEl.disabled = busy;
  }

  async function uploadVideo(file) {
    setStatus('Uploading…');
    if (file.size > DIRECT_MAX) {
      const { ok, data } = await api('/api/contentstation/media', {
        method: 'POST',
        body: JSON.stringify({
          action: 'sign-put',
          prefix: PREFIX,
          filename: file.name || 'ad.mp4',
          contentType: file.type || 'video/mp4',
        }),
      });
      if (!ok || !data?.url || !data?.key) {
        throw new Error(errMessage(data, 'Could not prepare large upload.'));
      }
      const putRes = await fetch(data.url, {
        method: 'PUT',
        headers: data.headers || { 'Content-Type': file.type || 'video/mp4' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Large upload failed.');
      return String(data.key);
    }

    const form = new FormData();
    form.append('file', file);
    form.append('prefix', PREFIX);
    const { ok, data } = await api('/api/contentstation/media', {
      method: 'POST',
      body: form,
      headers: {},
    });
    if (!ok || !data?.object?.key) {
      throw new Error(errMessage(data, 'Upload failed.'));
    }
    return String(data.object.key);
  }

  async function cleanupKeys(keys) {
    const list = (keys || []).filter(Boolean);
    if (!list.length) return;
    try {
      await api('/api/contentstation/disclaimer-burn', {
        method: 'POST',
        body: JSON.stringify({ action: 'cleanup', keys: list }),
      });
    } catch {
      /* best-effort */
    }
  }

  async function pollJob(jobId) {
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const { ok, data, status } = await api(
        `/api/contentstation/disclaimer-burn?jobId=${encodeURIComponent(jobId)}`,
      );
      if (!ok) {
        throw new Error(errMessage(data, `Status failed (HTTP ${status}).`));
      }
      const stage = String(data?.stage || '');
      setStatus(data?.message || `Burning… (${stage || 'running'})`);
      if (stage === 'done' && data?.outputKey) return data;
      if (stage === 'error' || data?.ok === false) {
        throw new Error(errMessage(data, 'Burn failed on worker.'));
      }
    }
    throw new Error('Burn timed out after 10 minutes.');
  }

  async function finishDownload(data, prior) {
    if (data.outputKey) tmpKeys.push(data.outputKey);
    const path =
      data.downloadPath ||
      `/api/contentstation/media?action=get&key=${encodeURIComponent(data.outputKey)}`;
    setStatus('Fetching burned video…');
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    if (downloadLink) {
      downloadLink.href = objUrl;
      downloadLink.hidden = false;
      downloadLink.download = 'disclaimer-burned.mp4';
    }
    if (eventsPreview && Array.isArray(data.events) && data.events.length) {
      eventsPreview.hidden = false;
      eventsPreview.textContent =
        'Burned: ' +
        data.events
          .map(
            (e) =>
              `"${String(e.text || '').slice(0, 80)}" @ ${e.position || 'bottom'} ${e.startMs || 0}–${e.endMs || '?'}ms`,
          )
          .join(' · ');
    }
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = 'disclaimer-burned.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
    await cleanupKeys([...prior, ...tmpKeys]);
    tmpKeys = [];
    setStatus('Done. Temp uploads cleaned — re-use the download link if needed (local copy).');
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  }

  async function burn() {
    if (busy) return;
    setError('');
    if (downloadLink) {
      downloadLink.hidden = true;
      downloadLink.removeAttribute('href');
    }
    if (eventsPreview) {
      eventsPreview.hidden = true;
      eventsPreview.textContent = '';
    }

    const file = videoFile?.files?.[0];
    const prompt = String(promptEl?.value || '').trim();
    if (!file) {
      setError('Choose a video file.');
      return;
    }
    if (!prompt) {
      setError('Write a prompt (disclaimer text + how to place it).');
      return;
    }

    setBusy(true);
    const prior = tmpKeys.slice();
    tmpKeys = [];
    try {
      setStatus('Uploading video…');
      const sourceKey = await uploadVideo(file);
      tmpKeys.push(sourceKey);

      setStatus('Starting burn…');
      const { ok, data, status } = await api('/api/contentstation/disclaimer-burn', {
        method: 'POST',
        body: JSON.stringify({ action: 'burn', sourceKey, prompt }),
      });
      if (!ok) {
        throw new Error(errMessage(data, `Burn failed (HTTP ${status}).`));
      }

      let result = data;
      if (data?.started && data?.jobId) {
        setStatus('Burning disclaimer (Codex + ffmpeg)…');
        result = await pollJob(data.jobId);
      } else if (!data?.outputKey) {
        throw new Error(errMessage(data, 'Burn failed — no output.'));
      }

      await finishDownload(result, prior);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed.');
      await cleanupKeys([...prior, ...tmpKeys]);
      tmpKeys = [];
    } finally {
      setBusy(false);
    }
  }

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      if (gate) gate.hidden = false;
      if (app) app.hidden = true;
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'disclaimer-burn')) return;
    if (window.CSAuth) window.CSAuth.applyNav(data.role);
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) {
      sessionMeta.textContent = data.role ? `Signed in · ${data.role}` : 'Signed in';
    }
  }

  loginForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setError('');
    if (gateError) {
      gateError.hidden = true;
      gateError.textContent = '';
    }
    const password = passwordInput?.value || '';
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      if (gateError) {
        gateError.hidden = false;
        gateError.textContent = (data && data.message) || 'Login failed.';
      }
      return;
    }
    window.location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    window.location.reload();
  });

  burnBtn?.addEventListener('click', () => {
    burn().catch((err) => {
      setError(err?.message || String(err));
      setBusy(false);
    });
  });

  boot().catch((err) => {
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    if (gateError) {
      gateError.hidden = false;
      gateError.textContent = err?.message || String(err);
    }
  });
})();
