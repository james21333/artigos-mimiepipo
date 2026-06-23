#!/usr/bin/env python3
"""Bake static advertorial.html from template with default ATF values."""

from __future__ import annotations

import html
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "public/advertorial.template.html"
OUTPUT = ROOT / "public/advertorial.html"
PDP = "https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003"
META_PIXEL_ID = "1960132154863603"

DEFAULTS = {
    "h1": "A carga intestinal escondida por trás dos problemas do seu cão (e por que cada remédio falha de novo)",
    "hero": "https://artigos.mimiepipo.com.br/advertorial/images/inline-01-atf-hero.png",
    "lead": "Se o seu cão tem problemas crônicos de pele, comportamento ou digestão, você provavelmente já tentou o que a maioria tenta.",
}

BASE_PROBLEMS = [
    "arrasta o bumbum",
    "lambe a pata até ferir",
    "tem cocô mole",
    "acorda a casa às 3 da manhã",
]


def build_quote() -> str:
    problems = BASE_PROBLEMS[:]
    last = problems.pop()
    return f"“Se o seu cão {', '.join(problems)} ou {last} — costuma haver a mesma causa por trás.”"


def published_date() -> str:
    d = datetime.now() - timedelta(days=35)
    months = [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ]
    return f"{d.day} de {months[d.month - 1]} de {d.year}"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


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
    script = f"""<script>
(function () {{
  var ATTR = ["fbclid","utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id"];
  var landing = new URL(window.location.href);
  var stored = {{}};
  ATTR.forEach(function (k) {{
    var v = landing.searchParams.get(k);
    if (v) {{
      stored[k] = v;
      try {{ sessionStorage.setItem('mp_attr_' + k, v); }} catch (e) {{}}
    }}
  }});
  function withAttribution(href) {{
    try {{
      var u = new URL(href, window.location.origin);
      Object.keys(stored).forEach(function (k) {{
        if (!u.searchParams.has(k)) u.searchParams.set(k, stored[k]);
      }});
      return u.toString();
    }} catch (e) {{
      return href;
    }}
  }}
  document.querySelectorAll('a.pag-cta-btn[href]').forEach(function (a) {{
    a.href = withAttribution(a.href);
  }});
}})();
</script>"""
    return head, script


def main() -> None:
    tpl = TEMPLATE.read_text(encoding="utf-8")
    pixel_head, pixel_script = pixel_snippets()
    h1 = DEFAULTS["h1"]
    title = h1[:52] + "..." if len(h1) > 55 else h1
    out = (
        tpl.replace("__H1__", esc(h1))
        .replace("__HERO__", esc(DEFAULTS["hero"]))
        .replace("__HERO_ALT__", esc(h1[:120]))
        .replace("__LEAD__", esc(DEFAULTS["lead"]))
        .replace("__QUOTE__", esc(build_quote()))
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
