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

const URL_PATTERN = /https?:\/\/[^\s]+/i;
const SHOPIFY_HOST = /mimiepipo\.com\.br/i;

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
};

export function normalizeKey(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?…]+$/g, '')
    .trim();
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

export function pickParam(searchParams, key) {
  const v = searchParams.get(key);
  if (!v) return null;
  return v.replace(/\+/g, ' ').trim();
}

function extractUrl(text) {
  const m = text.match(URL_PATTERN);
  return m ? m[0].replace(/[.,;:!?)]+$/, '') : null;
}

function isCtaParagraph(text) {
  const t = text.trim();
  if (t.startsWith('👉')) return true;
  if (URL_PATTERN.test(t) && SHOPIFY_HOST.test(t)) return true;
  return false;
}

function isGarantiaParagraph(text) {
  return /^garantia de 60 dias/i.test(String(text).trim());
}

const RECOMMEND_BEFORE_CTA = `<p class="pag-adcopy pag-recommend">Eu recomendo melhorar a saúde intestinal com petiscos prebióticos naturais como o <strong>Digestão Saudável</strong> da Mimi e Pipo.</p><div class="pag-adcopy-spacer" aria-hidden="true"></div><div class="pag-adcopy-spacer" aria-hidden="true"></div><p class="pag-adcopy pag-recommend pag-recommend-offer">Por tempo limitado, eles estão oferecendo <strong>30% de desconto</strong> e <strong>frete grátis</strong> para minhas leitoras.</p>`;

const GUT_PROBLEMS_BLOCK = `<p class="pag-adcopy pag-gut-intro">Se o seu cachorro tem algum destes problemas, em cerca de duas semanas muita coisa pode melhorar quando você cuida do intestino dele — e, com isso, fortalece o sistema imune:</p>
<ul class="pag-list pag-problems">
<li>Coceira crônica, manchas na pele e hot spots</li>
<li>Giardia e parasitas intestinais que voltam depois do vermífugo</li>
<li>Arrastar o bumbum, glândula anal entupida e cheiro de peixe</li>
<li>Diarreia, cocô mole ou sangue nas fezes</li>
<li>Vômito frequente e vontade desesperada de comer grama</li>
<li>Comer cocô no passeio</li>
<li>Gases e cocô com cheiro forte demais</li>
<li>Falta de energia e apatia</li>
<li>Inquietação à noite e ansiedade</li>
<li>Rigidez e dor nas articulações em cães idosos</li>
<li>Intestino frágil depois de antibióticos ou probiótico que não resolveu</li>
</ul>`;

function shouldNotSplit(text) {
  const t = String(text).trim();
  if (!t) return true;
  if (t.startsWith('👉') || t.startsWith('•')) return true;
  if (URL_PATTERN.test(t)) return true;
  if (/^P\.?\s*P\.?\s*S/i.test(t)) return true;
  if (t.endsWith('...')) return true;
  return false;
}

function expandDisplayLines(text) {
  const t = String(text).trim();
  if (!t) return [];
  if (shouldNotSplit(t)) return [t];
  const parts = t.split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [t];
}

function expandDisplayParagraphs(paragraphs) {
  const out = [];
  for (const raw of paragraphs) {
    out.push(...expandDisplayLines(raw));
  }
  return out;
}

function renderParagraphs(paragraphs, pdp, { skipFirst = false } = {}) {
  const slice = expandDisplayParagraphs(
    skipFirst ? paragraphs.slice(1) : paragraphs,
  );
  const parts = [];
  let firstCtaDone = false;
  let gutProblemsDone = false;

  for (const raw of slice) {
    const text = String(raw).trim();
    if (!text) continue;

    if (isCtaParagraph(text)) {
      if (!firstCtaDone) {
        parts.push(RECOMMEND_BEFORE_CTA);
        firstCtaDone = true;
      }
      const href = extractUrl(text) || pdp;
      parts.push(
        `<div class="pag-cta-wrap pag-cta-wrap--adcopy"><a class="pag-cta-btn pag-cta-btn--green" href="${escapeHtml(href)}">Ver Digestão Saudável — Garantia de 60 dias</a></div>`,
      );
      continue;
    }

    parts.push(`<p class="pag-adcopy">${escapeHtml(text)}</p>`);
    if (isGarantiaParagraph(text) && !gutProblemsDone) {
      parts.push(GUT_PROBLEMS_BLOCK);
      gutProblemsDone = true;
    }
  }

  return parts.filter(Boolean).join('\n');
}

/** First line = headline; rest = body with original paragraph spacing. */
export function renderAdCopySections(paragraphs, pdp = PDP) {
  if (!paragraphs?.length) {
    const fallback = DEFAULTS.h1;
    return {
      headline: escapeHtml(fallback),
      bodyHtml: '',
    };
  }
  return {
    headline: escapeHtml(String(paragraphs[0]).trim()),
    bodyHtml: renderParagraphs(paragraphs, pdp, { skipFirst: true }),
  };
}

export function inlineCtaHtml(href, label, variant = 'green') {
  const cls =
    variant === 'blue'
      ? 'pag-cta-btn pag-cta-btn--blue'
      : 'pag-cta-btn pag-cta-btn--green';
  return `<div class="pag-cta-wrap pag-cta-wrap--inline"><a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(label)}</a></div>`;
}

export function stickyCtaHtml(href) {
  return `<div class="pag-sticky-cta" role="region" aria-label="Oferta para leitoras">
  <a class="pag-cta-btn pag-cta-btn--green pag-sticky-cta-btn" href="${escapeHtml(href)}">Ganhe 30% de desconto + frete grátis para leitoras — Digestão Saudável da Mimi e Pipo</a>
</div>`;
}

