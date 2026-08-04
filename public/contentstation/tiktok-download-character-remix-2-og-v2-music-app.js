(function () {
  const MAX_URLS = 20;
  const POLL_MS = 4000;
  const ACTIVE_STORAGE_KEY = 'cs_remix2_v2_music_only_batch_v1';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const configEl = document.getElementById('remix2-config');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const errorEl = document.getElementById('remix2-v2-error');
  const urlCountEl = document.getElementById('url-count');
  const tiktokUrls = document.getElementById('tiktok-urls');
  const titleInput = document.getElementById('job-title');
  const restoreOverlaysEl = document.getElementById('restore-overlays');
  const runBtn = document.getElementById('run-btn');
  const clearFinishedBtn = document.getElementById('clear-finished-btn');
  const batchActions = document.getElementById('batch-actions');
  const batchList = document.getElementById('batch-list');
  const frameGallery = document.getElementById('frame-gallery');
  const outputGallery = document.getElementById('output-gallery');

  /** @type {{ jobId: string, tiktokUrl: string, title?: string, characterUrl?: string, outputUrl?: string, account?: string, tagged?: boolean, characterKey?: string, stage?: string }[]} */
  let batchJobs = [];
  let pollTimer = null;
  let submitting = false;
  let publicBaseUrl = '';
  /** @type {any[]} */
  let accountsCache = [];

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
      onError: (msg) => {
        if (msg) setError(msg);
      },
    });

  function mediaFinalPath(jobId) {
    const key = `character-remix-2-og/${jobId}/final.mp4`;
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function publicFinalUrl(jobId) {
    const base = String(publicBaseUrl || '').replace(/\/$/, '');
    if (!base || !jobId) return '';
    return `${base}/character-remix-2-og/${jobId}/final.mp4`;
  }

  function resolveFinalUrl(job, data) {
    const fromStatus = data?.output_url || data?.outputUrl || '';
    if (fromStatus) return fromStatus;
    if (job?.outputUrl) return job.outputUrl;
    const stage = data?.stage || data?.status || '';
    if (stage === 'stitched' || data?.outputUploaded) {
      return publicFinalUrl(job?.jobId) || mediaFinalPath(job?.jobId);
    }
    return '';
  }

  function renderFinalOutput(outWrap, finalUrl, job) {
    if (!outWrap) return;
    if (!finalUrl) {
      outWrap.hidden = true;
      outWrap.innerHTML = '';
      return;
    }
    outWrap.hidden = false;
    const readyHref = job?.account
      ? `./ready-account.html?account=${encodeURIComponent(job.account)}`
      : './remix2-ready.html';
    const readyLabel = job?.account ? `Ready · ${job.account}` : 'Remix 2 ready';
    outWrap.innerHTML = `<figure class="result-final">
        <figcaption>Final</figcaption>
        <video src="${finalUrl}" controls playsinline preload="metadata" class="result-preview"></video>
      </figure>
      <div class="job-account-row" data-job-tag-row></div>
      <p class="muted-line job-tag-status" data-job-tag-status hidden></p>
      <p class="muted-line result-actions">
        <a class="btn-link" href="${finalUrl}" target="_blank" rel="noopener">Open MP4</a>
        ·
        <a class="btn-link" href="${readyHref}">${readyLabel}</a>
      </p>`;
    wireJobTagRow(outWrap, job);
  }

  function wireJobTagRow(outWrap, job) {
    const row = outWrap.querySelector('[data-job-tag-row]');
    const statusEl = outWrap.querySelector('[data-job-tag-status]');
    if (!row || !job?.jobId) return;
    row.innerHTML = '';
    const label = document.createElement('label');
    label.textContent = 'Tag for account';
    const select = document.createElement('select');
    select.className = 'account-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Choose account —';
    select.appendChild(placeholder);
    for (const a of accountsCache) {
      const name = typeof a === 'string' ? a : a.name;
      if (!name) continue;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
    if (job.account) select.value = job.account;
    if (job.tagged && job.account) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = `Tagged → Ready For Upload (${job.account})`;
      }
    }
    select.addEventListener('change', async () => {
      if (!select.value) return;
      select.disabled = true;
      try {
        const { ok, data } = await api('/api/contentstation/accounts', {
          method: 'POST',
          body: JSON.stringify({
            action: 'tag',
            key: `character-remix-2-og/${job.jobId}/final.mp4`,
            account: select.value,
          }),
        });
        if (!ok) throw new Error((data && (data.message || data.error)) || 'Could not tag video.');
        job.account = select.value;
        job.tagged = true;
        saveBatch();
        if (data?.accounts) accountsCache = data.accounts;
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.textContent = `Tagged → Ready For Upload (${job.account})`;
        }
        accountsUi?.refresh?.().catch(() => {});
      } catch (err) {
        setError(err?.message || String(err));
        select.value = job.account || '';
      } finally {
        select.disabled = false;
      }
    });
    label.appendChild(select);
    row.appendChild(label);
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

  function setStatus(main, detail) {
    if (statusLine) statusLine.textContent = main || '';
    if (statusDetail) {
      statusDetail.hidden = !detail;
      statusDetail.textContent = detail || '';
    }
  }

  function parseUrls(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\d+[\).:\-\s]+/, '').replace(/^[-*]\s+/, '').trim())
      .filter((u) => /^https?:\/\//i.test(u));
  }

  function updateUrlCount() {
    const n = parseUrls(tiktokUrls?.value).length;
    if (urlCountEl) {
      urlCountEl.textContent = `${n} / ${MAX_URLS} links`;
      urlCountEl.classList.toggle('error', n > MAX_URLS);
    }
  }

  function saveBatch() {
    try {
      localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(batchJobs));
    } catch {
      /* ignore */
    }
  }

  function loadBatch() {
    try {
      const raw = localStorage.getItem(ACTIVE_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      batchJobs = Array.isArray(arr) ? arr.filter((j) => j && j.jobId) : [];
    } catch {
      batchJobs = [];
    }
  }

  async function uploadImage(file, prefix) {
    const form = new FormData();
    form.append('file', file, file.name || 'image.png');
    form.append('prefix', prefix);
    const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
    if (!ok || !data?.object?.key) {
      throw new Error(data?.message || data?.error || 'Upload failed');
    }
    return data.object.key;
  }

  function createFailureDetail(data, httpStatus, index) {
    const msg =
      (typeof data?.message === 'string' && data.message.trim()) ||
      (typeof data?.detail === 'string' && data.detail.trim()) ||
      (typeof data?.error === 'string' && data.error.trim() && data.error !== 'worker_error'
        ? data.error
        : '') ||
      '';
    if (msg) return msg;
    if (httpStatus) return `Create failed (HTTP ${httpStatus}) for URL ${index + 1}.`;
    return `Failed to start job ${index + 1}`;
  }

  function showSubmitFailure(url, index, detail) {
    const placeholderId = `submit-failed-${index + 1}`;
    ensureBatchCard({ jobId: placeholderId, tiktokUrl: url });
    const card = batchList?.querySelector(`[data-job-id="${placeholderId}"]`);
    if (!card) return;
    const statusEl = card.querySelector('.result-status');
    if (statusEl) statusEl.textContent = 'Submit failed';
    const idEl = card.querySelector('.result-jobid');
    if (idEl) idEl.textContent = 'No job created';
    const errEl = card.querySelector('.result-error');
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = detail;
    }
  }

  async function loadConfig() {
    const { ok, data } = await api('/api/contentstation/character-remix-2-og?action=config');
    publicBaseUrl = String(data?.r2?.publicBaseUrl || data?.publicBaseUrl || '').trim();
    let healthNote = '';
    if (ok && data?.configured) {
      try {
        const ping = await api('/api/contentstation/character-remix-2-og?action=ping');
        if (!ping.ok) {
          healthNote =
            ping.data?.message ||
            `Worker unreachable (HTTP ${ping.status || '?'}) — creates will fail until Fast Panda is back.`;
          setError(healthNote);
        }
      } catch {
        /* ignore ping errors */
      }
    }
    if (configEl) {
      configEl.hidden = false;
      const lockNote =
        data?.musicLockNote ||
        data?.identityLockNote ||
        'V2 Music-Only: identity-lock + exact EDL timing + original TikTok audio.';
      const overlayNote =
        data?.restoreOverlaysNote ||
        'Original on-screen hooks restored onto final (Music-Only default on).';
      const baseMsg = data?.message || (ok ? 'Configured' : 'Worker not configured');
      configEl.textContent = healthNote
        ? `${healthNote} · ${lockNote}`
        : `${baseMsg} · ${lockNote} · ${overlayNote} · Pipelines queue (1 at a time), up to ${MAX_URLS} links.`;
    }
    return { ok, data };
  }

  function syncBatchActionsVisibility() {
    const hasCards = Boolean(batchList && batchList.children.length);
    if (batchList) batchList.hidden = !hasCards;
    if (batchActions) batchActions.hidden = !hasCards;
  }

  function isTerminalStage(stage) {
    return stage === 'stitched' || stage === 'error';
  }

  function isTerminalJob(job) {
    if (!job) return false;
    if (String(job.jobId || '').startsWith('fail-')) return true;
    if (String(job.jobId || '').startsWith('submit-failed-')) return true;
    if (isTerminalStage(job.stage)) return true;
    if (!job.stage && job.outputUrl) return true;
    return false;
  }

  function removeJobCard(jobId) {
    batchList?.querySelector(`[data-job-id="${jobId}"]`)?.remove();
  }

  function ensureBatchCard(job) {
    if (!batchList) return null;
    batchList.hidden = false;
    if (batchActions) batchActions.hidden = false;
    let card = batchList.querySelector(`[data-job-id="${job.jobId}"]`);
    if (card) return card;
    card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.jobId = job.jobId;
    card.innerHTML = `
      <p class="result-url muted-line"></p>
      <p class="result-status status">Queued…</p>
      <p class="muted-line result-jobid"></p>
      <div class="result-character" hidden></div>
      <div class="result-frames" hidden></div>
      <div class="result-outputs" hidden></div>
      <p class="error result-error" hidden></p>
    `;
    card.querySelector('.result-url').textContent = job.tiktokUrl || job.jobId;
    card.querySelector('.result-jobid').textContent = `Job ${job.jobId}`;
    batchList.appendChild(card);
    return card;
  }

  async function maybeAutoTag(job, stage) {
    if (stage !== 'stitched' || !job?.account || job.tagged) return;
    const result = await accountsUi?.tagFinalForAccount(job.jobId, job.account);
    if (result?.ok) {
      job.tagged = true;
      saveBatch();
      accountsUi?.refresh?.().catch(() => {});
    }
  }

  function updateCardFromStatus(job, data) {
    const card = ensureBatchCard(job);
    if (!card) return;
    const stage = data?.stage || data?.status || 'unknown';
    if (job) job.stage = stage;
    const pos = data?.queuePosition;
    const depth = data?.queueDepth;
    let label = stage;
    if (stage === 'queued' && pos) {
      label = `Queued — #${pos}${depth ? ` of ${depth}` : ''}`;
    } else if (stage === 'running_first_frames') {
      label = 'Codex first frames…';
    } else if (stage === 'analyzing_beats') {
      label = 'Analyzing beats…';
    } else if (stage === 'running_videos') {
      label = 'Grok videos…';
    } else if (stage === 'stitching') {
      label = 'Stitching…';
    } else if (stage === 'restoring_overlays') {
      label = 'Restoring on-screen text…';
    } else if (stage === 'waiting_provider' || stage === 'provider_cooldown') {
      const provider = data?.provider || '';
      const hours = data?.providerWaitEstimateHours;
      const who =
        provider === 'grok' ? 'Grok/xAI' : provider === 'codex' || provider === 'openai' ? 'OpenAI/Codex' : 'Provider';
      const est = hours != null && hours !== '' ? `~${hours}h` : 'a few hours';
      label = `${who} cooling down ${est} — checking hourly, auto-resume`;
    } else if (stage === 'stitched') {
      const n = data?.overlayText?.eventCount ?? data?.overlayText?.events?.length;
      label =
        data?.overlaysBurned && n
          ? `Done (overlays×${n})`
          : 'Done';
      if (job.account) label += job.tagged ? ` · ${job.account}` : ` → ${job.account}`;
    } else if (stage === 'error') {
      label = 'Failed';
    }
    const statusEl = card.querySelector('.result-status');
    if (statusEl) statusEl.textContent = label;
    const errEl = card.querySelector('.result-error');
    if (errEl) {
      if ((stage === 'error' || stage === 'waiting_provider' || stage === 'provider_cooldown') && data?.message) {
        errEl.hidden = false;
        errEl.textContent = data.message;
        if (stage === 'waiting_provider' || stage === 'provider_cooldown') {
          errEl.classList.remove('error');
          errEl.classList.add('muted-line');
        } else {
          errEl.classList.add('error');
          errEl.classList.remove('muted-line');
        }
      } else {
        errEl.hidden = true;
      }
    }

    const charUrl =
      data?.characterUrl ||
      data?.character_url ||
      (data?.derivedCharacter && data.derivedCharacter.url) ||
      job?.characterUrl ||
      '';
    const charWrap = card.querySelector('.result-character');
    if (charWrap) {
      if (charUrl) {
        if (job && !job.characterUrl) job.characterUrl = charUrl;
        charWrap.hidden = false;
        charWrap.innerHTML = `<figure><figcaption>Character</figcaption><img src="${charUrl}" alt="Character" class="character-preview result-character-thumb"></figure>`;
      } else {
        charWrap.hidden = true;
        charWrap.innerHTML = '';
      }
    }

    const framesWrap = card.querySelector('.result-frames');
    const frames = data?.first_frames || data?.firstFrames || {};
    const frameEntries = Object.entries(frames);
    if (framesWrap) {
      if (frameEntries.length) {
        framesWrap.hidden = false;
        framesWrap.innerHTML = frameEntries
          .map(([sid, info]) => {
            const url = typeof info === 'string' ? info : info?.url || info?.publicUrl || '';
            return url
              ? `<figure><figcaption>${sid}</figcaption><img src="${url}" alt="${sid}" class="character-preview"></figure>`
              : '';
          })
          .join('');
      } else {
        framesWrap.hidden = true;
        framesWrap.innerHTML = '';
      }
    }

    const outWrap = card.querySelector('.result-outputs');
    const finalUrl = resolveFinalUrl(job, data);
    if (finalUrl && job) job.outputUrl = finalUrl;
    renderFinalOutput(outWrap, finalUrl, job);
    maybeAutoTag(job, stage).catch(() => {});
  }

  async function pollBatch() {
    if (!batchJobs.length) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    let active = 0;
    let done = 0;
    let failed = 0;
    for (const job of batchJobs) {
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
      );
      if (!ok) {
        ensureBatchCard(job);
        const card = batchList?.querySelector(`[data-job-id="${job.jobId}"]`);
        const statusEl = card?.querySelector('.result-status');
        const fallbackUrl = job.outputUrl || publicFinalUrl(job.jobId) || mediaFinalPath(job.jobId);
        if (fallbackUrl && card) {
          if (!job.outputUrl) job.outputUrl = fallbackUrl;
          job.stage = 'stitched';
          if (statusEl && (!statusEl.textContent || statusEl.textContent === 'Status error' || statusEl.textContent === 'Queued…')) {
            statusEl.textContent = 'Done (from R2)';
          }
          renderFinalOutput(card.querySelector('.result-outputs'), fallbackUrl, job);
          await maybeAutoTag(job, 'stitched');
        } else if (statusEl) {
          statusEl.textContent = 'Status error';
        }
        continue;
      }
      updateCardFromStatus(job, data);
      const stage = data?.stage || '';
      if (stage === 'stitched') done += 1;
      else if (stage === 'error') failed += 1;
      else active += 1;
    }
    setStatus(
      `Batch: ${done} done · ${active} in flight/queued · ${failed} failed · ${batchJobs.length} total`,
      'Worker runs one remake pipeline at a time; the rest stay queued. Quota cooldown auto-resumes.',
    );
    saveBatch();
    if (active === 0 && !submitting) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (runBtn) runBtn.disabled = false;
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollBatch, POLL_MS);
    pollBatch();
  }

  async function refreshMissingStages() {
    await Promise.all(
      batchJobs.map(async (job) => {
        if (isTerminalStage(job.stage)) return;
        const { ok, data } = await api(
          `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
        );
        if (ok && data?.stage) {
          job.stage = data.stage;
          if (data.stage === 'stitched') {
            const finalUrl = resolveFinalUrl(job, data);
            if (finalUrl) job.outputUrl = finalUrl;
          }
        } else if (job.outputUrl) {
          job.stage = 'stitched';
        }
      }),
    );
  }

  async function clearFinishedFromList() {
    setError('');
    await refreshMissingStages();
    const finished = batchJobs.filter(isTerminalJob);
    const orphanFailCards = batchList
      ? Array.from(batchList.querySelectorAll('.download-result-card')).filter((card) => {
          const id = String(card.dataset.jobId || '');
          return id.startsWith('fail-') || id.startsWith('submit-failed-');
        })
      : [];
    if (!finished.length && !orphanFailCards.length) {
      setStatus('No finished jobs to clear.', 'In-flight and queued jobs stay on this list.');
      return;
    }
    const ok = confirm(
      `Clear ${finished.length + orphanFailCards.length} finished job(s) from this list?\n\nIn-flight and queued jobs stay. Does not delete R2 files or Ready For Upload tags.`,
    );
    if (!ok) return;

    const keep = [];
    for (const job of batchJobs) {
      if (isTerminalJob(job)) removeJobCard(job.jobId);
      else keep.push(job);
    }
    batchJobs = keep;
    for (const card of orphanFailCards) card.remove();
    saveBatch();
    syncBatchActionsVisibility();
    setStatus(
      keep.length
        ? `Cleared finished jobs · ${keep.length} still on list`
        : 'Cleared finished jobs from this list.',
      'R2 finals and Ready For Upload tags are unchanged.',
    );
  }

  if (frameGallery) frameGallery.hidden = true;
  if (outputGallery) outputGallery.hidden = true;

  tiktokUrls?.addEventListener('input', updateUrlCount);

  clearFinishedBtn?.addEventListener('click', () => {
    clearFinishedFromList().catch((err) => setError(err?.message || String(err)));
  });

  runBtn?.addEventListener('click', async () => {
    setError('');
    const urls = parseUrls(tiktokUrls?.value);
    if (!urls.length) {
      setError('Paste 1–20 TikTok URLs (one per line).');
      return;
    }
    if (urls.length > MAX_URLS) {
      setError(`Max ${MAX_URLS} TikTok links per batch.`);
      return;
    }
    if (!accountsUi?.hasCharacter()) {
      setError('Choose a character image — or select an account that already has a saved character.');
      return;
    }
    for (const u of urls) {
      if (!/tiktok\.com\//i.test(u) && !/vm\.tiktok\.com\//i.test(u)) {
        setError(`Not a TikTok URL: ${u}`);
        return;
      }
    }

    submitting = true;
    if (runBtn) runBtn.disabled = true;
    try {
      setStatus('Preparing character…');
      const characterKey = await accountsUi.resolveCharacterKeyForCreate(uploadImage);
      if (!characterKey) {
        throw new Error('Character key missing — upload a character or pick an account with one saved.');
      }
      const account = accountsUi.selected() || '';

      const baseTitle = titleInput?.value || 'TikTok remake (music-only)';
      const started = [];
      const failures = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        setStatus(`Submitting ${i + 1} / ${urls.length}`, url);
        const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
          method: 'POST',
          body: JSON.stringify({
            action: 'from-tiktok',
            tiktokUrl: url,
            characterKey,
            characterMode: 'upload',
            version: 'v2',
            identityLock: true,
            musicLock: true,
            audioMode: 'source',
            remixVariant: 'music-only',
            restoreOverlays: restoreOverlaysEl ? restoreOverlaysEl.checked : true,
            deriveCharacterFromSource: false,
            title: urls.length > 1 ? `${baseTitle} (${i + 1}/${urls.length})` : baseTitle,
            autoRun: true,
          }),
        });
        if (!ok || !data?.jobId) {
          const detail = createFailureDetail(data, status, i);
          failures.push(detail);
          showSubmitFailure(url, i, detail);
          continue;
        }
        const job = {
          jobId: data.jobId,
          tiktokUrl: url,
          title: data.title || baseTitle,
          account: account || undefined,
          characterKey,
          tagged: false,
        };
        started.push(job);
        batchJobs.push(job);
        saveBatch();
        updateCardFromStatus(job, data);
      }
      if (!started.length) {
        throw new Error(failures[0] || 'No jobs started — worker did not return a jobId.');
      }
      if (failures.length) {
        setError(`${failures.length} URL(s) failed to create. First: ${failures[0]}`);
      }
      setStatus(
        `Submitted ${started.length} job(s)${account ? ` · account ${account}` : ''}`,
        account
          ? 'Pipelines queue on Fast Panda. Finished MP4s auto-tag to Ready For Upload.'
          : 'Pipelines queue on Fast Panda — one remake at a time. Tag later on the job card or Remix 2 ready.',
      );
      startPoll();
      accountsUi?.refresh?.().catch(() => {});
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed');
      if (runBtn) runBtn.disabled = false;
    } finally {
      submitting = false;
    }
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-download-character-remix-2-og-v2-music')) {
      return;
    }
    if (window.CSAuth) window.CSAuth.applyNav(data.role || 'admin');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${data.role || 'admin'}`;
    await loadConfig();
    if (accountsUi) {
      accountsCache = (await accountsUi.loadAccounts()) || [];
    }
    updateUrlCount();
    loadBatch();
    if (batchJobs.length) {
      for (const job of batchJobs) ensureBatchCard(job);
      startPoll();
      setStatus(`Resuming ${batchJobs.length} job(s)…`);
    } else {
      setStatus('Ready — pick account (optional) + character + up to 20 TikTok URLs.');
    }
  }

  boot();
})();
