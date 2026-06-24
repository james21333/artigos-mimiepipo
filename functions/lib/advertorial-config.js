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

/** Render Facebook primary text — one <p> per blank-line break; PDP URLs become green CTAs. */
export function renderAdCopyHtml(paragraphs, pdp = PDP) {
  if (!paragraphs?.length) {
    return `<p class="pag-adcopy">${escapeHtml(DEFAULTS.h1)}</p>`;
  }
  return paragraphs
    .map((raw) => {
      const text = String(raw).trim();
      if (!text) return '';
      if (isCtaParagraph(text)) {
        const href = extractUrl(text) || pdp;
        return `<div class="pag-cta-wrap pag-cta-wrap--adcopy"><a class="pag-cta-btn pag-cta-btn--green" href="${escapeHtml(href)}">Ver Digestão Saudável — Garantia de 60 dias</a></div>`;
      }
      return `<p class="pag-adcopy">${escapeHtml(text)}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

export function inlineCtaHtml(
  href,
  label,
  variant = 'green',
) {
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

export function resolveAdvertorial(searchParams, adCopyData = null, now = new Date()) {
  const variantId = pickParam(searchParams, 'id');
  const pdp = adCopyData?.pdp || PDP;

  let hero = safeUrl(pickParam(searchParams, 'hero'), DEFAULTS.hero);
  let headline = DEFAULTS.h1;
  let adCopyHtml = '';

  if (adCopyData?.paragraphs?.length) {
    headline = adCopyData.headline || adCopyData.paragraphs[0];
    hero = safeUrl(adCopyData.hero, hero);
    adCopyHtml = renderAdCopyHtml(adCopyData.paragraphs, pdp);
  } else {
    const h1 = pickParam(searchParams, 'h1') || DEFAULTS.h1;
    headline = h1;
    adCopyHtml = `<p class="pag-adcopy">${escapeHtml(h1)}</p>`;
    if (pickParam(searchParams, 'lead')) {
      adCopyHtml += `\n<p class="pag-adcopy">${escapeHtml(pickParam(searchParams, 'lead'))}</p>`;
    }
  }

  return {
    variantId,
    headline,
    hero,
    heroAlt: headline.substring(0, 120),
    adCopyHtml,
    pageTitle: pageTitle(headline),
    publishedDate: publishedDate(now),
    footerYear: String(now.getFullYear()),
    pdp,
    inlineCta1: inlineCtaHtml(
      pdp,
      'Verificar estoque — Digestão Saudável',
      'blue',
    ),
    inlineCta2: inlineCtaHtml(
      pdp,
      'Quero 30% OFF + frete grátis para leitoras',
      'green',
    ),
    inlineCta3: inlineCtaHtml(
      pdp,
      'Ver Digestão Saudável na loja oficial',
      'blue',
    ),
    inlineCta4: inlineCtaHtml(
      pdp,
      'Garantir minha oferta de leitora agora',
      'green',
    ),
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
    .replaceAll('__AD_COPY__', data.adCopyHtml)
    .replaceAll('__HERO__', escapeHtml(data.hero))
    .replaceAll('__HERO_ALT__', escapeHtml(data.heroAlt))
    .replaceAll('__INLINE_CTA_1__', data.inlineCta1)
    .replaceAll('__INLINE_CTA_2__', data.inlineCta2)
    .replaceAll('__INLINE_CTA_3__', data.inlineCta3)
    .replaceAll('__INLINE_CTA_4__', data.inlineCta4)
    .replaceAll('__STICKY_CTA__', data.stickyCta)
    .replaceAll('__PAGE_TITLE__', escapeHtml(data.pageTitle))
    .replaceAll('__PUBLISHED_DATE__', escapeHtml(data.publishedDate))
    .replaceAll('__FOOTER_YEAR__', escapeHtml(data.footerYear))
    .replaceAll('__PDP__', escapeHtml(data.pdp))
    .replaceAll('__META_PIXEL_HEAD__', buildMetaPixelHead(META_PIXEL_ID))
    .replaceAll('__META_PIXEL_SCRIPT__', buildAttributionScript());
}
