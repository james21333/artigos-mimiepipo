(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const cleanError = document.getElementById('clean-error');
  const downloadWrap = document.getElementById('download-wrap');
  const downloadLink = document.getElementById('download-link');
  const fileMeta = document.getElementById('file-meta');
  const cleanBtn = document.getElementById('clean-btn');
  const stopBtn = document.getElementById('stop-btn');
  const fileInput = document.getElementById('video-file');

  const DIRECT_MAX = 90 * 1024 * 1024;
  let pollTimer = null;
  let activeWorkId = null;

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
    stopPoll();
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
    if (session.ready || session.cleanReady) bits.push('Ready');
    else bits.push('Setup incomplete');
    if (session.uploadReady) bits.push('Uploads on');
    sessionMeta.textContent = bits.join(' · ');
  }

  function setStatus(label, detail) {
    statusLine.textContent = label || 'Ready.';
    if (detail) {
      statusDetail.hidden = false;
      statusDetail.textContent = detail;
    } else {
      statusDetail.hidden = true;
      statusDetail.textContent = '';
    }
  }

  function setError(msg) {
    if (msg) {
      cleanError.hidden = false;
      cleanError.textContent = msg;
    } else {
      cleanError.hidden = true;
      cleanError.textContent = '';
    }
  }

  function showDownload(url) {
    if (!url) {
      downloadWrap.hidden = true;
      downloadLink.removeAttribute('href');
      return;
    }
    downloadLink.href = url;
    downloadWrap.hidden = false;
  }

  function selectedOptions() {
    return {
      removeWatermark: document.getElementById('opt-watermark').checked,
      cleanMetadata: document.getElementById('opt-metadata').checked,
      remix: document.getElementById('opt-remix').checked,
      mirror: document.getElementById('opt-mirror').checked,
    };
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    stopBtn.hidden = true;
  }

  function startPoll(workId) {
    stopPoll();
    activeWorkId = workId;
    stopBtn.hidden = false;
    pollTimer = setInterval(() => {
      checkStatus(workId).catch(() => stopPoll());
    }, 12000);
  }

  async function checkStatus(workId) {
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({ action: 'status', workId }),
    });
    if (!ok || !data) {
      setError((data && data.message) || 'Could not check status.');
      return data;
    }
    setError('');
    setStatus(data.label || 'Checking…', workId ? `Job ${workId}` : '');
    if (data.state === 'ready' && data.downloadUrl) {
      showDownload(data.downloadUrl);
      setStatus('Ready to download', `Job ${workId}`);
      stopPoll();
      cleanBtn.disabled = false;
    } else if (data.state === 'failed') {
      setError(data.error || 'Cleaning failed.');
      showDownload(null);
      stopPoll();
      cleanBtn.disabled = false;
    }
    return data;
  }

  async function uploadViaStorage(file) {
    setStatus('Uploading…', formatBytes(file.size));
    if (file.size > DIRECT_MAX) {
      const { ok, data } = await api('/api/contentstation/media', {
        method: 'POST',
        body: JSON.stringify({
          action: 'sign-put',
          prefix: 'clean/',
          filename: file.name,
          contentType: file.type || 'video/mp4',
        }),
      });
      if (!ok || !data || !data.url) {
        throw new Error((data && data.message) || 'Could not prepare large upload.');
      }
      const putRes = await fetch(data.url, {
        method: 'PUT',
        headers: data.headers || { 'Content-Type': file.type || 'video/mp4' },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error('Large upload failed. Try a smaller file.');
      }
      if (data.publicUrl) return data.publicUrl;
      const meta = await api(
        `/api/contentstation/media?action=meta&key=${encodeURIComponent(data.key)}`,
      );
      if (meta.ok && meta.data?.object?.publicUrl) return meta.data.object.publicUrl;
      throw new Error('Upload succeeded but no public URL is available for processing.');
    }

    const form = new FormData();
    form.append('file', file);
    form.append('prefix', 'clean/');
    const { ok, data } = await api('/api/contentstation/media', {
      method: 'POST',
      body: form,
      headers: {},
    });
    if (!ok || !data?.object) {
      throw new Error((data && data.message) || 'Upload failed.');
    }
    if (data.object.publicUrl) return data.object.publicUrl;
    throw new Error('Upload succeeded but no public URL is available for processing.');
  }

  async function submitByUrl(videoUrl, options) {
    setStatus('Starting clean…', '');
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({ action: 'submit', videoUrl, options }),
    });
    if (!ok || !data?.workId) {
      throw new Error((data && data.message) || 'Could not start cleaning.');
    }
    return data.workId;
  }

  async function submitDirect(file, options) {
    setStatus('Uploading & starting clean…', formatBytes(file.size));
    const form = new FormData();
    form.append('file', file);
    form.append('options', JSON.stringify(options));
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: form,
      headers: {},
    });
    if (!ok || !data?.workId) {
      throw new Error((data && data.message) || 'Could not start cleaning.');
    }
    return data.workId;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      fileMeta.hidden = true;
      return;
    }
    fileMeta.hidden = false;
    fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
  });

  cleanBtn.addEventListener('click', async () => {
    setError('');
    showDownload(null);
    stopPoll();

    const options = selectedOptions();
    if (!options.removeWatermark && !options.cleanMetadata && !options.remix && !options.mirror) {
      setError('Select at least one option.');
      return;
    }

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setError('Choose a video file first.');
      return;
    }

    cleanBtn.disabled = true;
    try {
      let workId;
      // Prefer direct processor upload for typical sizes; fall back to storage URL path.
      if (file.size <= DIRECT_MAX) {
        try {
          workId = await submitDirect(file, options);
        } catch (directErr) {
          setStatus('Trying alternate upload…', '');
          const videoUrl = await uploadViaStorage(file);
          workId = await submitByUrl(videoUrl, options);
        }
      } else {
        const videoUrl = await uploadViaStorage(file);
        workId = await submitByUrl(videoUrl, options);
      }

      activeWorkId = workId;
      setStatus('Cleaning…', `Job ${workId}`);
      await checkStatus(workId);
      if (activeWorkId === workId) startPoll(workId);
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
      setStatus('Ready.');
      cleanBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', () => {
    stopPoll();
    cleanBtn.disabled = false;
    setStatus(activeWorkId ? `Stopped checking · Job ${activeWorkId}` : 'Stopped.');
  });

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
    stopPoll();
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshSession().catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
