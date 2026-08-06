(function () {
  const MAX_URLS = 5;
  const POLL_MS = 3500;
  const ACTIVE_STORAGE_KEY = 'cs_remix2_viral_builder_batch_v1';

  const DEFAULT_LABELS = [
    'dramatic event',
    'prank shown',
    'hook screen',
    'draw in user with hook',
    'people laughing',
    'show social proof',
    'anticipation',
    'product reveal',
    'before/after',
    'reaction',
    'cliffhanger',
    'transition',
    'punchline',
    'setting establish',
    'call to action',
  ];

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
  const grokDialogueEl = document.getElementById('opt-grok-dialogue');
  const musicOnlyEl = document.getElementById('opt-music-only');
  const analyzeBtn = document.getElementById('analyze-btn');
  const clearFinishedBtn = document.getElementById('clear-finished-btn');
  const batchActions = document.getElementById('batch-actions');
  const batchList = document.getElementById('batch-list');

  /** @type {{ jobId: string, tiktokUrl: string, title?: string, characterUrl?: string, outputUrl?: string, account?: string, tagged?: boolean, characterKey?: string, stage?: string, scenesDraft?: any[] }[]} */
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
    if (urlCountEl) urlCountEl.textContent = `${n} / ${MAX_URLS} links`;
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
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) batchJobs = parsed;
    } catch {
      batchJobs = [];
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stageLabel(stage, data) {
    if (stage === 'queued' && data?.queuePosition) {
      return `Queued — #${data.queuePosition}${data.queueDepth ? ` of ${data.queueDepth}` : ''}`;
    }
    const map = {
      analyzing: 'Building EDL…',
      analyzing_beats: 'Analyzing beats…',
      detecting_overlays: 'Detecting on-screen text…',
      awaiting_prompts: 'Ready — write prompts',
      analyzed: 'Ready — write prompts',
      ready: 'Starting generate…',
      running_first_frames: 'Codex first frames…',
      first_frames_done: 'Frames ready…',
      running_videos: 'Grok videos…',
      stitching: 'Stitching…',
      restoring_overlays: 'Burning overlays…',
      stitched: 'Done',
      error: 'Failed',
    };
    if (stage === 'waiting_provider' || stage === 'provider_cooldown') {
      const provider = data?.provider || '';
      const hours = data?.providerWaitEstimateHours;
      const who =
        provider === 'grok' ? 'Grok/xAI' : provider === 'codex' || provider === 'openai' ? 'OpenAI/Codex' : 'Provider';
      const est = hours != null && hours !== '' ? `~${hours}h` : 'a few hours';
      const cadence =
        data?.providerProbeCadence ||
        (data?.providerProbePhase === 'slow'
          ? 'checking every 12h'
          : data?.providerProbePhase === 'gave_up'
            ? 'auto-check stopped'
            : 'checking hourly (~25h)');
      return `${who} cooling down ${est} — ${cadence}`;
    }
    if (stage === 'provider_give_up') {
      const provider = data?.provider || '';
      const who =
        provider === 'grok' ? 'Grok/xAI' : provider === 'codex' || provider === 'openai' ? 'OpenAI/Codex' : 'Provider';
      return `${who} auto-check stopped — re-run to retry`;
    }
    return map[stage] || stage || '…';
  }

  function isTerminalStage(stage) {
    return stage === 'stitched' || stage === 'error' || stage === 'provider_give_up';
  }

  function isTerminalJob(job) {
    if (!job) return false;
    if (String(job.jobId || '').startsWith('fail-')) return true;
    if (String(job.jobId || '').startsWith('submit-failed-')) return true;
    if (isTerminalStage(job.stage)) return true;
    if (!job.stage && job.outputUrl) return true;
    return false;
  }

  function isAwaitingPrompts(stage) {
    return stage === 'awaiting_prompts' || stage === 'analyzed';
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
    card.className = 'download-result-card viral-builder-card';
    card.dataset.jobId = job.jobId;
    card.innerHTML = `
      <p class="result-url muted-line"></p>
      <p class="result-status status">Queued…</p>
      <p class="muted-line result-jobid"></p>
      <div class="result-character" hidden></div>
      <div class="viral-scene-editor" hidden></div>
      <div class="result-frames" hidden></div>
      <div class="result-outputs" hidden></div>
      <p class="error result-error" hidden></p>
    `;
    card.querySelector('.result-url').textContent = job.tiktokUrl || job.jobId;
    card.querySelector('.result-jobid').textContent = `Job ${job.jobId}`;
    batchList.appendChild(card);
    return card;
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
      : './character-remixes.html';
    const readyLabel = job?.account ? `Ready · ${job.account}` : 'Recent remixes';
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
    if (job.tagged && job.account && statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Tagged → Ready For Upload (${job.account})`;
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

  async function maybeAutoTag(job, stage) {
    if (stage !== 'stitched' || !job?.account || job.tagged) return;
    const result = await accountsUi?.tagFinalForAccount(job.jobId, job.account);
    if (result?.ok) {
      job.tagged = true;
      saveBatch();
      accountsUi?.refresh?.().catch(() => {});
    }
  }

  function collectSceneDrafts(card) {
    const editor = card?.querySelector('.viral-scene-editor');
    if (!editor) return [];
    return Array.from(editor.querySelectorAll('[data-scene-id]')).map((block) => {
      const id = block.getAttribute('data-scene-id');
      return {
        id,
        userPrompt: block.querySelector('[data-field="userPrompt"]')?.value || '',
        sceneNotes: block.querySelector('[data-field="sceneNotes"]')?.value || '',
        sceneLabel: block.querySelector('[data-field="sceneLabel"]')?.value || '',
        textRewrite: block.querySelector('[data-field="textRewrite"]')?.value || '',
      };
    });
  }

  function renderSceneEditor(card, job, data) {
    const editor = card.querySelector('.viral-scene-editor');
    if (!editor) return;
    const stage = data?.stage || job.stage || '';
    const scenes = Array.isArray(data?.scenes) ? data.scenes : [];

    if (!isAwaitingPrompts(stage) || !scenes.length) {
      if (
        [
          'ready',
          'queued',
          'running_first_frames',
          'running_videos',
          'stitching',
          'restoring_overlays',
          'stitched',
        ].includes(stage)
      ) {
        // Persist drafts before hiding.
        if (!editor.hidden && editor.querySelector('[data-scene-id]')) {
          job.scenesDraft = collectSceneDrafts(card);
        }
        editor.hidden = true;
      }
      return;
    }

    // Don't wipe in-progress typing on poll — only build once (or rebuild if scene count changes).
    const existingBlocks = editor.querySelectorAll('[data-scene-id]');
    if (!editor.hidden && existingBlocks.length === scenes.length) {
      return;
    }

    const labels = Array.isArray(data?.generalizedLabels) && data.generalizedLabels.length
      ? data.generalizedLabels
      : DEFAULT_LABELS;

    const existingDrafts = collectSceneDrafts(card);
    const draftById = Object.fromEntries(existingDrafts.map((d) => [d.id, d]));
    if (job.scenesDraft?.length) {
      for (const d of job.scenesDraft) draftById[d.id] = { ...draftById[d.id], ...d };
    }

    editor.hidden = false;
    editor.innerHTML = `
      <h3 class="viral-editor-title">Scene prompts</h3>
      <p class="muted-line">Write what each remake beat should be. Labels + notes are editable. Text rewrite only when the beat had on-screen text.</p>
      <div class="viral-scenes"></div>
      <div class="row viral-generate-row">
        <button type="button" class="viral-generate-btn">Generate remake</button>
      </div>
    `;
    const wrap = editor.querySelector('.viral-scenes');
    for (const scene of scenes) {
      const sid = String(scene.id || '');
      const draft = draftById[sid] || {};
      const kf =
        scene.keyframeUrl ||
        data?.structureKeyframes?.[sid] ||
        '';
      const hasText = Boolean(scene.hasOverlayText || scene.overlayTextOriginal);
      const labelVal = draft.sceneLabel || scene.sceneLabel || 'setting establish';
      const block = document.createElement('article');
      block.className = 'viral-scene-block';
      block.setAttribute('data-scene-id', sid);
      block.innerHTML = `
        <div class="viral-scene-grid">
          <figure class="viral-scene-still">
            <figcaption>${escapeHtml(sid)}</figcaption>
            ${
              kf
                ? `<img src="${escapeHtml(kf)}" alt="${escapeHtml(sid)} still" class="character-preview viral-still-img">`
                : '<p class="muted-line">No still</p>'
            }
            <p class="muted-line">${Math.round(Number(scene.durationMs || (scene.duration || 0) * 1000) || 0)}ms</p>
          </figure>
          <div class="viral-scene-fields">
            <label><strong>${escapeHtml(labelVal)}</strong> — why it works (label)
              <input list="viral-labels-${escapeHtml(job.jobId)}" data-field="sceneLabel" type="text" value="${escapeHtml(labelVal)}">
            </label>
            <label>Scene notes
              <textarea data-field="sceneNotes" rows="3">${escapeHtml(draft.sceneNotes ?? scene.sceneNotes ?? '')}</textarea>
            </label>
            <label>Prompt for remake (required)
              <textarea data-field="userPrompt" rows="4" placeholder="Describe the new scene Codex should draw…">${escapeHtml(draft.userPrompt ?? scene.userPrompt ?? '')}</textarea>
            </label>
            ${
              hasText
                ? `<label>Text rewrite
                    <span class="muted-line">Original: ${escapeHtml(scene.overlayTextOriginal || '')}</span>
                    <textarea data-field="textRewrite" rows="2" placeholder="Rewritten on-screen text…">${escapeHtml(draft.textRewrite ?? scene.textRewrite ?? '')}</textarea>
                  </label>`
                : '<input type="hidden" data-field="textRewrite" value="">'
            }
          </div>
        </div>
      `;
      wrap.appendChild(block);
    }

    let datalist = editor.querySelector(`#viral-labels-${job.jobId}`);
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = `viral-labels-${job.jobId}`;
      datalist.innerHTML = labels.map((l) => `<option value="${escapeHtml(l)}"></option>`).join('');
      editor.appendChild(datalist);
    }

    const genBtn = editor.querySelector('.viral-generate-btn');
    genBtn?.addEventListener('click', () => {
      submitGenerate(job, card).catch((err) => setError(err?.message || String(err)));
    });
  }

  async function submitGenerate(job, card) {
    setError('');
    const scenes = collectSceneDrafts(card);
    job.scenesDraft = scenes;
    saveBatch();
    const missing = scenes.filter((s) => !String(s.userPrompt || '').trim());
    if (missing.length) {
      setError(`Fill a prompt for every scene (${missing.map((s) => s.id).join(', ')} still empty).`);
      return;
    }
    if (!grokDialogueEl?.checked && !musicOnlyEl?.checked) {
      setError('Check at least one audio option (Grok dialogue and/or Music-only).');
      return;
    }
    genBusy(card, true);
    setStatus(`Generating ${job.jobId}…`, 'Codex → Grok → stitch');
    const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
      method: 'POST',
      body: JSON.stringify({
        action: 'continue',
        jobId: job.jobId,
        scenes,
        grokDialogue: Boolean(grokDialogueEl?.checked),
        musicOnly: Boolean(musicOnlyEl?.checked),
        title: titleInput?.value || job.title,
        autoRun: true,
      }),
    });
    genBusy(card, false);
    if (!ok) {
      throw new Error(
        (data && (data.message || data.error)) || `Continue failed (HTTP ${status || '?'})`,
      );
    }
    updateCardFromStatus(job, data);
    startPoll();
  }

  function genBusy(card, busy) {
    const btn = card?.querySelector('.viral-generate-btn');
    if (btn) btn.disabled = busy;
  }

  function updateCardFromStatus(job, data) {
    const card = ensureBatchCard(job);
    if (!card) return;
    const stage = data?.stage || data?.status || 'unknown';
    if (job) job.stage = stage;
    const statusEl = card.querySelector('.result-status');
    if (statusEl) {
      let label = stageLabel(stage, data);
      if (stage === 'stitched' && job.account) {
        label += job.tagged ? ` · ${job.account}` : ` → ${job.account}`;
      }
      statusEl.textContent = label;
    }
    const errEl = card.querySelector('.result-error');
    if (errEl) {
      if (
        (stage === 'error' ||
          stage === 'waiting_provider' ||
          stage === 'provider_cooldown' ||
          stage === 'provider_give_up') &&
        data?.message
      ) {
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

    renderSceneEditor(card, job, data);

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

  function createFailureDetail(data, status, index) {
    return (
      (data && (data.message || data.error)) ||
      `Failed to start job ${index + 1} (HTTP ${status || '?'})`
    );
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
        /* ignore */
      }
    }
    if (configEl) {
      configEl.hidden = false;
      const note =
        data?.viralBuilderNote ||
        'Analyze → write prompts → generate. Codex uses your scene prompts + identity lock.';
      const baseMsg = data?.message || (ok ? 'Configured' : 'Worker not configured');
      configEl.textContent = healthNote ? `${healthNote} · ${note}` : `${baseMsg} · ${note}`;
    }
    return { ok, data };
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
    let awaiting = 0;
    let done = 0;
    let failed = 0;
    for (const job of batchJobs) {
      if (String(job.jobId || '').startsWith('submit-failed-')) {
        failed += 1;
        continue;
      }
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
      );
      if (!ok) {
        ensureBatchCard(job);
        continue;
      }
      // Preserve in-progress drafts while polling.
      const card = ensureBatchCard(job);
      if (card && isAwaitingPrompts(job.stage)) {
        job.scenesDraft = collectSceneDrafts(card);
      }
      updateCardFromStatus(job, data);
      const stage = data?.stage || '';
      if (stage === 'stitched') done += 1;
      else if (stage === 'error') failed += 1;
      else if (isAwaitingPrompts(stage)) awaiting += 1;
      else active += 1;
    }
    setStatus(
      `Viral builder: ${awaiting} awaiting prompts · ${active} generating · ${done} done · ${failed} failed`,
      'Analyze finishes at “Ready — write prompts”. Then Generate remake.',
    );
    saveBatch();
    if (active === 0 && awaiting === 0 && !submitting) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (analyzeBtn) analyzeBtn.disabled = false;
    } else if (awaiting > 0 && active === 0 && !submitting) {
      // Keep a slow poll so quota wait / resume still updates if user leaves editor open.
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollBatch, POLL_MS);
    pollBatch();
  }

  async function clearFinishedFromList() {
    setError('');
    const finished = batchJobs.filter(isTerminalJob);
    const orphanFailCards = batchList
      ? Array.from(batchList.querySelectorAll('.download-result-card')).filter((card) => {
          const id = String(card.dataset.jobId || '');
          return id.startsWith('fail-') || id.startsWith('submit-failed-');
        })
      : [];
    if (!finished.length && !orphanFailCards.length) {
      setStatus('No finished jobs to clear.', 'In-flight and awaiting-prompt jobs stay.');
      return;
    }
    const ok = confirm(
      `Clear ${finished.length + orphanFailCards.length} finished job(s) from this list?\n\nAwaiting-prompt and in-flight jobs stay. Does not delete R2 files.`,
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
      keep.length ? `Cleared finished · ${keep.length} still on list` : 'Cleared finished jobs.',
      'R2 finals unchanged.',
    );
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

  tiktokUrls?.addEventListener('input', updateUrlCount);
  clearFinishedBtn?.addEventListener('click', () => {
    clearFinishedFromList().catch((err) => setError(err?.message || String(err)));
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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'viral-video-builder')) {
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
      setStatus('Ready — pick account (optional) + character + TikTok URL(s), then Analyze.');
    }
  }

  analyzeBtn?.addEventListener('click', async () => {
    setError('');
    const urls = parseUrls(tiktokUrls?.value);
    if (!urls.length) {
      setError('Paste 1–5 TikTok URLs (one per line).');
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
    if (!grokDialogueEl?.checked && !musicOnlyEl?.checked) {
      setError('Check at least one audio option (Grok dialogue and/or Music-only).');
      return;
    }
    for (const u of urls) {
      if (!/tiktok\.com\//i.test(u) && !/vm\.tiktok\.com\//i.test(u)) {
        setError(`Not a TikTok URL: ${u}`);
        return;
      }
    }

    submitting = true;
    if (analyzeBtn) analyzeBtn.disabled = true;
    try {
      setStatus('Preparing character…');
      const characterKey = await accountsUi.resolveCharacterKeyForCreate(uploadImage);
      if (!characterKey) {
        throw new Error('Character key missing — upload a character or pick an account with one saved.');
      }
      const account = accountsUi.selected() || '';
      const baseTitle = titleInput?.value || 'Viral Video Builder — Write From Scratch';
      const failures = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        setStatus(`Analyzing ${i + 1} / ${urls.length}`, url);
        const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
          method: 'POST',
          body: JSON.stringify({
            action: 'from-tiktok',
            tiktokUrl: url,
            characterKey,
            characterMode: 'upload',
            version: 'v2',
            identityLock: true,
            writeFromScratch: true,
            remixVariant: 'viral-builder',
            grokDialogue: Boolean(grokDialogueEl?.checked),
            musicOnly: Boolean(musicOnlyEl?.checked),
            deriveCharacterFromSource: false,
            title: urls.length > 1 ? `${baseTitle} (${i + 1}/${urls.length})` : baseTitle,
            autoRun: false,
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
          title: baseTitle,
          characterKey,
          characterUrl: data.characterUrl || '',
          account: account || undefined,
          tagged: false,
          stage: data.stage || 'analyzing',
        };
        batchJobs.push(job);
        ensureBatchCard(job);
        updateCardFromStatus(job, data);
      }
      saveBatch();
      if (failures.length) setError(failures.join('\n'));
      startPoll();
      setStatus(
        failures.length
          ? `Started with ${failures.length} failure(s)`
          : 'Analyze running — write prompts when scenes appear.',
      );
      accountsUi?.refresh?.().catch(() => {});
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed');
      if (analyzeBtn) analyzeBtn.disabled = false;
    } finally {
      submitting = false;
    }
  });

  boot();
})();
