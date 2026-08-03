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
  const characterFile = document.getElementById('character-file');
  const characterPreview = document.getElementById('character-preview');
  const characterPreviewWrap = document.getElementById('character-preview-wrap');
  const titleInput = document.getElementById('job-title');
  const restoreOverlaysEl = document.getElementById('restore-overlays');
  const runBtn = document.getElementById('run-btn');
  const batchList = document.getElementById('batch-list');
  const frameGallery = document.getElementById('frame-gallery');
  const outputGallery = document.getElementById('output-gallery');

  /** @type {{ jobId: string, tiktokUrl: string, title?: string }[]} */
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

  async function loadConfig() {
    const { ok, data } = await api('/api/contentstation/character-remix-2-og?action=config');
    if (configEl) {
      configEl.hidden = false;
      const lockNote =
        data?.musicLockNote ||
        data?.identityLockNote ||
        'V2 Music-Only: identity-lock + exact EDL timing + original TikTok audio.';
      const overlayNote =
        data?.restoreOverlaysNote ||
        'Original on-screen hooks restored onto final (Music-Only default on).';
      configEl.textContent = `${data?.message || (ok ? 'Configured' : 'Worker not configured')} · ${lockNote} · ${overlayNote} · Pipelines queue (1 at a time), up to ${MAX_URLS} links.`;
    }
    return { ok, data };
  }

  function ensureBatchCard(job) {
    if (!batchList) return null;
    batchList.hidden = false;
    let card = batchList.querySelector(`[data-job-id="${job.jobId}"]`);
    if (card) return card;
    card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.jobId = job.jobId;
    card.innerHTML = `
      <p class="result-url muted-line"></p>
      <p class="result-status status">Queued…</p>
      <p class="muted-line result-jobid"></p>
      <div class="result-frames" hidden></div>
      <div class="result-outputs" hidden></div>
      <p class="error result-error" hidden></p>
    `;
    card.querySelector('.result-url').textContent = job.tiktokUrl || job.jobId;
    card.querySelector('.result-jobid').textContent = `Job ${job.jobId}`;
    batchList.appendChild(card);
    return card;
  }

  function updateCardFromStatus(job, data) {
    const card = ensureBatchCard(job);
    if (!card) return;
    const stage = data?.stage || data?.status || 'unknown';
    const pos = data?.queuePosition;
    const depth = data?.queueDepth;
    let label = stage;
    if (stage === 'queued' && pos) {
      label = `Queued — #${pos}${depth ? ` of ${depth}` : ''}`;
    } else if (stage === 'running_first_frames') {
      label = 'Codex first frames…';
    } else if (stage === 'running_videos') {
      label = 'Grok videos…';
    } else if (stage === 'stitching') {
      label = 'Stitching…';
    } else if (stage === 'restoring_overlays') {
      label = 'Restoring on-screen text…';
    } else if (stage === 'stitched') {
      const n = data?.overlayText?.eventCount ?? data?.overlayText?.events?.length;
      label =
        data?.overlaysBurned && n
          ? `Done (overlays×${n})`
          : 'Done';
    } else if (stage === 'error') {
      label = 'Failed';
    }
    const statusEl = card.querySelector('.result-status');
    if (statusEl) statusEl.textContent = label;
    const errEl = card.querySelector('.result-error');
    if (errEl) {
      if (stage === 'error' && data?.message) {
        errEl.hidden = false;
        errEl.textContent = data.message;
      } else {
        errEl.hidden = true;
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
    const finalUrl = data?.output_url || data?.outputUrl || '';
    if (outWrap) {
      if (finalUrl) {
        outWrap.hidden = false;
        outWrap.innerHTML = `<video src="${finalUrl}" controls playsinline class="character-preview"></video>
          <p class="muted-line"><a href="${finalUrl}" target="_blank" rel="noopener">Open MP4</a></p>`;
      } else {
        outWrap.hidden = true;
        outWrap.innerHTML = '';
      }
    }
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
        if (statusEl) statusEl.textContent = 'Status error';
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
      'Worker runs one remake pipeline at a time; the rest stay queued.',
    );
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

  // Keep legacy gallery elements unused (batch cards own frames/outputs).
  if (frameGallery) frameGallery.hidden = true;
  if (outputGallery) outputGallery.hidden = true;

  tiktokUrls?.addEventListener('input', updateUrlCount);

  characterFile?.addEventListener('change', () => {
    const f = characterFile.files?.[0];
    if (!f || !characterPreview || !characterPreviewWrap) return;
    characterPreview.src = URL.createObjectURL(f);
    characterPreviewWrap.hidden = false;
  });

  runBtn?.addEventListener('click', async () => {
    setError('');
    const urls = parseUrls(tiktokUrls?.value);
    const char = characterFile?.files?.[0];
    if (!urls.length) {
      setError('Paste 1–20 TikTok URLs (one per line).');
      return;
    }
    if (urls.length > MAX_URLS) {
      setError(`Max ${MAX_URLS} TikTok links per batch.`);
      return;
    }
    if (!char) {
      setError('Choose a character image — V2 Music-Only requires your upload');
      return;
    }

    submitting = true;
    if (runBtn) runBtn.disabled = true;
    try {
      setStatus('Uploading character…');
      const characterKey = await uploadImage(char, 'characters/');

      const baseTitle = titleInput?.value || 'TikTok remake (music-only)';
      const started = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        setStatus(`Submitting ${i + 1} / ${urls.length}`, url);
        const { ok, data } = await api('/api/contentstation/character-remix-2-og', {
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
          const detail =
            data?.message ||
            (typeof data?.detail === 'string' ? data.detail : null) ||
            data?.error ||
            `Failed to start job ${i + 1}`;
          ensureBatchCard({ jobId: `fail-${i}`, tiktokUrl: url });
          const card = batchList?.querySelector(`[data-job-id="fail-${i}"]`);
          if (card) {
            const statusEl = card.querySelector('.result-status');
            if (statusEl) statusEl.textContent = 'Submit failed';
            const errEl = card.querySelector('.result-error');
            if (errEl) {
              errEl.hidden = false;
              errEl.textContent = detail;
            }
          }
          continue;
        }
        const job = { jobId: data.jobId, tiktokUrl: url, title: data.title || baseTitle };
        started.push(job);
        batchJobs.push(job);
        saveBatch();
        updateCardFromStatus(job, data);
      }
      if (!started.length) throw new Error('No jobs started');
      setStatus(
        `Submitted ${started.length} job(s)`,
        'Pipelines queue on Fast Panda — one remake at a time.',
      );
      startPoll();
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
    updateUrlCount();
    loadBatch();
    if (batchJobs.length) {
      for (const job of batchJobs) ensureBatchCard(job);
      startPoll();
      setStatus(`Resuming ${batchJobs.length} job(s)…`);
    } else {
      setStatus('Ready — upload character + up to 20 TikTok URLs (queued, one pipeline at a time).');
    }
  }

  boot();
})();
