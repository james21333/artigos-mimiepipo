(function () {
  const MAX_URLS = 10;
  const POLL_MS = 4000;
  const MAX_POLL_ERRORS = 8;
  /** Cap concurrent GhostCut cleans to avoid vendor throttle / credit spikes. */
  const MAX_CLEAN_IN_FLIGHT = 3;
  // Auto-Clean is always on for admin (no UI checkbox). Download role never cleans.
  function autoCleanOptions(account, sourceKey) {
    return {
      removeWatermark: false,
      cleanMetadata: true,
      alterAudio: true,
      basicVideoRemix: false,
      remix: false,
      deepAiRemake: true,
      mirror: false,
      account: account || null,
      sourceKey: sourceKey || null,
    };
  }

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const urlsInput = document.getElementById('tiktok-urls');
  const urlCount = document.getElementById('url-count');
  const smallerNoHd = document.getElementById('opt-smaller-no-hd');
  const downloadBtn = document.getElementById('download-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const downloadError = document.getElementById('download-error');
  const results = document.getElementById('results');
  const libraryNote = document.getElementById('library-note');
  const accountSelect = document.getElementById('account-select');
  const editAccountBtn = document.getElementById('edit-account-btn');
  const editAccountForm = document.getElementById('edit-account-form');
  const editAccountName = document.getElementById('edit-account-name');
  const editAccountCancel = document.getElementById('edit-account-cancel');
  const createAccountForm = document.getElementById('create-account-form');
  const newAccountName = document.getElementById('new-account-name');
  const accountError = document.getElementById('account-error');

  let sessionRole = 'admin';
  let stopRequested = false;
  /** @type {Map<HTMLElement, { workId: string, errors: number, done: boolean, failed?: boolean }>} */
  const pendingCleans = new Map();
  /** @type {{ card: HTMLElement, key: string, account?: string|null }[]} */
  const cleanSubmitQueue = [];
  let cleanSubmitActive = 0;
  let cleanPollTimer = null;
  let cleanPollInFlight = false;
  let batchActive = false;

  function selectedAccount() {
    return (accountSelect && accountSelect.value ? accountSelect.value : '').trim();
  }

  /** Admin always cleans after download; download-only role never does. */
  function shouldAutoClean() {
    return sessionRole !== 'download';
  }

  function setAccountError(msg) {
    if (!accountError) return;
    if (msg) {
      accountError.hidden = false;
      accountError.textContent = msg;
    } else {
      accountError.hidden = true;
      accountError.textContent = '';
    }
  }

  function syncEditAccountButton() {
    if (!editAccountBtn) return;
    editAccountBtn.hidden = !selectedAccount();
  }

  function fillAccountSelect(accounts, prefer) {
    if (!accountSelect) return;
    const current = prefer != null ? prefer : accountSelect.value;
    const names = (accounts || []).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);
    accountSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— No account (Cleaned videos) —';
    accountSelect.appendChild(none);
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      accountSelect.appendChild(opt);
    }
    if (current && names.includes(current)) {
      accountSelect.value = current;
    } else {
      accountSelect.value = '';
    }
    syncEditAccountButton();
  }

  async function loadAccounts(prefer) {
    const { ok, data } = await api('/api/contentstation/accounts?action=list');
    if (!ok) {
      setAccountError((data && (data.message || data.error)) || 'Could not load accounts.');
      return [];
    }
    const accounts = data.accounts || [];
    fillAccountSelect(accounts, prefer);
    setAccountError('');
    return accounts;
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
      if (gateError) {
        gateError.hidden = false;
        gateError.textContent = msg;
      }
    } else if (gateError) {
      gateError.hidden = true;
    }
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    sessionRole = (session && session.role) || 'admin';
    if (sessionMeta) {
      sessionMeta.textContent = sessionRole === 'download' ? 'Download access' : 'Signed in';
    }
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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-download')) return false;
    if (window.CSAuth) window.CSAuth.applyNav(data.role);
    showApp(data);
    await loadAccounts().catch(() => {});
    return true;
  }

  function setError(msg) {
    if (!downloadError) return;
    if (msg) {
      downloadError.hidden = false;
      downloadError.textContent = msg;
    } else {
      downloadError.hidden = true;
      downloadError.textContent = '';
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

  function formatBytes(n) {
    if (n == null || !Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function parseUrls(raw) {
    const parts = String(raw || '')
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set();
    const urls = [];
    for (const p of parts) {
      const url = p.replace(/^\d+[\).:\-\s]+/, '').replace(/^[-*]\s+/, '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= MAX_URLS) break;
    }
    return urls;
  }

  function updateUrlCount() {
    if (!urlCount || !urlsInput) return;
    const n = parseUrls(urlsInput.value).length;
    const totalLines = String(urlsInput.value || '')
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean).length;
    urlCount.textContent =
      totalLines > MAX_URLS
        ? `${n} / ${MAX_URLS} links (first ${MAX_URLS} will run)`
        : `${n} / ${MAX_URLS} links`;
  }

  function clearResults() {
    if (!results) return;
    results.innerHTML = '';
    results.hidden = true;
    if (libraryNote) libraryNote.hidden = true;
    pendingCleans.clear();
    cleanSubmitQueue.length = 0;
    cleanSubmitActive = 0;
    stopCleanPoll();
  }

  function ensureResults() {
    results.hidden = false;
    return results;
  }

  function addResultCard(index, url) {
    const card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.index = String(index);
    card.innerHTML = `
      <p class="result-index">#${index + 1}</p>
      <p class="result-url muted-line"></p>
      <p class="result-status status">Queued…</p>
      <p class="result-title" hidden></p>
      <p class="result-meta muted-line" hidden></p>
      <video class="result-preview" controls playsinline preload="metadata" hidden></video>
      <p class="row result-actions" hidden>
        <a class="btn-link result-download" href="#" download>Download MP4</a>
        <a class="btn-link result-clean" href="./">Clean this video</a>
        <a class="btn-link result-cleaned-lib" href="./cleaned.html" hidden>Open Cleaned videos</a>
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
    const actions = card.querySelector('.result-actions');
    const preview = card.querySelector('.result-preview');
    const title = card.querySelector('.result-title');
    const meta = card.querySelector('.result-meta');
    if (actions) actions.hidden = true;
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
    if (title) title.hidden = true;
    if (meta) meta.hidden = true;
    if (!el) return;
    if (msg) {
      el.hidden = false;
      el.textContent = msg;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function fillCardSuccess(card, data) {
    setCardError(card, '');
    const title = (data.meta && data.meta.title) || 'TikTok video';
    const author = data.meta && data.meta.author ? `@${data.meta.author}` : '';
    const quality = data.quality || data.meta?.quality;
    const titleEl = card.querySelector('.result-title');
    const metaEl = card.querySelector('.result-meta');
    const preview = card.querySelector('.result-preview');
    const actions = card.querySelector('.result-actions');
    const dl = card.querySelector('.result-download');
    const cleanLink = card.querySelector('.result-clean');
    titleEl.hidden = false;
    titleEl.textContent = title;
    metaEl.hidden = false;
    metaEl.textContent = [
      author,
      quality === 'hd' ? 'HD' : quality === 'standard' ? 'standard' : '',
      formatBytes(data.size),
      data.meta?.duration != null ? `${data.meta.duration}s` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (data.downloadPath) {
      preview.hidden = false;
      preview.src = data.downloadPath;
      actions.hidden = false;
      dl.href = data.downloadPath;
      dl.setAttribute('download', (data.key || 'tiktok.mp4').split('/').pop());
      if (cleanLink && data.key) {
        cleanLink.href = `./?media=${encodeURIComponent(data.key)}`;
      }
    }
    setCardStatus(card, 'Saved');
    if (libraryNote) libraryNote.hidden = false;
  }

  function markCardCleaned(card, data) {
    setCardError(card, '');
    const account = data?.account || '';
    setCardStatus(
      card,
      account
        ? `Cleaned · Ready For Upload (${account})`
        : data?.inLibrary || data?.savingToLibrary
          ? 'Cleaned · in Cleaned videos'
          : 'Cleaned',
    );
    const cleanLink = card.querySelector('.result-clean');
    const libLink = card.querySelector('.result-cleaned-lib');
    if (cleanLink) cleanLink.hidden = true;
    if (libLink) {
      libLink.hidden = false;
      if (account) {
        libLink.href = `./ready-account.html?account=${encodeURIComponent(account)}`;
        libLink.textContent = `Open ${account}`;
      } else {
        libLink.href = './cleaned.html';
        libLink.textContent = 'Open Cleaned videos';
      }
    }
    if (libraryNote) {
      libraryNote.hidden = false;
      libraryNote.innerHTML = account
        ? `Saved downloads live in <a class="btn-link" href="./downloaded.html">Downloaded videos</a>. Cleaned clips are tagged for <a class="btn-link" href="./ready-account.html?account=${encodeURIComponent(account)}">${account}</a> under <a class="btn-link" href="./ready.html">Ready For Upload</a>.`
        : 'Saved downloads live in <a class="btn-link" href="./downloaded.html">Downloaded videos</a>. Cleaned clips go to <a class="btn-link" href="./cleaned.html">Cleaned videos</a>.';
    }
  }

  function stopCleanPoll() {
    if (cleanPollTimer) {
      clearInterval(cleanPollTimer);
      cleanPollTimer = null;
    }
  }

  function ensureCleanPoll() {
    if (cleanPollTimer) return;
    cleanPollTimer = setInterval(() => {
      pollPendingCleans().catch(() => {});
    }, POLL_MS);
  }

  function summarizeBatch() {
    let cleaning = 0;
    let cleaned = 0;
    let cleanFailed = 0;
    for (const job of pendingCleans.values()) {
      if (job.done) {
        if (job.failed) cleanFailed += 1;
        else cleaned += 1;
      } else {
        cleaning += 1;
      }
    }
    const queued = cleanSubmitQueue.length;
    return { cleaning, cleaned, cleanFailed, queued };
  }

  function refreshBatchStatus(baseMain, baseDetail) {
    const { cleaning, cleaned, cleanFailed, queued } = summarizeBatch();
    if (!cleaning && !cleaned && !cleanFailed && !queued) {
      if (baseMain) setStatus(baseMain, baseDetail);
      return;
    }
    const cleanBits = [];
    if (queued) cleanBits.push(`${queued} clean queued`);
    if (cleaning) cleanBits.push(`${cleaning} cleaning`);
    if (cleaned) cleanBits.push(`${cleaned} cleaned`);
    if (cleanFailed) cleanBits.push(`${cleanFailed} clean failed`);
    const cleanLine = cleanBits.join(' · ');
    if (batchActive) {
      setStatus(baseMain || 'Working…', [baseDetail, cleanLine].filter(Boolean).join(' · '));
    } else if (cleaning) {
      setStatus('Cleaning…', `${cleanLine} · keep this tab open`);
      if (stopBtn) {
        stopBtn.hidden = false;
        stopBtn.textContent = 'Stop polling';
      }
    } else {
      setStatus('Done', [baseDetail, cleanLine].filter(Boolean).join(' · '));
      if (!batchActive && stopBtn) {
        stopBtn.hidden = true;
        stopBtn.textContent = 'Stop';
      }
    }
  }

  async function pollPendingCleans() {
    if (cleanPollInFlight) return;
    const entries = [...pendingCleans.entries()].filter(([, j]) => !j.done);
    if (!entries.length) {
      stopCleanPoll();
      refreshBatchStatus('Done', null);
      return;
    }

    cleanPollInFlight = true;
    try {
      for (const [card, job] of entries) {
        try {
          const { ok, data } = await api('/api/contentstation/clean', {
            method: 'POST',
            body: JSON.stringify({ action: 'status', workId: job.workId }),
          });
          if (!ok || !data) {
            job.errors += 1;
            if (job.errors >= MAX_POLL_ERRORS) {
              job.done = true;
              job.failed = true;
              setCardError(
                card,
                (data && (data.message || data.error)) ||
                  'Clean status check failed repeatedly.',
              );
              setCardStatus(card, 'Clean failed');
              onCleanSlotFreed();
            }
            continue;
          }
          job.errors = 0;
          if (data.workId) job.workId = data.workId;

          if (data.state === 'ready' && data.downloadUrl) {
            job.done = true;
            job.failed = false;
            markCardCleaned(card, data);
            onCleanSlotFreed();
          } else if (data.state === 'failed') {
            job.done = true;
            job.failed = true;
            setCardError(card, data.error || data.message || 'Cleaning failed.');
            setCardStatus(card, 'Clean failed');
            onCleanSlotFreed();
          } else {
            const label = data.label || 'Cleaning…';
            const prog =
              data.progress != null && data.progress !== ''
                ? ` · ${data.progress}%`
                : '';
            setCardStatus(card, `${label}${prog}`);
          }
        } catch {
          job.errors += 1;
          if (job.errors >= MAX_POLL_ERRORS) {
            job.done = true;
            job.failed = true;
            setCardError(card, 'Network error while checking clean status.');
            setCardStatus(card, 'Clean failed');
            onCleanSlotFreed();
          }
        }
      }
    } finally {
      cleanPollInFlight = false;
      refreshBatchStatus(
        batchActive && statusLine ? statusLine.textContent : null,
        batchActive && statusDetail ? statusDetail.textContent : null,
      );
      const stillBusy =
        [...pendingCleans.values()].some((j) => !j.done) || cleanSubmitQueue.length > 0;
      if (!stillBusy) {
        stopCleanPoll();
        if (!batchActive) {
          if (stopBtn) {
            stopBtn.hidden = true;
            stopBtn.textContent = 'Stop';
          }
          const { cleaned, cleanFailed } = summarizeBatch();
          setStatus(
            'Done',
            `${cleaned} cleaned · ${cleanFailed} clean failed · see Cleaned videos`,
          );
        }
      }
    }
  }

  async function resolveFetchUrl(key) {
    const { ok, data } = await api(
      `/api/contentstation/media?action=meta&key=${encodeURIComponent(key)}`,
    );
    if (!ok) {
      throw new Error((data && (data.message || data.error)) || 'Could not resolve media URL.');
    }
    const fetchUrl =
      (data.object && (data.object.fetchUrl || data.object.publicUrl)) ||
      data.fetchUrl ||
      data.publicUrl;
    if (!fetchUrl || !/^https?:\/\//i.test(fetchUrl)) {
      throw new Error('No public URL available for cleaning.');
    }
    return fetchUrl;
  }

  function inFlightCleanCount() {
    let n = 0;
    for (const job of pendingCleans.values()) {
      if (!job.done) n += 1;
    }
    return n;
  }

  function onCleanSlotFreed() {
    drainCleanSubmitQueue().catch(() => {});
  }

  async function drainCleanSubmitQueue() {
    while (
      cleanSubmitQueue.length > 0 &&
      inFlightCleanCount() < MAX_CLEAN_IN_FLIGHT &&
      cleanSubmitActive < MAX_CLEAN_IN_FLIGHT
    ) {
      const next = cleanSubmitQueue.shift();
      if (!next) break;
      // eslint-disable-next-line no-await-in-loop
      await submitAutoClean(next.card, next.key, next.account);
    }
    refreshBatchStatus(
      batchActive && statusLine ? statusLine.textContent : null,
      batchActive && statusDetail ? statusDetail.textContent : null,
    );
  }

  async function submitAutoClean(card, key, account) {
    cleanSubmitActive += 1;
    setCardStatus(card, 'Starting clean…');
    setCardError(card, '');
    try {
      const videoUrl = await resolveFetchUrl(key);
      const { ok, data } = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          videoUrl,
          options: autoCleanOptions(account, key),
        }),
      });
      if (!ok || !data?.workId) {
        throw new Error((data && (data.message || data.error)) || 'Could not start clean.');
      }
      pendingCleans.set(card, { workId: data.workId, errors: 0, done: false });
      setCardStatus(card, 'Cleaning…');
      const cleanLink = card.querySelector('.result-clean');
      if (cleanLink) cleanLink.hidden = true;
      ensureCleanPoll();
      pollPendingCleans().catch(() => {});
    } catch (err) {
      // Download already succeeded — clean failure must not undo it.
      setCardError(card, String(err?.message || err));
      setCardStatus(card, 'Saved · clean failed');
      const cleanLink = card.querySelector('.result-clean');
      if (cleanLink) cleanLink.hidden = false;
    } finally {
      cleanSubmitActive = Math.max(0, cleanSubmitActive - 1);
      // Try to start another queued clean if a slot opened (submit failed or finished kickoff).
      if (cleanSubmitQueue.length && inFlightCleanCount() < MAX_CLEAN_IN_FLIGHT) {
        drainCleanSubmitQueue().catch(() => {});
      }
    }
  }

  function enqueueAutoClean(card, key, account) {
    const cleanLink = card.querySelector('.result-clean');
    if (cleanLink) cleanLink.hidden = true;

    if (inFlightCleanCount() + cleanSubmitActive < MAX_CLEAN_IN_FLIGHT) {
      return submitAutoClean(card, key, account);
    }

    cleanSubmitQueue.push({ card, key, account });
    setCardStatus(card, `Queued for clean (${cleanSubmitQueue.length} waiting)…`);
    setCardError(card, '');
    return Promise.resolve();
  }

  function startAutoClean(card, key, account) {
    return enqueueAutoClean(card, key, account);
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError('');
      const passwordEl = document.getElementById('password');
      const password = passwordEl ? passwordEl.value : '';
      const { ok, data } = await api('/api/contentstation/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (!ok) {
        showGate(data?.error === 'invalid_password' ? 'Wrong password' : data?.error || 'Sign-in failed');
        return;
      }
      if (passwordEl) passwordEl.value = '';
      await refreshSession();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
      showGate();
    });
  }

  if (urlsInput) urlsInput.addEventListener('input', updateUrlCount);
  updateUrlCount();

  accountSelect?.addEventListener('change', () => {
    setAccountError('');
    syncEditAccountButton();
    if (editAccountForm) editAccountForm.hidden = true;
  });

  function showEditAccountForm(show) {
    if (!editAccountForm || !editAccountBtn) return;
    const name = selectedAccount();
    if (show && !name) {
      setAccountError('Select an account to edit.');
      return;
    }
    editAccountForm.hidden = !show;
    editAccountBtn.hidden = show || !name;
    if (show && editAccountName) {
      editAccountName.value = name;
      editAccountName.focus();
      editAccountName.select();
    }
  }

  editAccountBtn?.addEventListener('click', () => {
    setAccountError('');
    showEditAccountForm(true);
  });

  editAccountCancel?.addEventListener('click', () => {
    setAccountError('');
    showEditAccountForm(false);
  });

  editAccountForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAccountError('');
    const from = selectedAccount();
    const to = (editAccountName?.value || '').trim();
    if (!from) {
      setAccountError('Select an account to edit.');
      return;
    }
    if (!to) {
      setAccountError('Enter an account name.');
      return;
    }
    if (to === from) {
      showEditAccountForm(false);
      return;
    }
    const saveBtn = editAccountForm.querySelector('button[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;
    if (editAccountCancel) editAccountCancel.disabled = true;
    if (editAccountName) editAccountName.disabled = true;
    try {
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'rename', from, to }),
      });
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not rename account.');
      }
      fillAccountSelect(data.accounts || [], data.to || to);
      showEditAccountForm(false);
    } catch (err) {
      setAccountError(err && err.message ? err.message : String(err));
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (editAccountCancel) editAccountCancel.disabled = false;
      if (editAccountName) editAccountName.disabled = false;
    }
  });

  createAccountForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAccountError('');
    const name = (newAccountName?.value || '').trim();
    if (!name) {
      setAccountError('Enter an account name.');
      return;
    }
    const submitBtn = createAccountForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', name }),
      });
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not create account.');
      }
      if (newAccountName) newAccountName.value = '';
      fillAccountSelect(data.accounts || [], data.name || name);
    } catch (err) {
      setAccountError(err && err.message ? err.message : String(err));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (batchActive) {
        stopRequested = true;
        setStatus('Stopping…', 'Finishing the current download, then stopping. Cleans already started keep running.');
        return;
      }
      // After downloads finished: stop queue + polling (already-submitted GhostCut jobs keep running).
      const skippedQueue = cleanSubmitQueue.length;
      cleanSubmitQueue.length = 0;
      stopCleanPoll();
      stopBtn.hidden = true;
      stopBtn.textContent = 'Stop';
      const { cleaning, cleaned, cleanFailed } = summarizeBatch();
      setStatus(
        'Polling stopped',
        [
          cleaning ? `${cleaning} still processing on GhostCut` : null,
          skippedQueue ? `${skippedQueue} queued cleans skipped` : null,
          `${cleaned} cleaned`,
          `${cleanFailed} failed`,
          'check Cleaned videos later',
        ]
          .filter(Boolean)
          .join(' · '),
      );
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      setError('');
      clearResults();
      stopRequested = false;
      batchActive = true;
      if (stopBtn) stopBtn.textContent = 'Stop';

      const urls = parseUrls(urlsInput ? urlsInput.value : '');
      if (!urls.length) {
        setError('Paste at least one TikTok URL (one per line).');
        batchActive = false;
        return;
      }

      const smallerFile = Boolean(smallerNoHd && smallerNoHd.checked);
      const account = selectedAccount() || null;
      // Always-on for admin; download role never cleans (no UI checkbox).
      const autoClean = shouldAutoClean();

      downloadBtn.disabled = true;
      if (stopBtn) stopBtn.hidden = false;

      let okCount = 0;
      let failCount = 0;
      let cleanStarted = 0;

      for (let i = 0; i < urls.length; i++) {
        if (stopRequested) {
          refreshBatchStatus(
            'Stopped',
            `${okCount} saved · ${failCount} failed · ${urls.length - i} skipped`,
          );
          break;
        }

        const url = urls[i];
        const card = addResultCard(i, url);
        setCardStatus(card, 'Downloading…');
        setStatus(
          `Downloading ${i + 1} / ${urls.length}…`,
          [
            smallerFile ? 'Smaller (no HD)' : 'HD when available',
            autoClean ? (account ? `then clean → ${account}` : 'then clean') : null,
          ]
            .filter(Boolean)
            .join(' · '),
        );

        try {
          const { ok, data } = await api('/api/contentstation/tiktok-download', {
            method: 'POST',
            body: JSON.stringify({ url, smallerFile }),
          });
          if (!ok) {
            failCount += 1;
            const detail = data?.detail ? ` (${data.detail})` : '';
            setCardError(card, (data?.message || data?.error || 'Download failed') + detail);
            setCardStatus(card, 'Failed');
          } else {
            okCount += 1;
            fillCardSuccess(card, data);

            if (autoClean && data.key && !stopRequested) {
              await startAutoClean(card, data.key, account);
              if (pendingCleans.has(card) || cleanSubmitQueue.some((q) => q.card === card)) {
                cleanStarted += 1;
              }
              refreshBatchStatus(
                `Downloading ${Math.min(i + 2, urls.length)} / ${urls.length}…`,
                `${okCount} saved · ${cleanStarted} queued for clean${account ? ` · ${account}` : ''}`,
              );
            }
          }
        } catch (err) {
          failCount += 1;
          setCardError(card, String(err?.message || err));
          setCardStatus(card, 'Failed');
        }

        // Backup resolver (tikwm) is ~1 req/sec — space batch items so fallbacks don’t 429.
        if (i < urls.length - 1 && !stopRequested) {
          await new Promise((r) => setTimeout(r, 1100));
        }
      }

      batchActive = false;

      if (!stopRequested) {
        const base = `${okCount} saved · ${failCount} failed · ${urls.length} total`;
        if (autoClean && cleanStarted) {
          refreshBatchStatus('Downloads done · cleaning…', `${base} · keep this tab open`);
          if (stopBtn) {
            stopBtn.hidden = false;
            stopBtn.textContent = 'Stop polling';
          }
        } else {
          setStatus('Done', base);
          if (stopBtn) {
            stopBtn.hidden = true;
            stopBtn.textContent = 'Stop';
          }
        }
        if (failCount && !okCount) {
          setError('All downloads failed. Check the errors on each card.');
        }
      } else if (stopBtn) {
        stopBtn.hidden = ![...pendingCleans.values()].some((j) => !j.done);
        stopBtn.textContent = stopBtn.hidden ? 'Stop' : 'Stop polling';
      }

      downloadBtn.disabled = false;
      stopRequested = false;
    });
  }

  refreshSession();
})();
