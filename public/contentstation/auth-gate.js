/**
 * Shared Content Station frontend role gate.
 * Include before each *app.js via <script src="./auth-gate.js"></script>
 *
 * window.CSAuth.gatePage(session, pageId) → true if allowed (else redirects)
 * window.CSAuth.applyNav(role)
 * window.CSAuth.applyBrand(role)
 * window.CSAuth.homeFor(role)
 */
(function (global) {
  const BRAND_KENNETH = "Kenneth's Content Tools";
  const ALL_ROLES = ['admin', 'download', 'ready', 'kenneth'];

  const HOMES = {
    admin: './',
    download: './tiktok-download.html',
    ready: './ready.html',
    kenneth: './kenneth.html',
  };

  /**
   * Top nav on every page, for every login.
   * Keep this list in sync with index.html footer (footer = everything else).
   */
  const PRIMARY_NAV = [
    {
      href: './tiktok-download-character-remix-2-og-v2-music.html',
      label: 'V2 Music-Only',
      page: 'tiktok-download-character-remix-2-og-v2-music.html',
    },
    {
      href: './ready.html',
      label: 'Ready For Upload',
      page: 'ready.html',
      alsoCurrent: ['ready-account.html', 'ready-archived.html'],
    },
    {
      href: './tiktok-url-lists.html',
      label: 'TikTok URL lists',
      page: 'tiktok-url-lists.html',
    },
    { href: './stitch-videos.html', label: 'Stitch videos', page: 'stitch-videos.html' },
    { href: './stitch-creator.html', label: 'Stitch Creator', page: 'stitch-creator.html' },
    {
      href: './stitch-creator-videos.html',
      label: 'Stitch Creator gallery',
      page: 'stitch-creator-videos.html',
    },
    {
      href: './character-remixes.html',
      label: 'Recent remixes',
      page: 'character-remixes.html',
    },
    { href: './usage-tracker.html', label: 'Usage tracker', page: 'usage-tracker.html' },
  ];

  /** Other station pages — shown in the main Clean page footer only. */
  const FOOTER_LINKS = [
    { href: './', label: 'Clean video', page: 'index.html' },
    { href: './cleaned.html', label: 'Cleaned videos' },
    { href: './tiktok-download.html', label: 'TikTok download' },
    { href: './downloaded.html', label: 'Downloaded videos' },
    { href: './tiktok-download-character-remix.html', label: 'Character remix' },
    { href: './tiktok-download-character-remix-2-og.html', label: 'Remix 2 OG V1' },
    { href: './tiktok-download-character-remix-2-og-v2.html', label: 'V2 Talking Heads' },
    { href: './tiktok-download-character-remix-2-og-v3.html', label: 'Talking Heads V3' },
    { href: './tiktok-download-character-remix-2-og-talking-johnny.html', label: 'Talking Johnny' },
    {
      href: './tiktok-download-character-remix-2-og-talking-johnny-jolly-voice-mod.html',
      label: 'Talking Johnny Jolly Voice Mod',
    },
    { href: './johnny-stub-fix.html', label: 'Johnny Stub Fix' },
    { href: './johnny-jolly-voice-mod.html', label: 'Johnny Jolly Voice Mod' },
    { href: './prompt-talking.html', label: 'Prompt talking' },
    { href: './disclaimer-burn.html', label: 'Disclaimer burn' },
    { href: './viral-video-builder.html', label: 'Viral Video Builder' },
    { href: './remix2-ready.html', label: 'Remix 2 ready' },
    { href: './tiktok-download-facefusion-remix.html', label: 'Remix 3 FaceFusion' },
    { href: './facefusion-remixes.html', label: 'FaceFusion remixes' },
    { href: './ready-account.html', label: 'Ready account' },
    { href: './ready-archived.html', label: 'Archived accounts' },
    { href: './stitch-maker.html', label: 'Stitch Maker with Character' },
    { href: './kenneth.html', label: "Kenneth's home" },
    { href: './views-tracker.html', label: 'Views & URLs' },
    { href: './old213223523.html', label: 'Old tools' },
    { href: '/', label: '← Artigos hub' },
  ];

  /** Nav / footer href → roles that may see it (admin always sees all). */
  const NAV_BY_HREF = [
    { match: /usage-tracker\.html/, roles: ALL_ROLES },
    { match: /character-remixes\.html/, roles: ALL_ROLES },
    { match: /tiktok-url-lists\.html/, roles: ALL_ROLES },
    { match: /stitch-videos\.html/, roles: ALL_ROLES },
    { match: /stitch-creator\.html/, roles: ALL_ROLES },
    { match: /stitch-creator-videos\.html/, roles: ALL_ROLES },
    { match: /tiktok-download-character-remix-2-og-v2-music\.html/, roles: ALL_ROLES },
    { match: /ready(?:-account|-archived)?\.html/, roles: ALL_ROLES },
    { match: /views-tracker\.html/, roles: ['kenneth', 'admin'] },
    { match: /stitch-maker\.html/, roles: ['kenneth', 'admin'] },
    { match: /kenneth\.html/, roles: ['kenneth', 'admin'] },
    { match: /(?:^|\/)(?:index\.html)?$/, roles: ['admin'], label: 'Clean' },
    { match: /cleaned\.html/, roles: ['admin'] },
    { match: /tiktok-download-facefusion-remix\.html/, roles: ['admin'] },
    { match: /facefusion-remixes\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og-v2\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og-v3\.html/, roles: ['admin'] },
    { match: /johnny-stub-fix\.html/, roles: ['admin'] },
    { match: /johnny-jolly-voice-mod\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og-talking-johnny-jolly-voice-mod\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og-talking-johnny\.html/, roles: ['admin'] },
    { match: /prompt-talking\.html/, roles: ['admin'] },
    { match: /disclaimer-burn\.html/, roles: ['admin'] },
    { match: /viral-video-builder\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix-2-og(?:-v1)?\.html/, roles: ['admin'] },
    { match: /tiktok-download-character-remix\.html/, roles: ['admin'] },
    { match: /remix2-ready\.html/, roles: ['admin'] },
    { match: /tiktok-download\.html/, roles: ['admin', 'download', 'kenneth'] },
    { match: /downloaded\.html/, roles: ['admin'] },
    { match: /old213223523\.html/, roles: ['admin'] },
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
    'tiktok-download-character-remix-2-og-v3': ['admin'],
    'tiktok-download-character-remix-2-og-talking-johnny': ['admin'],
    'johnny-stub-fix': ['admin'],
    'johnny-jolly-voice-mod': ['admin'],
    'tiktok-download-character-remix-2-og-talking-johnny-jolly-voice-mod': ['admin'],
    'tiktok-download-character-remix-2-og-v2-music': ALL_ROLES,
    'prompt-talking': ['admin'],
    'tiktok-url-lists': ALL_ROLES,
    'disclaimer-burn': ['admin'],
    'viral-video-builder': ['admin'],
    'character-remixes': ALL_ROLES,
    'remix2-ready': ['admin'],
    ready: ALL_ROLES,
    'ready-account': ALL_ROLES,
    'ready-archived': ALL_ROLES,
    kenneth: ['admin', 'kenneth'],
    'views-tracker': ['admin', 'kenneth'],
    'stitch-maker': ['admin', 'kenneth'],
    'stitch-videos': ALL_ROLES,
    'stitch-creator': ALL_ROLES,
    'stitch-creator-videos': ALL_ROLES,
    'usage-tracker': ALL_ROLES,
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
    if (href === '/' || href === '') return true;
    for (const rule of NAV_BY_HREF) {
      if (rule.match.test(href) && rule.roles.includes(role)) return true;
    }
    if (
      (href === './' || href === '.' || /index\.html/.test(href)) &&
      role === 'kenneth'
    ) {
      return false;
    }
    return false;
  }

  function currentPageFile() {
    try {
      const path = String(global.location?.pathname || '');
      const leaf = path.split('/').filter(Boolean).pop() || '';
      if (!leaf || leaf === 'contentstation') return 'index.html';
      return leaf;
    } catch {
      return '';
    }
  }

  function isPrimaryNavPage(page, item) {
    return (
      page === item.page ||
      (Array.isArray(item.alsoCurrent) && item.alsoCurrent.includes(page))
    );
  }

  /** Rebuild every top-nav with the shared primary links. */
  function applyPrimaryNav(role) {
    const page = currentPageFile();
    const r = role || 'admin';
    document.querySelectorAll('nav.top-nav').forEach((nav) => {
      nav.setAttribute('aria-label', 'Station');
      nav.replaceChildren();
      for (const item of PRIMARY_NAV) {
        if (!hrefAllowedForRole(item.href, r)) continue;
        const a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.label;
        if (isPrimaryNavPage(page, item)) {
          a.setAttribute('aria-current', 'page');
        }
        nav.appendChild(a);
      }
    });
  }

  /** Main Clean page only: fill footer with every other station link. */
  function applyMainFooter(role) {
    const page = currentPageFile();
    if (page !== 'index.html') return;

    const r = role || 'admin';
    let foot = document.getElementById('station-more-links');
    if (!foot) {
      foot = document.querySelector('p.foot, footer.site-footer, .site-footer');
    }
    if (!foot) return;

    foot.replaceChildren();
    foot.classList.add('foot', 'station-more-links');
    foot.setAttribute('aria-label', 'More Content Station pages');

    const heading = document.createElement('span');
    heading.className = 'foot-heading';
    heading.textContent = 'More pages';
    foot.appendChild(heading);

    for (const item of FOOTER_LINKS) {
      if (!hrefAllowedForRole(item.href, r) && item.href !== '/') continue;
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label;
      if (item.page && isPrimaryNavPage(page, item)) {
        a.setAttribute('aria-current', 'page');
      }
      foot.appendChild(a);
    }
  }

  function applyNav(role) {
    const r = role || 'admin';
    applyPrimaryNav(r);
    applyMainFooter(r);
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
    PRIMARY_NAV,
    FOOTER_LINKS,
    BRAND_KENNETH,
  };
})(typeof window !== 'undefined' ? window : globalThis);
