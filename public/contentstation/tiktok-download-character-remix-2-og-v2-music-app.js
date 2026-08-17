(function () {
  const MAX_URLS = 20;
  const POLL_MS = 180000;
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
  const dupBanner = document.getElementById('remix-dup-banner');
  const urlCountEl = document.getElementById('url-count');
  const tiktokUrls = document.getElementById('tiktok-urls');
  const titleInput = document.getElementById('job-title');
  const restoreOverlaysEl = document.getElementById('restore-overlays');
  const subtleRewriteOverlaysEl = document.getElementById('subtle-rewrite-overlays');
  const autogenRandomEl = document.getElementById('autogen-random');
  const autogenListEl = document.getElementById('autogen-account-list');
  const autogenEmptyEl = document.getElementById('autogen-empty');
  const autogenSummaryEl = document.getElementById('autogen-summary');
  const autogenBtn = document.getElementById('autogen-btn');
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
      onAccountChange: (account) => {
        if (account) autogenChecked.add(account);
        renderAutogen();
      },
    });

  const listsUi =
    window.CSTikTokLists &&
    window.CSTikTokLists.createController({
      api,
      onChange: () => {
        loadSourcePool().catch(() => {});
      },
    });

  function selectedListId() {
    return listsUi?.selected?.() || 'glp-1';
  }

  const FEATURED_ACCOUNT_RE = /^(1|2|3|6|7|8|10)(\D|$)/;
  /** @type {any[]} */
  let sourcePool = [];
  /** @type {Set<string>} */
  const autogenChecked = new Set();
  /** @type {Set<string>} leftover url keys `${account}\t${url}` */
  const leftoverChecked = new Set();

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
    if (data?.outputUploaded) {
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

  function leftoverKey(account, url) {
    return `${account}\t${url}`;
  }

  function accountNum(name) {
    const m = String(name || '').match(/^(\d+)/);
    return m ? Number(m[1]) : 999;
  }

  function isFeaturedAccount(name) {
    return FEATURED_ACCOUNT_RE.test(String(name || '').trim());
  }

  function poolFor(account) {
    return sourcePool.find((p) => p.account === account) || null;
  }

  function selectedAutogenAccounts() {
    return sourcePool.filter((p) => autogenChecked.has(p.account));
  }

  function plannedAutogenJobs() {
    const random = Boolean(autogenRandomEl?.checked);
    const jobs = [];
    const blocked = [];
    for (const p of selectedAutogenAccounts()) {
      if (!p.characterKey) {
        blocked.push(`${p.account} — no character image`);
        continue;
      }
      if (random) {
        if (!p.leftover?.length) {
          blocked.push(`${p.account} — no leftovers`);
          continue;
        }
        jobs.push({ account: p.account, characterKey: p.characterKey, pick: 'random', leftover: p.leftover });
        continue;
      }
      const picked = (p.leftover || []).filter((item) => leftoverChecked.has(leftoverKey(p.account, item.url)));
      if (!picked.length) {
        blocked.push(`${p.account} — pick at least one leftover URL`);
        continue;
      }
      for (const item of picked) {
        jobs.push({
          account: p.account,
          characterKey: p.characterKey,
          url: item.url,
        });
      }
    }
    return { jobs, blocked, random };
  }

  function renderAutogen() {
    if (!autogenListEl) return;
    autogenListEl.innerHTML = '';
    const random = Boolean(autogenRandomEl?.checked);
    if (autogenEmptyEl) autogenEmptyEl.hidden = sourcePool.length > 0;
    const featured = sourcePool.filter((p) => isFeaturedAccount(p.account));
    const rest = sourcePool.filter((p) => !isFeaturedAccount(p.account));
    const groups = [
      { label: 'Accounts 1, 2, 3, 6, 7, 8, 10', rows: featured },
      { label: 'Other accounts', rows: rest },
    ];
    for (const group of groups) {
      if (!group.rows.length) continue;
      const heading = document.createElement('li');
      heading.className = 'autogen-group-label';
      heading.style.listStyle = 'none';
      heading.textContent = group.label;
      autogenListEl.appendChild(heading);
      for (const p of group.rows) {
        const li = document.createElement('li');
        const blocked = !p.characterKey;
        li.className = 'autogen-account-row' + (blocked ? ' is-blocked' : '');
        const id = `autogen-acc-${accountNum(p.account)}-${encodeURIComponent(p.account).slice(0, 40)}`;
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.id = id;
        check.checked = autogenChecked.has(p.account);
        check.disabled = blocked || (!random && !(p.leftover || []).length && !p.characterKey);
        if (!p.leftover?.length) check.disabled = true;
        if (blocked) check.disabled = true;
        check.addEventListener('change', () => {
          if (check.checked) autogenChecked.add(p.account);
          else autogenChecked.delete(p.account);
          renderAutogen();
        });
        let thumb;
        if (p.characterUrl) {
          thumb = document.createElement('img');
          thumb.className = 'autogen-thumb';
          thumb.alt = '';
          thumb.src = p.characterUrl;
        } else {
          thumb = document.createElement('div');
          thumb.className = 'autogen-thumb is-empty';
          thumb.textContent = 'No img';
        }
        const meta = document.createElement('div');
        meta.className = 'autogen-account-meta';
        const nameEl = document.createElement('strong');
        nameEl.textContent = p.account;
        const sub = document.createElement('span');
        sub.textContent = blocked
          ? 'Save a character for this account before autogenerate'
          : `${p.leftoverCount} leftover · ${p.remixedCount} already remixed · ${p.poolCount} on list`;
        meta.appendChild(nameEl);
        meta.appendChild(sub);
        const count = document.createElement('span');
        count.className = 'autogen-count' + (p.leftoverCount ? '' : ' is-zero');
        count.textContent = p.leftoverCount ? `${p.leftoverCount} left` : '0 left';
        li.appendChild(check);
        li.appendChild(thumb);
        li.appendChild(meta);
        li.appendChild(count);
        if (!random && check.checked && p.leftover?.length && p.characterKey) {
          const wrap = document.createElement('div');
          wrap.className = 'autogen-leftovers';
          for (const item of p.leftover) {
            const lab = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = leftoverChecked.has(leftoverKey(p.account, item.url));
            cb.addEventListener('change', () => {
              const k = leftoverKey(p.account, item.url);
              if (cb.checked) leftoverChecked.add(k);
              else leftoverChecked.delete(k);
              updateAutogenSummary();
            });
            const u = document.createElement('span');
            u.textContent = item.url;
            lab.appendChild(cb);
            lab.appendChild(u);
            wrap.appendChild(lab);
          }
          li.appendChild(wrap);
        }
        autogenListEl.appendChild(li);
      }
    }
    updateAutogenSummary();
  }

  function updateAutogenSummary() {
    const { jobs, blocked, random } = plannedAutogenJobs();
    const accounts = new Set(jobs.map((j) => j.account)).size;
    let text = '';
    if (jobs.length) {
      text = random
        ? `Will queue ${jobs.length} random leftover${jobs.length === 1 ? '' : 's'} · ${accounts} account${accounts === 1 ? '' : 's'}`
        : `Will queue ${jobs.length} selected leftover${jobs.length === 1 ? '' : 's'} · ${accounts} account${accounts === 1 ? '' : 's'}`;
    } else if (selectedAutogenAccounts().length) {
      text = blocked[0] || 'Nothing to queue — check leftovers and character images.';
    } else {
      text = 'Check one or more accounts above.';
    }
    if (autogenSummaryEl) autogenSummaryEl.textContent = text;
    if (autogenBtn) autogenBtn.disabled = submitting || !jobs.length;
  }

  async function loadSourcePool() {
    const listId = encodeURIComponent(selectedListId());
    const { ok, data } = await api(
      `/api/contentstation/character-remix-2-og?action=source-pool&listId=${listId}`,
    );
    sourcePool = ok && Array.isArray(data?.accounts) ? data.accounts : [];
    const titleEl = document.getElementById('autogen-title');
    if (titleEl && data?.listName) {
      titleEl.textContent = `Autogenerate from ${data.listName}`;
    }
    renderAutogen();
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** Download / resolve failures where another leftover URL can satisfy the same account slot. */
  function isReplaceableCreateFailure(data) {
    const err = String(data?.error || '');
    return (
      err === 'file_too_large' ||
      err === 'source_is_speech' ||
      err === 'too_many_scenes' ||
      err === 'resolve_rejected' ||
      err === 'resolve_rate_limited' ||
      err === 'tiktok_download_failed'
    );
  }

  function formatCreateFailure(data, status) {
    const detail =
      (typeof data?.detail === 'string' && data.detail.trim()) ||
      (typeof data?.message === 'string' && data.message.trim()) ||
      '';
    const err = String(data?.error || '');
    if (err === 'file_too_large') {
      return detail ? `Too large (${detail})` : 'Too large (over 40MB)';
    }
    if (err === 'source_is_speech') {
      return 'Spoken dialogue — moved to GLP-1 Speech audio list';
    }
    if (err === 'too_many_scenes') {
      const n = Number(data?.shotCount);
      const max = Number(data?.maxScenes) || 6;
      if (Number.isFinite(n) && n > 0) {
        return `${n} scenes (max ${max}) — removed + blocklisted`;
      }
      return `Too many scenes (max ${max}) — removed + blocklisted`;
    }
    if (detail) return detail;
    if (err) return err;
    if (status) return `Create failed (HTTP ${status})`;
    return 'Create failed';
  }

  function nextLeftoverUrl(leftover, exclude) {
    const pool = (leftover || []).filter((item) => item?.url && !exclude.has(item.url));
    return pickRandom(pool)?.url || null;
  }

  function setDupBanner(skipped, account) {
    if (!dupBanner) return;
    if (!skipped.length) {
      dupBanner.hidden = true;
      dupBanner.innerHTML = '';
      return;
    }
    const title = document.createElement('p');
    title.className = 'duplicate-skip-title';
    title.textContent =
      skipped.length === 1
        ? 'Already remixed for this account — skipped.'
        : `${skipped.length} URLs already remixed for this account — skipped.`;
    const sub = document.createElement('p');
    sub.style.margin = '0 0 0.35rem';
    sub.style.fontWeight = '700';
    sub.textContent = account
      ? `Account: ${account}. Other accounts can still remix these URLs.`
      : 'Pick an account to track per-account duplicates.';
    const list = document.createElement('ul');
    list.className = 'duplicate-skip-list';
    for (const url of skipped) {
      const li = document.createElement('li');
      li.textContent = url;
      list.appendChild(li);
    }
    dupBanner.innerHTML = '';
    dupBanner.appendChild(title);
    dupBanner.appendChild(sub);
    dupBanner.appendChild(list);
    dupBanner.hidden = false;
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

  async function maybeAutoTag(job, stage, data) {
    const uploaded = Boolean(data?.outputUploaded || data?.output_url || data?.outputUrl);
    if (stage !== 'stitched' || !uploaded || !job?.account || job.tagged) return;
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
      const cadence =
        data?.providerProbeCadence ||
        (data?.providerProbePhase === 'slow'
          ? 'checking every 6h'
          : data?.providerProbePhase === 'gave_up'
            ? 'auto-check stopped'
            : 'checking hourly (~168h)');
      label = `${who} cooling down ${est} — ${cadence}, auto-resume`;
    } else if (stage === 'provider_give_up') {
      const provider = data?.provider || '';
      const who =
        provider === 'grok' ? 'Grok/xAI' : provider === 'codex' || provider === 'openai' ? 'OpenAI/Codex' : 'Provider';
      label = `${who} auto-check stopped — re-run to retry`;
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
    maybeAutoTag(job, stage, data).catch(() => {});
  }

  function isPlaceholderJobId(jobId) {
    const id = String(jobId || '');
    return id.startsWith('submit-failed-') || id.startsWith('fail-');
  }

  function jobNeedsPoll(job) {
    return Boolean(job?.jobId) && !isPlaceholderJobId(job.jobId) && !isTerminalStage(job.stage);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollBatch() {
    if (document.hidden) return;
    if (!batchJobs.length) {
      stopPoll();
      return;
    }
    let active = 0;
    let done = 0;
    let failed = 0;
    for (const job of batchJobs) {
      if (isPlaceholderJobId(job.jobId)) {
        failed += 1;
        continue;
      }
      if (isTerminalStage(job.stage)) {
        if (job.stage === 'error') failed += 1;
        else done += 1;
        continue;
      }
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
      );
      if (!ok) {
        ensureBatchCard(job);
        const card = batchList?.querySelector(`[data-job-id="${job.jobId}"]`);
        const statusEl = card?.querySelector('.result-status');
        if (statusEl) statusEl.textContent = 'Worker unreachable — retrying';
        active += 1;
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
      stopPoll();
      if (runBtn) runBtn.disabled = false;
    }
  }

  function startPoll() {
    if (!batchJobs.some(jobNeedsPoll)) {
      stopPoll();
      return;
    }
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollBatch, POLL_MS);
    if (!document.hidden) pollBatch();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPoll();
    else if (batchJobs.some(jobNeedsPoll)) startPoll();
  });

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
  autogenRandomEl?.addEventListener('change', () => renderAutogen());

  clearFinishedBtn?.addEventListener('click', () => {
    clearFinishedFromList().catch((err) => setError(err?.message || String(err)));
  });

  autogenBtn?.addEventListener('click', async () => {
    setError('');
    const plan = plannedAutogenJobs();
    if (!plan.jobs.length) {
      setError(plan.blocked[0] || 'Check accounts that have a character and leftovers.');
      return;
    }
    const work = [];
    for (const job of plan.jobs) {
      if (job.url) {
        work.push({
          account: job.account,
          characterKey: job.characterKey,
          url: job.url,
          leftover: poolFor(job.account)?.leftover || job.leftover || [],
        });
        continue;
      }
      const leftovers = job.leftover || [];
      if (!leftovers.length) continue;
      work.push({
        account: job.account,
        characterKey: job.characterKey,
        url: null,
        leftover: leftovers,
      });
    }
    if (!work.length) {
      setError('No leftover URLs to autogenerate.');
      return;
    }
    submitting = true;
    if (autogenBtn) autogenBtn.disabled = true;
    if (runBtn) runBtn.disabled = true;
    try {
      const baseTitle = titleInput?.value || 'TikTok remake (music-only)';
      const started = [];
      const failures = [];
      const skipped = [];
      const replaced = [];
      setDupBanner([]);
      for (let i = 0; i < work.length; i++) {
        const item = work[i];
        const tried = new Set();
        const maxAttempts = Math.max(
          1,
          Math.min(8, (item.leftover || []).length || (item.url ? 1 : 0)),
        );
        let url = item.url || nextLeftoverUrl(item.leftover, tried);
        let created = null;
        let lastDetail = '';

        for (let attempt = 0; attempt < maxAttempts && url; attempt++) {
          tried.add(url);
          setStatus(
            `Autogenerate ${i + 1} / ${work.length}`,
            attempt === 0
              ? `${item.account} · ${url}`
              : `${item.account} · replace #${attempt} · ${url}`,
          );
          const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
            method: 'POST',
            body: JSON.stringify({
              action: 'from-tiktok',
              tiktokUrl: url,
              characterKey: item.characterKey,
              account: item.account,
              characterMode: 'upload',
              version: 'v2',
              identityLock: true,
              musicLock: true,
              audioMode: 'source',
              remixVariant: 'music-only',
              restoreOverlays: restoreOverlaysEl ? restoreOverlaysEl.checked : true,
              subtleRewriteOverlays: subtleRewriteOverlaysEl
                ? subtleRewriteOverlaysEl.checked
                : true,
              deriveCharacterFromSource: false,
              listId: selectedListId(),
              title: work.length > 1 ? `${baseTitle} (${item.account})` : baseTitle,
              autoRun: true,
            }),
          });
          if (data?.error === 'already_remixed_for_account') {
            skipped.push(url);
            setDupBanner(skipped, item.account);
            url = nextLeftoverUrl(item.leftover, tried);
            continue;
          }
          if (!ok || !data?.jobId) {
            lastDetail = formatCreateFailure(data, status);
            if (isReplaceableCreateFailure(data)) {
              replaced.push(`${item.account}: ${lastDetail} → trying another leftover`);
              showSubmitFailure(url, i * 10 + attempt, `${item.account}: ${lastDetail} — replacing…`);
              url = nextLeftoverUrl(item.leftover, tried);
              continue;
            }
            failures.push(`${item.account}: ${lastDetail}`);
            showSubmitFailure(url, i, `${item.account}: ${lastDetail}`);
            created = null;
            break;
          }
          created = { data, url };
          break;
        }

        if (!created) {
          if (!failures.some((f) => f.startsWith(`${item.account}:`))) {
            failures.push(
              `${item.account}: ${lastDetail || 'No usable leftover after rejects/skips'}`,
            );
          }
          continue;
        }

        const job = {
          jobId: created.data.jobId,
          tiktokUrl: created.url,
          title: created.data.title || baseTitle,
          account: item.account,
          characterKey: item.characterKey,
          tagged: false,
        };
        started.push(job);
        batchJobs.push(job);
        saveBatch();
        updateCardFromStatus(job, created.data);
      }
      await loadSourcePool();
      if (listsUi) await listsUi.load().catch(() => {});
      if (!started.length) {
        if (skipped.length && !failures.length) {
          setStatus('All skipped', 'Those leftovers were already remixed for the selected accounts.');
          return;
        }
        throw new Error(failures[0] || 'Autogenerate did not start any jobs.');
      }
      if (failures.length || replaced.length) {
        setError([...replaced, ...failures].filter(Boolean).join('\n'));
      }
      setStatus(
        `Autogenerated ${started.length} job(s)${skipped.length ? ` · ${skipped.length} skipped` : ''}${
          replaced.length ? ` · ${replaced.length} replaced` : ''
        }`,
        'Each job uses that account’s character. Pipelines queue on Fast Panda.',
      );
      startPoll();
      accountsUi?.refresh?.().catch(() => {});
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed');
    } finally {
      submitting = false;
      updateAutogenSummary();
      if (runBtn) runBtn.disabled = false;
    }
  });

  restoreOverlaysEl?.addEventListener('change', () => {
    if (!subtleRewriteOverlaysEl) return;
    if (!restoreOverlaysEl.checked) {
      subtleRewriteOverlaysEl.checked = false;
      subtleRewriteOverlaysEl.disabled = true;
    } else {
      subtleRewriteOverlaysEl.disabled = false;
    }
  });
  if (restoreOverlaysEl && subtleRewriteOverlaysEl && !restoreOverlaysEl.checked) {
    subtleRewriteOverlaysEl.checked = false;
    subtleRewriteOverlaysEl.disabled = true;
  }

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
      const skipped = [];
      setDupBanner([]);
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        setStatus(`Submitting ${i + 1} / ${urls.length}`, url);
        const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
          method: 'POST',
          body: JSON.stringify({
            action: 'from-tiktok',
            tiktokUrl: url,
            characterKey,
            account: account || undefined,
            characterMode: 'upload',
            version: 'v2',
            identityLock: true,
            musicLock: true,
            audioMode: 'source',
            remixVariant: 'music-only',
            restoreOverlays: restoreOverlaysEl ? restoreOverlaysEl.checked : true,
            subtleRewriteOverlays: subtleRewriteOverlaysEl
              ? subtleRewriteOverlaysEl.checked
              : true,
            deriveCharacterFromSource: false,
            listId: selectedListId(),
            title: urls.length > 1 ? `${baseTitle} (${i + 1}/${urls.length})` : baseTitle,
            autoRun: true,
          }),
        });
        if (data?.error === 'already_remixed_for_account') {
          skipped.push(url);
          setDupBanner(skipped, account);
          continue;
        }
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
        if (skipped.length && !failures.length) {
          setStatus(
            'All skipped',
            `${skipped.length} already remixed for ${account || 'this account'}`,
          );
          return;
        }
        throw new Error(failures[0] || 'No jobs started — worker did not return a jobId.');
      }
      if (failures.length) {
        setError(`${failures.length} URL(s) failed to create. First: ${failures[0]}`);
      }
      setStatus(
        `Submitted ${started.length} job(s)${account ? ` · account ${account}` : ''}${
          skipped.length ? ` · ${skipped.length} skipped` : ''
        }`,
        account
          ? 'Pipelines queue on Fast Panda. Finished MP4s auto-tag to Ready For Upload.'
          : 'Pipelines queue on Fast Panda — one remake at a time. Tag later on the job card or Remix 2 ready.',
      );
      startPoll();
      accountsUi?.refresh?.().catch(() => {});
      loadSourcePool().catch(() => {});
      listsUi?.load?.().catch(() => {});
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
    if (listsUi) await listsUi.load().catch(() => {});
    await loadSourcePool();
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
