/**
 * Grok Imagine remaining-capacity banner (community formulas, no AI).
 * Usage % is auto-fetched on the worker from Grok billing — no manual paste needed.
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
    const week = data.weekClips || {};
    const formulas = data.formulas || {};
    const other = data.otherQuotas || [];
    const used = data.usagePercentUsed;
    const src = data.usagePercentSource || '';
    const liveOk = data.usageLive?.ok;
    const liveErr = data.usageLive?.error;
    const liveAt = data.usageLive?.fetchedAt;

    el.innerHTML = `
      <div class="grok-quota-banner" data-state="ok">
        <div class="grok-quota-head">
          <p class="grok-quota-title">Grok Imagine left (720p estimates)</p>
          <p class="grok-quota-meta">
            SuperGrok Plus · weekly pool · resets <strong>${esc(fmtReset(data.resetAt))}</strong>
            ${data.msUntilReset != null ? ` · ${esc(fmtLeft(data.msUntilReset))}` : ''}
          </p>
        </div>
        <div class="grok-quota-counts" role="list">
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(v['7s'] ?? '—')}</span><span class="l">× 7s</span></div>
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(v['15s'] ?? '—')}</span><span class="l">× 15s</span></div>
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(v['30s'] ?? '—')}</span><span class="l">× 30s</span></div>
          <div class="grok-quota-chip" role="listitem"><span class="n">${esc(v['1m'] ?? v['60s'] ?? '—')}</span><span class="l">× 1 min</span></div>
        </div>
        <p class="grok-quota-sub">
          used <strong>${esc(used)}%</strong>
          ${liveOk ? ' · <span class="grok-quota-live">auto from Grok billing</span>' : ` · (${esc(src)})`}
          ${liveAt ? ` · pulled ${esc(fmtReset(liveAt))}` : ''}
          · ~${esc(data.remaining?.as10sGens ?? '—')} × 10s left
          · pool ≈ ${esc(formulas.pool10sUnits)} × 10s ($30×${esc(formulas.plusMult)} planning)
          · our submits this week: ${esc(week.clips)} clips / ${esc(week.seconds)}s
        </p>
        ${liveErr && !liveOk ? `<p class="error">Live billing: ${esc(liveErr)}</p>` : ''}
        <details class="grok-quota-details">
          <summary>Quotas communities / xAI mention</summary>
          <ul>
            ${other.map((o) => `<li><strong>${esc(o.name)}:</strong> ${esc(o.detail)}</li>`).join('')}
          </ul>
          <p class="muted-line">$30 receipt: ~50×10s 720p/week (2%/gen). Plus has no published clip table — counts use a ${esc(formulas.plusMult)}× planning mult. Used % is live from Grok billing when OAuth works.</p>
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
