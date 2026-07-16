(function () {
  const MAX_URLS = 10;
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

  let stopRequested = false;

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
      // Allow "1. url" or "- url"
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

  function clearResults() {
    results.innerHTML = '';
    results.hidden = true;
    if (libraryNote) libraryNote.hidden = true;
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
      setCardStatus(card, 'Failed');
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

  stopBtn.addEventListener('click', () => {
    stopRequested = true;
    setStatus('Stopping…', 'Finishing the current download, then stopping');
  });

  downloadBtn.addEventListener('click', async () => {
    setError('');
    clearResults();
    stopRequested = false;

    const urls = parseUrls(urlsInput.value);
    if (!urls.length) {
      setError('Paste at least one TikTok URL (one per line).');
      return;
    }

    const smallerFile = Boolean(smallerNoHd && smallerNoHd.checked);
    downloadBtn.disabled = true;
    stopBtn.hidden = false;

    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < urls.length; i++) {
      if (stopRequested) {
        setStatus('Stopped', `${okCount} saved · ${failCount} failed · ${urls.length - i} skipped`);
        break;
      }

      const url = urls[i];
      const card = addResultCard(i, url);
      setCardStatus(card, 'Downloading…');
      setStatus(
        `Downloading ${i + 1} / ${urls.length}…`,
        smallerFile ? 'Smaller (no HD) file' : 'HD when available',
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
          continue;
        }
        okCount += 1;
        fillCardSuccess(card, data);
      } catch (err) {
        failCount += 1;
        setCardError(card, String(err?.message || err));
      }
    }

    if (!stopRequested) {
      setStatus(
        'Done',
        `${okCount} saved · ${failCount} failed · ${urls.length} total`,
      );
      if (failCount && !okCount) {
        setError('All downloads failed. Check the errors on each card.');
      }
    }

    downloadBtn.disabled = false;
    stopBtn.hidden = true;
    stopRequested = false;
  });

  refreshSession();
})();
