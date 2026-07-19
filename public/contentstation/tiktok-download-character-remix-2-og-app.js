(function () {
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
  const errorEl = document.getElementById('remix2-error');
  const jobIdLine = document.getElementById('job-id-line');
  const frameGallery = document.getElementById('frame-gallery');
  const outputGallery = document.getElementById('output-gallery');
  const titleInput = document.getElementById('job-title');
  const tiktokUrl = document.getElementById('tiktok-url');
  const scenesJson = document.getElementById('scenes-json');
  const characterFile = document.getElementById('character-file');
  const productFile = document.getElementById('product-file');
  const setFile = document.getElementById('set-file');
  const characterPreview = document.getElementById('character-preview');
  const characterPreviewWrap = document.getElementById('character-preview-wrap');
  const runBtn = document.getElementById('run-btn');
  const createBtn = document.getElementById('create-btn');
  const framesBtn = document.getElementById('frames-btn');
  const videosBtn = document.getElementById('videos-btn');
  const stitchBtn = document.getElementById('stitch-btn');

  let currentJobId = null;
  let pollTimer = null;

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

  function parseScenes() {
    const raw = String(scenesJson?.value || '').trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('Scenes must be a non-empty JSON array');
    return parsed.map((s, i) => {
      const id = String(s.id || `scene_${String(i + 1).padStart(2, '0')}`);
      if (!s.image_prompt && !s.imagePrompt) {
        throw new Error(`Scene ${id} needs image_prompt`);
      }
      return {
        id,
        title: s.title || id,
        duration: Number(s.duration) || 8,
        durationMs: s.durationMs || null,
        startMs: s.startMs || null,
        endMs: s.endMs || null,
        dialogue: s.dialogue || '',
        motion_type: s.motion_type || s.motionType || 'lip-sync',
        silent: Boolean(s.silent),
        image_prompt: s.image_prompt || s.imagePrompt,
        subject: s.subject || '',
      };
    });
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
      configEl.textContent = data?.message || (ok ? 'Configured' : 'Worker not configured');
    }
    return { ok, data };
  }

  function renderFrames(job) {
    if (!frameGallery) return;
    const frames = job?.first_frames || job?.firstFrames || {};
    const entries = Object.entries(frames);
    if (!entries.length) {
      frameGallery.hidden = true;
      frameGallery.innerHTML = '';
      return;
    }
    frameGallery.hidden = false;
    frameGallery.innerHTML = '';
    for (const [sceneId, info] of entries) {
      const card = document.createElement('article');
      card.className = 'result-card';
      const url = typeof info === 'string' ? info : info?.url || info?.publicUrl || '';
      card.innerHTML = `<h3>${sceneId}</h3>${
        url ? `<img src="${url}" alt="${sceneId}" class="character-preview">` : '<p class="muted-line">No URL yet</p>'
      }`;
      frameGallery.appendChild(card);
    }
  }

  function renderOutputs(job) {
    if (!outputGallery) return;
    const videos = job?.videos || {};
    const finalUrl = job?.output_url || job?.outputUrl || '';
    const videoEntries = Object.entries(videos).filter(([, info]) => {
      const url = typeof info === 'string' ? info : info?.url || info?.publicUrl || '';
      return Boolean(url);
    });
    if (!finalUrl && !videoEntries.length) {
      outputGallery.hidden = true;
      outputGallery.innerHTML = '';
      return;
    }
    outputGallery.hidden = false;
    outputGallery.innerHTML = '';
    if (finalUrl) {
      const card = document.createElement('article');
      card.className = 'result-card';
      card.innerHTML = `<h3>Final</h3><video src="${finalUrl}" controls playsinline class="character-preview"></video><p class="muted-line"><a href="${finalUrl}" target="_blank" rel="noopener">Open MP4</a></p>`;
      outputGallery.appendChild(card);
    }
    for (const [sceneId, info] of videoEntries) {
      const url = typeof info === 'string' ? info : info?.url || info?.publicUrl || '';
      const card = document.createElement('article');
      card.className = 'result-card';
      card.innerHTML = `<h3>${sceneId}</h3><video src="${url}" controls playsinline class="character-preview"></video>`;
      outputGallery.appendChild(card);
    }
  }

  async function pollJob() {
    if (!currentJobId) return;
    const { ok, data } = await api(
      `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(currentJobId)}`,
    );
    if (!ok) {
      setStatus('Status error', data?.message || data?.error || 'worker error');
      return;
    }
    const stage = data?.stage || data?.status || 'unknown';
    const edlNote = data?.edl?.shotCount ? ` · ${data.edl.shotCount} shots` : '';
    setStatus(`Job ${currentJobId}: ${stage}${edlNote}`, data?.message || data?.detail || '');
    renderFrames(data);
    renderOutputs(data);
    if (framesBtn) {
      framesBtn.disabled =
        !currentJobId ||
        stage === 'analyzing' ||
        stage === 'running_first_frames' ||
        stage === 'running_videos' ||
        stage === 'stitching' ||
        stage === 'stitched';
    }
    if (videosBtn) {
      videosBtn.disabled = !(stage === 'first_frames_done' || stage === 'videos_done');
    }
    if (stitchBtn) stitchBtn.disabled = stage !== 'videos_done';
    if (runBtn) {
      runBtn.disabled =
        stage === 'analyzing' ||
        stage === 'running_first_frames' ||
        stage === 'running_videos' ||
        stage === 'stitching';
    }
    if (stage === 'error') {
      setError(data?.message || 'Job error');
      if (runBtn) runBtn.disabled = false;
    }
    if (stage === 'stitched') {
      setStatus('Stitched', data?.output_url || data?.output_path || data?.message || '');
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (runBtn) runBtn.disabled = false;
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollJob, 4000);
    pollJob();
  }

  function bindJob(jobId) {
    currentJobId = jobId;
    if (jobIdLine) {
      jobIdLine.hidden = false;
      jobIdLine.textContent = `Job ID: ${currentJobId}`;
    }
    startPoll();
  }

  characterFile?.addEventListener('change', () => {
    const f = characterFile.files?.[0];
    if (!f || !characterPreview || !characterPreviewWrap) return;
    characterPreview.src = URL.createObjectURL(f);
    characterPreviewWrap.hidden = false;
  });

  runBtn?.addEventListener('click', async () => {
    setError('');
    try {
      const url = String(tiktokUrl?.value || '').trim();
      const char = characterFile?.files?.[0];
      if (!url) throw new Error('Paste a TikTok URL');
      if (!char) throw new Error('Choose a character image');
      if (runBtn) runBtn.disabled = true;
      setStatus('Uploading character…');
      const characterKey = await uploadImage(char, 'characters/');
      setStatus('Downloading TikTok + building EDL + starting remake…');
      const { ok, data } = await api('/api/contentstation/character-remix-2-og', {
        method: 'POST',
        body: JSON.stringify({
          action: 'from-tiktok',
          tiktokUrl: url,
          characterKey,
          title: titleInput?.value || 'TikTok remake',
          autoRun: true,
        }),
      });
      if (!ok || !data?.jobId) {
        const detail =
          data?.message ||
          (typeof data?.detail === 'string' ? data.detail : null) ||
          data?.error ||
          (data ? JSON.stringify(data).slice(0, 240) : null) ||
          'Remake failed to start';
        throw new Error(detail);
      }
      bindJob(data.jobId);
      setStatus(
        'Running',
        data?.edl?.shotCount
          ? `EDL: ${data.edl.shotCount} shot(s). Frames → videos → stitch…`
          : data?.message || 'Pipeline running…',
      );
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed');
      if (runBtn) runBtn.disabled = false;
    }
  });

  createBtn?.addEventListener('click', async () => {
    setError('');
    try {
      const scenes = parseScenes();
      const char = characterFile?.files?.[0];
      if (!char) throw new Error('Choose a character image');
      setStatus('Uploading character…');
      const characterKey = await uploadImage(char, 'characters/');
      let productKey = null;
      let setKey = null;
      if (productFile?.files?.[0]) {
        productKey = await uploadImage(productFile.files[0], 'characters/products/');
      }
      if (setFile?.files?.[0]) {
        setKey = await uploadImage(setFile.files[0], 'characters/sets/');
      }
      setStatus('Creating job…');
      const { ok, data } = await api('/api/contentstation/character-remix-2-og', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          title: titleInput?.value || 'Remix 2 OG',
          characterKey,
          productKey,
          setKey,
          scenes,
        }),
      });
      if (!ok || !data?.jobId) {
        throw new Error(data?.message || data?.error || 'Create job failed');
      }
      bindJob(data.jobId);
      if (framesBtn) framesBtn.disabled = false;
      setStatus('Job created', 'Use First frames → Videos → Stitch, or wait if auto-run');
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed');
    }
  });

  async function postAction(action, label) {
    if (!currentJobId) return;
    setError('');
    setStatus(label);
    const { ok, data } = await api('/api/contentstation/character-remix-2-og', {
      method: 'POST',
      body: JSON.stringify({ action, jobId: currentJobId }),
    });
    if (!ok) {
      setError(data?.message || data?.error || `${action} failed`);
      setStatus('Failed');
      return;
    }
    setStatus(data?.stage || label, data?.message || '');
    startPoll();
  }

  framesBtn?.addEventListener('click', () => postAction('first-frames', 'Generating first frames…'));
  videosBtn?.addEventListener('click', () => postAction('videos', 'Generating videos (Grok)…'));
  stitchBtn?.addEventListener('click', () => postAction('stitch', 'Stitching…'));

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password: passwordInput?.value || '' }),
    });
    if (!ok) {
      if (gateError) {
        gateError.hidden = false;
        gateError.textContent = data?.message || 'Login failed';
      }
      return;
    }
    await boot();
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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-download-character-remix-2-og')) {
      return;
    }
    if (window.CSAuth) window.CSAuth.applyNav(data.role || 'admin');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${data.role || 'admin'}`;
    await loadConfig();
  }

  boot();
})();
