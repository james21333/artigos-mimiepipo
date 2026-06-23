export const PDP =
  'https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003';

/** Same pixel as Shopify Facebook & Instagram channel (Web Pixels Manager). */
export const META_PIXEL_ID = '1960132154863603';

const ATTRIBUTION_PARAMS = [
  'fbclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
];

export function buildMetaPixelHead(pixelId) {
  if (!pixelId) return '';
  return `<!-- Meta Pixel (prelander — same ID as Shopify PDP) -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&amp;ev=PageView&amp;noscript=1"
/></noscript>`;
}

export function buildAttributionScript() {
  const paramsJson = JSON.stringify(ATTRIBUTION_PARAMS);
  return `<script>
(function () {
  var ATTR = ${paramsJson};
  var landing = new URL(window.location.href);
  var stored = {};
  ATTR.forEach(function (k) {
    var v = landing.searchParams.get(k);
    if (v) {
      stored[k] = v;
      try { sessionStorage.setItem('mp_attr_' + k, v); } catch (e) {}
    }
  });
  function withAttribution(href) {
    try {
      var u = new URL(href, window.location.origin);
      Object.keys(stored).forEach(function (k) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, stored[k]);
      });
      return u.toString();
    } catch (e) {
      return href;
    }
  }
  document.querySelectorAll('a.pag-cta-btn[href]').forEach(function (a) {
    a.href = withAttribution(a.href);
  });
})();
</script>`;
}

const IMG = 'https://artigos.mimiepipo.com.br/advertorial/images';

export const DEFAULTS = {
  h1: 'A carga intestinal escondida por trás dos problemas do seu cão (e por que cada remédio falha de novo)',
  hero: `${IMG}/inline-01-atf-hero.png`,
  lead:
    'Se o seu cão tem problemas crônicos de pele, comportamento ou digestão, você provavelmente já tentou o que a maioria tenta.',
  problem: null,
};

export const ANGLES = {
  digestion: {
    h1: 'Tentei de tudo para consertar a digestão do meu cão — até encontrar essa alternativa',
    hero: 'https://artigos.mimiepipo.com.br/advertorial/angles/digestion-hero.jpg',
    lead:
      'Eu tentei remédio, troca de ração e probiótico. Nada segurava. Foi quando uma amiga me mostrou os biscoitos Digestão Saudável que o intestino dele finalmente mudou.',
    problem: 'tem cocô mole',
  },
  shinycoat: {
    h1: 'O pelo opaco do meu cão tinha solução — e não era só shampoo',
    hero: 'https://artigos.mimiepipo.com.br/advertorial/angles/shinycoat-hero.jpg',
    lead:
      'Gastei com banho, shampoo e condicionador. O brilho só voltou quando parei de tratar só a superfície e cuidei do intestino dele por dentro.',
    problem: 'pelo opaco e sem brilho',
  },
};

const BASE_PROBLEMS = [
  'arrasta o bumbum',
  'lambe a pata até ferir',
  'tem cocô mole',
  'acorda a casa às 3 da manhã',
];

function normalizeProblem(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findCustomProblemRef(problems, customProblem) {
  if (!customProblem) return null;
  const norm = normalizeProblem(customProblem);
  const match = problems.find((p) => {
    const pn = normalizeProblem(p);
    return pn === norm || pn.includes(norm) || norm.includes(pn);
  });
  if (match) return match;
  problems.splice(2, 0, customProblem);
  return customProblem;
}

function formatQuoteProblem(problem, boldRef) {
  const text = escapeHtml(problem);
  return problem === boldRef ? `<strong>${text}</strong>` : text;
}

export function buildQuote(customProblem) {
  const problems = BASE_PROBLEMS.slice();
  const boldRef = findCustomProblemRef(problems, customProblem);
  const last = problems.pop();
  const list = `${problems.map((p) => formatQuoteProblem(p, boldRef)).join(', ')} ou ${formatQuoteProblem(last, boldRef)}`;
  return `“Se o seu cão ${list} — costuma haver a mesma causa por trás.”`;
}

export function publishedDate(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - 35);
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function pageTitle(h1) {
  return h1.length > 55 ? `${h1.substring(0, 52)}...` : h1;
}

function safeUrl(raw, fallback) {
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch (_) {
    /* ignore */
  }
  return fallback;
}

function pickParam(searchParams, key) {
  const v = searchParams.get(key);
  if (!v) return null;
  return v.replace(/\+/g, ' ').trim();
}

export function resolveAdvertorial(searchParams, now = new Date()) {
  const angleKey = (pickParam(searchParams, 'angle') || '').toLowerCase();
  const angle = ANGLES[angleKey] || null;

  const h1 = pickParam(searchParams, 'h1') || angle?.h1 || DEFAULTS.h1;
  const hero = safeUrl(
    pickParam(searchParams, 'hero'),
    angle?.hero || DEFAULTS.hero,
  );
  const lead = pickParam(searchParams, 'lead') || angle?.lead || DEFAULTS.lead;
  const problem =
    pickParam(searchParams, 'problem') || angle?.problem || DEFAULTS.problem;
  const quoteOverride = pickParam(searchParams, 'quote');
  const quote = quoteOverride || buildQuote(problem);

  return {
    h1,
    hero,
    heroAlt: h1.substring(0, 120),
    lead,
    quote,
    pageTitle: pageTitle(h1),
    publishedDate: publishedDate(now),
    footerYear: String(now.getFullYear()),
    pdp: PDP,
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAdvertorial(template, searchParams, now = new Date()) {
  const data = resolveAdvertorial(searchParams, now);
  return template
    .replaceAll('__H1__', escapeHtml(data.h1))
    .replaceAll('__HERO__', escapeHtml(data.hero))
    .replaceAll('__HERO_ALT__', escapeHtml(data.heroAlt))
    .replaceAll('__LEAD__', escapeHtml(data.lead))
    .replaceAll('__QUOTE__', data.quote)
    .replaceAll('__PAGE_TITLE__', escapeHtml(data.pageTitle))
    .replaceAll('__PUBLISHED_DATE__', escapeHtml(data.publishedDate))
    .replaceAll('__FOOTER_YEAR__', escapeHtml(data.footerYear))
    .replaceAll('__PDP__', escapeHtml(data.pdp))
    .replaceAll('__META_PIXEL_HEAD__', buildMetaPixelHead(META_PIXEL_ID))
    .replaceAll('__META_PIXEL_SCRIPT__', buildAttributionScript());
}
