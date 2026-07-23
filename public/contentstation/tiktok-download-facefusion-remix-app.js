(function () {
  const POLL_MS = 4000;
  const MAX_POLL_MS = 45 * 60 * 1000;
  const MAX_CLEAN_POLL_MS = 25 * 60 * 1000;
  const ACTIVE_STORAGE_KEY = 'cs_facefusion_remix_active_v1';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const faceFile = document.getElementById('face-file');
  const faceMeta = document.getElementById('face-meta');
  const facePreviewWrap = document.getElementById('face-preview-wrap');
  const facePreview = document.getElementById('face-preview');
  const tiktokUrl = document.getElementById('tiktok-url');
  const smallerNoHd = document.getElementById('opt-smaller-no-hd');
  const deepAiRemake = document.getElementById('opt-deep-ai-remake');
  const enhanceOpt = document.getElementById('opt-enhance');
  const ffConfig = document.getElementById('ff-config');
  const runBtn = document.getElementById('run-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const ffError = document.getElementById('ff-error');
  const results = document.getElementById('results');

  let stopRequested = false;
  let running = false;
  /** @type {string|null} */
  let uploadedFaceKey = null;

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
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    if (msg) {
      gateError.hidden = false;
      gateError.textContent = msg;
    } else if (gateError) {
      gateError.hidden = true;
    }
  }

  function showApp() {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = 'Signed in';
    void loadConfig();
  }

  function setError(msg) {
    if (!ffError) return;
    if (msg) {
      ffError.hidden = false;
      ffError.textContent = msg;
    } else {
      ffError.hidden = true;
      ffError.textContent = '';
    }
  }

  function setStatus(main, detail) {
    if (statusLine) statusLine.textContent = main || '';
    if (!statusDetail) return;
    if (detail) {
      statusDetail.hidden = false;
      statusDetail.textContent = detail;
    } else {
      statusDetail.hidden = true;
      statusDetail.textContent = '';
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function loadConfig() {
    const { ok, data } = await api('/api/contentstation/facefusion-remix?action=config');
    if (!ffConfig) return;
    if (!ok) {
      ffConfig.hidden = false;
      ffConfig.textContent = 'FaceFusion endpoint not reachable.';
      return;
    }
    ffConfig.hidden = false;
    ffConfig.textContent = data.configured
      ? `RunPod FaceFusion ready · endpoint ${data.endpointId || '—'}`
      : 'FaceFusion not configured — set RUNPOD_FACEFUSION_ENDPOINT_ID on Pages.';
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
    if (!data.authenticated) {
      showGate();
      return false;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-download-facefusion-remix')) {
      return false;
    }
    if (window.CSAuth) window.CSAuth.applyNav(data.role);
    showApp();
    return true;
  }

  async function uploadFace(file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('prefix', 'faces/');
    const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: fd });
    if (!ok || !data?.key) {
      throw new Error(data?.message || data?.error || 'Face upload failed');
    }
    return data.key;
  }

  function ensureResults() {
    if (results) results.hidden = false;
    return results;
  }

  function addCard(url) {
    const card = document.createElement('article');
    card.className = 'download-result-card';
    card.innerHTML = `
      <p class="result-url muted-line"></p>
      <p class="result-status status">Queued…</p>
      <video class="result-preview" controls playsinline preload="metadata" hidden></video>
      <p class="row result-actions" hidden>
        <a class="btn-link result-download" href="#" download>Download MP4</a>
        <a class="btn-link" href="./facefusion-remixes.html">Open library</a>
      </p>
      <p class="error result-error" hidden></p>
    `;
    card.querySelector('.result-url').textContent = url;
    ensureResults().appendChild(card);
    return card;
  }

  function setCardStatus(card, text) {
    const el = card.querySelector('.result-status');
    if (el) el.textContent = text;
  }

  function setCardError(card, msg) {
    const el = card.querySelector('.result-error');
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function fillCardSuccess(card, { downloadPath, key }) {
    setCardError(card, '');
    const preview = card.querySelector('.result-preview');
    const actions = card.querySelector('.result-actions');
    const dl = card.querySelector('.result-download');
    if (downloadPath) {
      preview.hidden = false;
      preview.src = downloadPath;
      actions.hidden = false;
      dl.href = downloadPath;
      dl.setAttribute('download', (key || 'facefusion.mp4').split('/').pop());
    }
    setCardStatus(card, 'Saved');
  }

  async function downloadTikTok(url, smallerFile) {
    const { ok, data } = await api('/api/contentstation/tiktok-download', {
      method: 'POST',
      body: JSON.stringify({ url, smallerFile }),
    });
    if (!ok) {
      throw new Error(
        (data?.message || data?.error || 'TikTok download failed') +
          (data?.detail ? ` (${data.detail})` : ''),
      );
    }
    return data;
  }

  async function runDeepAiRemake(sourceKey) {
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit',
        key: sourceKey,
        sourceKey,
        options: {
          removeWatermark: false,
          cleanMetadata: true,
          alterAudio: false,
          basicVideoRemix: false,
          remix: false,
          deepAiRemake: true,
          mirror: false,
        },
      }),
    });
    if (!ok) {
      throw new Error(data?.message || data?.error || 'Deep AI remake submit failed');
    }
    const workId = data.workId || data.id;
    if (!workId) throw new Error('No clean workId returned');

    const started = Date.now();
    while (!stopRequested) {
      if (Date.now() - started > MAX_CLEAN_POLL_MS) {
        throw new Error('Deep AI remake timed out');
      }
      await sleep(POLL_MS);
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok) continue;
      const status = String(st.data?.status || st.data?.state || '').toLowerCase();
      setStatus('Deep AI remake…', status || workId);
      if (
        status === 'completed' ||
        status === 'success' ||
        status === 'done' ||
        status === 'ready' ||
        st.data?.ready
      ) {
        if (st.data?.cleanedKey || st.data?.key) {
          return st.data.cleanedKey || st.data.key;
        }
        const arch = await api('/api/contentstation/clean', {
          method: 'POST',
          body: JSON.stringify({ action: 'archive', workId, sourceKey }),
        });
        if (arch.ok && (arch.data?.key || arch.data?.cleanedKey)) {
          return arch.data.key || arch.data.cleanedKey;
        }
        // Status already archived in some responses
        if (st.data?.downloadPath && st.data?.cleanedKey) {
          return st.data.cleanedKey;
        }
        throw new Error('Deep AI remake finished but no cleaned key');
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(st.data?.message || st.data?.error || 'Deep AI remake failed');
      }
    }
    throw new Error('Stopped');
  }

  async function pollFacefusion(jobId, card, meta) {
    const started = Date.now();
    while (!stopRequested) {
      if (Date.now() - started > MAX_POLL_MS) {
        throw new Error('FaceFusion timed out');
      }
      await sleep(POLL_MS);
      const { ok, data } = await api(
        `/api/contentstation/facefusion-remix?action=status&jobId=${encodeURIComponent(jobId)}`,
      );
      if (!ok) continue;
      const status = String(data.status || '').toUpperCase();
      setCardStatus(card, data.message || data.progress?.label || status);
      setStatus(data.message || status, jobId);

      if (status === 'COMPLETED' && (data.videoUrl || data.key || data.downloadPath)) {
        let downloadPath = data.downloadPath;
        let key = data.key;
        if (data.videoUrl && !key) {
          const saved = await api('/api/contentstation/facefusion-remix', {
            method: 'POST',
            body: JSON.stringify({
              action: 'save',
              videoUrl: data.videoUrl,
              sourceKey: meta.videoKey,
              faceKey: meta.faceKey,
              tiktokUrl: meta.tiktokUrl,
              runpodJobId: jobId,
            }),
          });
          if (saved.ok) {
            downloadPath = saved.data.downloadPath;
            key = saved.data.key;
          }
        }
        if (data.key && data.downloadPath) {
          downloadPath = data.downloadPath;
          key = data.key;
        }
        fillCardSuccess(card, { downloadPath, key });
        try {
          localStorage.removeItem(ACTIVE_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
        throw new Error(data.message || data.error || status);
      }
    }
    throw new Error('Stopped');
  }

  async function runPipeline() {
    setError('');
    const url = (tiktokUrl?.value || '').trim();
    if (!url) {
      setError('Paste a TikTok URL.');
      return;
    }
    if (!uploadedFaceKey && !(faceFile && faceFile.files && faceFile.files[0])) {
      setError('Choose a face image.');
      return;
    }

    stopRequested = false;
    running = true;
    if (runBtn) runBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;

    const card = addCard(url);
    try {
      if (!uploadedFaceKey) {
        setStatus('Uploading face…');
        setCardStatus(card, 'Uploading face…');
        uploadedFaceKey = await uploadFace(faceFile.files[0]);
        if (faceMeta) faceMeta.textContent = `Uploaded · ${uploadedFaceKey}`;
      }

      setStatus('Downloading TikTok…');
      setCardStatus(card, 'Downloading TikTok…');
      const dl = await downloadTikTok(url, Boolean(smallerNoHd && smallerNoHd.checked));
      let videoKey = dl.key;
      if (!videoKey) throw new Error('Download returned no key');

      if (deepAiRemake && deepAiRemake.checked) {
        setStatus('Deep AI remake…');
        setCardStatus(card, 'Deep AI remake…');
        videoKey = await runDeepAiRemake(videoKey);
      }

      if (stopRequested) throw new Error('Stopped');

      setStatus('Submitting FaceFusion…');
      setCardStatus(card, 'Submitting FaceFusion…');
      const { ok, data } = await api('/api/contentstation/facefusion-remix', {
        method: 'POST',
        body: JSON.stringify({
          action: 'run',
          faceKey: uploadedFaceKey,
          videoKey,
          options: { enhance: !enhanceOpt || enhanceOpt.checked },
        }),
      });
      if (!ok || !data.jobId) {
        throw new Error(data?.message || data?.error || 'FaceFusion submit failed');
      }

      try {
        localStorage.setItem(
          ACTIVE_STORAGE_KEY,
          JSON.stringify({
            jobId: data.jobId,
            faceKey: uploadedFaceKey,
            videoKey,
            tiktokUrl: url,
            startedAt: Date.now(),
          }),
        );
      } catch {
        /* ignore */
      }

      await pollFacefusion(data.jobId, card, {
        faceKey: uploadedFaceKey,
        videoKey,
        tiktokUrl: url,
      });
      setStatus('Done', data.jobId);
    } catch (err) {
      const msg = String(err?.message || err);
      setCardError(card, msg);
      setCardStatus(card, 'Failed');
      setError(msg);
      setStatus('Failed', msg);
    } finally {
      running = false;
      if (runBtn) runBtn.disabled = false;
      if (stopBtn) {
        stopBtn.hidden = true;
        stopBtn.textContent = 'Stop';
      }
    }
  }

  faceFile?.addEventListener('change', () => {
    uploadedFaceKey = null;
    const file = faceFile.files && faceFile.files[0];
    if (!file) {
      if (facePreviewWrap) facePreviewWrap.hidden = true;
      return;
    }
    if (facePreview && facePreviewWrap) {
      facePreview.src = URL.createObjectURL(file);
      facePreviewWrap.hidden = false;
    }
    if (faceMeta) faceMeta.textContent = file.name;
  });

  runBtn?.addEventListener('click', () => {
    if (running) return;
    void runPipeline();
  });

  stopBtn?.addEventListener('click', async () => {
    stopRequested = true;
    stopBtn.textContent = 'Stopping…';
    try {
      const raw = localStorage.getItem(ACTIVE_STORAGE_KEY);
      const active = raw ? JSON.parse(raw) : null;
      if (active?.jobId) {
        await api('/api/contentstation/facefusion-remix', {
          method: 'POST',
          body: JSON.stringify({ action: 'cancel', jobId: active.jobId }),
        });
      }
    } catch {
      /* ignore */
    }
  });

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password')?.value || '';
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate(data?.message || data?.error || 'Login failed');
      return;
    }
    await refreshSession();
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshSession().catch(() => showGate());
})();
