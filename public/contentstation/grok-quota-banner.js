/**
 * Grok Imagine remaining-capacity banner (community formulas, no AI).
 * Mount: <div id="grok-quota-banner"></div> near top of #app.
 */
(function () {
  const API = '/api/contentstation/character-remix-2-og';
  const LS_KEY = 'cs_grok_usage_percent';
  const REFRESH_MS = 120000;

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
    const saved = localStorage.getItem(LS_KEY) || '';

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
          ~${esc(data.remaining?.as10sGens ?? '—')} community-style 10s gens left ·
          pool ≈ ${esc(formulas.pool10sUnits)} × 10s
          ( $30 baseline ${esc(formulas.communityStd10s720pPerWeek)} × Plus ${esc(formulas.plusMult)} ) ·
          used <strong>${esc(used)}%</strong> (${esc(src)}) ·
          our submits this week: ${esc(week.clips)} clips / ${esc(week.seconds)}s
        </p>
        <details class="grok-quota-details">
          <summary>Quotas communities / xAI mention</summary>
          <ul>
            ${other.map((o) => `<li><strong>${esc(o.name)}:</strong> ${esc(o.detail)}</li>`).join('')}
          </ul>
          <p class="muted-line">Formula: remaining_seconds = pool_10s×10 × (1 − used%). Counts = floor(remaining_seconds ÷ duration). Used % prefers grok.com Usage when saved; else our clip seconds this week.</p>
        </details>
        <form class="grok-quota-usage-form" id="grok-quota-usage-form">
          <label for="grok-usage-percent">Usage % from grok.com Settings → Usage</label>
          <div class="row">
            <input id="grok-usage-percent" name="percent" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="e.g. 4" value="${esc(saved)}">
            <button type="submit">Update estimates</button>
          </div>
        </form>
        <p id="grok-quota-usage-msg" class="muted-line" hidden></p>
      </div>
    `;

    const form = el.querySelector('#grok-quota-usage-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = el.querySelector('#grok-usage-percent');
      const msg = el.querySelector('#grok-quota-usage-msg');
      const pct = Number(input?.value);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Enter 0–100 from the Usage tab.';
          msg.className = 'error';
        }
        return;
      }
      localStorage.setItem(LS_KEY, String(pct));
      const { ok, data: out } = await api(API, {
        method: 'POST',
        body: JSON.stringify({ action: 'grok-quota-usage', percentUsed: pct }),
      });
      if (!ok || !out?.ok) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = out?.error || 'Save failed';
          msg.className = 'error';
        }
        return;
      }
      render(el, out, null);
    });
  }

  async function refresh(el) {
    const saved = localStorage.getItem(LS_KEY);
    const q = new URLSearchParams({ action: 'grok-quota' });
    if (saved != null && saved !== '') q.set('usagePercent', saved);
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
    refresh(el);
    setInterval(() => refresh(el), REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
