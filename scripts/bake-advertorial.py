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


def main() -> None:
    tpl = TEMPLATE.read_text(encoding="utf-8")
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
    )
    OUTPUT.write_text(out, encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
