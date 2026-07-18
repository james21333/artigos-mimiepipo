(function () {
  const MAX_URLS = 10;
  const POLL_MS = 4000;
  const MAX_POLL_ERRORS = 10;
  /** Hard stop so cards cannot sit on "Processing…" forever. */
  const MAX_REMIX_POLL_MS = 45 * 60 * 1000;
  const MAX_RUNPOD_IN_FLIGHT = 2;
  /** Active RunPod/Comfy jobs that should resume after refresh. */
  const ACTIVE_STORAGE_KEY = 'cs_character_remix_active_v1';
  /** Drop stale active entries older than this (job likely expired). */
  const ACTIVE_JOB_MAX_AGE_MS = 6 * 60 * 60 * 1000;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const urlsInput = document.getElementById('tiktok-urls');
  const urlCount = document.getElementById('url-count');
  const characterFile = document.getElementById('character-file');
  const characterMeta = document.getElementById('character-preview-wrap')
    ? document.getElementById('character-meta')
    : document.getElementById('character-meta');
  const characterPreviewWrap = document.getElementById('character-preview-wrap');
  const characterPreview = document.getElementById('character-preview');
  const smallerNoHd = document.getElementById('opt-smaller-no-hd');
  const stripCaptions = document.getElementById('opt-strip-captions');
  const preserveAudio = document.getElementById('opt-preserve-audio');
  const alterAudio = document.getElementById('opt-alter-audio');
  const restoreHooks = document.getElementById('opt-restore-hooks');
  const characterStrength = document.getElementById('opt-character-strength');
  const sceneRestyle = document.getElementById('opt-scene-restyle');
  const characterStrengthVal = document.getElementById('character-strength-val');
  const sceneRestyleVal = document.getElementById('scene-restyle-val');
  const remixConfig = document.getElementById('remix-config') || document.getElementById('runpod-config');
  const remixBtn = document.getElementById('remix-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const remixError = document.getElementById('remix-error');
  const results = document.getElementById('results');

  let stopRequested = false;
  let batchActive = false;
  let resumeActive = false;
  /** @type {string|null} */
  let uploadedCharacterKey = null;
  /** @type {'comfyui'|'runpod'|null} */
  let activeBackend = null;

  function loadActiveJobs() {
    try {
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
      // quota / private mode — ignore
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

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = 'Signed in';
    void loadConfig();
    void resumeActiveJobs();
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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-download-character-remix')) {
      return false;
    }
    if (window.CSAuth) window.CSAuth.applyNav(data.role);
    showApp(data);
    return true;
  }

  function setError(msg) {
    if (!remixError) return;
    if (msg) {
      remixError.hidden = false;
      remixError.textContent = msg;
    } else {
      remixError.hidden = true;
      remixError.textContent = '';
    }
  }

  function setStatus(main, detail) {
    if (statusLine) statusLine.textContent = main || '';
    if (statusDetail) {
      if (detail) {
        statusDetail.hidden = false;
        statusDetail.textContent = detail;
      } else {
        statusDetail.hidden = true;
        statusDetail.textContent = '';
      }
    }
  }

  function parseUrls(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_URLS);
  }

  function updateUrlCount() {
    const n = parseUrls(urlsInput?.value).length;
    if (urlCount) urlCount.textContent = `${n} / ${MAX_URLS} links`;
  }

  function bindSliders() {
    const sync = () => {
      if (characterStrengthVal && characterStrength) {
        characterStrengthVal.textContent = Number(characterStrength.value).toFixed(2);
      }
      if (sceneRestyleVal && sceneRestyle) {
        sceneRestyleVal.textContent = Number(sceneRestyle.value).toFixed(2);
      }
    };
    characterStrength?.addEventListener('input', sync);
    sceneRestyle?.addEventListener('input', sync);
    sync();
  }

  async function loadConfig() {
    const { ok, data } = await api('/api/contentstation/character-remix?action=config');
    if (!remixConfig) return;
    remixConfig.hidden = false;
    activeBackend = data?.backend || null;
    if (!ok || !data?.configured) {
      remixConfig.textContent =
        data?.message ||
        'Not configured — set RUNPOD_API_KEY + RUNPOD_CHARACTER_REMIX_ENDPOINT_ID (RunPod Serverless).';
      return;
    }
    if (data.backend === 'runpod') {
      remixConfig.textContent =
        data.message ||
        `RunPod Serverless ready${data.endpointId ? ` (${data.endpointId})` : ''} — GPU scales from zero.`;
      return;
    }
    remixConfig.textContent =
      data.message ||
      'Debug ComfyUI proxy mode. Production uses RunPod Serverless.';
  }

  function createCard(url, index) {
    const card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.index = String(index);
    card.innerHTML = `
      <p class="result-index">#${index + 1}</p>
      <p class="result-url muted-line">${escapeHtml(url)}</p>
      <p class="download-card-stage muted-line">Queued</p>
      <p class="result-status status"></p>
      <div class="result-actions" hidden></div>
      <video class="result-preview" controls playsinline hidden></video>
    `;
    return card;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setCardStage(card, stage, status) {
    const stageEl = card.querySelector('.download-card-stage');
    const statusEl = card.querySelector('.result-status');
    if (stageEl) stageEl.textContent = stage;
    if (statusEl) statusEl.textContent = status || '';
  }

  function showCardResult(card, { downloadPath, key }) {
    const actions = card.querySelector('.result-actions');
    const video = card.querySelector('.result-preview');
    if (actions) {
      actions.hidden = false;
      actions.innerHTML = '';
      const a = document.createElement('a');
      a.className = 'btn-link';
      a.href = downloadPath;
      a.textContent = 'Download remix';
      a.download = '';
      actions.appendChild(a);
      if (key) {
        const span = document.createElement('span');
        span.className = 'muted-line';
        span.textContent = ` ${key}`;
        actions.appendChild(span);
      }
    }
    if (video && downloadPath) {
      video.hidden = false;
      video.src = downloadPath;
    }
  }

  async function uploadCharacter(file) {
    const form = new FormData();
    form.append('file', file, file.name || 'character.png');
    form.append('prefix', 'characters/');
    const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
    if (!ok || !data?.object?.key) {
      throw new Error(data?.message || data?.error || 'Character upload failed');
    }
    uploadedCharacterKey = data.object.key;
    return uploadedCharacterKey;
  }

  async function downloadTikTok(url) {
    const { ok, data } = await api('/api/contentstation/tiktok-download', {
      method: 'POST',
      body: JSON.stringify({ url, smallerFile: Boolean(smallerNoHd?.checked) }),
    });
    if (!ok || !data?.key) {
      throw new Error(data?.message || data?.error || 'Download failed');
    }
    return data.key;
  }

  async function mediaFetchUrl(key) {
    const { ok, data } = await api(
      `/api/contentstation/media?action=meta&key=${encodeURIComponent(key)}`,
    );
    if (!ok) throw new Error(data?.error || 'Could not resolve media URL');
    const url = data?.object?.fetchUrl || data?.object?.publicUrl;
    if (!url) throw new Error('No public/fetch URL — set R2_PUBLIC_BASE_URL');
    return url;
  }

  async function stripCaptionsGhostCut(videoUrl, sourceKey) {
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit',
        videoUrl,
        options: {
          removeWatermark: true,
          cleanMetadata: false,
          alterAudio: false,
          basicVideoRemix: false,
          remix: false,
          deepAiRemake: false,
          mirror: false,
          sourceKey: sourceKey || null,
        },
      }),
    });
    if (!ok) throw new Error(data?.message || data?.error || 'Caption strip failed to start');
    const workId = data.workId || data.id;
    if (!workId) throw new Error('No GhostCut workId');

    let errors = 0;
    for (;;) {
      if (stopRequested) throw new Error('Stopped');
      await sleep(POLL_MS);
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(st.data?.message || st.data?.error || 'Caption strip status failed');
        }
        continue;
      }
      errors = 0;
      const state = String(st.data?.state || '').toLowerCase();
      if (state === 'failed') {
        throw new Error(st.data?.error || st.data?.message || 'Caption strip failed');
      }
      if (st.data?.cleanedKey) return st.data.cleanedKey;
      if (state === 'ready' && st.data?.downloadUrl) {
        // Wait for auto-archive, or force archive into cleaned/.
        if (st.data.savingToLibrary) continue;
        const arch = await api('/api/contentstation/clean', {
          method: 'POST',
          body: JSON.stringify({
            action: 'archive',
            workId,
            sourceUrl: st.data.downloadUrl,
            sourceKey,
          }),
        });
        if (arch.ok && arch.data?.cleanedKey) return arch.data.cleanedKey;
        // downloadUrl from GhostCut may be absolute — use that key path after one more status
        continue;
      }
    }
  }

  async function runRemix(sourceKey, originalKey, characterKey) {
    const { ok, data } = await api('/api/contentstation/character-remix', {
      method: 'POST',
      body: JSON.stringify({
        action: 'run',
        sourceKey,
        originalKey,
        characterKey,
        options: {
          characterStrength: Number(characterStrength?.value || 0.9),
          sceneRestyleStrength: Number(sceneRestyle?.value || 0.85),
          preserveAudio: Boolean(preserveAudio?.checked),
          discardSpeechCaptions: Boolean(stripCaptions?.checked),
          restoreNonSpeechText: Boolean(restoreHooks?.checked),
          enableSceneRestyle: true,
        },
      }),
    });
    if (!ok || !data?.jobId) {
      throw new Error(data?.message || data?.error || 'Remix submit failed');
    }
    if (data.backend) activeBackend = data.backend;
    return { jobId: data.jobId, backend: data.backend || activeBackend };
  }

  /** Cap rough ETA display so it never looks absurdly precise or endless. */
  const ETA_DISPLAY_MAX_MIN = 55;
  const ETA_CHUNK_COLD_LO = 8;
  const ETA_CHUNK_COLD_HI = 15;
  const ETA_CHUNK_WARM_LO = 6;
  const ETA_CHUNK_WARM_HI = 12;
  const ETA_STITCH_MIN = 1.5;

  function createEtaTracker() {
    return {
      startedAt: Date.now(),
      firstChunkAt: null,
      lastChunk: null,
      lastChunks: null,
      chunkStartAt: null,
      /** @type {number[]} ms for fully completed chunks */
      completedDurations: [],
    };
  }

  function clampEtaMin(n) {
    return Math.max(1, Math.min(ETA_DISPLAY_MAX_MIN, Math.round(n)));
  }

  /** Rough minutes only — never invent seconds. */
  function formatEtaPhrase(lo, hi) {
    let a = clampEtaMin(lo);
    let b = clampEtaMin(hi);
    if (b < a) b = a;
    if (a === b) return `~${a} min left`;
    if (b - a <= 3 && b <= 5) return `~${a}–${b} min left`;
    return `Est. ~${a}–${b} min remaining`;
  }

  function remixStageLabel(progress) {
    if (!progress) return null;
    const stage = String(progress.stage || '').toLowerCase();
    const chunk = Number(progress.chunk);
    const chunks = Number(progress.chunks || progress.chunkCount);
    const hasChunks =
      Number.isFinite(chunk) && chunk >= 1 && Number.isFinite(chunks) && chunks >= 1;

    if (stage.includes('segment')) return 'Splitting into chunks';
    if (stage.includes('character_and_scene') || (stage.includes('scene') && stage.includes('restyl'))) {
      return hasChunks ? `Character + scenery ${chunk}/${chunks}` : 'Character + scenery';
    }
    if (stage.includes('scene') && !stage.includes('character')) {
      return hasChunks ? `Character + scenery ${chunk}/${chunks}` : 'Character + scenery';
    }
    if (stage.includes('character')) {
      return hasChunks ? `Character replace ${chunk}/${chunks}` : 'Character replace';
    }
    if (stage.includes('stitch')) return 'Stitching';
    if (stage.includes('audio')) return 'Remuxing audio';
    if (stage.includes('upload')) return 'Uploading';
    if (stage.includes('download')) return 'Downloading media';
    if (stage === 'done') return 'Finalizing';
    if (progress.message) {
      return String(progress.message)
        .replace(/\s*…\s*$/, '')
        .replace(/\s*\.\s*$/, '');
    }
    return stage || null;
  }

  function noteChunkProgress(progress, tracker) {
    const chunk = Number(progress?.chunk);
    const chunks = Number(progress?.chunks || progress?.chunkCount);
    if (!Number.isFinite(chunk) || chunk < 1 || !Number.isFinite(chunks) || chunks < 1) return;
    const now = Date.now();
    if (!tracker.firstChunkAt) tracker.firstChunkAt = now;
    if (tracker.lastChunk != null && chunk > tracker.lastChunk && tracker.chunkStartAt) {
      tracker.completedDurations.push(now - tracker.chunkStartAt);
    }
    if (tracker.lastChunk !== chunk) {
      tracker.lastChunk = chunk;
      tracker.lastChunks = chunks;
      tracker.chunkStartAt = now;
    } else if (tracker.lastChunks !== chunks) {
      tracker.lastChunks = chunks;
    }
  }

  /**
   * Pragmatic ETA from RunPod status + stage/chunk progress.
   * Returns a short phrase (no leading separator).
   */
  function estimateRemixEta(progress, status, tracker) {
    const now = Date.now();
    const elapsedMin = (now - tracker.startedAt) / 60000;
    const st = String(status || '').toUpperCase();
    const stage = String(progress?.stage || '').toLowerCase();
    const queued =
      !progress ||
      !stage ||
      st === 'IN_QUEUE' ||
      st === 'QUEUED' ||
      st === 'PENDING';

    noteChunkProgress(progress, tracker);

    if (stage.includes('stitch') || stage.includes('audio') || stage.includes('upload') || stage === 'done') {
      // Shrink as finishing steps run.
      if (elapsedMin > 0 && stage.includes('upload')) return '~1 min left';
      return formatEtaPhrase(1, 2);
    }

    if (queued) {
      if (elapsedMin < 1.5) return 'often 2–10 min cold start';
      if (elapsedMin < 10) {
        return formatEtaPhrase(Math.max(1, 2 - elapsedMin * 0.2), Math.max(3, 10 - elapsedMin));
      }
      return 'still starting… GPU cold starts vary';
    }

    const chunk = Number(progress?.chunk);
    const chunks = Number(progress?.chunks || progress?.chunkCount);
    const hasChunks =
      Number.isFinite(chunk) && chunk >= 1 && Number.isFinite(chunks) && chunks >= 1;

    if (stage.includes('segment') || stage.includes('download')) {
      const assumed = hasChunks ? chunks : 3;
      return formatEtaPhrase(assumed * ETA_CHUNK_WARM_LO + ETA_STITCH_MIN, assumed * ETA_CHUNK_COLD_HI + 2);
    }

    if (hasChunks) {
      const remainingChunks = Math.max(1, chunks - chunk + 1);
      const warm = st === 'IN_PROGRESS' || st === 'RUNNING';
      const onChunkMin = tracker.chunkStartAt ? (now - tracker.chunkStartAt) / 60000 : 0;

      if (tracker.completedDurations.length > 0) {
        const avgMin =
          tracker.completedDurations.reduce((a, b) => a + b, 0) /
          tracker.completedDurations.length /
          60000;
        const per = Math.max(2, Math.min(20, avgMin));
        const currentLeft = Math.max(0.75, per - onChunkMin);
        const others = Math.max(0, remainingChunks - 1) * per;
        const total = currentLeft + others + ETA_STITCH_MIN;
        return formatEtaPhrase(total * 0.85, Math.min(ETA_DISPLAY_MAX_MIN, total * 1.2));
      }

      // First chunk(s): cold heuristic, tighten once we've been on a chunk a while.
      let loPer = warm ? ETA_CHUNK_WARM_LO : ETA_CHUNK_COLD_LO;
      let hiPer = warm ? ETA_CHUNK_WARM_HI : ETA_CHUNK_COLD_HI;
      if (onChunkMin >= 5) {
        loPer = Math.max(4, loPer - 2);
        hiPer = Math.max(loPer + 2, hiPer - 2);
      }
      let lo = remainingChunks * loPer + ETA_STITCH_MIN;
      let hi = remainingChunks * hiPer + 2;
      // Credit time already spent on the current chunk.
      if (onChunkMin > 1) {
        lo = Math.max(1, lo - onChunkMin * 0.6);
        hi = Math.max(lo + 1, hi - onChunkMin * 0.5);
      }
      return formatEtaPhrase(lo, hi);
    }

    // In progress but no chunk numbers yet.
    if (st === 'IN_PROGRESS' || st === 'RUNNING') {
      const rem = Math.max(5, 22 - elapsedMin);
      return formatEtaPhrase(Math.min(rem, 12), Math.min(ETA_DISPLAY_MAX_MIN, rem + 10));
    }

    return 'often 2–10 min cold start';
  }

  /** Stage line for result cards: “Character + scenery 1/2 · ~12 min left”. */
  function formatRemixCardProgress(progress, status, tracker) {
    const st = String(status || '').toUpperCase();
    const label = remixStageLabel(progress);
    const eta = estimateRemixEta(progress, status, tracker);
    const queued =
      !label ||
      st === 'IN_QUEUE' ||
      st === 'QUEUED' ||
      st === 'PENDING';

    if (queued && (!progress || !progress.stage)) {
      return { stageLine: `Starting GPU… ${eta}`, detail: '' };
    }
    if (!label) {
      return { stageLine: `Working · ${eta}`, detail: progress?.note || '' };
    }
    return { stageLine: `${label} · ${eta}`, detail: progress?.note || '' };
  }

  async function pollRemix(jobId, onProgress) {
    let errors = 0;
    const started = Date.now();
    for (;;) {
      if (stopRequested) throw new Error('Stopped');
      if (Date.now() - started > MAX_REMIX_POLL_MS) {
        throw new Error(
          'Remix timed out after 45 minutes with no usable result. Refresh and retry — the GPU job may have finished or vanished.',
        );
      }
      await sleep(POLL_MS);
      const st = await api(
        `/api/contentstation/character-remix?action=status&jobId=${encodeURIComponent(jobId)}`,
      );
      if (!st.ok) {
        // Missing job / gone — fail immediately (do not soft-retry into a hang).
        if (st.status === 404 || st.data?.error === 'job_not_found') {
          throw new Error(
            st.data?.message ||
              'RunPod job not found (finished, expired, or never submitted). Refresh and retry.',
          );
        }
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(st.data?.message || st.data?.error || 'Remix status failed');
        }
        continue;
      }
      errors = 0;
      const status = String(st.data?.status || '').toUpperCase();
      if (typeof onProgress === 'function') {
        onProgress(st.data?.progress || null, status);
      }
      if (
        status === 'FAILED' ||
        status === 'CANCELLED' ||
        status === 'TIMED_OUT' ||
        status === '404' ||
        st.data?.error === 'job_not_found'
      ) {
        throw new Error(st.data?.message || st.data?.error || `Remix ${status || 'FAILED'}`);
      }
      if (status === 'COMPLETED' && st.data?.error === 'no_output_video') {
        throw new Error('Remix finished but no output video was found');
      }
      if (status === 'COMPLETED' && st.data?.error && !st.data?.videoUrl && !st.data?.remixReady) {
        throw new Error(st.data?.message || st.data?.error || 'Remix failed');
      }
      if (status === 'COMPLETED' && st.data?.videoUrl) {
        return {
          videoUrl: st.data.videoUrl,
          archivedKey: st.data.archivedKey || null,
          downloadPath: st.data.downloadPath || null,
          progress: st.data.progress || null,
          note: st.data.progress?.note || null,
        };
      }
      if (st.data?.remixReady && st.data?.videoUrl) {
        return {
          videoUrl: st.data.videoUrl,
          archivedKey: st.data.archivedKey || null,
          downloadPath: st.data.downloadPath || null,
          progress: st.data.progress || null,
          note: st.data.progress?.note || null,
        };
      }
      if (st.data?.remixReady && st.data?.videoBase64) {
        return {
          videoUrl: null,
          videoBase64: st.data.videoBase64,
          videoMime: st.data.videoMime || 'video/mp4',
          archivedKey: null,
          progress: st.data.progress || null,
          note: st.data.progress?.note || null,
        };
      }
      if (st.data?.remixReady && st.data?.downloadPath && st.data?.archivedKey) {
        return {
          videoUrl: st.data.videoUrl || st.data.downloadPath,
          archivedKey: st.data.archivedKey,
          downloadPath: st.data.downloadPath,
          progress: st.data.progress || null,
          note: st.data.progress?.note || null,
        };
      }
      // COMPLETED without video/remixReady used to loop forever on "Processing…".
      if (status === 'COMPLETED') {
        throw new Error(
          st.data?.message ||
            st.data?.error ||
            'Remix completed but no output video was returned. Refresh and retry.',
        );
      }
      // Empty/unknown non-terminal status — count toward soft errors, then fail clearly.
      if (!status || !['IN_QUEUE', 'IN_PROGRESS', 'QUEUED', 'RUNNING', 'PENDING'].includes(status)) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(
            st.data?.message ||
              `Remix status stuck (${status || 'empty'}). Job may be gone — refresh and retry.`,
          );
        }
      }
    }
  }

  async function saveRemix(videoRef, sourceKey, jobId, tiktokUrl) {
    const payload = {
      action: 'save',
      sourceKey,
      runpodJobId: jobId,
      jobId,
      filename: sourceKey,
      tiktokUrl: tiktokUrl || null,
    };
    if (typeof videoRef === 'string') {
      payload.videoUrl = videoRef;
    } else if (videoRef?.videoBase64) {
      payload.videoBase64 = videoRef.videoBase64;
      payload.videoMime = videoRef.videoMime || 'video/mp4';
    } else if (videoRef?.archivedKey) {
      // Already archived during status poll (base64 materialize).
      const path =
        videoRef.downloadPath ||
        `/api/contentstation/media?action=get&key=${encodeURIComponent(videoRef.archivedKey)}`;
      return { ok: true, key: videoRef.archivedKey, downloadPath: path, publicUrl: videoRef.videoUrl || null };
    } else if (videoRef?.videoUrl) {
      payload.videoUrl = videoRef.videoUrl;
    } else {
      throw new Error('No remix video to save');
    }
    const { ok, data } = await api('/api/contentstation/character-remix', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!ok || !data?.key) {
      throw new Error(data?.message || data?.error || 'Could not save remix to library');
    }
    return data;
  }

  function ghostcutWorkId(data) {
    const list = data?.body?.dataList;
    if (Array.isArray(list) && list[0]?.id != null) return String(list[0].id);
    return data?.workId || data?.id || null;
  }

  async function ghostcutFree(payload) {
    const { ok, data } = await api('/api/contentstation/ghostcut/v-w-c/gateway/ve/work/free', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!ok || (data?.code != null && Number(data.code) !== 1000)) {
      throw new Error(data?.msg || data?.message || data?.error || 'GhostCut submit failed');
    }
    const workId = ghostcutWorkId(data);
    if (!workId) throw new Error('GhostCut returned no work id');
    return workId;
  }

  async function ghostcutPoll(workId, { wantSrt = false, wantVideo = false } = {}) {
    const deadline = Date.now() + 12 * 60 * 1000;
    let errors = 0;
    while (Date.now() < deadline) {
      if (stopRequested) throw new Error('Stopped');
      await sleep(POLL_MS);
      const { ok, data } = await api('/api/contentstation/ghostcut/v-w-c/gateway/ve/work/status', {
        method: 'POST',
        body: JSON.stringify({
          idWorks: [/^\d+$/.test(workId) ? Number(workId) : workId],
        }),
      });
      if (!ok) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(data?.msg || data?.error || 'GhostCut status failed');
        }
        continue;
      }
      errors = 0;
      const content = Array.isArray(data?.body?.content) ? data.body.content[0] : null;
      const status = Number(content?.processStatus);
      if (status === 1) {
        if (wantSrt) {
          const srt = content?.srcSrtUrl || content?.tgtSrtUrl;
          if (srt) return { srtUrl: srt, content };
          throw new Error('GhostCut finished but no SRT URL');
        }
        if (wantVideo) {
          const videoUrl = content?.videoUrl || content?.videoUrlOut;
          if (videoUrl) return { videoUrl, content };
          throw new Error('GhostCut finished but no video URL');
        }
        return { content };
      }
      if (Number.isFinite(status) && status > 1) {
        throw new Error(content?.errorMsg || content?.msg || `GhostCut failed (${status})`);
      }
    }
    throw new Error('GhostCut timed out');
  }

  /** OCR hooks from original − ASR speech → burn onto remixed MP4 (GhostCut). */
  async function restoreHooksAfterRemix(saved, originalKey, jobId, tiktokUrl) {
    const remixUrl = saved.publicUrl || (await mediaFetchUrl(saved.key));
    const { ok, data: payloads } = await api('/api/contentstation/character-remix', {
      method: 'POST',
      body: JSON.stringify({
        action: 'hooks-payloads',
        originalKey,
        remixKey: saved.key,
        remixVideoUrl: remixUrl,
      }),
    });
    if (!ok || !payloads?.ocr || !payloads?.asr) {
      throw new Error(payloads?.message || payloads?.error || 'Could not build hook payloads');
    }

    const ocrWorkId = await ghostcutFree(payloads.ocr);
    let asrWorkId = null;
    try {
      asrWorkId = await ghostcutFree(payloads.asr);
    } catch {
      asrWorkId = null;
    }

    const ocrDone = await ghostcutPoll(ocrWorkId, { wantSrt: true });
    let asrSrtUrl = null;
    if (asrWorkId) {
      try {
        const asrDone = await ghostcutPoll(asrWorkId, { wantSrt: true });
        asrSrtUrl = asrDone.srtUrl;
      } catch {
        asrSrtUrl = null;
      }
    }

    const prepared = await api('/api/contentstation/character-remix', {
      method: 'POST',
      body: JSON.stringify({
        action: 'prepare-hooks-srt',
        ocrSrtUrl: ocrDone.srtUrl,
        asrSrtUrl,
        runId: jobId,
      }),
    });
    if (!prepared.ok) {
      throw new Error(prepared.data?.error || 'Could not prepare hooks SRT');
    }
    if (prepared.data?.skipped) {
      return {
        ...saved,
        hooksSkipped: true,
        hooksReason: prepared.data.reason || 'no_non_speech_text',
      };
    }

    const burnPayload = burnHooksPayloadClient(
      payloads.remixVideoUrl || remixUrl,
      prepared.data.srtUrl,
      payloads.sourceLang || 'en',
    );
    const burnWorkId = await ghostcutFree(burnPayload);
    const burned = await ghostcutPoll(burnWorkId, { wantVideo: true });
    return saveRemix(burned.videoUrl, originalKey, `hooks:${jobId}`, tiktokUrl);
  }

  function burnHooksPayloadClient(videoUrl, srtUrl, lang) {
    return {
      urls: [videoUrl],
      sourceLang: lang,
      lang,
      needWanyin: 1,
      wyTaskType: 'NO_TTS',
      wyNeedText: 1,
      removeBgAudio: 0,
      wyVoiceParam: JSON.stringify({
        font_param: {
          style: 'tpl-31-1-T',
          font_size: 36,
          position: 0.22,
          subtitleLang: lang,
        },
      }),
      extraOptions: JSON.stringify({
        customer_input_srt: { source: srtUrl, translation: srtUrl },
      }),
    };
  }

  /** Light uniquify via CloudConvert alter-audio (clean API, no GhostCut). */
  async function uniquifyAlterAudio(videoUrl, sourceKey) {
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit',
        videoUrl,
        options: {
          removeWatermark: false,
          // Alter-audio path always strips map_metadata in CloudConvert (clean pipeline).
          cleanMetadata: true,
          alterAudio: true,
          basicVideoRemix: false,
          remix: false,
          deepAiRemake: false,
          mirror: false,
          sourceKey: sourceKey || null,
        },
      }),
    });
    if (!ok) {
      throw new Error(data?.message || data?.error || 'Alter-audio uniquify failed to start');
    }
    const workId = data.workId || data.id;
    if (!workId) throw new Error('No uniquify workId');

    let errors = 0;
    for (;;) {
      if (stopRequested) throw new Error('Stopped');
      await sleep(POLL_MS);
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(st.data?.message || st.data?.error || 'Uniquify status failed');
        }
        continue;
      }
      errors = 0;
      const state = String(st.data?.state || '').toLowerCase();
      if (state === 'failed') {
        throw new Error(st.data?.error || st.data?.message || 'Uniquify failed');
      }
      if (st.data?.cleanedKey) {
        return {
          key: st.data.cleanedKey,
          downloadPath:
            st.data.downloadPath ||
            `/api/contentstation/media?action=get&key=${encodeURIComponent(st.data.cleanedKey)}`,
          publicUrl: st.data.publicUrl || null,
        };
      }
      if (state === 'ready' && st.data?.downloadUrl) {
        if (st.data.savingToLibrary) continue;
        // Re-archive uniquified file into character-remix/
        const saved = await saveRemix(st.data.downloadUrl, sourceKey, `uniquify:${workId}`);
        return saved;
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Poll → save → optional uniquify for a job that already has a RunPod/Comfy id.
   * Used by fresh batches and by refresh-resume.
   */
  async function finishRemixJob({
    jobId,
    card,
    url,
    sourceKey,
    originalKey,
    startedAt,
    backend,
    doAlterAudio,
    doRestoreHooks,
  }) {
    const label = backend === 'comfyui' ? 'ComfyUI remix (debug)' : 'Full remix';
    const etaTracker = createEtaTracker();
    if (startedAt && Number.isFinite(Number(startedAt))) {
      etaTracker.startedAt = Number(startedAt);
    }
    setCardStage(card, 'Starting GPU… often 2–10 min cold start', `${label} · job ${jobId}`);
    const remixOut = await pollRemix(jobId, (progress, status) => {
      const { stageLine, detail } = formatRemixCardProgress(progress, status, etaTracker);
      setCardStage(card, stageLine, detail || `${label} · job ${jobId}`);
    });

    if (stopRequested) throw new Error('Stopped');
    setCardStage(card, 'Saving', 'Archiving final MP4…');
    let saved = await saveRemix(remixOut, originalKey || sourceKey, jobId, url);

    const restoreOn = doRestoreHooks !== undefined ? doRestoreHooks : Boolean(restoreHooks?.checked);
    if (restoreOn && originalKey) {
      if (stopRequested) throw new Error('Stopped');
      setCardStage(card, 'Restoring hooks', 'OCR hooks from original − speech, burn onto remix…');
      try {
        saved = await restoreHooksAfterRemix(saved, originalKey, jobId, url);
      } catch (err) {
        setCardStage(
          card,
          'Hooks skipped',
          `Remix kept without hooks: ${err?.message || err}`,
        );
      }
    }

    if (doAlterAudio) {
      if (stopRequested) throw new Error('Stopped');
      setCardStage(card, 'Uniquify', 'Light audio alter (CloudConvert)…');
      const fetchUrl = saved.publicUrl || (await mediaFetchUrl(saved.key));
      try {
        saved = await uniquifyAlterAudio(fetchUrl, originalKey || sourceKey);
      } catch (err) {
        setCardStage(card, 'Done', `Remix ready (uniquify skipped: ${err?.message || err})`);
        showCardResult(card, saved);
        removeActiveJob(jobId);
        return saved;
      }
    }

    const doneDetail = remixOut?.note
      ? `Remix ready — ${remixOut.note}`
      : 'Remix ready';
    setCardStage(card, 'Done', doneDetail);
    showCardResult(card, saved);
    removeActiveJob(jobId);
    return saved;
  }

  async function processOne(url, card, characterKey, index) {
    setCardStage(card, 'Downloading', 'Fetching TikTok…');
    const originalKey = await downloadTikTok(url);
    if (stopRequested) throw new Error('Stopped');

    let sourceKey = originalKey;
    if (stripCaptions?.checked) {
      setCardStage(card, 'Stripping captions', 'GhostCut OCR erase (speech captions)…');
      const videoUrl = await mediaFetchUrl(originalKey);
      sourceKey = await stripCaptionsGhostCut(videoUrl, originalKey);
    }

    if (stopRequested) throw new Error('Stopped');
    const backendLabel = activeBackend === 'comfyui' ? 'ComfyUI remix (debug)' : 'Full remix';
    setCardStage(card, backendLabel, 'Submitting segment → character → scenery → stitch…');
    const { jobId, backend } = await runRemix(sourceKey, originalKey, characterKey);
    if (backend) activeBackend = backend;
    const startedAt = Date.now();
    upsertActiveJob({
      jobId,
      url,
      sourceKey,
      originalKey,
      characterKey,
      startedAt,
      backend: backend || activeBackend,
      alterAudio: Boolean(alterAudio?.checked),
      restoreHooks: Boolean(restoreHooks?.checked),
      index: index ?? 0,
    });

    try {
      return await finishRemixJob({
        jobId,
        card,
        url,
        sourceKey,
        originalKey,
        startedAt,
        backend: backend || activeBackend,
        doAlterAudio: Boolean(alterAudio?.checked),
        doRestoreHooks: Boolean(restoreHooks?.checked),
      });
    } catch (err) {
      // Keep active job so refresh can resume, unless the GPU job is clearly gone.
      if (isTerminalRemixError(err)) removeActiveJob(jobId);
      throw err;
    }
  }

  function isTerminalRemixError(err) {
    const msg = String(err?.message || err || '');
    if (!msg || msg === 'Stopped') return false;
    return (
      /job not found/i.test(msg) ||
      /timed out after 45/i.test(msg) ||
      /no output video/i.test(msg) ||
      /\bCANCELLED\b/i.test(msg) ||
      /\bTIMED_OUT\b/i.test(msg) ||
      /\bFAILED\b/i.test(msg)
    );
  }

  async function resumeActiveJobs() {
    if (resumeActive || batchActive) return;
    const jobs = loadActiveJobs();
    if (!jobs.length) return;

    resumeActive = true;
    stopRequested = false;
    if (remixBtn) remixBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;
    if (results) {
      results.hidden = false;
      // Keep any in-DOM cards; append resume cards if empty or missing job cards.
    }

    const sorted = [...jobs].sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
    setStatus(
      `Resuming ${sorted.length} remix job${sorted.length === 1 ? '' : 's'}…`,
      'Progress survived refresh — polling GPU until done',
    );

    let failures = 0;
    let inFlight = 0;
    let next = 0;

    await new Promise((resolve) => {
      const pump = () => {
        if (stopRequested && inFlight === 0) {
          resolve();
          return;
        }
        while (!stopRequested && inFlight < MAX_RUNPOD_IN_FLIGHT && next < sorted.length) {
          const job = sorted[next++];
          const card = createCard(job.url || job.jobId, job.index ?? next - 1);
          card.dataset.jobId = job.jobId;
          results.appendChild(card);
          inFlight += 1;
          if (job.backend) activeBackend = job.backend;
          finishRemixJob({
            jobId: job.jobId,
            card,
            url: job.url || '',
            sourceKey: job.sourceKey || job.originalKey || '',
            originalKey: job.originalKey || job.sourceKey || '',
            startedAt: job.startedAt,
            backend: job.backend || activeBackend,
            doAlterAudio: Boolean(job.alterAudio),
            doRestoreHooks:
              job.restoreHooks !== undefined
                ? Boolean(job.restoreHooks)
                : Boolean(restoreHooks?.checked),
          })
            .catch((err) => {
              failures += 1;
              setCardStage(card, 'Failed', err?.message || String(err));
              card.classList.add('is-failed');
              if (isTerminalRemixError(err)) removeActiveJob(job.jobId);
            })
            .finally(() => {
              inFlight -= 1;
              if (next >= sorted.length && inFlight === 0) resolve();
              else pump();
            });
        }
        if (next >= sorted.length && inFlight === 0) resolve();
      };
      pump();
    });

    if (stopRequested) setStatus('Stopped. Active jobs kept for next visit.');
    else if (failures) setStatus(`Resumed with ${failures} failure(s).`);
    else setStatus('Resumed jobs finished.');
    resumeActive = false;
    if (!batchActive) {
      if (remixBtn) remixBtn.disabled = false;
      if (stopBtn) stopBtn.hidden = true;
    }
  }

  async function runBatch() {
    if (batchActive || resumeActive) return;
    setError('');
    const urls = parseUrls(urlsInput?.value);
    if (!urls.length) {
      setError('Paste at least one TikTok URL.');
      return;
    }
    const file = characterFile?.files?.[0];
    if (!file && !uploadedCharacterKey) {
      setError('Choose a character image.');
      return;
    }

    batchActive = true;
    stopRequested = false;
    remixBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;
    results.hidden = false;
    results.innerHTML = '';

    try {
      setStatus('Uploading character…');
      const characterKey = file ? await uploadCharacter(file) : uploadedCharacterKey;
      if (!characterKey) throw new Error('Character upload missing key');

      const cards = urls.map((u, i) => {
        const card = createCard(u, i);
        results.appendChild(card);
        return { url: u, card, index: i };
      });

      let inFlight = 0;
      let next = 0;
      let failures = 0;

      await new Promise((resolve) => {
        const pump = () => {
          if (stopRequested && inFlight === 0) {
            resolve();
            return;
          }
          while (!stopRequested && inFlight < MAX_RUNPOD_IN_FLIGHT && next < cards.length) {
            const item = cards[next++];
            inFlight += 1;
            setStatus(
              `Remixing ${next} / ${cards.length}…`,
              `Up to ${MAX_RUNPOD_IN_FLIGHT} ${activeBackend === 'comfyui' ? 'ComfyUI' : 'remix'} jobs at a time`,
            );
            processOne(item.url, item.card, characterKey, item.index)
              .catch((err) => {
                failures += 1;
                setCardStage(item.card, 'Failed', err?.message || String(err));
                item.card.classList.add('is-failed');
              })
              .finally(() => {
                inFlight -= 1;
                if (next >= cards.length && inFlight === 0) resolve();
                else pump();
              });
          }
          if (next >= cards.length && inFlight === 0) resolve();
        };
        pump();
      });

      if (stopRequested) setStatus('Stopped. In-flight remix jobs will resume if you refresh.');
      else if (failures) setStatus(`Finished with ${failures} failure(s).`);
      else setStatus('All remixed.');
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed.');
    } finally {
      batchActive = false;
      remixBtn.disabled = false;
      if (stopBtn) stopBtn.hidden = true;
    }
  }

  characterFile?.addEventListener('change', () => {
    uploadedCharacterKey = null;
    const file = characterFile.files?.[0];
    if (!file || !characterPreview || !characterPreviewWrap) return;
    const url = URL.createObjectURL(file);
    characterPreview.src = url;
    characterPreviewWrap.hidden = false;
    if (characterMeta) {
      characterMeta.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    }
  });

  urlsInput?.addEventListener('input', updateUrlCount);
  remixBtn?.addEventListener('click', () => void runBatch());
  stopBtn?.addEventListener('click', () => {
    stopRequested = true;
    setStatus('Stopping after current step…');
  });

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
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

  bindSliders();
  updateUrlCount();
  void refreshSession();
})();
