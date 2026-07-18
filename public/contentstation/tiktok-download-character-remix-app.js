(function () {
  const MAX_URLS = 10;
  const POLL_MS = 4000;
  const MAX_POLL_ERRORS = 10;
  const MAX_RUNPOD_IN_FLIGHT = 2;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const urlsInput = document.getElementById('tiktok-urls');
  const urlCount = document.getElementById('url-count');
  const characterFile = document.getElementById('character-file');
  const characterMeta = document.getElementById('character-preview-wrap')
    ? document.getElementById('character-meta')
    : document.getElementById('character-meta');
  const characterPreviewWrap = document.getElementById('character-preview-wrap');
  const characterPreview = document.getElementById('character-preview');
  const smallerNoHd = document.getElementById('opt-smaller-no-hd');
  const stripCaptions = document.getElementById('opt-strip-captions');
  const preserveAudio = document.getElementById('opt-preserve-audio');
  const alterAudio = document.getElementById('opt-alter-audio');
  const restoreHooks = document.getElementById('opt-restore-hooks');
  const characterStrength = document.getElementById('opt-character-strength');
  const sceneRestyle = document.getElementById('opt-scene-restyle');
  const characterStrengthVal = document.getElementById('character-strength-val');
  const sceneRestyleVal = document.getElementById('scene-restyle-val');
  const remixConfig = document.getElementById('remix-config') || document.getElementById('runpod-config');
  const remixBtn = document.getElementById('remix-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const remixError = document.getElementById('remix-error');
  const results = document.getElementById('results');

  let stopRequested = false;
  let batchActive = false;
  /** @type {string|null} */
  let uploadedCharacterKey = null;
  /** @type {'comfyui'|'runpod'|null} */
  let activeBackend = null;

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
      gateError.hidden = false;
      gateError.textContent = msg;
    } else if (gateError) {
      gateError.hidden = true;
    }
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = 'Signed in';
    void loadConfig();
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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'tiktok-download-character-remix')) {
      return false;
    }
    if (window.CSAuth) window.CSAuth.applyNav(data.role);
    showApp(data);
    return true;
  }

  function setError(msg) {
    if (!remixError) return;
    if (msg) {
      remixError.hidden = false;
      remixError.textContent = msg;
    } else {
      remixError.hidden = true;
      remixError.textContent = '';
    }
  }

  function setStatus(main, detail) {
    if (statusLine) statusLine.textContent = main || '';
    if (statusDetail) {
      if (detail) {
        statusDetail.hidden = false;
        statusDetail.textContent = detail;
      } else {
        statusDetail.hidden = true;
        statusDetail.textContent = '';
      }
    }
  }

  function parseUrls(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_URLS);
  }

  function updateUrlCount() {
    const n = parseUrls(urlsInput?.value).length;
    if (urlCount) urlCount.textContent = `${n} / ${MAX_URLS} links`;
  }

  function bindSliders() {
    const sync = () => {
      if (characterStrengthVal && characterStrength) {
        characterStrengthVal.textContent = Number(characterStrength.value).toFixed(2);
      }
      if (sceneRestyleVal && sceneRestyle) {
        sceneRestyleVal.textContent = Number(sceneRestyle.value).toFixed(2);
      }
    };
    characterStrength?.addEventListener('input', sync);
    sceneRestyle?.addEventListener('input', sync);
    sync();
  }

  async function loadConfig() {
    const { ok, data } = await api('/api/contentstation/character-remix?action=config');
    if (!remixConfig) return;
    remixConfig.hidden = false;
    activeBackend = data?.backend || null;
    if (!ok || !data?.configured) {
      remixConfig.textContent =
        data?.message ||
        'Not configured — set RUNPOD_API_KEY + RUNPOD_CHARACTER_REMIX_ENDPOINT_ID (RunPod Serverless).';
      return;
    }
    if (data.backend === 'runpod') {
      remixConfig.textContent =
        data.message ||
        `RunPod Serverless ready${data.endpointId ? ` (${data.endpointId})` : ''} — GPU scales from zero.`;
      return;
    }
    remixConfig.textContent =
      data.message ||
      'Debug ComfyUI proxy mode. Production uses RunPod Serverless.';
  }

  function createCard(url, index) {
    const card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.index = String(index);
    card.innerHTML = `
      <p class="result-index">#${index + 1}</p>
      <p class="result-url muted-line">${escapeHtml(url)}</p>
      <p class="download-card-stage muted-line">Queued</p>
      <p class="result-status status"></p>
      <div class="result-actions" hidden></div>
      <video class="result-preview" controls playsinline hidden></video>
    `;
    return card;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setCardStage(card, stage, status) {
    const stageEl = card.querySelector('.download-card-stage');
    const statusEl = card.querySelector('.result-status');
    if (stageEl) stageEl.textContent = stage;
    if (statusEl) statusEl.textContent = status || '';
  }

  function showCardResult(card, { downloadPath, key }) {
    const actions = card.querySelector('.result-actions');
    const video = card.querySelector('.result-preview');
    if (actions) {
      actions.hidden = false;
      actions.innerHTML = '';
      const a = document.createElement('a');
      a.className = 'btn-link';
      a.href = downloadPath;
      a.textContent = 'Download remix';
      a.download = '';
      actions.appendChild(a);
      if (key) {
        const span = document.createElement('span');
        span.className = 'muted-line';
        span.textContent = ` ${key}`;
        actions.appendChild(span);
      }
    }
    if (video && downloadPath) {
      video.hidden = false;
      video.src = downloadPath;
    }
  }

  async function uploadCharacter(file) {
    const form = new FormData();
    form.append('file', file, file.name || 'character.png');
    form.append('prefix', 'characters/');
    const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
    if (!ok || !data?.object?.key) {
      throw new Error(data?.message || data?.error || 'Character upload failed');
    }
    uploadedCharacterKey = data.object.key;
    return uploadedCharacterKey;
  }

  async function downloadTikTok(url) {
    const { ok, data } = await api('/api/contentstation/tiktok-download', {
      method: 'POST',
      body: JSON.stringify({ url, smallerFile: Boolean(smallerNoHd?.checked) }),
    });
    if (!ok || !data?.key) {
      throw new Error(data?.message || data?.error || 'Download failed');
    }
    return data.key;
  }

  async function mediaFetchUrl(key) {
    const { ok, data } = await api(
      `/api/contentstation/media?action=meta&key=${encodeURIComponent(key)}`,
    );
    if (!ok) throw new Error(data?.error || 'Could not resolve media URL');
    const url = data?.object?.fetchUrl || data?.object?.publicUrl;
    if (!url) throw new Error('No public/fetch URL — set R2_PUBLIC_BASE_URL');
    return url;
  }

  async function stripCaptionsGhostCut(videoUrl, sourceKey) {
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit',
        videoUrl,
        options: {
          removeWatermark: true,
          cleanMetadata: false,
          alterAudio: false,
          basicVideoRemix: false,
          remix: false,
          deepAiRemake: false,
          mirror: false,
          sourceKey: sourceKey || null,
        },
      }),
    });
    if (!ok) throw new Error(data?.message || data?.error || 'Caption strip failed to start');
    const workId = data.workId || data.id;
    if (!workId) throw new Error('No GhostCut workId');

    let errors = 0;
    for (;;) {
      if (stopRequested) throw new Error('Stopped');
      await sleep(POLL_MS);
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(st.data?.message || st.data?.error || 'Caption strip status failed');
        }
        continue;
      }
      errors = 0;
      const state = String(st.data?.state || '').toLowerCase();
      if (state === 'failed') {
        throw new Error(st.data?.error || st.data?.message || 'Caption strip failed');
      }
      if (st.data?.cleanedKey) return st.data.cleanedKey;
      if (state === 'ready' && st.data?.downloadUrl) {
        // Wait for auto-archive, or force archive into cleaned/.
        if (st.data.savingToLibrary) continue;
        const arch = await api('/api/contentstation/clean', {
          method: 'POST',
          body: JSON.stringify({
            action: 'archive',
            workId,
            sourceUrl: st.data.downloadUrl,
            sourceKey,
          }),
        });
        if (arch.ok && arch.data?.cleanedKey) return arch.data.cleanedKey;
        // downloadUrl from GhostCut may be absolute — use that key path after one more status
        continue;
      }
    }
  }

  async function runRemix(sourceKey, originalKey, characterKey) {
    const { ok, data } = await api('/api/contentstation/character-remix', {
      method: 'POST',
      body: JSON.stringify({
        action: 'run',
        sourceKey,
        originalKey,
        characterKey,
        options: {
          characterStrength: Number(characterStrength?.value || 0.9),
          sceneRestyleStrength: Number(sceneRestyle?.value || 0.62),
          preserveAudio: Boolean(preserveAudio?.checked),
          discardSpeechCaptions: Boolean(stripCaptions?.checked),
          restoreNonSpeechText: Boolean(restoreHooks?.checked),
        },
      }),
    });
    if (!ok || !data?.jobId) {
      throw new Error(data?.message || data?.error || 'Remix submit failed');
    }
    if (data.backend) activeBackend = data.backend;
    return { jobId: data.jobId, backend: data.backend || activeBackend };
  }

  function formatRemixProgress(progress, fallback) {
    if (!progress) return fallback || 'Working…';
    const stage = String(progress.stage || '').toLowerCase();
    if (progress.message) return progress.message;
    if (stage.includes('segment')) return 'Splitting into ~5s chunks…';
    if (stage.includes('character_and_scene') || stage.includes('scene')) {
      if (progress.chunk && progress.chunks) {
        return `Character + scenery chunk ${progress.chunk}/${progress.chunks}…`;
      }
      return 'Character + scenery restyle…';
    }
    if (stage.includes('character')) {
      if (progress.chunk && progress.chunks) {
        return `Character replace chunk ${progress.chunk}/${progress.chunks}…`;
      }
      return 'Character replace…';
    }
    if (stage.includes('stitch')) return 'Stitching chunks into one MP4…';
    if (stage.includes('audio')) return 'Remuxing original audio…';
    if (stage.includes('upload')) return 'Uploading final MP4…';
    if (stage.includes('download')) return 'Worker downloading media…';
    if (stage === 'done') return 'Final MP4 ready';
    return fallback || stage || 'Working…';
  }

  async function pollRemix(jobId, onProgress) {
    let errors = 0;
    for (;;) {
      if (stopRequested) throw new Error('Stopped');
      await sleep(POLL_MS);
      const st = await api(
        `/api/contentstation/character-remix?action=status&jobId=${encodeURIComponent(jobId)}`,
      );
      if (!st.ok) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(st.data?.message || st.data?.error || 'Remix status failed');
        }
        continue;
      }
      errors = 0;
      const status = String(st.data?.status || '').toUpperCase();
      if (typeof onProgress === 'function') {
        onProgress(st.data?.progress || null, status);
      }
      if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
        throw new Error(st.data?.message || st.data?.error || `Remix ${status}`);
      }
      if (status === 'COMPLETED' && st.data?.error === 'no_output_video') {
        throw new Error('Remix finished but no output video was found');
      }
      if (status === 'COMPLETED' && st.data?.error && !st.data?.videoUrl && !st.data?.remixReady) {
        throw new Error(st.data?.message || st.data?.error || 'Remix failed');
      }
      if (status === 'COMPLETED' && st.data?.videoUrl) {
        return {
          videoUrl: st.data.videoUrl,
          archivedKey: st.data.archivedKey || null,
          downloadPath: st.data.downloadPath || null,
          progress: st.data.progress || null,
        };
      }
      if (st.data?.remixReady && st.data?.videoUrl) {
        return {
          videoUrl: st.data.videoUrl,
          archivedKey: st.data.archivedKey || null,
          downloadPath: st.data.downloadPath || null,
          progress: st.data.progress || null,
        };
      }
      if (st.data?.remixReady && st.data?.videoBase64) {
        return {
          videoUrl: null,
          videoBase64: st.data.videoBase64,
          videoMime: st.data.videoMime || 'video/mp4',
          archivedKey: null,
          progress: st.data.progress || null,
        };
      }
      if (st.data?.remixReady && st.data?.downloadPath && st.data?.archivedKey) {
        return {
          videoUrl: st.data.videoUrl || st.data.downloadPath,
          archivedKey: st.data.archivedKey,
          downloadPath: st.data.downloadPath,
          progress: st.data.progress || null,
        };
      }
    }
  }

  async function saveRemix(videoRef, sourceKey, jobId) {
    const payload = {
      action: 'save',
      sourceKey,
      runpodJobId: jobId,
      jobId,
      filename: sourceKey,
    };
    if (typeof videoRef === 'string') {
      payload.videoUrl = videoRef;
    } else if (videoRef?.videoBase64) {
      payload.videoBase64 = videoRef.videoBase64;
      payload.videoMime = videoRef.videoMime || 'video/mp4';
    } else if (videoRef?.archivedKey) {
      // Already archived during status poll (base64 materialize).
      const path =
        videoRef.downloadPath ||
        `/api/contentstation/media?action=get&key=${encodeURIComponent(videoRef.archivedKey)}`;
      return { ok: true, key: videoRef.archivedKey, downloadPath: path, publicUrl: videoRef.videoUrl || null };
    } else if (videoRef?.videoUrl) {
      payload.videoUrl = videoRef.videoUrl;
    } else {
      throw new Error('No remix video to save');
    }
    const { ok, data } = await api('/api/contentstation/character-remix', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!ok || !data?.key) {
      throw new Error(data?.message || data?.error || 'Could not save remix to library');
    }
    return data;
  }

  /** Light uniquify via CloudConvert alter-audio (clean API, no GhostCut). */
  async function uniquifyAlterAudio(videoUrl, sourceKey) {
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit',
        videoUrl,
        options: {
          removeWatermark: false,
          cleanMetadata: false,
          alterAudio: true,
          basicVideoRemix: false,
          remix: false,
          deepAiRemake: false,
          mirror: false,
          sourceKey: sourceKey || null,
        },
      }),
    });
    if (!ok) {
      throw new Error(data?.message || data?.error || 'Alter-audio uniquify failed to start');
    }
    const workId = data.workId || data.id;
    if (!workId) throw new Error('No uniquify workId');

    let errors = 0;
    for (;;) {
      if (stopRequested) throw new Error('Stopped');
      await sleep(POLL_MS);
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(st.data?.message || st.data?.error || 'Uniquify status failed');
        }
        continue;
      }
      errors = 0;
      const state = String(st.data?.state || '').toLowerCase();
      if (state === 'failed') {
        throw new Error(st.data?.error || st.data?.message || 'Uniquify failed');
      }
      if (st.data?.cleanedKey) {
        return {
          key: st.data.cleanedKey,
          downloadPath:
            st.data.downloadPath ||
            `/api/contentstation/media?action=get&key=${encodeURIComponent(st.data.cleanedKey)}`,
          publicUrl: st.data.publicUrl || null,
        };
      }
      if (state === 'ready' && st.data?.downloadUrl) {
        if (st.data.savingToLibrary) continue;
        // Re-archive uniquified file into character-remix/
        const saved = await saveRemix(st.data.downloadUrl, sourceKey, `uniquify:${workId}`);
        return saved;
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function processOne(url, card, characterKey) {
    setCardStage(card, 'Downloading', 'Fetching TikTok…');
    const originalKey = await downloadTikTok(url);
    if (stopRequested) throw new Error('Stopped');

    let sourceKey = originalKey;
    if (stripCaptions?.checked) {
      setCardStage(card, 'Stripping captions', 'GhostCut OCR erase (speech captions)…');
      const videoUrl = await mediaFetchUrl(originalKey);
      sourceKey = await stripCaptionsGhostCut(videoUrl, originalKey);
    }

    if (stopRequested) throw new Error('Stopped');
    const backendLabel = activeBackend === 'comfyui' ? 'ComfyUI remix (debug)' : 'Full remix';
    setCardStage(card, backendLabel, 'Submitting segment → character → scenery → stitch…');
    const { jobId, backend } = await runRemix(sourceKey, originalKey, characterKey);
    const label = backend === 'comfyui' ? 'ComfyUI remix (debug)' : 'Full remix';
    setCardStage(card, label, `Job ${jobId} — waiting for GPU…`);
    const remixOut = await pollRemix(jobId, (progress) => {
      setCardStage(card, label, formatRemixProgress(progress, 'Processing…'));
    });

    if (stopRequested) throw new Error('Stopped');
    setCardStage(card, 'Saving', 'Archiving final MP4…');
    let saved = await saveRemix(remixOut, originalKey, jobId);

    if (alterAudio?.checked) {
      if (stopRequested) throw new Error('Stopped');
      setCardStage(card, 'Uniquify', 'Light audio alter (CloudConvert)…');
      const fetchUrl = saved.publicUrl || (await mediaFetchUrl(saved.key));
      try {
        saved = await uniquifyAlterAudio(fetchUrl, originalKey);
      } catch (err) {
        // Remix is already saved — surface uniquify failure but keep result
        setCardStage(card, 'Done', `Remix ready (uniquify skipped: ${err?.message || err})`);
        showCardResult(card, saved);
        return saved;
      }
    }

    setCardStage(card, 'Done', 'Remix ready');
    showCardResult(card, saved);
    return saved;
  }

  async function runBatch() {
    if (batchActive) return;
    setError('');
    const urls = parseUrls(urlsInput?.value);
    if (!urls.length) {
      setError('Paste at least one TikTok URL.');
      return;
    }
    const file = characterFile?.files?.[0];
    if (!file && !uploadedCharacterKey) {
      setError('Choose a character image.');
      return;
    }

    batchActive = true;
    stopRequested = false;
    remixBtn.disabled = true;
    if (stopBtn) stopBtn.hidden = false;
    results.hidden = false;
    results.innerHTML = '';

    try {
      setStatus('Uploading character…');
      const characterKey = file ? await uploadCharacter(file) : uploadedCharacterKey;
      if (!characterKey) throw new Error('Character upload missing key');

      const cards = urls.map((u, i) => {
        const card = createCard(u, i);
        results.appendChild(card);
        return { url: u, card };
      });

      let inFlight = 0;
      let next = 0;
      let failures = 0;

      await new Promise((resolve) => {
        const pump = () => {
          if (stopRequested && inFlight === 0) {
            resolve();
            return;
          }
          while (!stopRequested && inFlight < MAX_RUNPOD_IN_FLIGHT && next < cards.length) {
            const item = cards[next++];
            inFlight += 1;
            setStatus(
              `Remixing ${next} / ${cards.length}…`,
              `Up to ${MAX_RUNPOD_IN_FLIGHT} ${activeBackend === 'comfyui' ? 'ComfyUI' : 'remix'} jobs at a time`,
            );
            processOne(item.url, item.card, characterKey)
              .catch((err) => {
                failures += 1;
                setCardStage(item.card, 'Failed', err?.message || String(err));
                item.card.classList.add('is-failed');
              })
              .finally(() => {
                inFlight -= 1;
                if (next >= cards.length && inFlight === 0) resolve();
                else pump();
              });
          }
          if (next >= cards.length && inFlight === 0) resolve();
        };
        pump();
      });

      if (stopRequested) setStatus('Stopped.');
      else if (failures) setStatus(`Finished with ${failures} failure(s).`);
      else setStatus('All remixed.');
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed.');
    } finally {
      batchActive = false;
      remixBtn.disabled = false;
      if (stopBtn) stopBtn.hidden = true;
    }
  }

  characterFile?.addEventListener('change', () => {
    uploadedCharacterKey = null;
    const file = characterFile.files?.[0];
    if (!file || !characterPreview || !characterPreviewWrap) return;
    const url = URL.createObjectURL(file);
    characterPreview.src = url;
    characterPreviewWrap.hidden = false;
    if (characterMeta) {
      characterMeta.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    }
  });

  urlsInput?.addEventListener('input', updateUrlCount);
  remixBtn?.addEventListener('click', () => void runBatch());
  stopBtn?.addEventListener('click', () => {
    stopRequested = true;
    setStatus('Stopping after current step…');
  });

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const password = document.getElementById('password')?.value || '';
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate(data?.message || data?.error || 'Login failed');
      return;
    }
    await refreshSession();
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  bindSliders();
  updateUrlCount();
  void refreshSession();
})();
