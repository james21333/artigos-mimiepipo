/**
 * Shared Content Station frontend role gate.
 * Include before each *app.js via <script src="./auth-gate.js"></script>
 *
 * window.CSAuth.gatePage(session, pageId) → true if allowed (else redirects)
 * window.CSAuth.applyNav(role)
 * window.CSAuth.homeFor(role)
 * window.CSAuth.applyBrand(role)
 */
(function (global) {
  const BRAND_KENNETH = "Kenneth's Content Tools";

  const HOMES = {
    admin: './',
    download: './tiktok-download.html',
    ready: './ready.html',
    kenneth: './kenneth.html',
  };

  /** Nav link href → roles that may see it (admin always sees all). */
  const NAV_BY_HREF = [
    { match: /kenneth\.html/, roles: ['kenneth', 'admin'] },
    { match: /stitch-maker\.html/, roles: ['kenneth', 'admin'] },
    { match: /tiktok-download-character-remix-2-og-v2-music\.html/, roles: ['admin', 'kenneth'] },
    { match: /(?:^|\/)(?:index\.html)?$/, roles: ['admin'], label: 'Clean' },
    { match: /cleaned\.html/, roles: ['admin'] },
    { match: /tiktok-download-facefusion-remix\.html/, roles: ['admin'] },
    { match: /facefusion-remixes\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og-v2\.html/, roles: ['admin'] },
    { match: /viral-video-builder\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og(?:-v1)?\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix\.html/, roles: ['admin'] },
    { match: /remix2-ready\.html/, roles: ['admin'] },
    { match: /character-remixes\.html/, roles: ['admin'] },
    { match: /tiktok-download\.html/, roles: ['admin', 'download', 'kenneth'] },
    { match: /downloaded\.html/, roles: ['admin'] },
    { match: /ready(?:-account)?\.html/, roles: ['admin', 'ready'] },
  ];

  const PAGE_ROLES = {
    clean: ['admin'],
    cleaned: ['admin'],
    downloaded: ['admin'],
    'tiktok-download': ['admin', 'download', 'kenneth'],
    'tiktok-download-facefusion-remix': ['admin'],
    'facefusion-remixes': ['admin'],
    'tiktok-download-character-remix': ['admin'],
    'tiktok-download-character-remix-2-og': ['admin'],
    'tiktok-download-character-remix-2-og-v1': ['admin'],
    'tiktok-download-character-remix-2-og-v2': ['admin'],
    'tiktok-download-character-remix-2-og-v2-music': ['admin', 'kenneth'],
    'viral-video-builder': ['admin'],
    'character-remixes': ['admin'],
    'remix2-ready': ['admin'],
    ready: ['admin', 'ready'],
    'ready-account': ['admin', 'ready'],
    kenneth: ['admin', 'kenneth'],
    'stitch-maker': ['admin', 'kenneth'],
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
    if (roleAllowed(role, pageId)) {
      applyBrand(role);
      return true;
    }
    const dest = session.homePath || homeFor(role);
    if (dest) {
      global.location.replace(dest);
    }
    return false;
  }

  function hrefAllowedForRole(href, role) {
    if (role === 'admin') return true;
    for (const rule of NAV_BY_HREF) {
      if (rule.match.test(href) && rule.roles.includes(role)) return true;
    }
    // Home-ish links for limited roles
    if (
      (href === './' || href === '.' || /index\.html/.test(href)) &&
      role === 'kenneth'
    ) {
      return false;
    }
    return false;
  }

  function applyNav(role) {
    const r = role || 'admin';
    const navs = document.querySelectorAll('nav.top-nav a, footer a, .site-footer a');
    navs.forEach((a) => {
      const href = a.getAttribute('href') || '';
      const allowed = hrefAllowedForRole(href, r);
      a.hidden = !allowed;
      if (!allowed) {
        a.setAttribute('aria-hidden', 'true');
        a.tabIndex = -1;
      } else {
        a.removeAttribute('aria-hidden');
        a.removeAttribute('tabIndex');
      }
    });
    applyBrand(r);
  }

  function applyBrand(role) {
    if (role !== 'kenneth') return;
    document.querySelectorAll('.brand').forEach((el) => {
      el.textContent = BRAND_KENNETH;
    });
    const title = document.querySelector('title');
    if (title && !/Kenneth/i.test(title.textContent || '')) {
      title.textContent = `${BRAND_KENNETH} | ${(title.textContent || '').replace(/^Content Station\s*\|\s*/i, '')}`;
    }
  }

  global.CSAuth = {
    homeFor,
    roleAllowed,
    gatePage,
    applyNav,
    applyBrand,
    PAGE_ROLES,
    BRAND_KENNETH,
  };
})(typeof window !== 'undefined' ? window : globalThis);
