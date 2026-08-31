/**
 * Grok Imagine remaining-capacity banner (community formulas, no AI).
 * Consumer meter = per Imagine submit (~2%/720p gen). Scene count matters more than duration.
 * Mount: <div id="grok-quota-banner"></div> near top of #app.
 */
(function () {
  const API = '/api/contentstation/character-remix-2-og';
  const REFRESH_MS = 60000;

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtReset(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      return iso || '—';
    }
  }

  function fmtLeft(ms) {
    if (ms == null || ms < 0) return '';
    const h = Math.floor(ms / 3600000);
    const d = Math.floor(h / 24);
    const rh = h % 24;
    if (d > 0) return `${d}d ${rh}h left`;
    return `${h}h left`;
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }

  function render(el, data, err) {
    if (err) {
      el.innerHTML = `<div class="grok-quota-banner" data-state="error"><p class="grok-quota-title">Grok Imagine estimate</p><p class="error">${esc(err)}</p></div>`;
      return;
    }
    const v = data.remaining?.videos || {};
    const fin = data.remaining?.finished || {};
    const week = data.weekClips || {};
    const formulas = data.formulas || {};
    const other = data.otherQuotas || [];
    const used = data.usagePercentUsed;
    const submits = data.remaining?.submits ?? v['7s'];
    const liveOk = data.usageLive?.ok;
    const liveErr = data.usageLive?.error;
    const liveAt = data.usageLive?.fetchedAt;
    const scenesT = formulas.scenesTalking ?? 6;
    const scenesM = formulas.scenesMusicAvg ?? 8;

    el.innerHTML = `
      <div class="grok-quota-banner" data-state="ok">
        <div class="grok-quota-head">
          <p class="grok-quota-title">Grok Imagine left (per-submit estimates)</p>
          <p class="grok-quota-meta">
            SuperGrok Plus · weekly pool · resets <strong>${esc(fmtReset(data.resetAt))}</strong>
            ${data.msUntilReset != null ? ` · ${esc(fmtLeft(data.msUntilReset))}` : ''}
          </p>
        </div>
        <div class="grok-quota-counts" role="list">
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(submits ?? '—')}</span><span class="l">submits left</span></div>
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(fin.talking6Scene ?? '—')}</span><span class="l">× talking (${esc(scenesT)} sc)</span></div>
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(fin.musicAvgScenes ?? '—')}</span><span class="l">× music (~${esc(scenesM)} sc)</span></div>
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(fin.singleSubmit ?? v['1m'] ?? '—')}</span><span class="l">× 1-submit clips</span></div>
        </div>
        <p class="grok-quota-sub">
          used <strong>${esc(used)}%</strong>
          ${liveOk ? ' · <span class="grok-quota-live">auto from Grok billing</span>' : ''}
          ${liveAt ? ` · pulled ${esc(fmtReset(liveAt))}` : ''}
          · pool ≈ ${esc(formulas.poolGens ?? formulas.pool10sUnits)} submits
          ($30×${esc(formulas.plusMult)}; account cal ≈${esc(formulas.accountCalibratedMult)}×)
          · our week: ${esc(week.clips)} submits / ${esc(week.seconds)}s
          · duration chips flat: 7s=${esc(v['7s'])} 15s=${esc(v['15s'])} 30s=${esc(v['30s'])} 1m=${esc(v['1m'])}
        </p>
        ${liveErr && !liveOk ? `<p class="error">Live billing: ${esc(liveErr)}</p>` : ''}
        <details class="grok-quota-details">
          <summary>Quotas communities / xAI mention</summary>
          <ul>
            ${other.map((o) => `<li><strong>${esc(o.name)}:</strong> ${esc(o.detail)}</li>`).join('')}
          </ul>
          <p class="muted-line">$30: ~50×720p gens/week at 2%/submit (r/grok + FamilyPro). Duration barely changes consumer %. Scene submits divide finished videos. Plus has no published table — we use account ≈3.3×.</p>
        </details>
        <button type="button" class="ghost grok-quota-refresh" id="grok-quota-refresh">Refresh usage now</button>
        <p id="grok-quota-usage-msg" class="muted-line" hidden></p>
      </div>
    `;

    el.querySelector('#grok-quota-refresh')?.addEventListener('click', async () => {
      const msg = el.querySelector('#grok-quota-usage-msg');
      if (msg) {
        msg.hidden = false;
        msg.className = 'muted-line';
        msg.textContent = 'Refreshing…';
      }
      await refresh(el, true);
    });
  }

  async function refresh(el, force) {
    const q = new URLSearchParams({ action: 'grok-quota' });
    if (force) q.set('forceRefresh', '1');
    const { ok, data } = await api(`${API}?${q}`);
    if (!ok || !data?.ok) {
      render(el, null, data?.error || data?.message || 'Could not load Grok quota estimate');
      return;
    }
    render(el, data, null);
  }

  function mount() {
    const el = document.getElementById('grok-quota-banner');
    if (!el) return;
    refresh(el, false);
    setInterval(() => refresh(el, false), REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
