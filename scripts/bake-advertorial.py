#!/usr/bin/env python3
"""Bake static advertorial.html from template with default ATF values."""

from __future__ import annotations

import html
import json
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "public/advertorial.template.html"
OUTPUT = ROOT / "public/advertorial.html"
AD_COPY_DIR = ROOT / "public/ad-copy"
PDP = "https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003"
META_PIXEL_ID = "1960132154863603"

DEFAULTS = {
    "headline": "A carga intestinal escondida por trás dos problemas do seu cão (e por que cada remédio falha de novo)",
    "hero": "https://artigos.mimiepipo.com.br/advertorial/images/inline-01-atf-hero.png",
}


def published_date() -> str:
    d = datetime.now() - timedelta(days=35)
    months = [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ]
    return f"{d.day} de {months[d.month - 1]} de {d.year}"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def is_cta_paragraph(text: str) -> bool:
    t = text.strip()
    return t.startswith("👉") or (
        "mimiepipo.com.br" in t and ("http://" in t or "https://" in t)
    )


def extract_url(text: str) -> str:
    import re

    m = re.search(r"https?://[^\s]+", text)
    if not m:
        return PDP
    return m.group(0).rstrip(".,;:!?)")


def is_garantia_paragraph(text: str) -> bool:
    return text.strip().lower().startswith("garantia de 60 dias")


RECOMMEND_BEFORE_CTA = (
    '<p class="pag-adcopy pag-recommend">Eu recomendo melhorar a saúde intestinal com '
    "petiscos prebióticos naturais como o <strong>Digestão Saudável</strong> da Mimi e Pipo.</p>"
    '<div class="pag-adcopy-spacer" aria-hidden="true"></div>'
    '<div class="pag-adcopy-spacer" aria-hidden="true"></div>'
    '<p class="pag-adcopy pag-recommend pag-recommend-offer">Por tempo limitado, eles estão oferecendo '
    "<strong>30% de desconto</strong> e <strong>frete grátis</strong> para minhas leitoras.</p>"
)

GUT_HEALTH_HEADLINE = (
    "Você pode resolver vários problemas de saúde mantendo o intestino do seu cão saudável"
)

GUT_PROBLEMS_BLOCK = """<p class="pag-adcopy pag-gut-intro">Se o seu cachorro tem algum destes problemas, em cerca de duas semanas muita coisa pode melhorar quando você cuida do intestino dele — e, com isso, fortalece o sistema imune:</p>
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
</ul>"""


def should_not_split(text: str) -> bool:
    import re

    t = text.strip()
    if not t:
        return True
    if t.startswith("👉") or t.startswith("•"):
        return True
    if "http://" in t or "https://" in t:
        return True
    if re.match(r"^P\.?\s*P\.?\s*S", t, re.I):
        return True
    if t.endswith("..."):
        return True
    return False


def split_into_display_lines(text: str) -> list[str]:
    import re

    t = text.strip()
    if not t:
        return []
    if should_not_split(t):
        return [t]
    parts = re.split(r"(?<=[.!?…])\s+", t)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) <= 1:
        return [t]
    return parts


def expand_display_paragraphs_list(paragraphs: list[str]) -> list[str]:
    out: list[str] = []
    for block in paragraphs:
        out.extend(split_into_display_lines(block))
    return out


AD_COPY_CTA_LABEL = "Ver Digestão Saudável — Garantia de 60 dias"


def ad_copy_cta_html(href: str) -> str:
    return (
        f'<div class="pag-cta-wrap pag-cta-wrap--adcopy">'
        f'<a class="pag-cta-btn pag-cta-btn--green" href="{esc(href)}">'
        f"{AD_COPY_CTA_LABEL}</a></div>"
    )


def mid_cta_line_indices(slice_lines: list[str], word_count: int) -> set[int]:
    if word_count <= 900:
        return set()
    body_end = next(
        (i for i, raw in enumerate(slice_lines) if is_cta_paragraph(raw.strip())),
        len(slice_lines),
    )
    if body_end < 45:
        return set()
    return {
        i
        for i in (int(body_end * 0.33), int(body_end * 0.66))
        if 8 < i < body_end - 8
    }


