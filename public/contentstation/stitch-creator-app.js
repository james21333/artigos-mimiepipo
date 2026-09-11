(function () {
  const POLL_MS = 4000;
  const MAX_POLL_ERRORS = 10;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const accountSelect = document.getElementById('account-select');
  const tiktokUrlInput = document.getElementById('tiktok-url');
  const titleInput = document.getElementById('title-input');
  const stitchAccountFilter = document.getElementById('stitch-account-filter');
  const refreshStitchesBtn = document.getElementById('refresh-stitches-btn');
  const stitchPickStatus = document.getElementById('stitch-pick-status');
  const stitchPickGrid = document.getElementById('stitch-pick-grid');
  const runBtn = document.getElementById('run-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const runError = document.getElementById('run-error');
  const resultPanel = document.getElementById('result-panel');
  const resultMeta = document.getElementById('result-meta');
  const resultVideo = document.getElementById('result-video');
  const resultDownload = document.getElementById('result-download');

  /** @type {Array<{key:string,jobId?:string,account?:string|null,downloadPath?:string,uploaded?:string}>} */
  let stitchObjects = [];
  /** @type {string|null} */
  let selectedBottomKey = null;
  let running = false;

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const headers = { ...(options.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    opts.headers = headers;
    const res = await fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  function setError(msg) {
    if (!runError) return;
    if (msg) {
      runError.hidden = false;
      runError.textContent = msg;
    } else {
      runError.hidden = true;
      runError.textContent = '';
    }
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

  function mediaGet(key) {
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function accountLabel(acct) {
    return String(acct || '').trim() || 'Unassigned';
  }

  async function loadAccounts() {
    if (!accountSelect) return;
    const { ok, data } = await api('/api/contentstation/accounts?action=list');
    const accounts = ok && Array.isArray(data?.accounts) ? data.accounts : [];
    const prev = accountSelect.value;
    accountSelect.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— None —';
    accountSelect.appendChild(none);
    for (const a of accounts) {
      const name = typeof a === 'string' ? a : a?.name || a?.account || '';
      if (!name) continue;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      accountSelect.appendChild(opt);
    }
    if ([...accountSelect.options].some((o) => o.value === prev)) {
      accountSelect.value = prev;
    }
  }

  function fillStitchAccountFilter(objects) {
    if (!stitchAccountFilter) return;
    const prev = stitchAccountFilter.value;
    const names = [
      ...new Set(objects.map((o) => accountLabel(o.account)).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    stitchAccountFilter.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All accounts';
    stitchAccountFilter.appendChild(allOpt);
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name === 'Unassigned' ? '__none__' : name;
      opt.textContent = name;
      stitchAccountFilter.appendChild(opt);
    }
    if ([...stitchAccountFilter.options].some((o) => o.value === prev)) {
      stitchAccountFilter.value = prev;
    }
  }

  function filteredStitches() {
    const want = stitchAccountFilter?.value || '';
    if (!want) return stitchObjects;
    if (want === '__none__') {
      return stitchObjects.filter((o) => !String(o.account || '').trim());
    }
    return stitchObjects.filter((o) => String(o.account || '').trim() === want);
  }

  function renderStitchPicker() {
    if (!stitchPickGrid) return;
    const objects = filteredStitches();
    stitchPickGrid.innerHTML = '';
    if (!objects.length) {
      stitchPickGrid.hidden = true;
      if (stitchPickStatus) {
        stitchPickStatus.textContent = stitchObjects.length
          ? 'No stitches for this account filter.'
          : 'No stitch videos yet — make some on Stitch Maker first.';
      }
      return;
    }
    if (stitchPickStatus) {
      stitchPickStatus.textContent = `Pick one bottom clip · ${objects.length} shown`;
    }
    stitchPickGrid.hidden = false;
    for (const obj of objects) {
      const key = obj.key;
      const href = obj.downloadPath || mediaGet(key);
      const jobId = obj.jobId || String(key || '').split('/')[1] || '';
      const acct = accountLabel(obj.account);
      const card = document.createElement('article');
      card.className = 'gallery-card stitch-video-card';
      if (selectedBottomKey === key) {
        card.style.outline = '2px solid var(--accent)';
        card.style.outlineOffset = '2px';
      }
      card.innerHTML = `
        <div class="stitch-video-thumb">
          <video playsinline preload="metadata" muted src="${href}"></video>
        </div>
        <div class="gallery-card-meta stitch-video-meta">
          <p class="gallery-card-title">${acct} · ${jobId.slice(0, 10)}</p>
          <p class="muted-line">${selectedBottomKey === key ? 'Selected' : 'Tap to select'}</p>
        </div>
      `;
      card.addEventListener('click', () => {
        selectedBottomKey = key;
        renderStitchPicker();
      });
      stitchPickGrid.appendChild(card);
    }
  }

  async function loadStitches() {
    if (stitchPickStatus) stitchPickStatus.textContent = 'Loading stitch clips…';
    const { ok, data } = await api(
      '/api/contentstation/character-remix-2-og?action=list&variant=stitch-maker&limit=100',
    );
    if (!ok) {
      if (stitchPickStatus) {
        stitchPickStatus.textContent = data?.message || data?.error || 'Could not load stitches';
      }
      return;
    }
    stitchObjects = Array.isArray(data?.objects) ? data.objects : [];
    if (
      selectedBottomKey &&
      !stitchObjects.some((o) => o.key === selectedBottomKey)
    ) {
      selectedBottomKey = null;
    }
    fillStitchAccountFilter(stitchObjects);
    renderStitchPicker();
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
      throw new Error('No public URL available for light remix.');
    }
    return fetchUrl;
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * GhostCut Basic Video Remix + metadata strip (same “light remix” as the Clean tool).
   * No account → cleaned file is not Ready-tagged.
   */
  async function lightRemix(sourceKey) {
    const videoUrl = await resolveFetchUrl(sourceKey);
    setStatus('Light remix…', 'GhostCut Basic Video Remix + metadata strip');
    const { ok, data } = await api('/api/contentstation/clean', {
      method: 'POST',
      body: JSON.stringify({
        action: 'submit',
        videoUrl,
        options: {
          removeWatermark: false,
          cleanMetadata: true,
          alterAudio: true,
          basicVideoRemix: true,
          remix: false,
          deepAiRemake: false,
          mirror: false,
          sourceKey,
        },
      }),
    });
    if (!ok || !data?.workId) {
      throw new Error((data && (data.message || data.error)) || 'Could not start light remix.');
    }
    let workId = data.workId;
    let errors = 0;
    const deadline = Date.now() + 18 * 60 * 1000;
    let archiveNudged = false;
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error('Light remix timed out waiting for cleaned file.');
      }
      await sleep(POLL_MS);
      const st = await api('/api/contentstation/clean', {
        method: 'POST',
        body: JSON.stringify({ action: 'status', workId }),
      });
      if (!st.ok || !st.data) {
        errors += 1;
        if (errors >= MAX_POLL_ERRORS) {
          throw new Error(
            (st.data && (st.data.message || st.data.error)) || 'Light remix status failed.',
          );
        }
        continue;
      }
      errors = 0;
      if (st.data.workId) workId = st.data.workId;
      const state = String(st.data.state || '').toLowerCase();
      const label = st.data.label || 'Remixing…';
      const prog =
        st.data.progress != null && st.data.progress !== ''
          ? ` · ${st.data.progress}%`
          : '';
      setStatus('Light remix…', `${label}${prog}`);

      if (state === 'failed') {
        throw new Error(st.data.error || st.data.message || 'Light remix failed.');
      }
      if (st.data.cleanedKey) {
        return st.data.cleanedKey;
      }
      if (state === 'ready' && st.data.downloadUrl && !archiveNudged) {
        archiveNudged = true;
        setStatus('Light remix…', 'Saving cleaned file to library…');
        const arch = await api('/api/contentstation/clean', {
          method: 'POST',
          body: JSON.stringify({
            action: 'archive',
            workId,
            sourceUrl: st.data.downloadUrl,
            sourceKey,
          }),
        });
        if (arch.ok && arch.data?.cleanedKey) {
          return arch.data.cleanedKey;
        }
      } else if (state === 'ready' && st.data.savingToLibrary) {
        setStatus('Light remix…', 'Saving cleaned file to library…');
      }
    }
  }

  async function downloadTikTok(url) {
    setStatus('Downloading TikTok…', url);
    const { ok, data } = await api('/api/contentstation/tiktok-download', {
      method: 'POST',
      body: JSON.stringify({ url, smallerFile: false, allowDuplicate: true }),
    });
    if (!ok || !data?.key) {
      throw new Error((data && (data.message || data.error)) || 'TikTok download failed.');
    }
    return data.key;
  }

  async function compose(topKey, bottomKey) {
    setStatus('Stacking…', 'ffmpeg 75% top / 25% bottom · random stitch start · loop if short');
    const { ok, data } = await api('/api/contentstation/stitch-creator', {
      method: 'POST',
      body: JSON.stringify({
        action: 'compose',
        topKey,
        bottomKey,
        account: accountSelect?.value || undefined,
        tiktokUrl: tiktokUrlInput?.value?.trim() || undefined,
        title: titleInput?.value?.trim() || undefined,
      }),
    });
    if (!ok) {
      throw new Error((data && (data.message || data.error)) || 'Compose failed.');
    }
    return data;
  }

  function showResult(data) {
    if (!resultPanel) return;
    resultPanel.hidden = false;
    const href = data.downloadPath || (data.key ? mediaGet(data.key) : '#');
    if (resultVideo) resultVideo.src = href;
    if (resultDownload) {
      resultDownload.href = href;
    }
    if (resultMeta) {
      const bits = [
        data.jobId ? `job ${data.jobId}` : null,
        data.account ? data.account : null,
        data.stitchStartSec != null ? `bottom start ${data.stitchStartSec}s` : null,
        data.durationSec != null ? `${data.durationSec}s` : null,
      ].filter(Boolean);
      resultMeta.textContent = bits.join(' · ');
    }
  }

  async function run() {
    if (running) return;
    setError('');
    if (resultPanel) resultPanel.hidden = true;

    const url = String(tiktokUrlInput?.value || '').trim();
    if (!url) {
      setError('Paste a TikTok URL for the top clip.');
      return;
    }
    if (!selectedBottomKey) {
      setError('Select a Stitch Maker clip for the bottom strip.');
      return;
    }

    running = true;
    if (runBtn) runBtn.disabled = true;
    try {
      const tiktokKey = await downloadTikTok(url);
      const cleanedKey = await lightRemix(tiktokKey);
      const composed = await compose(cleanedKey, selectedBottomKey);
      setStatus('Done', composed.message || 'Stitch creator final ready.');
      showResult(composed);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed', '');
    } finally {
      running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  function showGate() {
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${session.role || 'kenneth'}`;
    if (window.CSAuth) window.CSAuth.applyNav(session.role || 'kenneth');
    if (window.CSAuth) window.CSAuth.applyBrand(session.role || 'kenneth');
  }

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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-creator')) return;
    location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  runBtn?.addEventListener('click', () => {
    run().catch((err) => setError(err?.message || String(err)));
  });

  refreshStitchesBtn?.addEventListener('click', () => {
    loadStitches().catch((err) => {
      if (stitchPickStatus) stitchPickStatus.textContent = err?.message || String(err);
    });
  });

  stitchAccountFilter?.addEventListener('change', () => renderStitchPicker());

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      showGate();
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'stitch-creator')) return;
    showApp(data);
    await Promise.all([loadAccounts(), loadStitches()]);
  }

  boot().catch((err) => {
    showGate();
    if (gateError) {
      gateError.hidden = false;
      gateError.textContent = err?.message || String(err);
    }
  });
})();
