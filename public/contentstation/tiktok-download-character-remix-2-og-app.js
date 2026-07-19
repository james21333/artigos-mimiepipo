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
  const titleInput = document.getElementById('job-title');
  const scenesJson = document.getElementById('scenes-json');
  const characterFile = document.getElementById('character-file');
  const productFile = document.getElementById('product-file');
  const setFile = document.getElementById('set-file');
  const characterPreview = document.getElementById('character-preview');
  const characterPreviewWrap = document.getElementById('character-preview-wrap');
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
    setStatus(`Job ${currentJobId}: ${stage}`, data?.message || data?.detail || '');
    renderFrames(data);
    const readyFrames = stage === 'first_frames_done' || stage === 'videos_done' || stage === 'stitched';
    if (framesBtn) framesBtn.disabled = !currentJobId || stage === 'running_first_frames';
    if (videosBtn) videosBtn.disabled = !readyFrames && stage !== 'first_frames_done';
    if (stitchBtn) stitchBtn.disabled = !(stage === 'videos_done' || stage === 'first_frames_done');
    if (stage === 'stitched' && data?.output_url) {
      setStatus('Stitched', data.output_url);
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollJob, 4000);
    pollJob();
  }

  characterFile?.addEventListener('change', () => {
    const f = characterFile.files?.[0];
    if (!f || !characterPreview || !characterPreviewWrap) return;
    characterPreview.src = URL.createObjectURL(f);
    characterPreviewWrap.hidden = false;
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
        setStatus('Uploading product…');
        productKey = await uploadImage(productFile.files[0], 'characters/products/');
      }
      if (setFile?.files?.[0]) {
        setStatus('Uploading set…');
        setKey = await uploadImage(setFile.files[0], 'characters/sets/');
      }
      setStatus('Creating job on Fast Panda…');
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
      currentJobId = data.jobId;
      if (jobIdLine) {
        jobIdLine.hidden = false;
        jobIdLine.textContent = `Job ID: ${currentJobId}`;
      }
      if (framesBtn) framesBtn.disabled = false;
      setStatus('Job created', 'Next: Generate first frames (Codex on Fast Panda)');
      startPoll();
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
