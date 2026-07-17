(function () {
  const MAX_URLS = 10;
  const POLL_MS = 4000;
  const MAX_POLL_ERRORS = 8;
  const AUTO_CLEAN_OPTIONS = {
    removeWatermark: false,
    cleanMetadata: true,
    alterAudio: true,
    basicVideoRemix: false,
    remix: false,
    deepAiRemake: true,
    mirror: false,
  };

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const urlsInput = document.getElementById('tiktok-urls');
  const urlCount = document.getElementById('url-count');
  const autoCleanOpt = document.getElementById('opt-auto-clean');
  const smallerNoHd = document.getElementById('opt-smaller-no-hd');
  const downloadBtn = document.getElementById('download-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const downloadError = document.getElementById('download-error');
  const results = document.getElementById('results');
  const libraryNote = document.getElementById('library-note');

  let stopRequested = false;
  /** @type {Map<HTMLElement, { workId: string, errors: number, done: boolean }>} */
  const pendingCleans = new Map();
  let cleanPollTimer = null;
  let cleanPollInFlight = false;
  let batchActive = false;

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
    gate.hidden = false;
    app.hidden = true;
    if (msg) {
      gateError.hidden = false;
      gateError.textContent = msg;
    } else {
      gateError.hidden = true;
    }
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    sessionMeta.textContent = 'Signed in';
  }

  function setError(msg) {
    if (msg) {
      downloadError.hidden = false;
      downloadError.textContent = msg;
    } else {
      downloadError.hidden = true;
      downloadError.textContent = '';
    }
  }

  function setStatus(main, detail) {
    statusLine.textContent = main || '';
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

  function updateDownloadButtonLabel() {
    if (!downloadBtn) return;
    downloadBtn.textContent =
      autoCleanOpt && autoCleanOpt.checked ? 'Download & auto-clean' : 'Download videos';
  }

  function clearResults() {
    results.innerHTML = '';
    results.hidden = true;
    if (libraryNote) libraryNote.hidden = true;
    pendingCleans.clear();
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
    setCardStatus(
      card,
      data?.inLibrary || data?.savingToLibrary
        ? 'Cleaned · in Cleaned videos'
        : 'Cleaned',
    );
    const cleanLink = card.querySelector('.result-clean');
    const libLink = card.querySelector('.result-cleaned-lib');
    if (cleanLink) cleanLink.hidden = true;
    if (libLink) libLink.hidden = false;
    if (libraryNote) {
      libraryNote.hidden = false;
      libraryNote.innerHTML =
        'Saved downloads live in <a class="btn-link" href="./downloaded.html">Downloaded videos</a>. Auto-cleaned clips go to <a class="btn-link" href="./cleaned.html">Cleaned videos</a> — keep this tab open until cleaning finishes.';
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
    return { cleaning, cleaned, cleanFailed };
  }

  function refreshBatchStatus(baseMain, baseDetail) {
    const { cleaning, cleaned, cleanFailed } = summarizeBatch();
    if (!cleaning && !cleaned && !cleanFailed) {
      if (baseMain) setStatus(baseMain, baseDetail);
      return;
    }
    const cleanBits = [];
    if (cleaning) cleanBits.push(`${cleaning} cleaning`);
    if (cleaned) cleanBits.push(`${cleaned} cleaned`);
    if (cleanFailed) cleanBits.push(`${cleanFailed} clean failed`);
    const cleanLine = cleanBits.join(' · ');
    if (batchActive) {
      setStatus(baseMain || 'Working…', [baseDetail, cleanLine].filter(Boolean).join(' · '));
    } else if (cleaning) {
      setStatus('Auto-cleaning…', `${cleanLine} · keep this tab open`);
      stopBtn.hidden = false;
      stopBtn.textContent = 'Stop polling';
    } else {
      setStatus('Done', [baseDetail, cleanLine].filter(Boolean).join(' · '));
      if (!batchActive) {
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
            }
            continue;
          }
          job.errors = 0;
          if (data.workId) job.workId = data.workId;

          if (data.state === 'ready' && data.downloadUrl) {
            job.done = true;
            job.failed = false;
            markCardCleaned(card, data);
          } else if (data.state === 'failed') {
            job.done = true;
            job.failed = true;
            setCardError(card, data.error || data.message || 'Cleaning failed.');
            setCardStatus(card, 'Clean failed');
          } else {
            const label = data.label || 'Auto-cleaning…';
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
          }
        }
      }
    } finally {
      cleanPollInFlight = false;
      refreshBatchStatus(
        batchActive ? statusLine.textContent : null,
        batchActive ? statusDetail.textContent : null,
      );
      if (![...pendingCleans.values()].some((j) => !j.done)) {
        stopCleanPoll();
        if (!batchActive) {
          stopBtn.hidden = true;
          stopBtn.textContent = 'Stop';
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
      data.fetchUrl ||
      data.publicUrl ||
      (data.object && (data.object.fetchUrl || data.object.publicUrl));
    if (!fetchUrl || !/^https?:\/\//i.test(fetchUrl)) {
      throw new Error('No public URL available for auto-clean.');
    }
    return fetchUrl;
  }

  async function startAutoClean(card, key) {
    setCardStatus(card, 'Starting auto-clean…');
    setCardError(card, '');
    try {
      const videoUrl = await resolveFetchUrl(key);
      const { ok, data } = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          videoUrl,
          options: AUTO_CLEAN_OPTIONS,
        }),
      });
      if (!ok || !data?.workId) {
        throw new Error((data && (data.message || data.error)) || 'Could not start auto-clean.');
      }
      pendingCleans.set(card, { workId: data.workId, errors: 0, done: false });
      setCardStatus(card, 'Auto-cleaning…');
      const cleanLink = card.querySelector('.result-clean');
      if (cleanLink) cleanLink.hidden = true;
      ensureCleanPoll();
      // Kick an immediate status check so the card updates quickly.
      pollPendingCleans().catch(() => {});
    } catch (err) {
      setCardError(card, String(err?.message || err));
      setCardStatus(card, 'Saved · auto-clean failed');
      const cleanLink = card.querySelector('.result-clean');
      if (cleanLink) cleanLink.hidden = false;
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
    showApp();
    return true;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const password = document.getElementById('password').value;
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate(data?.error === 'invalid_password' ? 'Wrong password' : data?.error || 'Sign-in failed');
      return;
    }
    document.getElementById('password').value = '';
    await refreshSession();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  urlsInput.addEventListener('input', updateUrlCount);
  updateUrlCount();
  if (autoCleanOpt) {
    autoCleanOpt.addEventListener('change', updateDownloadButtonLabel);
  }
  updateDownloadButtonLabel();

  stopBtn.addEventListener('click', () => {
    if (batchActive) {
      stopRequested = true;
      setStatus('Stopping…', 'Finishing the current download, then stopping. Auto-cleans already started keep running.');
      return;
    }
    // After downloads finished: stop further clean polling.
    stopCleanPoll();
    stopBtn.hidden = true;
    stopBtn.textContent = 'Stop';
    const { cleaning, cleaned, cleanFailed } = summarizeBatch();
    setStatus(
      'Polling stopped',
      `${cleaning} still processing on GhostCut · ${cleaned} cleaned · ${cleanFailed} failed — check Cleaned videos later`,
    );
  });

  downloadBtn.addEventListener('click', async () => {
    setError('');
    clearResults();
    stopRequested = false;
    batchActive = true;
    stopBtn.textContent = 'Stop';

    const urls = parseUrls(urlsInput.value);
    if (!urls.length) {
      setError('Paste at least one TikTok URL (one per line).');
      batchActive = false;
      return;
    }

    const smallerFile = Boolean(smallerNoHd && smallerNoHd.checked);
    const autoClean = Boolean(autoCleanOpt && autoCleanOpt.checked);
    downloadBtn.disabled = true;
    stopBtn.hidden = false;

    let okCount = 0;
    let failCount = 0;
    let autoCleanStarted = 0;

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
          autoClean ? 'Auto-Clean on' : null,
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
          continue;
        }
        okCount += 1;
        fillCardSuccess(card, data);

        if (autoClean && data.key && !stopRequested) {
          await startAutoClean(card, data.key);
          if (pendingCleans.has(card)) autoCleanStarted += 1;
          refreshBatchStatus(
            `Downloading ${Math.min(i + 2, urls.length)} / ${urls.length}…`,
            `${okCount} saved · ${autoCleanStarted} auto-clean started`,
          );
        }
      } catch (err) {
        failCount += 1;
        setCardError(card, String(err?.message || err));
        setCardStatus(card, 'Failed');
      }
    }

    batchActive = false;

    if (!stopRequested) {
      const base = `${okCount} saved · ${failCount} failed · ${urls.length} total`;
      if (autoClean && autoCleanStarted) {
        refreshBatchStatus('Downloads done · auto-cleaning…', `${base} · keep this tab open`);
        stopBtn.hidden = false;
        stopBtn.textContent = 'Stop polling';
      } else {
        setStatus('Done', base);
        stopBtn.hidden = true;
        stopBtn.textContent = 'Stop';
      }
      if (failCount && !okCount) {
        setError('All downloads failed. Check the errors on each card.');
      }
    } else {
      stopBtn.hidden = ![...pendingCleans.values()].some((j) => !j.done);
      stopBtn.textContent = stopBtn.hidden ? 'Stop' : 'Stop polling';
    }

    downloadBtn.disabled = false;
    stopRequested = false;
  });

  refreshSession();
})();
