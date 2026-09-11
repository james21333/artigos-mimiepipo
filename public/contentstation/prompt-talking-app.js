(function () {
  const PAGE_ID = 'prompt-talking';
  const STORAGE_KEY = 'cs_prompt_talking_v1';
  const POLL_MS = 4000;
  const PLAN_POLL_MS = 2500;
  const PLAN_TIMEOUT_MS = 15 * 60 * 1000;
  const JOB_TIMEOUT_MS = 45 * 60 * 1000;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const statusLine = document.getElementById('status-line');
  const statusDetail = document.getElementById('status-detail');
  const errorEl = document.getElementById('prompt-talking-error');
  const promptEl = document.getElementById('master-prompt');
  const titleInput = document.getElementById('job-title');
  const runBtn = document.getElementById('run-btn');
  const planBox = document.getElementById('plan-box');
  const outputGallery = document.getElementById('output-gallery');
  const batchList = document.getElementById('batch-list');

  let publicBaseUrl = '';
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

  const accountsUi =
    window.CSRemix2Accounts &&
    window.CSRemix2Accounts.createController({
      api,
      getPublicBaseUrl: () => publicBaseUrl,
      onError: (msg) => setError(msg),
    });

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || '';
  }

  function setStatus(main, detail) {
    if (statusLine) statusLine.textContent = main || '';
    if (statusDetail) {
      statusDetail.hidden = !detail;
      statusDetail.textContent = detail || '';
    }
  }

  function saveBatch() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(batchJobs));
    } catch {
      /* ignore */
    }
  }

  function loadBatch() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      batchJobs = Array.isArray(arr) ? arr.filter((j) => j && j.jobId) : [];
    } catch {
      batchJobs = [];
    }
  }

  function mediaFinalPath(jobId) {
    const key = `character-remix-2-og/${jobId}/final.mp4`;
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function resolveFinalUrl(job, data) {
    return data?.output_url || data?.outputUrl || job?.outputUrl || mediaFinalPath(job?.jobId);
  }

  function isTerminal(stage) {
    return (
      stage === 'stitched' ||
      stage === 'error' ||
      stage === 'provider_give_up' ||
      stage === 'done'
    );
  }

  function renderPlan(plan) {
    if (!planBox) return;
    if (!plan) {
      planBox.hidden = true;
      planBox.textContent = '';
      return;
    }
    const lines = [];
    if (plan.title) lines.push(`Title: ${plan.title}`);
    lines.push(`Characters: ${plan.characterCount || (plan.characters || []).length || 0}`);
    lines.push(`Scenes: ${plan.sceneCount || (plan.scenes || []).length || 0}`);
    for (const s of plan.scenes || []) {
      const kind = s.kind || '?';
      const dur = s.durationSec != null ? `${s.durationSec}s` : '';
      const dlg = s.dialogue ? ` — “${s.dialogue}”` : '';
      lines.push(`• ${s.id} [${kind}] ${dur}${dlg}`);
    }
    for (const c of plan.characters || []) {
      lines.push(`• char ${c.id} (${c.role || '?'}) ${c.key || ''}`);
    }
    planBox.hidden = !lines.length;
    planBox.textContent = lines.join('\n');
  }

  function ensureCard(job) {
    if (!batchList) return null;
    batchList.hidden = false;
    let card = batchList.querySelector(`[data-job-id="${job.jobId}"]`);
    if (card) return card;
    card = document.createElement('article');
    card.className = 'download-result-card';
    card.dataset.jobId = job.jobId;
    card.innerHTML = `<p class="result-status">Queued</p>
      <p class="result-jobid">${job.jobId}</p>
      <p class="result-error error" hidden></p>`;
    batchList.appendChild(card);
    return card;
  }

  function renderFinal(job, data) {
    if (!outputGallery) return;
    const stage = data?.stage || job.stage || '';
    if (stage !== 'stitched' && !data?.outputUploaded) return;
    const url = resolveFinalUrl(job, data);
    if (!url) return;
    outputGallery.hidden = false;
    let wrap = outputGallery.querySelector(`[data-final-job="${job.jobId}"]`);
    if (!wrap) {
      wrap = document.createElement('article');
      wrap.className = 'download-result-card';
      wrap.dataset.finalJob = job.jobId;
      outputGallery.appendChild(wrap);
    }
    wrap.innerHTML = `<p class="result-jobid">${job.jobId}</p>
      <video src="${url}" controls playsinline></video>
      <a class="ghost" href="${url}" download>Download</a>`;
  }

  function updateCard(job, data) {
    const card = ensureCard(job);
    if (!card) return;
    const stage = data?.stage || job.stage || '';
    const statusEl = card.querySelector('.result-status');
    if (statusEl) statusEl.textContent = data?.message || stage || 'Working';
    const errEl = card.querySelector('.result-error');
    if (errEl) {
      if (stage === 'error' || stage === 'provider_give_up') {
        errEl.hidden = false;
        errEl.textContent = data?.message || data?.error || 'Failed';
      } else {
        errEl.hidden = true;
        errEl.textContent = '';
      }
    }
    if (stage === 'error' || stage === 'provider_give_up') {
      setError(data?.message || data?.error || 'Job failed');
    }
    if (data?.outputUrl) job.outputUrl = data.outputUrl;
    if (data?.output_url) job.outputUrl = data.output_url;
    if (data?.stage) job.stage = data.stage;
    if (data?.promptTalking?.planTitle || data?.scenes) {
      /* keep plan box from start response */
    }
    saveBatch();
    renderFinal(job, data);
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(tick, POLL_MS);
    tick();
  }

  async function tick() {
    let allDone = true;
    for (const job of batchJobs) {
      if (!job?.jobId || isTerminal(job.stage)) continue;
      allDone = false;
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=status&jobId=${encodeURIComponent(job.jobId)}`,
      );
      if (ok && data) updateCard(job, data);
    }
    if (allDone && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollPlan(planId) {
    const started = Date.now();
    while (Date.now() - started < PLAN_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, PLAN_POLL_MS));
      const { ok, data, status } = await api(
        `/api/contentstation/character-remix-2-og?action=prompt-talking-status&planId=${encodeURIComponent(planId)}`,
      );
      if (!ok) {
        throw new Error(
          (data && (data.message || data.error)) || `Plan status failed (HTTP ${status})`,
        );
      }
      const stage = String(data?.stage || '');
      setStatus(data?.message || `Planning… (${stage})`, planId);
      if (data?.plan) renderPlan(data.plan);
      if (stage === 'done' && data?.jobId) return data;
      if (stage === 'error' || data?.ok === false) {
        throw new Error(data?.message || data?.error || 'Planning failed');
      }
    }
    throw new Error('Planning timed out after 15 minutes.');
  }

  async function onRun() {
    if (submitting) return;
    const masterPrompt = String(promptEl?.value || '').trim();
    if (!masterPrompt) {
      setError('Enter a master prompt.');
      return;
    }
    const accountSelect = document.getElementById('account-select');
    const accountVal = String(accountsUi?.selected?.() || accountSelect?.value || '').trim();
    if (!accountVal) {
      setError('Pick a Ready For Upload account.');
      return;
    }

    submitting = true;
    if (runBtn) runBtn.disabled = true;
    setError('');
    setStatus('Starting plan…', '');
    renderPlan(null);

    try {
      const body = {
        action: 'prompt-talking',
        masterPrompt,
        title: String(titleInput?.value || '').trim() || undefined,
        account: accountVal,
        autoRun: true,
      };
      const vid = accountsUi?.voiceId?.() || '';
      const vlab = accountsUi?.voiceLabel?.() || '';
      if (vid) {
        body.voiceId = vid;
        if (vlab) body.voiceLabel = vlab;
      }

      const { ok, data, status } = await api('/api/contentstation/character-remix-2-og', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!ok || !data?.planId) {
        throw new Error(
          (data && (data.message || data.error)) || `Start failed (HTTP ${status})`,
        );
      }

      setStatus(data.message || 'Planning scenes…', data.planId);
      const planned = await pollPlan(data.planId);
      if (planned?.plan) renderPlan(planned.plan);

      const jobId = String(planned.jobId || '');
      if (!jobId) throw new Error('Plan finished without a jobId.');

      const job = {
        jobId,
        stage: planned.jobStage || 'queued',
        startedAt: Date.now(),
        planId: data.planId,
      };
      batchJobs.unshift(job);
      saveBatch();
      ensureCard(job);
      setStatus(`Job ${jobId} queued`, planned.message || '');
      startPoll();

      // Soft timeout note only — poll continues until terminal.
      setTimeout(() => {
        if (!isTerminal(job.stage)) {
          setStatus(`Still running ${jobId}…`, 'This can take a while for multi-scene Grok.');
        }
      }, JOB_TIMEOUT_MS);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Failed.', '');
    } finally {
      submitting = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      if (gate) gate.hidden = false;
      if (app) app.hidden = true;
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, PAGE_ID)) return;
    if (window.CSAuth) window.CSAuth.applyNav(data.role || 'admin');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) sessionMeta.textContent = `Signed in · ${data.role || 'admin'}`;

    const cfg = await api('/api/contentstation/character-remix-2-og?action=config');
    publicBaseUrl = String(cfg.data?.r2?.publicBaseUrl || cfg.data?.publicBaseUrl || '').trim();

    if (accountsUi?.loadAccounts) await accountsUi.loadAccounts();

    loadBatch();
    for (const job of batchJobs) ensureCard(job);
    if (batchJobs.some((j) => j?.jobId && !isTerminal(j.stage))) startPoll();

    runBtn?.addEventListener('click', onRun);
    setStatus('Ready.', '');
  }

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
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

  boot().catch((err) => {
    setError(err?.message || String(err));
  });
})();
