export const PDP =
  'https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003';

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

export function buildQuote(customProblem) {
  const problems = BASE_PROBLEMS.slice();
  if (customProblem) {
    const norm = normalizeProblem(customProblem);
    const exists = problems.some((p) => {
      const pn = normalizeProblem(p);
      return pn === norm || pn.includes(norm) || norm.includes(pn);
    });
    if (!exists) problems.splice(2, 0, customProblem);
  }
  const last = problems.pop();
  const list = `${problems.join(', ')} ou ${last}`;
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
    .replaceAll('__QUOTE__', escapeHtml(data.quote))
    .replaceAll('__PAGE_TITLE__', escapeHtml(data.pageTitle))
    .replaceAll('__PUBLISHED_DATE__', escapeHtml(data.publishedDate))
    .replaceAll('__FOOTER_YEAR__', escapeHtml(data.footerYear))
    .replaceAll('__PDP__', escapeHtml(data.pdp));
}
