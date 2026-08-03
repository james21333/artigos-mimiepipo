(function () {
  const POLL_MS = 4000;
  const MAX_POLL_MS = 45 * 60 * 1000;
  const MAX_CLEAN_POLL_MS = 25 * 60 * 1000;
  /** Soft-retry network blips before failing a poll loop. */
  const MAX_POLL_ERRORS = 20;
  const ACTIVE_STORAGE_KEY = 'cs_facefusion_remix_active_v2';
  const ACTIVE_JOB_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  /** Match FaceFusion endpoint idleTimeout (600s) — after this with no work, GPU is cold. */
  const GPU_IDLE_MS = 10 * 60 * 1000;
  /** Typical warm FaceFusion job length (minutes) for ETA heuristics. */
  const TYPICAL_JOB_MIN = 6;
  const TYPICAL_JOB_HI_MIN = 10;
  const COLD_START_EXTRA_MIN = 3;
  const ETA_DISPLAY_MAX_MIN = 55;

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
  const ffBalance = document.getElementById('ff-balance');
  const ffSpend = document.getElementById('ff-spend');

  let stopRequested = false;
  /** In-flight browser pipelines (download + poll). Allow >1 so the next job can queue on RunPod. */
  let activeRuns = 0;
  /** @type {string|null} */
  let uploadedFaceKey = null;
  /** $/hr used for estimates (from config). */
  let costPerHourUsd = 1.1;
  /** Session totals for finished FaceFusion jobs. */
  let sessionSpendUsd = 0;
  let sessionFinishedCount = 0;
  /** @type {Map<string, { status: string, delayMs: number|null, execMs: number|null, startedAt: number, progressAt: number|null, card: HTMLElement|null }>} */
  const liveJobs = new Map();
  /** Last time we saw a worker actively processing (IN_PROGRESS). Survives refresh via sessionStorage. */
  let lastGpuActiveAt = (() => {
    try {
      const n = Number(sessionStorage.getItem('cs_facefusion_gpu_active_at') || 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  })();
  /** Override top status while a non-GPU pipeline step is happening (upload/download/etc). */
  let statusOverride = null;

  function touchGpuActive() {
    lastGpuActiveAt = Date.now();
    try {
      sessionStorage.setItem('cs_facefusion_gpu_active_at', String(lastGpuActiveAt));
    } catch {
      /* ignore */
    }
  }

  function setRunUiBusy() {
    const busy = activeRuns > 0;
    // Keep submit enabled so another URL can be queued while a job is polling.
    if (runBtn) runBtn.disabled = false;
    if (stopBtn) {
      stopBtn.hidden = !busy;
      if (!busy) stopBtn.textContent = 'Stop';
    }
  }

  function loadActiveJobs() {
    try {
      // Migrate single-job v1 blob if present.
      const legacy = localStorage.getItem('cs_facefusion_remix_active_v1');
      if (legacy) {
        try {
          const j = JSON.parse(legacy);
          if (j?.jobId) {
            const cur = (() => {
              try {
                const raw = localStorage.getItem(ACTIVE_STORAGE_KEY);
                const arr = raw ? JSON.parse(raw) : [];
                return Array.isArray(arr) ? arr : [];
              } catch {
                return [];
              }
            })();
            if (!cur.some((x) => x.jobId === j.jobId)) {
              cur.push(j);
              localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(cur));
            }
          }
        } catch {
          /* ignore */
        }
        try {
          localStorage.removeItem('cs_facefusion_remix_active_v1');
        } catch {
          /* ignore */
        }
      }
      const raw = localStorage.getItem(ACTIVE_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      const now = Date.now();
      return arr.filter((j) => {
        if (!j || !j.jobId) return false;
        const started = Number(j.startedAt) || 0;
        return !started || now - started < ACTIVE_JOB_MAX_AGE_MS;
      });
    } catch {
      return [];
    }
  }

  function saveActiveJobs(jobs) {
    try {
      localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(jobs || []));
    } catch {
      /* ignore */
    }
  }

  function upsertActiveJob(job) {
    if (!job?.jobId) return;
    const jobs = loadActiveJobs().filter((j) => j.jobId !== job.jobId);
    jobs.push(job);
    saveActiveJobs(jobs);
  }

  function removeActiveJob(jobId) {
    if (!jobId) return;
    saveActiveJobs(loadActiveJobs().filter((j) => j.jobId !== jobId));
  }

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const headers = { ...(options.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    opts.headers = headers;
    try {
      const res = await fetch(path, opts);
      let data = null;
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { ok: res.ok, status: res.status, data, networkError: false };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        networkError: true,
        data: {
          error: 'network_error',
          message: String(err?.message || err || 'Failed to fetch'),
        },
      };
    }
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
    refreshFleetStatus();
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
    statusOverride = main
      ? { main: main || '', detail: detail || '', at: Date.now() }
      : null;
    refreshFleetStatus();
  }

  function clampEtaMin(n) {
    return Math.max(1, Math.min(ETA_DISPLAY_MAX_MIN, Math.round(n)));
  }

  function formatEtaRange(lo, hi) {
    let a = clampEtaMin(lo);
    let b = clampEtaMin(hi);
    if (b < a) b = a;
    if (a === b) return `~${a} min`;
    return `~${a}–${b} min`;
  }

  function isGpuWarm() {
    if ([...liveJobs.values()].some((j) => String(j.status || '').toUpperCase() === 'IN_PROGRESS')) {
      return true;
    }
    return lastGpuActiveAt > 0 && Date.now() - lastGpuActiveAt < GPU_IDLE_MS;
  }

  function estimateRunningLeftMin(job) {
    const execMin =
      job.execMs != null && Number.isFinite(job.execMs) ? job.execMs / 60000 : null;
    const sinceProgress =
      job.progressAt != null ? (Date.now() - job.progressAt) / 60000 : 0;
    const elapsed = execMin != null ? execMin : sinceProgress;
    const typical = isGpuWarm() ? TYPICAL_JOB_MIN : TYPICAL_JOB_MIN + COLD_START_EXTRA_MIN;
    const typicalHi = isGpuWarm() ? TYPICAL_JOB_HI_MIN : TYPICAL_JOB_HI_MIN + COLD_START_EXTRA_MIN;
    const leftLo = Math.max(0.75, typical - elapsed);
    const leftHi = Math.max(leftLo + 1, typicalHi - elapsed * 0.7);
    return { lo: leftLo, hi: leftHi };
  }

  function estimateQueuedJobMin() {
    // Full job once it gets the GPU; cold start only if GPU is currently cold and nothing running.
    const running = [...liveJobs.values()].some(
      (j) => String(j.status || '').toUpperCase() === 'IN_PROGRESS',
    );
    if (running || isGpuWarm()) {
      return { lo: TYPICAL_JOB_MIN, hi: TYPICAL_JOB_HI_MIN };
    }
    return {
      lo: TYPICAL_JOB_MIN + COLD_START_EXTRA_MIN,
      hi: TYPICAL_JOB_HI_MIN + COLD_START_EXTRA_MIN + 2,
    };
  }

  function queueAheadCount(job) {
    const queued = [...liveJobs.values()]
      .filter((j) => String(j.status || '').toUpperCase() === 'IN_QUEUE')
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const idx = queued.findIndex((j) => j === job || j.jobId === job.jobId);
    return idx < 0 ? queued.length : idx;
  }

  function cardStatusForJob(job) {
    const st = String(job?.status || '').toUpperCase();
    if (st === 'IN_QUEUE') {
      const ahead = queueAheadCount(job);
      const current = estimateCurrentRunLeftMin();
      const per = estimateQueuedJobMin();
      let lo = (current?.lo || 0) + ahead * per.lo;
      let hi = (current?.hi || 0) + ahead * per.hi;
      if (!current && ahead === 0 && !isGpuWarm()) {
        lo = COLD_START_EXTRA_MIN;
        hi = COLD_START_EXTRA_MIN + 2;
        return `Queued for GPU… · cold start ${formatEtaRange(lo, hi)}`;
      }
      if (lo <= 0 && hi <= 0) {
        return `Queued for GPU… · ${formatEtaRange(per.lo, per.hi)} once started`;
      }
      return `Queued for GPU… · starts in ${formatEtaRange(Math.max(0.75, lo), Math.max(1, hi))}`;
    }
    if (st === 'IN_PROGRESS') {
      const left = estimateRunningLeftMin(job);
      return `FaceFusion running… · ${formatEtaRange(left.lo, left.hi)} left`;
    }
    return job?.status || 'FaceFusion…';
  }

  function estimateCurrentRunLeftMin() {
    const running = [...liveJobs.values()].filter(
      (j) => String(j.status || '').toUpperCase() === 'IN_PROGRESS',
    );
    if (!running.length) return null;
    let lo = 0;
    let hi = 0;
    for (const job of running) {
      const e = estimateRunningLeftMin(job);
      lo = Math.max(lo, e.lo);
      hi = Math.max(hi, e.hi);
    }
    return { lo, hi };
  }

  function estimateTotalLeftMin() {
    const jobs = [...liveJobs.values()];
    const running = jobs.filter((j) => String(j.status || '').toUpperCase() === 'IN_PROGRESS');
    const queued = jobs.filter((j) => String(j.status || '').toUpperCase() === 'IN_QUEUE');
    if (!running.length && !queued.length) return null;

    let lo = 0;
    let hi = 0;
    const current = estimateCurrentRunLeftMin();
    if (current) {
      lo += current.lo;
      hi += current.hi;
    } else if (queued.length && !isGpuWarm()) {
      lo += COLD_START_EXTRA_MIN;
      hi += COLD_START_EXTRA_MIN + 2;
    }
    // Serial GPU assumption (workersMax often 1; safe upper bound even with 2).
    const per = estimateQueuedJobMin();
    lo += queued.length * per.lo;
    hi += queued.length * per.hi;
    return { lo: Math.max(0.75, lo), hi: Math.max(1, hi) };
  }

  function refreshFleetStatus() {
    if (statusOverride && liveJobs.size === 0) {
      if (statusLine) statusLine.textContent = statusOverride.main || '';
      if (statusDetail) {
        if (statusOverride.detail) {
          statusDetail.hidden = false;
          statusDetail.textContent = statusOverride.detail;
        } else {
          statusDetail.hidden = true;
          statusDetail.textContent = '';
        }
      }
      return;
    }

    const jobs = [...liveJobs.values()];
    const running = jobs.filter((j) => String(j.status || '').toUpperCase() === 'IN_PROGRESS').length;
    const queued = jobs.filter((j) => String(j.status || '').toUpperCase() === 'IN_QUEUE').length;
    const warm = isGpuWarm();

    if (!jobs.length && !statusOverride) {
      if (statusLine) {
        statusLine.textContent = warm ? 'GPU warm · Ready.' : 'GPU cold · Ready.';
      }
      if (statusDetail) {
        statusDetail.hidden = true;
        statusDetail.textContent = '';
      }
      return;
    }

    const parts = [
      warm ? 'GPU warm' : 'GPU cold',
      `${running} running`,
      `${queued} queued for GPU`,
    ];
    const current = estimateCurrentRunLeftMin();
    if (current) {
      parts.push(`${formatEtaRange(current.lo, current.hi)} left this run`);
    }
    const total = estimateTotalLeftMin();
    if (total && (queued > 0 || running > 0)) {
      parts.push(`${formatEtaRange(total.lo, total.hi)} total`);
    }

    if (statusLine) statusLine.textContent = parts.join(' · ');
    if (statusDetail) {
      if (statusOverride?.main) {
        statusDetail.hidden = false;
        statusDetail.textContent = statusOverride.detail
          ? `${statusOverride.main} — ${statusOverride.detail}`
          : statusOverride.main;
      } else {
        statusDetail.hidden = true;
        statusDetail.textContent = '';
      }
    }

    // Keep card labels in sync when fleet ETAs move.
    for (const job of liveJobs.values()) {
      if (!job.card) continue;
      const st = String(job.status || '').toUpperCase();
      if (st === 'IN_QUEUE' || st === 'IN_PROGRESS') {
        setCardStatus(job.card, cardStatusForJob(job));
      }
    }
  }

  function upsertLiveJob(jobId, patch) {
    if (!jobId) return;
    const prev = liveJobs.get(jobId) || {
      status: '',
      delayMs: null,
      execMs: null,
      startedAt: Date.now(),
      progressAt: null,
      card: null,
    };
    const next = { ...prev, ...patch, jobId };
    const st = String(next.status || '').toUpperCase();
    if (st === 'IN_PROGRESS') {
      touchGpuActive();
      if (!next.progressAt || String(prev.status || '').toUpperCase() !== 'IN_PROGRESS') {
        next.progressAt = Date.now();
      }
    }
    liveJobs.set(jobId, next);
    if (next.card && (st === 'IN_QUEUE' || st === 'IN_PROGRESS')) {
      setCardStatus(next.card, cardStatusForJob(next));
    }
    refreshFleetStatus();
  }

  function clearLiveJob(jobId) {
    if (!jobId) return;
    const job = liveJobs.get(jobId);
    if (job && String(job.status || '').toUpperCase() === 'IN_PROGRESS') {
      touchGpuActive();
    }
    liveJobs.delete(jobId);
    refreshFleetStatus();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function formatUsd(n, { cents = true } = {}) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    if (!cents && Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
    if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
    return `$${v.toFixed(3)}`;
  }

  function estimateCostFromMs(execMs) {
    const ms = Number(execMs);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.round((ms / 3_600_000) * costPerHourUsd * 1000) / 1000;
  }

  function setBalanceUi(balanceUsd) {
    if (!ffBalance) return;
    if (balanceUsd == null || !Number.isFinite(Number(balanceUsd))) {
      ffBalance.innerHTML = 'Balance unavailable';
      return;
    }
    ffBalance.innerHTML = `Balance <span class="ff-balance-amt">${formatUsd(balanceUsd, { cents: true })}</span>`;
  }

  function refreshSpendUi() {
    if (!ffSpend) return;
    if (!sessionFinishedCount) {
      ffSpend.hidden = true;
      ffSpend.textContent = '';
      return;
    }
    ffSpend.hidden = false;
    ffSpend.textContent = `Est. spent on ${sessionFinishedCount} finished video${
      sessionFinishedCount === 1 ? '' : 's'
    }: ${formatUsd(sessionSpendUsd)} (GPU runtime only · warm idle not included)`;
  }

  function noteFinishedCost(estimatedCostUsd, execMs) {
    let cost = estimatedCostUsd != null ? Number(estimatedCostUsd) : null;
    if (!Number.isFinite(cost)) cost = estimateCostFromMs(execMs);
    if (!Number.isFinite(cost) || cost < 0) return null;
    sessionSpendUsd = Math.round((sessionSpendUsd + cost) * 1000) / 1000;
    sessionFinishedCount += 1;
    refreshSpendUi();
    return cost;
  }

  async function refreshBalance() {
    const { ok, data } = await api('/api/contentstation/facefusion-remix?action=balance');
    if (ok && data?.balanceUsd != null) {
      setBalanceUi(data.balanceUsd);
      if (data.costPerHourUsd != null && Number.isFinite(Number(data.costPerHourUsd))) {
        costPerHourUsd = Number(data.costPerHourUsd);
      }
      return data.balanceUsd;
    }
    return null;
  }

  async function loadConfig() {
    const { ok, data } = await api('/api/contentstation/facefusion-remix?action=config');
    if (data?.costPerHourUsd != null && Number.isFinite(Number(data.costPerHourUsd))) {
      costPerHourUsd = Number(data.costPerHourUsd);
    }
    if (data?.balanceUsd != null) {
      setBalanceUi(data.balanceUsd);
    } else if (ffBalance) {
      ffBalance.textContent = 'Balance…';
      void refreshBalance();
    }
    if (!ffConfig) return;
    if (!ok) {
      ffConfig.hidden = false;
      ffConfig.textContent = 'FaceFusion endpoint not reachable.';
      return;
    }
    ffConfig.hidden = false;
    ffConfig.textContent = data.configured
      ? 'FaceFusion ready.'
      : 'FaceFusion not configured.';
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
    const key = data?.object?.key || data?.key;
    if (!ok || !key) {
      throw new Error(data?.message || data?.error || 'Face upload failed');
    }
    return key;
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

  function fillCardSuccess(card, { downloadPath, key, estimatedCostUsd }) {
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
    const cost = estimatedCostUsd != null && Number.isFinite(Number(estimatedCostUsd))
      ? Number(estimatedCostUsd)
      : null;
    setCardStatus(card, cost != null ? `Saved · est. ${formatUsd(cost)}` : 'Saved');
  }

  async function downloadTikTok(url, smallerFile) {
    const { ok, data } = await api('/api/contentstation/tiktok-download', {
      method: 'POST',
      // Remix may re-use a library URL; skip the download-page duplicate block.
      body: JSON.stringify({ url, smallerFile, allowDuplicate: true }),
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

  async function pollFacefusion(jobId, meta, card) {
    const started = Date.now();
    let errors = 0;
    upsertLiveJob(jobId, { card: card || null, startedAt: started, status: 'IN_QUEUE' });
    while (!stopRequested) {
      if (Date.now() - started > MAX_POLL_MS) {
        clearLiveJob(jobId);
        throw new Error(
          'FaceFusion timed out after 45 minutes. Refresh — the GPU job may still finish in the library.',
        );
      }
      await sleep(POLL_MS);
      const { ok, data, networkError, status: httpStatus } = await api(
        `/api/contentstation/facefusion-remix?action=status&jobId=${encodeURIComponent(jobId)}`,
      );
      if (!ok) {
        if (httpStatus === 404 || data?.error === 'job_not_found') {
          clearLiveJob(jobId);
          throw new Error(
            data?.message ||
              'RunPod job not found (finished, expired, or never submitted). Check FaceFusion remixes.',
          );
        }
        errors += 1;
        setStatus(
          networkError
            ? `Connection blip — still waiting on GPU (${errors}/${MAX_POLL_ERRORS})…`
            : data?.message || data?.error || `Status check failed (${errors}/${MAX_POLL_ERRORS})`,
          jobId,
        );
        if (errors >= MAX_POLL_ERRORS) {
          clearLiveJob(jobId);
          throw new Error(
            data?.message ||
              data?.error ||
              'Lost connection while polling FaceFusion. Refresh this page to resume — the GPU job may still be running.',
          );
        }
        continue;
      }
      errors = 0;
      statusOverride = null;
      const status = String(data.status || '').toUpperCase();
      const delayMs = data.delayTime != null ? Number(data.delayTime) : null;
      const execMs = data.executionTime != null ? Number(data.executionTime) : null;
      upsertLiveJob(jobId, {
        status,
        delayMs: delayMs != null && Number.isFinite(delayMs) ? delayMs : null,
        execMs: execMs != null && Number.isFinite(execMs) ? execMs : null,
        card: card || null,
      });

      if (status === 'COMPLETED' && (data.videoUrl || data.key || data.downloadPath)) {
        let downloadPath = data.downloadPath;
        let key = data.key;
        if (key && !downloadPath) {
          downloadPath = `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
        }
        if (!key && data.videoUrl) {
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
          if (!saved.ok) {
            clearLiveJob(jobId);
            throw new Error(saved.data?.message || saved.data?.error || 'Could not archive FaceFusion output');
          }
          downloadPath = saved.data.downloadPath;
          key = saved.data.key;
        }
        if (!key || !downloadPath) {
          clearLiveJob(jobId);
          throw new Error('FaceFusion completed but no output key/URL');
        }
        clearLiveJob(jobId);
        removeActiveJob(jobId);
        const estimatedCostUsd =
          data.estimatedCostUsd != null && Number.isFinite(Number(data.estimatedCostUsd))
            ? Number(data.estimatedCostUsd)
            : estimateCostFromMs(execMs);
        return { key, downloadPath, jobId, estimatedCostUsd, executionTime: execMs };
      }
      if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
        clearLiveJob(jobId);
        removeActiveJob(jobId);
        throw new Error(data.message || data.error || status);
      }
    }
    clearLiveJob(jobId);
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
    activeRuns += 1;
    setRunUiBusy();

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
      const videoKey = dl.key;
      if (!videoKey) throw new Error('Download returned no key');

      if (stopRequested) throw new Error('Stopped');

      setStatus('Submitting FaceFusion…');
      setCardStatus(card, 'FaceFusion…');
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

      upsertActiveJob({
        jobId: data.jobId,
        faceKey: uploadedFaceKey,
        videoKey,
        tiktokUrl: url,
        deepAiRemake: Boolean(deepAiRemake && deepAiRemake.checked),
        startedAt: Date.now(),
      });

      setCardStatus(card, 'Queued for GPU…');
      statusOverride = null;
      let final = await finishFacefusionJob(data.jobId, {
        faceKey: uploadedFaceKey,
        videoKey,
        tiktokUrl: url,
        deepAiRemake: Boolean(deepAiRemake && deepAiRemake.checked),
      }, card);

      const cost = noteFinishedCost(final.estimatedCostUsd, final.executionTime);
      fillCardSuccess(card, {
        downloadPath: final.downloadPath,
        key: final.key,
        estimatedCostUsd: cost,
      });
      statusOverride = null;
      refreshFleetStatus();
      void refreshBalance();
      if (!liveJobs.size) {
        setStatus(
          'Done',
          cost != null ? `${formatUsd(cost)} this video · ${formatUsd(sessionSpendUsd)} session` : data.jobId,
        );
      }
    } catch (err) {
      const msg = String(err?.message || err);
      setCardError(card, msg);
      setCardStatus(card, 'Failed');
      setError(msg);
      setStatus('Failed', msg);
    } finally {
      activeRuns = Math.max(0, activeRuns - 1);
      setRunUiBusy();
    }
  }

  async function finishFacefusionJob(jobId, meta, card) {
    setCardStatus(card, 'Queued for GPU…');
    let final = await pollFacefusion(jobId, meta, card);
    if (meta.deepAiRemake && final.key && !stopRequested) {
      setStatus('Deep AI remake (after FaceFusion)…');
      setCardStatus(card, 'Deep AI remake…');
      const cleanedKey = await runDeepAiRemake(final.key);
      final = {
        key: cleanedKey,
        downloadPath: `/api/contentstation/media?action=get&key=${encodeURIComponent(cleanedKey)}`,
        jobId,
        estimatedCostUsd: final.estimatedCostUsd,
        executionTime: final.executionTime,
      };
    }
    removeActiveJob(jobId);
    return final;
  }

  async function resumeActiveJobs() {
    const jobs = loadActiveJobs();
    if (!jobs.length) {
      refreshFleetStatus();
      return;
    }
    setStatus(`Resuming ${jobs.length} FaceFusion job${jobs.length === 1 ? '' : 's'}…`);
    await Promise.all(
      jobs.map(async (job) => {
        const card = addCard(job.tiktokUrl || job.jobId);
        setCardStatus(card, 'Resuming GPU poll…');
        upsertLiveJob(job.jobId, {
          card,
          status: 'IN_QUEUE',
          startedAt: Number(job.startedAt) || Date.now(),
        });
        activeRuns += 1;
        setRunUiBusy();
        try {
          const final = await finishFacefusionJob(
            job.jobId,
            {
              faceKey: job.faceKey,
              videoKey: job.videoKey,
              tiktokUrl: job.tiktokUrl,
              deepAiRemake: Boolean(job.deepAiRemake),
            },
            card,
          );
          const cost = noteFinishedCost(final.estimatedCostUsd, final.executionTime);
          fillCardSuccess(card, {
            downloadPath: final.downloadPath,
            key: final.key,
            estimatedCostUsd: cost,
          });
          statusOverride = null;
          refreshFleetStatus();
          void refreshBalance();
          if (!liveJobs.size) {
            setStatus(
              'Done',
              cost != null
                ? `${formatUsd(cost)} this video · ${formatUsd(sessionSpendUsd)} session`
                : job.jobId,
            );
          }
        } catch (err) {
          clearLiveJob(job.jobId);
          const msg = String(err?.message || err);
          setCardError(card, msg);
          setCardStatus(card, 'Failed');
          setError(msg);
        } finally {
          activeRuns = Math.max(0, activeRuns - 1);
          setRunUiBusy();
        }
      }),
    );
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
    void runPipeline();
  });

  stopBtn?.addEventListener('click', async () => {
    stopRequested = true;
    stopBtn.textContent = 'Stopping…';
    try {
      const jobs = loadActiveJobs();
      await Promise.all(
        jobs.map((j) =>
          api('/api/contentstation/facefusion-remix', {
            method: 'POST',
            body: JSON.stringify({ action: 'cancel', jobId: j.jobId }),
          }),
        ),
      );
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
    const authed = await refreshSession();
    if (authed) void resumeActiveJobs();
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshSession()
    .then((authed) => {
      if (authed) return resumeActiveJobs();
    })
    .catch(() => showGate());
})();
