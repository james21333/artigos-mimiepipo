(function () {
  const SHEET_ID = '1DEGGxGD2ERkMy_iVPOdE4AF7oPgrHaKmr0LXULk7s74';
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
  const tabButtons = Array.from(document.querySelectorAll('.views-tab'));

  let activeTab = 'yt';

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

  function sheetEmbedUrl(gid) {
    // Shared “anyone with the link” sheet — embed a single tab for Kenneth.
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlembed?gid=${gid}&widget=true&chrome=false&single=true`;
  }

  function showGate() {
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
  }

  function showApp(session) {
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (sessionMeta) {
      sessionMeta.textContent = `Signed in · ${session.role || 'kenneth'}`;
    }
    if (window.CSAuth) window.CSAuth.applyNav(session.role || 'kenneth');
    if (window.CSAuth) window.CSAuth.applyBrand(session.role || 'kenneth');
    selectTab(activeTab);
  }

  function selectTab(tabKey) {
    const tab = TABS[tabKey] || TABS.yt;
    activeTab = tabKey in TABS ? tabKey : 'yt';
    for (const btn of tabButtons) {
      const on = btn.dataset.tab === activeTab;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const embed = sheetEmbedUrl(tab.gid);
    const edit = sheetEditUrl(tab.gid);
    if (sheetFrame) {
      sheetFrame.title = `${tab.label} — Social Media Marketing Tracker`;
      if (sheetFrame.src !== embed) sheetFrame.src = embed;
    }
    if (openSheetLink) {
      openSheetLink.href = edit;
      openSheetLink.textContent = `Open ${tab.label} in Google Sheets`;
    }
  }

  for (const btn of tabButtons) {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab || 'yt'));
  }

  reloadBtn?.addEventListener('click', () => {
    const tab = TABS[activeTab] || TABS.yt;
    if (!sheetFrame) return;
    // Bust cache so Kenneth sees the latest employee updates.
    sheetFrame.src = `${sheetEmbedUrl(tab.gid)}&t=${Date.now()}`;
  });

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