function leadPrefixMatch(urlLead, storedLead) {
  const a = normalizeKey(urlLead);
  const b = normalizeKey(storedLead);
  if (!a || !b) return false;
  const n = Math.min(60, a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
}

function pickAmbiguous(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  const plain = ids.filter((id) => !id.endsWith('-calmaxis'));
  if (plain.length === 1) return plain[0];
  if (plain.length) return plain.sort()[0];
  return ids.sort()[0];
}

/** Resolve variant from live Meta URLs: ?id=, ?h1=&lead=&hero=, or ?h1=&hero=. */
export function resolveVariantId(searchParams, lookup = null) {
  const idParam = pickParam(searchParams, 'id');
  if (idParam && /^[\w-]+$/.test(idParam)) return idParam;

  const h1 = pickParam(searchParams, 'h1');
  const lead = pickParam(searchParams, 'lead');
  const hero = pickParam(searchParams, 'hero');
  const problem = pickParam(searchParams, 'problem');

  if (lookup && h1 && lead) {
    const slug = hero ? (hero.match(/\/creatives\/([^/]+)\/hero/i) || [])[1] : '';
    const paramKey = [
      normalizeKey(h1),
      normalizeKey(lead).slice(0, 150),
      slug || '',
      problem ? normalizeKey(problem) : '',
    ]
      .filter(Boolean)
      .join('::');
    if (lookup.byParams?.[paramKey]) return lookup.byParams[paramKey];

    const exactKey = `${normalizeKey(h1)}::${normalizeKey(lead).slice(0, 150)}`;
    if (lookup.byHeadlineLead?.[exactKey]) return lookup.byHeadlineLead[exactKey];

    for (const [key, vid] of Object.entries(lookup.byHeadlineLead || {})) {
      const [keyH1, keyLead] = key.split('::');
      if (keyH1 !== normalizeKey(h1)) continue;
      if (leadPrefixMatch(lead, keyLead)) return vid;
    }

    const all = lookup.byParamsAll?.[paramKey];
    const picked = pickAmbiguous(all);
    if (picked) return picked;
  }

  if (lookup && h1) {
    const ids = lookup.byHeadline?.[normalizeKey(h1)];
    if (typeof ids === 'string') return ids;
    if (Array.isArray(ids) && ids.length === 1) return ids[0];
  }

  if (lookup && hero) {
    const m = hero.match(/\/creatives\/([^/]+)\/hero/i);
    if (m) {
      const ids = lookup.byHero?.[m[1]];
      if (typeof ids === 'string') return ids;
      if (Array.isArray(ids) && ids.length === 1) return ids[0];
      if (Array.isArray(ids) && ids.length > 1 && h1) {
        const nh = normalizeKey(h1);
        const match = ids.find((vid) =>
          normalizeKey(lookup.variants?.[vid]?.headline || '') === nh,
        );
        if (match) return match;
      }
      return m[1];
    }
  }

  return null;
}

export function resolveAdvertorial(
  searchParams,
  adCopyData = null,
  now = new Date(),
) {
  const pdp = adCopyData?.pdp || PDP;
  const urlHero = safeUrl(pickParam(searchParams, 'hero'), null);
  const urlH1 = pickParam(searchParams, 'h1');

  let headline = urlH1 || DEFAULTS.h1;
  let hero = urlHero || adCopyData?.hero || DEFAULTS.hero;
  let bodyHtml = '';

  if (adCopyData?.paragraphs?.length) {
    const sections = renderAdCopySections(adCopyData.paragraphs, pdp);
    headline = String(adCopyData.paragraphs[0]).trim();
    bodyHtml = sections.bodyHtml;
    if (!urlHero && adCopyData.hero) hero = adCopyData.hero;
  } else if (urlH1) {
    bodyHtml = pickParam(searchParams, 'lead')
      ? `<p class="pag-adcopy">${escapeHtml(pickParam(searchParams, 'lead'))}</p>`
      : '';
  } else {
    bodyHtml = '';
  }

  return {
    headlineHtml: escapeHtml(headline),
    headline,
    hero,
    heroAlt: headline.substring(0, 120),
    adCopyBodyHtml: bodyHtml,
    pageTitle: pageTitle(headline),
    publishedDate: publishedDate(now),
    footerYear: String(now.getFullYear()),
    pdp,
    stickyCta: stickyCtaHtml(pdp),
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

export function renderAdvertorial(
  template,
  searchParams,
  adCopyData = null,
  now = new Date(),
) {
  const data = resolveAdvertorial(searchParams, adCopyData, now);
  return template
    .replaceAll('__AD_HEADLINE__', data.headlineHtml)
    .replaceAll('__AD_COPY_BODY__', data.adCopyBodyHtml)
    .replaceAll('__HERO__', escapeHtml(data.hero))
    .replaceAll('__HERO_ALT__', escapeHtml(data.heroAlt))
    .replaceAll('__STICKY_CTA__', data.stickyCta)
    .replaceAll('__PAGE_TITLE__', escapeHtml(data.pageTitle))
    .replaceAll('__PUBLISHED_DATE__', escapeHtml(data.publishedDate))
    .replaceAll('__FOOTER_YEAR__', escapeHtml(data.footerYear))
    .replaceAll('__PDP__', escapeHtml(data.pdp))
    .replaceAll('__META_PIXEL_HEAD__', buildMetaPixelHead(META_PIXEL_ID))
    .replaceAll('__META_PIXEL_SCRIPT__', buildAttributionScript());
}