def render_ad_copy(paragraphs: list[str], word_count: int = 0) -> str:
    slice_lines = expand_display_paragraphs_list(paragraphs)
    mid_cta_at = mid_cta_line_indices(slice_lines, word_count)
    parts: list[str] = []
    first_cta_done = False
    gut_problems_done = False
    line_idx = 0
    for raw in slice_lines:
        text = raw.strip()
        if not text:
            continue
        if is_cta_paragraph(text):
            if not first_cta_done:
                parts.append(RECOMMEND_BEFORE_CTA)
                first_cta_done = True
            parts.append(ad_copy_cta_html(extract_url(text)))
            line_idx += 1
            continue
        if line_idx in mid_cta_at:
            parts.append(ad_copy_cta_html(PDP))
        if is_garantia_paragraph(text) and not gut_problems_done:
            parts.append(
                f'<h2 class="pag-h2 pag-adcopy-headline">{esc(GUT_HEALTH_HEADLINE)}</h2>'
            )
            parts.append(GUT_PROBLEMS_BLOCK)
            gut_problems_done = True
            line_idx += 1
            continue
        parts.append(f'<p class="pag-adcopy">{esc(text)}</p>')
        line_idx += 1
    return "\n".join(parts)


def inline_cta(href: str, label: str, variant: str) -> str:
    cls = (
        "pag-cta-btn pag-cta-btn--blue"
        if variant == "blue"
        else "pag-cta-btn pag-cta-btn--green"
    )
    return (
        f'<div class="pag-cta-wrap pag-cta-wrap--inline">'
        f'<a class="{cls}" href="{esc(href)}">{esc(label)}</a></div>'
    )


def sticky_cta(href: str) -> str:
    label = (
        "Ganhe 30% de desconto + frete grátis para leitoras — "
        "Digestão Saudável da Mimi e Pipo"
    )
    return (
        f'<div class="pag-sticky-cta" role="region" aria-label="Oferta para leitoras">'
        f'<a class="pag-cta-btn pag-cta-btn--green pag-sticky-cta-btn" href="{esc(href)}">'
        f"{esc(label)}</a></div>"
    )


def pixel_snippets() -> tuple[str, str]:
    head = f"""<!-- Meta Pixel (prelander — same ID as Shopify PDP) -->
<script>
!function(f,b,e,v,n,t,s)
{{if(f.fbq)return;n=f.fbq=function(){{n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)}};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '{META_PIXEL_ID}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id={META_PIXEL_ID}&amp;ev=PageView&amp;noscript=1"
/></noscript>"""
    script = """<script>
(function () {
  var ATTR = ["fbclid","utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id"];
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
</script>"""
    return head, script


def render_ad_copy_body(paragraphs: list[str], word_count: int = 0) -> tuple[str, str]:
    if not paragraphs:
        h = DEFAULTS["headline"]
        return esc(h), ""
    headline = esc(paragraphs[0].strip())
    body = render_ad_copy(paragraphs[1:], word_count)
    return headline, body


def default_ad_copy_sections() -> tuple[str, str]:
    sample = AD_COPY_DIR / "01-giardia-neighbor-fear.json"
    if sample.exists():
        data = json.loads(sample.read_text(encoding="utf-8"))
        return render_ad_copy_body(
            data.get("paragraphs", []),
            data.get("wordCount", 0),
        )
    h = esc(DEFAULTS["headline"])
    return h, ""


def main() -> None:
    tpl = TEMPLATE.read_text(encoding="utf-8")
    pixel_head, pixel_script = pixel_snippets()
    headline_html, body_html = default_ad_copy_sections()
    headline = DEFAULTS["headline"]
    sample = AD_COPY_DIR / "01-giardia-neighbor-fear.json"
    if sample.exists():
        data = json.loads(sample.read_text(encoding="utf-8"))
        paras = data.get("paragraphs", [])
        if paras:
            headline = paras[0].strip()
    title = headline[:52] + "..." if len(headline) > 55 else headline
    out = (
        tpl.replace("__AD_HEADLINE__", headline_html)
        .replace("__AD_COPY_BODY__", body_html)
        .replace("__HERO__", esc(DEFAULTS["hero"]))
        .replace("__HERO_ALT__", esc(headline[:120]))
        .replace("__STICKY_CTA__", sticky_cta(PDP))
        .replace("__PAGE_TITLE__", esc(title))
        .replace("__PUBLISHED_DATE__", esc(published_date()))
        .replace("__FOOTER_YEAR__", esc(str(datetime.now().year)))
        .replace("__PDP__", esc(PDP))
        .replace("__META_PIXEL_HEAD__", pixel_head)
        .replace("__META_PIXEL_SCRIPT__", pixel_script)
    )
    OUTPUT.write_text(out, encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
