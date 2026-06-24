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


def render_ad_copy(paragraphs: list[str]) -> str:
    parts: list[str] = []
    for raw in paragraphs:
        text = raw.strip()
        if not text:
            continue
        if is_cta_paragraph(text):
            href = extract_url(text)
            parts.append(
                f'<div class="pag-cta-wrap pag-cta-wrap--adcopy">'
                f'<a class="pag-cta-btn pag-cta-btn--green" href="{esc(href)}">'
                f"Ver Digestão Saudável — Garantia de 60 dias</a></div>"
            )
        else:
            parts.append(f'<p class="pag-adcopy">{esc(text)}</p>')
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


def default_ad_copy_html() -> str:
    sample = AD_COPY_DIR / "01-giardia-neighbor-fear.json"
    if sample.exists():
        data = json.loads(sample.read_text(encoding="utf-8"))
        return render_ad_copy(data.get("paragraphs", []))
    return f'<p class="pag-adcopy">{esc(DEFAULTS["headline"])}</p>'


def main() -> None:
    tpl = TEMPLATE.read_text(encoding="utf-8")
    pixel_head, pixel_script = pixel_snippets()
    headline = DEFAULTS["headline"]
    title = headline[:52] + "..." if len(headline) > 55 else headline
    out = (
        tpl.replace("__AD_COPY__", default_ad_copy_html())
        .replace("__HERO__", esc(DEFAULTS["hero"]))
        .replace("__HERO_ALT__", esc(headline[:120]))
        .replace("__INLINE_CTA_1__", inline_cta(PDP, "Verificar estoque — Digestão Saudável", "blue"))
        .replace("__INLINE_CTA_2__", inline_cta(PDP, "Quero 30% OFF + frete grátis para leitoras", "green"))
        .replace("__INLINE_CTA_3__", inline_cta(PDP, "Ver Digestão Saudável na loja oficial", "blue"))
        .replace("__INLINE_CTA_4__", inline_cta(PDP, "Garantir minha oferta de leitora agora", "green"))
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
