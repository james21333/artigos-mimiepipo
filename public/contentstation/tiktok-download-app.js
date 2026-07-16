(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const urlInput = document.getElementById('tiktok-url');
  const smallerNoHd = document.getElementById('opt-smaller-no-hd');
  const downloadBtn = document.getElementById('download-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const downloadError = document.getElementById('download-error');
  const result = document.getElementById('result');
  const resultTitle = document.getElementById('result-title');
  const resultMeta = document.getElementById('result-meta');
  const resultPreview = document.getElementById('result-preview');
  const resultDownload = document.getElementById('result-download');

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
      downloadError.hidden = false;
      downloadError.textContent = msg;
    } else {
      downloadError.hidden = true;
      downloadError.textContent = '';
    }
  }

  function setStatus(main, detail) {
    statusLine.textContent = main || '';
    if (detail) {
      statusDetail.hidden = false;
      statusDetail.textContent = detail;
    } else {
      statusDetail.hidden = true;
      statusDetail.textContent = '';
    }
  }

  function formatBytes(n) {
    if (n == null || !Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showResult(data) {
    result.hidden = false;
    const title = (data.meta && data.meta.title) || 'TikTok video';
    const author = data.meta && data.meta.author ? `@${data.meta.author}` : '';
    resultTitle.textContent = title;
    const quality = data.quality || data.meta?.quality;
    const bits = [
      author,
      quality === 'hd' ? 'HD' : quality === 'standard' ? 'standard' : '',
      formatBytes(data.size),
      data.meta?.duration != null ? `${data.meta.duration}s` : '',
    ].filter(Boolean);
    resultMeta.textContent = bits.join(' · ');
    resultDownload.href = data.downloadPath;
    resultDownload.setAttribute('download', (data.key || 'tiktok.mp4').split('/').pop());
    if (data.downloadPath) {
      resultPreview.hidden = false;
      resultPreview.src = data.downloadPath;
    } else {
      resultPreview.hidden = true;
      resultPreview.removeAttribute('src');
    }
  }

  async function refreshSession() {
    const { ok, status, data } = await api('/api/contentstation/session');
    if (status === 401 || (data && data.authenticated === false)) {
      showGate();
      return false;
    }
    if (!ok) {
      showGate(data?.error || 'Could not check session');
      return false;
    }
    showApp();
    return true;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const password = document.getElementById('password').value;
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate(data?.error === 'invalid_password' ? 'Wrong password' : data?.error || 'Sign-in failed');
      return;
    }
    document.getElementById('password').value = '';
    await refreshSession();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  downloadBtn.addEventListener('click', async () => {
    setError('');
    result.hidden = true;
    const url = (urlInput.value || '').trim();
    if (!url) {
      setError('Paste a TikTok URL first.');
      return;
    }
    downloadBtn.disabled = true;
    const smallerFile = Boolean(smallerNoHd && smallerNoHd.checked);
    setStatus(
      'Downloading…',
      smallerFile ? 'Saving smaller (no HD) file' : 'Saving HD file when available',
    );
    try {
      const { ok, data } = await api('/api/contentstation/tiktok-download', {
        method: 'POST',
        body: JSON.stringify({ url, smallerFile }),
      });
      if (!ok) {
        setStatus('Failed');
        const detail = data?.detail ? ` (${data.detail})` : '';
        setError((data?.message || data?.error || 'Download failed') + detail);
        return;
      }
      const q = data.quality === 'hd' ? 'HD' : 'standard';
      setStatus('Saved', `${q}${data.key ? ` · ${data.key}` : ''}`);
      showResult(data);
    } catch (err) {
      setStatus('Failed');
      setError(String(err?.message || err));
    } finally {
      downloadBtn.disabled = false;
    }
  });

  refreshSession();
})();
