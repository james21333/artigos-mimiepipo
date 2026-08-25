(function () {
  const POLL_MS = 180000;
  const REF_URL = 'https://www.tiktok.com/@chakrabatiofficial/video/7402918578707565866';

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const notesEl = document.getElementById('stitch-notes');
  const startBtn = document.getElementById('start-stitch-btn');
  const startAllBtn = document.getElementById('start-stitch-all-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const errorEl = document.getElementById('stitch-error');
  const batchList = document.getElementById('batch-list');
  const batchActions = document.getElementById('batch-actions');
  const clearFinishedBtn = document.getElementById('clear-finished-btn');

  const STORAGE_KEY = 'cs_stitch_maker_v2';
  /** @type {{ jobId: string, account?: string, characterKey?: string, stage?: string, outputUrl?: string, tagged?: boolean }[]} */
  let batchJobs = [];
  let pollTimer = null;
  let submitting = false;
  let accountsUi = null;
  let publicBaseUrl = '';

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

  function saveBatch() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ jobs: batchJobs, notes: notesEl?.value || '' }),
      );
    } catch {
      /* ignore */
    }
  }

  function loadBatch() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data?.jobs)) batchJobs = data.jobs;
      if (notesEl && typeof data?.notes === 'string') notesEl.value = data.notes;
    } catch {
      /* ignore */
    }
  }

  function mediaUrl(key) {
    if (!key) return '';
    const base = String(publicBaseUrl || '').replace(/\/$/, '');
    if (base) return `${base}/${key}`;
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
    if (data?.outputUploaded || data?.stage === 'stitched') {
      return publicFinalUrl(job?.jobId) || '';
    }
    return '';
  }

  /**
   * ~30s silent stitch-reactor beats matching the bottom panel of REF_URL:
   * point up, expressive faces, dark bg + glowing circular halo behind head.
   */
  function buildStitchScenes(notes) {
    const noteBit = notes ? ` Extra direction: ${notes}` : '';
    const look =
      'Wide landscape 16:9 UGC reaction shot of THIS EXACT uploaded character only (match face + hair + body from the character reference image). ' +
      'CRITICAL FRAMING: character must be SMALL in frame — about half the usual close-up size, roughly 40% of frame height. ' +
      'Medium-wide / webcam pull-back: full head, shoulders, and pointing arm fully visible with large empty margins on left/right and above the head. ' +
      'Do NOT tight-crop the face. Do NOT fill the frame. Nothing cut off at edges. ' +
      'Dark cinematic void background with a bright glowing circular white halo / ring-light behind the head (halo fully visible, not clipped). ' +
      'Character faces camera. Right or left index finger pointing UP toward the top of frame (calling out a stitch above) — whole hand and arm in frame. ' +
      'Big expressive reaction faces — amused, shocked, skeptical. Silent — no talking, mouth mostly closed, not lip-sync. Single person only. No on-screen text.';
    // Scene ids MUST be scene_NN — Codex prompt parser only accepts ## scene_* headings.
    const beats = [
      {
        id: 'scene_01',
        title: 'Point up — hold',
        duration: 8,
        beat:
          'Firm upward point beside the face, raised eyebrows, slight smirk — hold the stitch-callout pose.',
      },
      {
        id: 'scene_02',
        title: 'Reaction faces',
        duration: 8,
        beat:
          'Still pointing up; stronger reaction faces — disbelief then laughter-adjacent expression, small head tilts.',
      },
      {
        id: 'scene_03',
        title: 'Lean + jab',
        duration: 7,
        beat:
          'Lean slightly toward camera, jab the upward point again, wide eyes / playful judgment face.',
      },
      {
        id: 'scene_04',
        title: 'Final beat',
        duration: 7,
        beat:
          'Final emphatic upward point + biggest reaction beat; hold for a CapCut stitch cut.',
      },
    ];
    let t = 0;
    return beats.map((b) => {
      const startMs = t;
      const durationMs = b.duration * 1000;
      const endMs = startMs + durationMs;
      t = endMs;
      const image_prompt =
        `${look} Beat: ${b.beat}${noteBit} ` +
        `Style reference: CapCut stitch bottom-panel reactor (see ${REF_URL}).`;
      return {
        id: b.id,
        title: b.title,
        duration: b.duration,
        durationMs,
        startMs,
        endMs,
        silent: true,
        motion_type: 'b-roll',
        dialogue: '',
        image_prompt,
        subject: 'uploaded character',
      };
    });
  }

  function isClearableFinishedJob(job) {
    if (!job) return false;
    const id = String(job.jobId || '');
    if (id.startsWith('fail-') || id.startsWith('submit-failed-')) return true;
    const stage = String(job.stage || '');
    return stage === 'stitched' || stage === 'error' || stage === 'provider_give_up';
  }

  function jobNeedsPoll(job) {
    if (!job?.jobId) return false;
    if (String(job.jobId).startsWith('fail-') || String(job.jobId).startsWith('submit-failed-')) {
      return false;
    }
    return !isClearableFinishedJob(job);
  }

  function syncBatchActionsVisibility() {
    const hasCards = Boolean(batchList && batchList.children.length);
    if (batchList) batchList.hidden = !hasCards;
    if (batchActions) batchActions.hidden = !hasCards;
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
      <div class="result-outputs" hidden></div>
      <p class="error result-error" hidden></p>
    `;
    card.querySelector('.result-url').textContent = job.account
      ? `${job.account} · stitch clip`
      : 'Stitch clip';
    card.querySelector('.result-jobid').textContent = `Job ${job.jobId}`;
    batchList.appendChild(card);
    return card;
  }

  function updateCardFromStatus(job, data) {
    const card = ensureBatchCard(job);
    if (!card) return;
    const stage =
      typeof data?.stage === 'string' && data.stage ? data.stage : job?.stage || 'unknown';
    if (job && typeof data?.stage === 'string' && data.stage) job.stage = data.stage;
    const statusEl = card.querySelector('.result-status');
    let label = stage;
    if (stage === 'queued' && data?.queuePosition) {
      label = `Queued — #${data.queuePosition}${data.queueDepth ? ` of ${data.queueDepth}` : ''}`;
    } else if (stage === 'running_first_frames') label = 'Codex first frames…';
    else if (stage === 'running_videos') label = 'Grok videos…';
    else if (stage === 'stitching') label = 'Stitching…';
    else if (stage === 'stitched') label = 'Done (~30s clip)';
    else if (stage === 'error') label = 'Error';
    if (statusEl) statusEl.textContent = label;

    const errEl = card.querySelector('.result-error');
    if (errEl) {
      if ((stage === 'error' || stage === 'waiting_provider') && data?.message) {
        errEl.hidden = false;
        errEl.textContent = data.message;
      } else {
        errEl.hidden = true;
      }
    }

    const finalUrl = resolveFinalUrl(job, data);
    if (finalUrl && job) job.outputUrl = finalUrl;
    const out = card.querySelector('.result-outputs');
    if (out) {
      if (finalUrl && stage === 'stitched') {
        out.hidden = false;
        out.innerHTML = `<a href="${finalUrl}" target="_blank" rel="noopener">Download stitch clip</a>`;
      } else {
        out.hidden = true;
        out.innerHTML = '';
      }
    }
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollBatch, POLL_MS);
    pollBatch();
  }

  async function pollBatch() {
    if (!batchJobs.some(jobNeedsPoll)) {
      stopPoll();
      return;
    }
    for (const job of batchJobs) {
      if (!jobNeedsPoll(job)) continue;
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
      );
      if (!ok) continue;
      updateCardFromStatus(job, data);
      // Intentionally no Ready For Upload tagging for stitch clips.
    }
    saveBatch();
    if (!batchJobs.some(jobNeedsPoll)) stopPoll();
  }

  async function createStitchJob({ account, characterKey }) {
    const scenes = buildStitchScenes(notesEl?.value || '');
    const title = account
      ? `Stitch Maker · ${account}`
      : 'Stitch Maker with Character';
    const { ok, data } = await api('/api/contentstation/character-remix-2-og', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        characterKey,
        characterMode: 'upload',
        version: 'v1',
        identityLock: false,
        musicLock: false,
        audioMode: 'grok',
        remixVariant: 'stitch-maker',
        restoreOverlays: false,
        viralSceneChat: false,
        writeFromScratch: false,
        autoRun: true,
        // Never Ready-tag stitch clips — library only (stitch-maker + stitch-videos).
        account: undefined,
        title,
        scenes,
        tiktokUrl: REF_URL,
      }),
    });
    if (!ok || !data?.jobId) {
      throw new Error(data?.message || data?.error || 'Create failed');
    }
    return data;
  }

  async function enqueueOne(account) {
    const characterKey = await accountsUi.resolveCharacterKeyForCreate(async (file, prefix) => {
      const form = new FormData();
      form.append('file', file, file.name || 'character.jpg');
      form.append('prefix', prefix || 'stitch-maker/characters/');
      const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
      if (!ok || !data?.object?.key) {
        throw new Error(data?.message || data?.error || 'Character upload failed');
      }
      return data.object.key;
    });
    if (!characterKey) {
      throw new Error(account ? `${account}: no character image` : 'Select an account with a character');
    }
    const created = await createStitchJob({ account, characterKey });
    const job = {
      jobId: created.jobId,
      account: account || '',
      characterKey,
      stage: created.stage || 'queued',
    };
    batchJobs.unshift(job);
    updateCardFromStatus(job, created);
    saveBatch();
    syncBatchActionsVisibility();
    return job;
  }

  startBtn?.addEventListener('click', async () => {
    setError('');
    if (submitting) return;
    const account = accountsUi?.selected?.() || '';
    if (!account && !accountsUi?.hasCharacter?.()) {
      setError('Select an account that has a character (or upload one).');
      return;
    }
    submitting = true;
    startBtn.disabled = true;
    setStatus('Creating stitch job…', account || 'no account tag');
    try {
      await enqueueOne(account);
      setStatus('Job queued on Fast Panda.', 'Silent ~30s clip · CapCut-ready');
      startPoll();
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('', '');
    } finally {
      submitting = false;
      startBtn.disabled = false;
    }
  });

  startAllBtn?.addEventListener('click', async () => {
    setError('');
    if (submitting) return;
    const { ok, data } = await api('/api/contentstation/accounts?action=list');
    if (!ok) {
      setError(data?.message || 'Could not load accounts');
      return;
    }
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    const withChar = accounts.filter((a) => a?.name && a?.characterKey);
    if (!withChar.length) {
      setError('No accounts with saved characters yet.');
      return;
    }
    const go = confirm(
      `Generate a ~30s stitch clip for ${withChar.length} account(s) that have characters?\n\nUses each account’s default character image.`,
    );
    if (!go) return;

    submitting = true;
    startAllBtn.disabled = true;
    startBtn.disabled = true;
    let done = 0;
    let failed = 0;
    for (const row of withChar) {
      const name = row.name;
      setStatus(`Queuing ${done + failed + 1}/${withChar.length}…`, name);
      try {
        accountsUi?.applyAccountCharacter?.(name);
        const created = await createStitchJob({
          account: name,
          characterKey: row.characterKey,
        });
        const job = {
          jobId: created.jobId,
          account: name,
          characterKey: row.characterKey,
          stage: created.stage || 'queued',
        };
        batchJobs.unshift(job);
        updateCardFromStatus(job, created);
        done += 1;
      } catch (err) {
        failed += 1;
        const failId = `submit-failed-${Date.now()}-${failed}`;
        const job = {
          jobId: failId,
          account: name,
          stage: 'error',
        };
        batchJobs.unshift(job);
        updateCardFromStatus(job, { stage: 'error', message: err?.message || String(err) });
      }
    }
    saveBatch();
    syncBatchActionsVisibility();
    setStatus(
      `Queued ${done} job(s)${failed ? ` · ${failed} failed` : ''}.`,
      'Pipeline runs one at a time on Fast Panda.',
    );
    startPoll();
    submitting = false;
    startAllBtn.disabled = false;
    startBtn.disabled = false;
  });

  clearFinishedBtn?.addEventListener('click', () => {
    const finished = batchJobs.filter(isClearableFinishedJob);
    if (!finished.length) {
      setStatus('No finished jobs to clear.', '');
      return;
    }
    const keepPreview = batchJobs.filter((j) => !isClearableFinishedJob(j));
    const ok = confirm(
      `Clear ${finished.length} finished?\n${keepPreview.length} in-flight will stay.`,
    );
    if (!ok) return;
    const keep = [];
    for (const job of batchJobs) {
      if (isClearableFinishedJob(job)) removeJobCard(job.jobId);
      else keep.push(job);
    }
    batchJobs = keep;
    saveBatch();
    syncBatchActionsVisibility();
    if (keep.some(jobNeedsPoll)) startPoll();
    else stopPoll();
  });

  notesEl?.addEventListener('input', saveBatch);

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
  }

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      showGate();
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-maker')) return;
    showApp(data);
    publicBaseUrl = data.publicBaseUrl || data.r2PublicBaseUrl || '';

    const ping = await api('/api/contentstation/character-remix-2-og?action=ping');
    if (ping.ok && ping.data?.worker?.ok === false) {
      setError('Remix worker unreachable — generation will fail until Fast Panda is back.');
    }
    if (ping.data?.publicBaseUrl) publicBaseUrl = ping.data.publicBaseUrl;

    accountsUi = window.CSRemix2Accounts?.createController({
      api,
      getPublicBaseUrl: () => publicBaseUrl,
      onError: (msg) => setError(msg),
    });
    await accountsUi?.loadAccounts?.();

    loadBatch();
    for (const job of batchJobs) {
      ensureBatchCard(job);
      updateCardFromStatus(job, { stage: job.stage });
    }
    syncBatchActionsVisibility();
    if (batchJobs.some(jobNeedsPoll)) startPoll();
  }

  boot().catch((err) => {
    showGate();
    if (gateError) {
      gateError.hidden = false;
      gateError.textContent = err?.message || String(err);
    }
  });
})();
