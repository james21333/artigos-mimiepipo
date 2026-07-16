(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const ghostcutOut = document.getElementById('ghostcut-out');
  const mediaOut = document.getElementById('media-out');
  const mediaList = document.getElementById('media-list');
  const mediaGate = document.getElementById('media-gate');
  const runpodOut = document.getElementById('runpod-out');
  const runpodGate = document.getElementById('runpod-gate');

  let pollTimer = null;
  let lastSession = null;

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

  function showApp(session) {
    lastSession = session;
    gate.hidden = true;
    app.hidden = false;
    const bits = [];
    bits.push(session.ghostcutConfigured ? 'GhostCut: ok' : 'GhostCut: missing');
    bits.push(session.passwordConfigured ? 'Password: ok' : 'Password: missing');
    bits.push(session.features?.r2 ? 'R2: bound' : 'R2: unbound');
    bits.push(session.features?.runpod ? 'RunPod: key set' : 'RunPod: no key');
    sessionMeta.textContent = bits.join(' · ');

    if (!session.features?.r2) {
      mediaGate.hidden = false;
      mediaGate.textContent =
        'R2 binding not active yet. Enable R2 in Cloudflare Dashboard (add payment method once), create bucket content-station-media, redeploy with wrangler.toml [[r2_buckets]].';
    } else {
      mediaGate.hidden = true;
    }

    if (!session.features?.runpod) {
      runpodGate.hidden = false;
      runpodGate.textContent =
        'RUNPOD_API_KEY not set. Add it to secrets/.env and run scripts/set-cloudflare-pages-secrets.sh, then refresh.';
    } else {
      runpodGate.hidden = true;
    }
  }

  function pretty(status, data) {
    return JSON.stringify({ status, data }, null, 2);
  }

  function extractWorkIds(data) {
    const ids = [];
    const list = data?.body?.dataList;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && item.id != null) ids.push(String(item.id));
      }
    }
    return ids;
  }

  function summarizeStatus(data) {
    const content = data?.body?.content;
    if (!Array.isArray(content) || !content.length) return null;
    return content.map((c) => ({
      id: c.id,
      processStatus: c.processStatus,
      videoUrl: c.videoUrl || null,
      srcSrtUrl: c.srcSrtUrl || null,
      tgtSrtUrl: c.tgtSrtUrl || null,
      errorDetail: c.errorDetail || null,
    }));
  }

  function buildErasePayload(jobType, videoUrl, lang) {
    if (jobType === 'erase-auto') {
      return {
        urls: [videoUrl],
        needChineseOcclude: 1,
        videoInpaintLang: lang,
      };
    }
    // erase-lite (default) — matches skill quickstart example
    return {
      urls: [videoUrl],
      needChineseOcclude: 2,
      videoInpaintLang: lang,
      extraOptions: JSON.stringify({ extra_inpaint_config: { model: 'advanced_lite' } }),
      videoInpaintMasks: JSON.stringify([
        {
          type: 'remove_only_ocr',
          start: 0,
          end: 99999,
          region: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
      ]),
    };
  }

  async function refreshSession() {
    const { ok, data } = await api('/api/contentstation/session');
    if (ok && data && data.authenticated) {
      showApp(data);
      if (data.features?.r2) refreshMediaList().catch(() => {});
      return true;
    }
    showGate();
    return false;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    gateError.hidden = true;
    const password = document.getElementById('password').value;
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate((data && (data.message || data.error)) || 'Login failed');
      return;
    }
    document.getElementById('password').value = '';
    await refreshSession();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    stopPoll();
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  document.getElementById('balance-btn').addEventListener('click', async () => {
    ghostcutOut.textContent = 'Loading balance…';
    const { status, data } = await api('/api/contentstation/balance');
    ghostcutOut.textContent = pretty(status, data);
  });

  document.getElementById('gc-submit-btn').addEventListener('click', async () => {
    const jobType = document.getElementById('gc-job-type').value;
    const lang = document.getElementById('gc-lang').value;
    let payload;
    if (jobType === 'custom') {
      const raw = document.getElementById('gc-custom-json').value.trim();
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        ghostcutOut.textContent = 'Custom JSON is invalid.';
        return;
      }
    } else {
      const videoUrl = document.getElementById('gc-video-url').value.trim();
      if (!videoUrl) {
        ghostcutOut.textContent = 'Video URL is required.';
        return;
      }
      payload = buildErasePayload(jobType, videoUrl, lang);
    }

    ghostcutOut.textContent = 'Submitting /work/free…';
    const { status, data } = await api('/api/contentstation/ghostcut/v-w-c/gateway/ve/work/free', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const ids = extractWorkIds(data);
    if (ids.length) {
      document.getElementById('gc-work-id').value = ids.join(',');
    }
    ghostcutOut.textContent =
      pretty(status, data) +
      (ids.length ? `\n\n— Work ID(s): ${ids.join(', ')} (filled into status field)` : '');
  });

  async function checkWorkStatus() {
    const raw = document.getElementById('gc-work-id').value.trim();
    if (!raw) {
      ghostcutOut.textContent = 'Enter a work ID first (or submit a job).';
      return;
    }
    const idWorks = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => (/^\d+$/.test(id) ? Number(id) : id));

    ghostcutOut.textContent = 'Checking work/status…';
    const { status, data } = await api('/api/contentstation/ghostcut/v-w-c/gateway/ve/work/status', {
      method: 'POST',
      body: JSON.stringify({ idWorks }),
    });
    const summary = summarizeStatus(data);
    ghostcutOut.textContent =
      (summary ? `Summary:\n${JSON.stringify(summary, null, 2)}\n\n` : '') + pretty(status, data);
    return { status, data, summary };
  }

  document.getElementById('gc-status-btn').addEventListener('click', () => {
    checkWorkStatus().catch((err) => {
      ghostcutOut.textContent = String(err);
    });
  });

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    document.getElementById('gc-poll-btn').hidden = false;
    document.getElementById('gc-poll-stop-btn').hidden = true;
  }

  document.getElementById('gc-poll-btn').addEventListener('click', async () => {
    stopPoll();
    document.getElementById('gc-poll-btn').hidden = true;
    document.getElementById('gc-poll-stop-btn').hidden = false;
    await checkWorkStatus();
    pollTimer = setInterval(() => {
      checkWorkStatus().catch(() => stopPoll());
    }, 15000);
  });

  document.getElementById('gc-poll-stop-btn').addEventListener('click', stopPoll);

  function renderMediaList(objects) {
    if (!objects || !objects.length) {
      mediaList.innerHTML = '<p class="muted-line">No objects yet.</p>';
      return;
    }
    mediaList.innerHTML = objects
      .map((o) => {
        const size = o.size != null ? `${o.size} B` : '';
        const when = o.uploaded || '';
        return `<div class="media-row">
          <div class="media-meta">
            <code>${escapeHtml(o.key)}</code>
            <span class="muted-line">${escapeHtml(size)}${when ? ' · ' + escapeHtml(when) : ''}</span>
          </div>
          <div class="row">
            <a class="btn-link" href="${o.downloadPath}&download=1" target="_blank" rel="noopener">Download</a>
            <button type="button" class="ghost media-del" data-key="${escapeAttr(o.key)}">Delete</button>
          </div>
        </div>`;
      })
      .join('');

    mediaList.querySelectorAll('.media-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-key');
        if (!key || !confirm(`Delete ${key}?`)) return;
        mediaOut.textContent = `Deleting ${key}…`;
        const { status, data } = await api('/api/contentstation/media', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', key }),
        });
        mediaOut.textContent = pretty(status, data);
        await refreshMediaList();
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  async function refreshMediaList() {
    mediaOut.textContent = 'Listing…';
    const prefix = document.getElementById('media-prefix').value.trim() || 'media/';
    const { ok, status, data } = await api(
      `/api/contentstation/media?action=list&prefix=${encodeURIComponent(prefix)}&limit=100`,
    );
    mediaOut.textContent = pretty(status, data);
    if (ok && data && Array.isArray(data.objects)) {
      renderMediaList(data.objects);
    } else if (data && data.status === 'unconfigured') {
      mediaList.innerHTML = '';
    }
  }

  document.getElementById('media-refresh-btn').addEventListener('click', () => {
    refreshMediaList().catch((e) => {
      mediaOut.textContent = String(e);
    });
  });

  document.getElementById('media-upload-btn').addEventListener('click', async () => {
    const fileInput = document.getElementById('media-file');
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      mediaOut.textContent = 'Choose a file first.';
      return;
    }
    const prefix = document.getElementById('media-prefix').value.trim() || 'media/';
    const form = new FormData();
    form.append('file', file);
    form.append('prefix', prefix);
    mediaOut.textContent = `Uploading ${file.name} (${file.size} bytes)…`;
    const { status, data } = await api('/api/contentstation/media', {
      method: 'POST',
      body: form,
      headers: {},
    });
    mediaOut.textContent = pretty(status, data);
    fileInput.value = '';
    await refreshMediaList();
  });

  function rpEndpoint() {
    return document.getElementById('rp-endpoint').value.trim();
  }

  document.getElementById('rp-config-btn').addEventListener('click', async () => {
    runpodOut.textContent = 'Loading config…';
    const { status, data } = await api('/api/contentstation/runpod?action=config');
    if (data && data.endpointId && !rpEndpoint()) {
      document.getElementById('rp-endpoint').value = data.endpointId;
    }
    runpodOut.textContent = pretty(status, data);
  });

  document.getElementById('rp-health-btn').addEventListener('click', async () => {
    const ep = rpEndpoint();
    const q = ep ? `&endpointId=${encodeURIComponent(ep)}` : '';
    runpodOut.textContent = 'Checking health…';
    const { status, data } = await api(`/api/contentstation/runpod?action=health${q}`);
    runpodOut.textContent = pretty(status, data);
  });

  document.getElementById('rp-run-btn').addEventListener('click', async () => {
    let input;
    try {
      input = JSON.parse(document.getElementById('rp-input').value || '{}');
    } catch {
      runpodOut.textContent = 'Input JSON is invalid.';
      return;
    }
    const body = { action: 'run', input };
    const ep = rpEndpoint();
    if (ep) body.endpointId = ep;
    runpodOut.textContent = 'Submitting /run…';
    const { status, data } = await api('/api/contentstation/runpod', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const jobId = data?.id || data?.jobId;
    if (jobId) document.getElementById('rp-job-id').value = String(jobId);
    runpodOut.textContent = pretty(status, data);
  });

  document.getElementById('rp-status-btn').addEventListener('click', async () => {
    const jobId = document.getElementById('rp-job-id').value.trim();
    if (!jobId) {
      runpodOut.textContent = 'Enter a job ID.';
      return;
    }
    const ep = rpEndpoint();
    const q = [
      `action=status`,
      `jobId=${encodeURIComponent(jobId)}`,
      ep ? `endpointId=${encodeURIComponent(ep)}` : '',
    ]
      .filter(Boolean)
      .join('&');
    runpodOut.textContent = 'Polling status…';
    const { status, data } = await api(`/api/contentstation/runpod?${q}`);
    runpodOut.textContent = pretty(status, data);
  });

  document.getElementById('rp-cancel-btn').addEventListener('click', async () => {
    const jobId = document.getElementById('rp-job-id').value.trim();
    if (!jobId) {
      runpodOut.textContent = 'Enter a job ID.';
      return;
    }
    const body = { action: 'cancel', jobId };
    const ep = rpEndpoint();
    if (ep) body.endpointId = ep;
    runpodOut.textContent = 'Cancelling…';
    const { status, data } = await api('/api/contentstation/runpod', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    runpodOut.textContent = pretty(status, data);
  });

  refreshSession().catch(() =>
    showGate('Could not reach session API (deploy Functions + set secrets).'),
  );
})();
