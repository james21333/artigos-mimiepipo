(function () {
  const cfg = window.CSTalkingTest || {};
  const VARIANT = cfg.variant || 'talking-heads-v3';
  const PAGE_ID = cfg.pageId || 'tiktok-download-character-remix-2-og-v3';
  const TITLE_DEFAULT = cfg.title || 'Talking Heads V3';
  const STORAGE_KEY = cfg.storageKey || 'cs_talking_heads_v3_test_v1';
  const TEST_URL = cfg.testUrl || 'https://www.tiktok.com/t/ZTDtNMRRM';
  const TEST_ACCOUNT = cfg.testAccount || '1-GLP- 20.YOUTUBE 1';
  const POLL_MS = 4000;
  const SHOW_SCENES = Boolean(cfg.showScenes);
  /** After Johnny stitch: light GhostCut remaker + CloudConvert metadata/audio. */
  const POST_CLEAN = cfg.postClean && typeof cfg.postClean === 'object' ? cfg.postClean : null;
  const POST_CLEAN_OPTS = POST_CLEAN
    ? {
        removeWatermark: false,
        cleanMetadata: POST_CLEAN.cleanMetadata !== false,
        alterAudio: POST_CLEAN.alterAudio !== false,
        basicVideoRemix: POST_CLEAN.basicVideoRemix !== false,
        remix: false,
        deepAiRemake: false,
        mirror: false,
      }
    : null;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const errorEl = document.getElementById('talking-test-error');
  const tiktokUrls = document.getElementById('tiktok-urls');
  const titleInput = document.getElementById('job-title');
  const adsStrictEl = document.getElementById('ads-strict-copy');
  const runBtn = document.getElementById('run-btn');
  const transcriptEl = document.getElementById('transcript-box');
  const scenesEl = document.getElementById('scenes-box');
  const outputGallery = document.getElementById('output-gallery');
  const batchList = document.getElementById('batch-list');

  let publicBaseUrl = '';
  let accountsCache = [];
  let batchJobs = [];
  let pollTimer = null;
  let submitting = false;

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
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  const accountsUi =
    window.CSRemix2Accounts &&
    window.CSRemix2Accounts.createController({
      api,
      getPublicBaseUrl: () => publicBaseUrl,
      onError: (msg) => setError(msg),
    });

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || '';
  }

  function setStatus(main, detail) {
    if (statusLine) statusLine.textContent = main || '';
    if (statusDetail) {
      statusDetail.hidden = !detail;
      statusDetail.textContent = detail || '';
    }
  }

  function saveBatch() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(batchJobs));
    } catch {
      /* ignore */
    }
  }

  function loadBatch() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      batchJobs = Array.isArray(arr) ? arr.filter((j) => j && j.jobId) : [];
    } catch {
      batchJobs = [];
    }
  }

  function parseUrls(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  function mediaFinalPath(jobId) {
    const key = `character-remix-2-og/${jobId}/final.mp4`;
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function resolveFinalUrl(job, data) {
    return data?.output_url || data?.outputUrl || job?.outputUrl || mediaFinalPath(job?.jobId);
  }

  function renderTranscript(data) {
    if (!transcriptEl) return;
    const text = data?.transcript || '';
    const scenes = data?.scenes || [];
    const lines = [];
    if (text) lines.push(text);
    for (const s of scenes) {
      if (s.dialogue) lines.push(`${s.id || s.title || 'scene'}: “${s.dialogue}”`);
    }
    transcriptEl.hidden = !lines.length;
    transcriptEl.textContent = lines.join('\n\n');
  }

  function renderScenes(data) {
    if (!scenesEl || !SHOW_SCENES) return;
    const scenes = data?.scenes || [];
    scenesEl.innerHTML = '';
    scenesEl.hidden = !scenes.length;
    for (const s of scenes) {
      const card = document.createElement('article');
      card.className = 'url-list-item talking-scene-card';
      const vis = s.handsVision || {};
      const winner = vis.winner || data?.handsVisionWinner || '';
      card.innerHTML = `
        <div>
          <strong>${s.id || s.title || 'scene'}</strong>
          <p class="muted-line">${s.dialogue ? `Dialogue: ${s.dialogue}` : 'No dialogue yet'}</p>
          <p class="muted-line">Setting: ${s.setting || '—'}</p>
          <p class="muted-line">Camera: ${s.cameraMovement || s.camera || '—'}</p>
          <p class="muted-line">Bridge: ${s.continuityKind || '—'} — ${s.emotion || s.continuityBridge || '—'}</p>
          <p class="muted-line">Left hand: ${s.leftHand || '—'} · Right hand: ${s.rightHand || '—'}</p>
          <p class="muted-line">Products: ${(s.products || []).join(', ') || '—'}</p>
          <p class="muted-line">Scene read winner: ${winner || 'pending'} (OpenAI vs Grok)</p>
          ${s.productPrompt ? `<p class="muted-line">Product still prompt: ${s.productPrompt}</p>` : ''}
          <label>Manual scene note / redo prompt
            <textarea data-scene-id="${s.id || ''}" rows="2" placeholder="Optional: rewrite this scene or describe the product">${s.userPrompt || ''}</textarea>
          </label>
        </div>`;
      scenesEl.appendChild(card);
    }
  }

  function publicFinalUrl(job, data) {
    const direct = data?.output_url || data?.outputUrl || job?.outputUrl || '';
    if (/^https?:\/\//i.test(direct)) return direct;
    if (publicBaseUrl && job?.jobId) {
      return `${publicBaseUrl.replace(/\/$/, '')}/character-remix-2-og/${job.jobId}/final.mp4`;
    }
    return '';
  }

  function renderFinal(job, data) {
    if (!outputGallery || !job?.jobId) return;
    const cleanedUrl = job.cleanedDownloadPath || job.cleanedPublicUrl || '';
    const url = cleanedUrl || resolveFinalUrl(job, data);
    const ready =
      Boolean(cleanedUrl) ||
      data?.stage === 'stitched' ||
      data?.outputUploaded ||
      job?.outputUrl;
    if (!ready || !url) {
      if (!outputGallery.children.length) outputGallery.hidden = true;
      return;
    }
    outputGallery.hidden = false;
    let card = outputGallery.querySelector(`[data-final-job="${job.jobId}"]`);
    if (!card) {
      card = document.createElement('article');
      card.className = 'download-result-card';
      card.dataset.finalJob = job.jobId;
      outputGallery.appendChild(card);
    }
    const idx = [...outputGallery.querySelectorAll('[data-final-job]')].indexOf(card) + 1;
    const label = cleanedUrl
      ? `Voice Mod final ${idx}`
      : POST_CLEAN_OPTS
        ? `Raw Johnny ${idx} (cleaning…)`
        : `Test final ${idx}`;
    const cleanNote = job.postCleanError
      ? `<p class="error">${job.postCleanError}</p>`
        : job.postCleanWorkId && !cleanedUrl
        ? `<p class="muted-line">Post-clean: metadata + alter audio… (${job.postCleanWorkId})</p>`
        : cleanedUrl
          ? `<p class="muted-line">Post-clean done (metadata + alter audio)</p>`
          : '';
    card.innerHTML = `<h2>${label}</h2>
      <p class="muted-line">${job.jobId} · ${VARIANT}</p>
      ${cleanNote}
      <video src="${url}" controls playsinline preload="metadata" class="result-preview"></video>
      <p class="result-actions"><a class="btn-link" href="${url}" target="_blank" rel="noopener">Open MP4</a></p>`;
  }

  async function runPostClean(job, data) {
    if (!POST_CLEAN_OPTS || job.postCleanDone || job.postCleanStarted) return;
    const videoUrl = publicFinalUrl(job, data);
    if (!videoUrl) {
      job.postCleanError = 'No public final URL for post-clean.';
      saveBatch();
      renderFinal(job, data);
      return;
    }
    job.postCleanStarted = true;
    saveBatch();
    setStatus('Johnny done — starting light clean…', job.jobId);
    try {
      const { ok, data: sub } = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          videoUrl,
          options: {
            ...POST_CLEAN_OPTS,
            account: job.account || null,
            sourceKey: `character-remix-2-og/${job.jobId}/final.mp4`,
          },
        }),
      });
      if (!ok || !(sub?.workId || sub?.id)) {
        throw new Error(sub?.message || sub?.error || 'Post-clean submit failed');
      }
      job.postCleanWorkId = sub.workId || sub.id;
      job.postCleanError = '';
      saveBatch();
      await pollPostClean(job);
    } catch (err) {
      job.postCleanError = err?.message || String(err);
      job.postCleanStarted = false;
      saveBatch();
      setError(job.postCleanError);
      renderFinal(job, data || { stage: job.stage });
    }
  }

  async function pollPostClean(job) {
    const workId = job.postCleanWorkId;
    if (!workId) return;
    let errors = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok) {
        errors += 1;
        if (errors >= 8) {
          job.postCleanError = st.data?.message || st.data?.error || 'Post-clean status failed';
          job.postCleanStarted = false;
          saveBatch();
          renderFinal(job, { stage: 'stitched', outputUrl: job.outputUrl });
          return;
        }
        continue;
      }
      errors = 0;
      const state = String(st.data?.state || '').toLowerCase();
      if (state === 'failed') {
        job.postCleanError = st.data?.error || st.data?.message || 'Post-clean failed';
        job.postCleanStarted = false;
        saveBatch();
        renderFinal(job, { stage: 'stitched', outputUrl: job.outputUrl });
        return;
      }
      if (st.data?.cleanedKey || (state === 'ready' && st.data?.downloadUrl && !st.data?.savingToLibrary)) {
        job.postCleanDone = true;
        job.cleanedKey = st.data.cleanedKey || null;
        job.cleanedDownloadPath =
          st.data.downloadPath ||
          (st.data.cleanedKey
            ? `/api/contentstation/media?action=get&key=${encodeURIComponent(st.data.cleanedKey)}`
            : null) ||
          st.data.downloadUrl ||
          null;
        job.cleanedPublicUrl = st.data.publicUrl || null;
        job.postCleanError = '';
        saveBatch();
        setStatus('Voice Mod ready', job.jobId);
        renderFinal(job, { stage: 'stitched', outputUrl: job.outputUrl });
        return;
      }
    }
  }

  function ensureCard(job) {
    if (!batchList) return;
    batchList.hidden = false;
    let card = batchList.querySelector(`[data-job-id="${job.jobId}"]`);
    if (card) return card;
    card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.jobId = job.jobId;
    card.innerHTML = `<p class="result-status">Queued</p>
      <p class="result-jobid">${job.jobId}</p>
      <p class="result-error error" hidden></p>`;
    batchList.appendChild(card);
    return card;
  }

  function updateCard(job, data) {
    const card = ensureCard(job);
    if (!card) return;
    const stage = data?.stage || job.stage || '';
    const statusEl = card.querySelector('.result-status');
    if (statusEl) statusEl.textContent = data?.message || stage || 'Working';
    if (data?.transcript) renderTranscript(data);
    if (data?.scenes) renderScenes(data);
    const errEl = card.querySelector('.result-error');
    if (errEl) {
      if (stage === 'error' || data?.error) {
        errEl.hidden = false;
        errEl.textContent = data?.message || data?.error || 'Failed';
      }
    }
    if (stage === 'error') setError(data?.message || data?.error || 'Job failed');
    if (data?.outputUrl) job.outputUrl = data.outputUrl;
    if (data?.output_url) job.outputUrl = data.output_url;
    if (data?.stage) job.stage = data.stage;
    saveBatch();
    renderFinal(job, data);
    if (
      POST_CLEAN_OPTS &&
      (stage === 'stitched' || data?.outputUploaded) &&
      !job.postCleanDone &&
      !job.postCleanStarted
    ) {
      runPostClean(job, data);
    }
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(tick, POLL_MS);
    tick();
  }

  async function tick() {
    let allDone = true;
    for (const job of batchJobs) {
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
      );
      if (ok && data) updateCard(job, data);
      const stage = (data && data.stage) || job.stage || '';
      if (POST_CLEAN_OPTS && !job.postCleanDone) {
        if (job.postCleanWorkId && !job._postCleanPolling) {
          job._postCleanPolling = true;
          pollPostClean(job).finally(() => {
            job._postCleanPolling = false;
          });
        }
        if (stage === 'stitched' || job.postCleanStarted || job.postCleanWorkId) {
          allDone = false;
          continue;
        }
      }
      if (stage !== 'stitched' && stage !== 'error' && stage !== 'provider_give_up') allDone = false;
    }
    if (allDone) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  runBtn?.addEventListener('click', async () => {
    setError('');
    const urls = parseUrls(tiktokUrls?.value);
    if (!urls.length) {
      setError('Paste a TikTok URL.');
      return;
    }
    if (!accountsUi?.hasCharacter()) {
      setError('Pick the Ready account so we use its saved character.');
      return;
    }
    submitting = true;
    runBtn.disabled = true;
    try {
      const characterKey = await accountsUi.resolveCharacterKeyForCreate();
      const account = accountsUi.selected() || TEST_ACCOUNT;
      const started = [];
      for (const url of urls) {
        setStatus('Submitting…', url);
        const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
          method: 'POST',
          body: JSON.stringify({
            action: 'from-tiktok',
            tiktokUrl: url,
            characterKey,
            account,
            characterMode: 'upload',
            version: 'v2',
            identityLock: true,
            musicLock: false,
            audioMode: 'grok',
            remixVariant: VARIANT,
            viralSceneChat: VARIANT === 'talking-heads-v3',
            restoreOverlays: VARIANT === 'talking-johnny' || VARIANT === 'talking-heads-johnny' || VARIANT === 'johnny-talking' ? true : undefined,
            subtleRewriteOverlays: false,
            adsStrictCopy: Boolean(adsStrictEl?.checked),
            overlayComplianceMode: adsStrictEl?.checked
              ? 'ads_strict'
              : VARIANT === 'talking-johnny' || VARIANT === 'talking-heads-johnny' || VARIANT === 'johnny-talking'
                ? 'organic_misspell'
                : undefined,
            allowDuplicate: true,
            deriveCharacterFromSource: false,
            title: titleInput?.value || TITLE_DEFAULT,
            autoRun: true,
          }),
        });
        if (!ok || !data?.jobId) {
          throw new Error((data && (data.message || data.error)) || `Create failed (HTTP ${status})`);
        }
        const job = {
          jobId: data.jobId,
          tiktokUrl: url,
          account,
          characterKey,
          stage: data.stage,
        };
        started.push(job);
        batchJobs.push(job);
        saveBatch();
        updateCard(job, data);
      }
      setStatus(`Queued ${started.length} test job(s)`, 'Keep this tab open until the video appears below.');
      startPoll();
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed');
    } finally {
      submitting = false;
      runBtn.disabled = false;
    }
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
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
    location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      if (gate) gate.hidden = false;
      if (app) app.hidden = true;
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, PAGE_ID)) return;
    if (window.CSAuth) window.CSAuth.applyNav(data.role || 'admin');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${data.role || 'admin'}`;
    const cfgRes = await api('/api/contentstation/character-remix-2-og?action=config');
    publicBaseUrl = String(cfgRes.data?.r2?.publicBaseUrl || cfgRes.data?.publicBaseUrl || '').trim();
    if (accountsUi) {
      accountsCache = (await accountsUi.loadAccounts()) || [];
      const sel = document.getElementById('account-select');
      if (sel && !sel.value) {
        const match = [...(sel.options || [])].find((o) => o.value === TEST_ACCOUNT);
        if (match) {
          sel.value = TEST_ACCOUNT;
          sel.dispatchEvent(new Event('change'));
        }
      }
    }
    if (tiktokUrls && !tiktokUrls.value.trim()) tiktokUrls.value = TEST_URL;
    loadBatch();
    if (cfg.resumeJobId && !batchJobs.some((j) => j.jobId === cfg.resumeJobId)) {
      batchJobs.push({
        jobId: cfg.resumeJobId,
        tiktokUrl: TEST_URL,
        account: TEST_ACCOUNT,
        stage: 'queued',
      });
      saveBatch();
    }
    if (batchJobs.length) {
      for (const job of batchJobs) ensureCard(job);
      startPoll();
      setStatus(`Resuming ${batchJobs.length} test job(s)…`);
    } else {
      setStatus('Ready — uses the account character + the TikTok URL, then shows the video below.');
    }
  }

  boot();
})();
