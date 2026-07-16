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
  const resumeBtn = document.getElementById('resume-btn');
  const fileInput = document.getElementById('video-file');
  const jobIdInput = document.getElementById('job-id-input');
  const jobCheckBtn = document.getElementById('job-check-btn');

  const DIRECT_MAX = 90 * 1024 * 1024;
  const POLL_MS = 8000;
  const STORAGE_KEY = 'cs_clean_work_id';
  const CREDITS_LAST_KEY = 'cs_credits_last';
  const CREDITS_SNAP_KEY = 'cs_credits_snap';
  const MAX_POLL_ERRORS = 8;

  let pollTimer = null;
  let activeWorkId = null;
  let pollPaused = false;
  let consecutiveErrors = 0;
  let pollInFlight = false;
  let creditBalances = { cleaningCreditsLeft: null, videoAlterCreditsLeft: null };
  let lastJobOptions = null;

  const creditsCleaningEl = document.getElementById('credits-cleaning');
  const creditsVideoAlterEl = document.getElementById('credits-video-alter');

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
    stopPoll({ clearStored: false });
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
    if (session.metadataReady === false) bits.push('Metadata off');
    sessionMeta.textContent = bits.join(' · ');
    if (session.cleaningCreditsLeft != null || session.videoAlterCreditsLeft != null) {
      creditBalances = {
        cleaningCreditsLeft:
          session.cleaningCreditsLeft != null ? session.cleaningCreditsLeft : creditBalances.cleaningCreditsLeft,
        videoAlterCreditsLeft:
          session.videoAlterCreditsLeft != null
            ? session.videoAlterCreditsLeft
            : creditBalances.videoAlterCreditsLeft,
      };
    }
    renderCredits();
  }

  function formatCredit(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const num = Number(n);
    if (Number.isInteger(num)) return String(num);
    return String(Math.round(num * 10) / 10);
  }

  function loadLastCredits() {
    try {
      const raw = sessionStorage.getItem(CREDITS_LAST_KEY);
      if (!raw) return { cleaningUsed: null, videoAlterUsed: null };
      const parsed = JSON.parse(raw);
      return {
        cleaningUsed: parsed.cleaningUsed != null ? Number(parsed.cleaningUsed) : null,
        videoAlterUsed: parsed.videoAlterUsed != null ? Number(parsed.videoAlterUsed) : null,
      };
    } catch {
      return { cleaningUsed: null, videoAlterUsed: null };
    }
  }

  function saveLastCredits(partial) {
    const prev = loadLastCredits();
    const next = {
      cleaningUsed:
        partial.cleaningUsed != null && Number.isFinite(Number(partial.cleaningUsed))
          ? Number(partial.cleaningUsed)
          : prev.cleaningUsed,
      videoAlterUsed:
        partial.videoAlterUsed != null && Number.isFinite(Number(partial.videoAlterUsed))
          ? Number(partial.videoAlterUsed)
          : prev.videoAlterUsed,
      at: new Date().toISOString(),
    };
    try {
      sessionStorage.setItem(CREDITS_LAST_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  }

  function renderCredits() {
    const last = loadLastCredits();
    if (creditsCleaningEl) {
      creditsCleaningEl.innerHTML =
        `Cleaning credits: <span class="credit-muted">last used</span> ${formatCredit(last.cleaningUsed)}` +
        ` · <span class="credit-muted">left</span> ${formatCredit(creditBalances.cleaningCreditsLeft)}`;
    }
    if (creditsVideoAlterEl) {
      creditsVideoAlterEl.innerHTML =
        `Video alter credits: <span class="credit-muted">last used</span> ${formatCredit(last.videoAlterUsed)}` +
        ` · <span class="credit-muted">left</span> ${formatCredit(creditBalances.videoAlterCreditsLeft)}`;
    }
  }

  async function refreshBalances() {
    const { ok, data } = await api('/api/contentstation/balance');
    if (!ok || !data) return creditBalances;
    creditBalances = {
      cleaningCreditsLeft:
        data.cleaningCreditsLeft != null ? data.cleaningCreditsLeft : creditBalances.cleaningCreditsLeft,
      videoAlterCreditsLeft:
        data.videoAlterCreditsLeft != null
          ? data.videoAlterCreditsLeft
          : creditBalances.videoAlterCreditsLeft,
    };
    renderCredits();
    return creditBalances;
  }

  function jobUsedVisual(workId, options) {
    if (
      options &&
      (options.removeWatermark || options.basicVideoRemix || options.remix || options.mirror)
    ) {
      return true;
    }
    const id = String(workId || '');
    return id.startsWith('gc:') || id.startsWith('pipe:gc:') || /^\d+$/.test(id);
  }

  function jobUsedCleaning(workId, options) {
    if (options && options.cleanMetadata) return true;
    return String(workId || '').startsWith('cc:');
  }

  function snapshotCreditsForJob(options) {
    lastJobOptions = options || null;
    try {
      sessionStorage.setItem(
        CREDITS_SNAP_KEY,
        JSON.stringify({
          videoAlterBefore: creditBalances.videoAlterCreditsLeft,
          cleaningBefore: creditBalances.cleaningCreditsLeft,
          options: options || null,
          at: new Date().toISOString(),
        }),
      );
    } catch {
      /* ignore */
    }
  }

  function loadCreditSnap() {
    try {
      const raw = sessionStorage.getItem(CREDITS_SNAP_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function recordCreditsOnReady(workId, data) {
    const snap = loadCreditSnap();
    const options = (snap && snap.options) || lastJobOptions || selectedOptions();
    const usedVisual = jobUsedVisual(workId, options);
    const usedCleaning = jobUsedCleaning(workId, options) || data?.stage === 'metadata';

    const after = await refreshBalances();
    const partial = {};

    if (usedCleaning) {
      const fromApi = data?.creditsUsed?.cleaning;
      if (fromApi != null && Number.isFinite(Number(fromApi))) {
        partial.cleaningUsed = Number(fromApi);
      } else if (
        snap &&
        snap.cleaningBefore != null &&
        after.cleaningCreditsLeft != null
      ) {
        const delta = Number(snap.cleaningBefore) - Number(after.cleaningCreditsLeft);
        if (Number.isFinite(delta) && delta >= 0) partial.cleaningUsed = delta || 1;
      } else {
        partial.cleaningUsed = 1;
      }
    }

    if (usedVisual) {
      const fromApi = data?.creditsUsed?.videoAlter;
      let alterUsed = null;
      if (
        snap &&
        snap.videoAlterBefore != null &&
        after.videoAlterCreditsLeft != null
      ) {
        const delta = Number(snap.videoAlterBefore) - Number(after.videoAlterCreditsLeft);
        if (Number.isFinite(delta) && delta > 0) alterUsed = Math.round(delta * 10) / 10;
      }
      if (alterUsed == null && fromApi != null && Number.isFinite(Number(fromApi))) {
        alterUsed = Number(fromApi);
      }
      if (alterUsed != null) partial.videoAlterUsed = alterUsed;
    }

    if (partial.cleaningUsed != null || partial.videoAlterUsed != null) {
      saveLastCredits(partial);
    }
    try {
      sessionStorage.removeItem(CREDITS_SNAP_KEY);
    } catch {
      /* ignore */
    }
    renderCredits();
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
      basicVideoRemix: document.getElementById('opt-basic-video-remix').checked,
      remix: document.getElementById('opt-remix').checked,
      mirror: document.getElementById('opt-mirror').checked,
    };
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function persistWorkId(workId) {
    try {
      if (workId) sessionStorage.setItem(STORAGE_KEY, workId);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function loadStoredWorkId() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  function updatePollButtons() {
    const hasJob = Boolean(activeWorkId);
    const polling = Boolean(pollTimer);
    stopBtn.hidden = !(hasJob && polling);
    if (resumeBtn) {
      resumeBtn.hidden = !(hasJob && !polling && pollPaused);
    }
  }

  function stopPoll({ clearStored = false, paused = true } = {}) {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollPaused = paused && Boolean(activeWorkId);
    if (clearStored) {
      activeWorkId = null;
      persistWorkId(null);
      pollPaused = false;
    }
    updatePollButtons();
  }

  function startPoll(workId) {
    if (workId) {
      activeWorkId = workId;
      persistWorkId(workId);
    }
    if (!activeWorkId) return;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollPaused = false;
    consecutiveErrors = 0;
    updatePollButtons();
    pollTimer = setInterval(() => {
      tickPoll().catch(() => {
        /* tickPoll handles errors; never kill the interval here */
      });
    }, POLL_MS);
  }

  async function tickPoll() {
    if (!activeWorkId || pollInFlight || document.hidden) return;
    await checkStatus(activeWorkId);
  }

  function detailFor(workId, data) {
    const bits = [];
    if (workId) bits.push(`Job ${workId}`);
    if (data && data.stage === 'visual') bits.push('visual stage');
    if (data && data.stage === 'metadata') bits.push('metadata stage');
    if (data && data.progress != null && data.state === 'processing') {
      bits.push(`${data.progress}%`);
    }
    return bits.join(' · ');
  }

  async function checkStatus(workId) {
    if (!workId) return null;
    pollInFlight = true;
    try {
      const { ok, data } = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });

      if (!ok || !data) {
        consecutiveErrors += 1;
        const msg = (data && data.message) || 'Could not check status.';
        setError(
          consecutiveErrors >= MAX_POLL_ERRORS
            ? `${msg} Stopped after repeated errors — use Resume checking or re-check the job id.`
            : msg,
        );
        if (consecutiveErrors >= MAX_POLL_ERRORS) {
          stopPoll({ paused: true });
        }
        return data;
      }

      consecutiveErrors = 0;

      // Pipeline may advance workId (visual → metadata strip).
      if (data.workId) {
        activeWorkId = data.workId;
        workId = data.workId;
        persistWorkId(workId);
        if (jobIdInput && document.activeElement !== jobIdInput) {
          jobIdInput.value = workId;
        }
      }

      setError(data.warning || '');
      setStatus(data.label || 'Checking…', detailFor(workId, data));

      if (data.state === 'ready' && data.downloadUrl) {
        showDownload(data.downloadUrl);
        const readyLabel = data.inLibrary
          ? 'Ready · in Cleaned videos'
          : data.savingToLibrary
            ? 'Ready · saving to Cleaned videos'
            : 'Ready to download';
        setStatus(readyLabel, detailFor(workId, data));
        stopPoll({ clearStored: true, paused: false });
        cleanBtn.disabled = false;
        recordCreditsOnReady(workId, data).catch(() => {
          renderCredits();
        });
      } else if (data.state === 'failed') {
        setError(data.error || 'Cleaning failed.');
        showDownload(null);
        stopPoll({ paused: true });
        cleanBtn.disabled = false;
      } else if (data.state === 'processing' || data.state === 'unknown') {
        // Keep polling; ensure interval is running if caller only did a one-shot check.
        if (!pollTimer && !pollPaused) startPoll(workId);
      }

      return data;
    } catch (err) {
      consecutiveErrors += 1;
      const msg = err && err.message ? err.message : 'Network error while checking status.';
      setError(
        consecutiveErrors >= MAX_POLL_ERRORS
          ? `${msg} Stopped after repeated errors — use Resume checking.`
          : msg,
      );
      if (consecutiveErrors >= MAX_POLL_ERRORS) {
        stopPoll({ paused: true });
      }
      return null;
    } finally {
      pollInFlight = false;
      updatePollButtons();
    }
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
      if (data.fetchUrl) return data.fetchUrl;
      if (data.publicUrl) return data.publicUrl;
      const meta = await api(
        `/api/contentstation/media?action=meta&key=${encodeURIComponent(data.key)}`,
      );
      if (meta.ok && meta.data?.object?.fetchUrl) return meta.data.object.fetchUrl;
      if (meta.ok && meta.data?.object?.publicUrl) return meta.data.object.publicUrl;
      throw new Error('Upload succeeded but no fetchable URL is available for processing.');
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
    if (data.object.fetchUrl) return data.object.fetchUrl;
    if (data.object.publicUrl) return data.object.publicUrl;
    throw new Error('Upload succeeded but no fetchable URL is available for processing.');
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

  async function beginTracking(workId) {
    activeWorkId = workId;
    persistWorkId(workId);
    if (jobIdInput) jobIdInput.value = workId;
    setStatus('Cleaning…', `Job ${workId}`);
    pollPaused = false;
    const data = await checkStatus(workId);
    // Always keep polling while still processing — even if workId advanced (pipe → cc).
    if (data && data.state === 'ready' && data.downloadUrl) return;
    if (data && data.state === 'failed') return;
    if (activeWorkId) startPoll(activeWorkId);
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
    stopPoll({ clearStored: true, paused: false });

    const options = selectedOptions();
    if (
      !options.removeWatermark &&
      !options.cleanMetadata &&
      !options.basicVideoRemix &&
      !options.remix &&
      !options.mirror
    ) {
      setError('Select at least one option.');
      return;
    }

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setError('Choose a video file first.');
      return;
    }

    if (options.cleanMetadata && window.__csSession && window.__csSession.metadataReady === false) {
      setError('Metadata cleaning isn’t configured.');
      return;
    }

    cleanBtn.disabled = true;
    try {
      await refreshBalances();
      snapshotCreditsForJob(options);

      let workId;
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

      await beginTracking(workId);
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
      setStatus('Ready.');
      cleanBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', () => {
    stopPoll({ paused: true });
    cleanBtn.disabled = false;
    setStatus(activeWorkId ? `Paused · Job ${activeWorkId}` : 'Stopped.');
    updatePollButtons();
  });

  if (resumeBtn) {
    resumeBtn.addEventListener('click', async () => {
      if (!activeWorkId) {
        const typed = jobIdInput && jobIdInput.value.trim();
        if (typed) activeWorkId = typed;
      }
      if (!activeWorkId) {
        setError('No job id to resume.');
        return;
      }
      setError('');
      pollPaused = false;
      cleanBtn.disabled = true;
      await beginTracking(activeWorkId);
    });
  }

  if (jobCheckBtn && jobIdInput) {
    jobCheckBtn.addEventListener('click', async () => {
      const workId = jobIdInput.value.trim();
      if (!workId) {
        setError('Enter a job id (e.g. pipe:gc:123 or cc:…).');
        return;
      }
      setError('');
      showDownload(null);
      cleanBtn.disabled = true;
      pollPaused = false;
      await beginTracking(workId);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeWorkId && pollTimer && !pollPaused) {
      checkStatus(activeWorkId).catch(() => {});
    }
  });

  async function refreshSession() {
    const { ok, data } = await api('/api/contentstation/session');
    if (ok && data && data.authenticated) {
      window.__csSession = data;
      showApp(data);
      // Refresh balances in background so left figures stay current.
      refreshBalances().catch(() => {});
      return true;
    }
    window.__csSession = null;
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
    const stored = loadStoredWorkId();
    if (stored) {
      activeWorkId = stored;
      if (jobIdInput) jobIdInput.value = stored;
      pollPaused = true;
      setStatus(`Job saved · ${stored}`, 'Click Resume checking to continue.');
      updatePollButtons();
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    stopPoll({ clearStored: true, paused: false });
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshSession()
    .then((authed) => {
      if (!authed) return;
      const stored = loadStoredWorkId();
      if (stored) {
        activeWorkId = stored;
        if (jobIdInput) jobIdInput.value = stored;
        pollPaused = true;
        setStatus(`Job saved · ${stored}`, 'Click Resume checking to continue.');
        updatePollButtons();
      }
    })
    .catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
