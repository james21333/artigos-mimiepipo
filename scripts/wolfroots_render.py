"""Render WolfRoots prelander body: full PT-BR copy + image layout."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
BLOCKS_EN = ROOT / "scripts/data/wolfroots-blocks-en.json"
TRANSLATIONS_JSON = ROOT / "scripts/data/wolfroots-translations.json"

CHECK = "1686153820-1663266021-check_2.webp"
STARS_PNG = "1662480996-amazon-5-stars-png-1-.png"
AS_SEEN = "1756983946-AS_SEEN_ON__1_.gif"
BADGE = "1686154966-1680512956-1677235652-1669739415.webp"
WIDE = {
    "1685138549-1670950692-1__1_.webp",
    "1685138542-1670950707-2__1_.webp",
}
PHOTO = {
    "1756982254-4X_MORE_CoQ10_than_fish__5_.webp",
    "1.jpg",
    "9.jpg",
}

_TRANSLATIONS: dict[str, str] | None = None

SKIP_HEADLINES = {
    "The Life-Changing Discovery 47,000 Dog Parents Made About Why Their Dogs Are Aging Too Fast",
    "And the 30-Second Daily Fix That's Adding Years to Dogs' Lives (Without Changing Their Food)",
    "⭐ ⭐ ⭐ ⭐ ⭐ 4.8/5 Stars - 17,500+ Reviews",
}

H2_FROM_PARAGRAPH = {
    "The Moment Everything Changed",
    "Why Your Dog Is Missing 30% of Their Natural Diet",
    "The Second Chance",
    "Sarah's Quest for Answers",
    "The Experiment with Luna",
    "The Other Dogs",
    "What Happened to 3 Dogs in 90 Days",
    "The Ripple Effect Sarah Never Expected",
    "What Sarah Created",
    "Why Vets Don't Know This",
    "What Can You Really Expect From WolfRoots Alpha Organ Blend",
    "Let's Address What You're Really Thinking",
    "The Real Cost of Waiting",
    "Your Three Options Right Now",
    "The Moment of Truth",
    "The Truth About What You're Already Spending",
    "Two Questions That Matter",
}


def load_translations() -> dict[str, str]:
    global _TRANSLATIONS
    if _TRANSLATIONS is None:
        _TRANSLATIONS = json.loads(TRANSLATIONS_JSON.read_text(encoding="utf-8"))
    return _TRANSLATIONS


def tr(text: str) -> str:
    return load_translations().get(text.strip(), text.strip())


def wolf_img_class(filename: str, width: str) -> str:
    if filename == CHECK:
        return "pl-img--check"
    if filename == STARS_PNG:
        return "pl-img--stars"
    if filename == AS_SEEN:
        return "pl-img--logo"
    if filename == BADGE:
        return "pl-img--badge"
    if filename in WIDE:
        return "pl-img--wide"
    if filename in PHOTO:
        return "pl-img--photo"
    return "pl-img--content"


def render_paragraphs(paragraphs: list[str]) -> str:
    parts: list[str] = []
    for para in paragraphs:
        text = tr(para)
        if para in H2_FROM_PARAGRAPH:
            parts.append(f"<h2>{text}</h2>")
        else:
            parts.append(f"<p>{text}</p>")
    return "\n".join(parts)


def render_wolfroots_body(
    img_fn: Callable[..., str],
    cta_fn: Callable[[], str],
    testimonials_html: str,
) -> str:
    blocks: list[dict] = json.loads(BLOCKS_EN.read_text(encoding="utf-8"))
    out: list[str] = []

    # Title block (first 3 blocks in source order)
    out.append(f'<h1 class="pl-title">{tr(blocks[0]["text"])}</h1>')
    out.append(f'<p class="pl-subtitle">{tr(blocks[1]["paragraphs"][0])}</p>')
    out.append(f'<p class="pl-stars">{tr(blocks[2]["text"])}</p>')

    inserted_testimonials = False
    inserted_mid_cta = False

    for b in blocks[3:]:
        if b["type"] == "headline":
            if b["text"] in SKIP_HEADLINES:
                continue
            text = tr(b["text"])
            if b["text"] == "Order WolfRoots Now":
                out.append(cta_fn())
                out.append(f"<h2>{text}</h2>")
                continue
            out.append(f"<h2>{text}</h2>")
            continue

        if b["type"] == "paragraph":
            if b["paragraphs"][0] == "Comments":
                if not inserted_testimonials:
                    out.append(testimonials_html)
                    inserted_testimonials = True
                continue
            if b["paragraphs"][0].startswith("By Dr.") or b["paragraphs"][0].startswith("Por "):
                out.append(f'<p class="pl-byline">{tr(b["paragraphs"][0])}</p>')
                continue
            if b["paragraphs"][0].startswith("🛡") and not inserted_mid_cta:
                out.append(render_paragraphs(b["paragraphs"]))
                out.append(cta_fn())
                inserted_mid_cta = True
                continue
            out.append(render_paragraphs(b["paragraphs"]))
            continue

        if b["type"] == "image":
            fname = b["file"]
            width = b.get("width", "100%")
            out.append(img_fn(fname, width, ""))
            continue

    if not inserted_testimonials:
        out.append(testimonials_html)

    out.append(
        '<p><strong>⚠ Estoque limitado:</strong> 30% OFF + frete grátis nesta página para leitoras.</p>'
    )
    out.append(cta_fn())
    out.append("<p>Garantia de 60 dias. Se não notar melhora, devolve.</p>")
    return "\n".join(out)
