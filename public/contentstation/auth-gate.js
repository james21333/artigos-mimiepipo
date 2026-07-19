/**
 * Shared Content Station frontend role gate.
 * Include before each *app.js via <script src="./auth-gate.js"></script>
 *
 * window.CSAuth.gatePage(session, pageId) → true if allowed (else redirects)
 * window.CSAuth.applyNav(role)
 * window.CSAuth.homeFor(role)
 */
(function (global) {
  const HOMES = {
    admin: './',
    download: './tiktok-download.html',
    ready: './ready.html',
  };

  /** Nav link href → roles that may see it (admin always sees all). */
  const NAV_BY_HREF = [
    { match: /(?:^|\/)(?:index\.html)?$/, roles: ['admin'], label: 'Clean' },
    { match: /cleaned\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og-v2\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og(?:-v1)?\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix\.html/, roles: ['admin'] },
    { match: /character-remixes\.html/, roles: ['admin'] },
    { match: /tiktok-download\.html/, roles: ['admin', 'download'] },
    { match: /downloaded\.html/, roles: ['admin'] },
    { match: /ready(?:-account)?\.html/, roles: ['admin', 'ready'] },
  ];

  const PAGE_ROLES = {
    clean: ['admin'],
    cleaned: ['admin'],
    downloaded: ['admin'],
    'tiktok-download': ['admin', 'download'],
    'tiktok-download-character-remix': ['admin'],
    'tiktok-download-character-remix-2-og': ['admin'],
    'tiktok-download-character-remix-2-og-v1': ['admin'],
    'tiktok-download-character-remix-2-og-v2': ['admin'],
    'character-remixes': ['admin'],
    ready: ['admin', 'ready'],
    'ready-account': ['admin', 'ready'],
    old: ['admin'],
  };

  function homeFor(role) {
    return HOMES[role] || HOMES.admin;
  }

  function roleAllowed(role, pageId) {
    if (!role) return false;
    if (role === 'admin') return true;
    const allowed = PAGE_ROLES[pageId] || [];
    return allowed.includes(role);
  }

  /**
   * If authenticated but wrong role for this page, redirect to their home.
   * Returns true when the caller may continue showing the app.
   */
  function gatePage(session, pageId) {
    if (!session || !session.authenticated) return false;
    const role = session.role || 'admin';
    if (roleAllowed(role, pageId)) return true;
    const dest = session.homePath || homeFor(role);
    if (dest) {
      global.location.replace(dest);
    }
    return false;
  }

  function applyNav(role) {
    const r = role || 'admin';
    const navs = document.querySelectorAll('nav.top-nav a, footer a, .site-footer a');
    navs.forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (r === 'admin') {
        a.hidden = false;
        return;
      }
      // Hide links this role cannot use.
      let allowed = false;
      if (/ready(?:-account)?\.html/.test(href) || href.includes('ready.html')) {
        allowed = r === 'ready';
      } else if (/tiktok-download-character-remix-2-og(?:-v\d+)?\.html/.test(href)) {
        allowed = false;
      } else if (/tiktok-download-character-remix\.html/.test(href)) {
        allowed = false;
      } else if (/character-remixes\.html/.test(href)) {
        allowed = false;
      } else if (/tiktok-download\.html/.test(href)) {
        allowed = r === 'download';
      } else if (
        /cleaned\.html/.test(href) ||
        /downloaded\.html/.test(href) ||
        href === './' ||
        href === '.' ||
        /index\.html/.test(href) ||
        href.endsWith('/contentstation/') ||
        href.endsWith('/contentstation')
      ) {
        allowed = false;
      } else {
        // Unknown link — hide for limited roles
        allowed = false;
      }
      a.hidden = !allowed;
      if (!allowed) {
        a.setAttribute('aria-hidden', 'true');
        a.tabIndex = -1;
      }
    });
  }

  global.CSAuth = {
    homeFor,
    roleAllowed,
    gatePage,
    applyNav,
    PAGE_ROLES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
