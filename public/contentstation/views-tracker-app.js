(function () {
  const SHEET_ID = '1DEGGxGD2ERkMy_iVPOdE4AF7oPgrHaKmr0LXULk7s74';
  /** Tab ids are fixed Google Sheet handles — the cell values inside stay live. */
  const TABS = {
    yt: {
      label: 'YT STATS',
      gid: '1969652636',
    },
    tiktok: {
      label: 'TIKTOK STATS',
      gid: '700392823',
    },
    urls: {
      label: 'URL-YT/TIKTOK',
      gid: '69408482',
    },
  };
  /** Re-load the live sheet embed so employee updates show up (not a server cron). */
  const AUTO_REFRESH_MS = 12 * 60 * 60 * 1000;

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const logoutBtn = document.getElementById('logout-btn');
  const sheetFrame = document.getElementById('sheet-frame');
  const openSheetLink = document.getElementById('open-sheet-link');
  const reloadBtn = document.getElementById('reload-sheet-btn');
  const refreshHint = document.getElementById('refresh-hint');
  const tabButtons = Array.from(document.querySelectorAll('.views-tab'));

  let activeTab = 'yt';
  let refreshTimer = null;
  let hintTimer = null;
  let lastLoadedAt = 0;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
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

  function sheetEditUrl(gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${gid}#gid=${gid}`;
  }

  function sheetEmbedUrl(gid, bustCache) {
    // Live shared sheet — not a snapshot. Cache-bust so embeds pick up new cell values.
    let url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlembed?gid=${gid}&widget=true&chrome=false&single=true`;
    if (bustCache) url += `&t=${Date.now()}`;
    return url;
  }

  function showGate() {
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    stopAutoRefresh();
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) {
      sessionMeta.textContent = `Signed in · ${session.role || 'kenneth'}`;
    }
    if (window.CSAuth) window.CSAuth.applyNav(session.role || 'kenneth');
    if (window.CSAuth) window.CSAuth.applyBrand(session.role || 'kenneth');
    selectTab(activeTab, true);
    startAutoRefresh();
  }

  function updateRefreshHint() {
    if (!refreshHint) return;
    if (!lastLoadedAt) {
      refreshHint.textContent = 'Live sheet · updates when the other employee edits it';
      return;
    }
    const ago = Math.max(0, Math.round((Date.now() - lastLoadedAt) / 1000));
    refreshHint.textContent =
      ago < 60
        ? 'Live sheet · just refreshed'
        : ago < 3600
          ? `Live sheet · last refreshed ${Math.round(ago / 60)}m ago · auto-refresh every 12h`
          : `Live sheet · last refreshed ${Math.round(ago / 3600)}h ago · auto-refresh every 12h`;
  }

  function loadFrame(bustCache) {
    const tab = TABS[activeTab] || TABS.yt;
    if (!sheetFrame) return;
    sheetFrame.title = `${tab.label} — Social Media Marketing Tracker`;
    sheetFrame.src = sheetEmbedUrl(tab.gid, bustCache);
    lastLoadedAt = Date.now();
    updateRefreshHint();
  }

  function selectTab(tabKey, bustCache) {
    const tab = TABS[tabKey] || TABS.yt;
    activeTab = tabKey in TABS ? tabKey : 'yt';
    for (const btn of tabButtons) {
      const on = btn.dataset.tab === activeTab;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (openSheetLink) {
      openSheetLink.href = sheetEditUrl(tab.gid);
      openSheetLink.textContent = `Open ${tab.label} in Google Sheets`;
    }
    loadFrame(bustCache !== false);
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      if (document.hidden) return;
      loadFrame(true);
    }, AUTO_REFRESH_MS);
    hintTimer = setInterval(updateRefreshHint, 5000);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (hintTimer) {
      clearInterval(hintTimer);
      hintTimer = null;
    }
  }

  for (const btn of tabButtons) {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab || 'yt', true));
  }

  reloadBtn?.addEventListener('click', () => loadFrame(true));

  // No refresh-on-tab-focus — auto-refresh is 12h only; use Reload now if needed.

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
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'views-tracker')) return;
    location.reload();
  });

  logoutBtn?.addEventListener('click', async () => {
    stopAutoRefresh();
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    location.reload();
  });

  async function boot() {
    const { ok, data } = await api('/api/contentstation/session');
    if (!ok || !data?.authenticated) {
      showGate();
      return;
    }
    if (window.CSAuth && !window.CSAuth.gatePage(data, 'views-tracker')) return;
    showApp(data);
  }

  boot().catch((err) => {
    showGate();
    if (gateError) {
      gateError.hidden = false;
      gateError.textContent = err?.message || String(err);
    }
  });
})();
