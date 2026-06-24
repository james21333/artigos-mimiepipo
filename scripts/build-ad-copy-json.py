#!/usr/bin/env python3
"""Export Meta primary text per variant to public/ad-copy/{id}.json for SSR."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public/ad-copy"
PUBLISH_PLAN = Path(
    "/Users/josh/Desktop/Facebook Ads/mimi and pipo/ads/creatives/publish-plan.json"
)
PRELANDER_URLS = Path(
    "/Users/josh/Desktop/Facebook Ads/mimi and pipo/ads/creatives/prelander-urls.json"
)
PDP = "https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003"


def extract_pt_br_paragraphs(md_path: Path) -> list[str]:
    text = md_path.read_text(encoding="utf-8")
    m = re.search(
        r"## Ad Copy \(PT-BR\)\s*\n(.*?)(?=\n## Ad Copy \(EN|\Z)",
        text,
        re.DOTALL,
    )
    if not m:
        raise ValueError(f"No PT-BR section in {md_path}")
    body = m.group(1).strip()
    return [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]


def extract_headline(md: str) -> str | None:
    m = re.search(r"## Headline \(Meta\).*?\n- \*\*PT-BR:\*\* \"(.+?)\"", md, re.DOTALL)
    return m.group(1).strip() if m else None


def main() -> None:
    plan = json.loads(PUBLISH_PLAN.read_text(encoding="utf-8"))
    heroes: dict[str, str] = {}
    if PRELANDER_URLS.exists():
        pre = json.loads(PRELANDER_URLS.read_text(encoding="utf-8"))
        for vid, entry in pre.get("ads", {}).items():
            if entry.get("hero"):
                heroes[vid] = entry["hero"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index: dict[str, dict] = {}

    for ad in plan["ads"]:
        vid = ad["id"]
        copy_path = Path(ad["copy_file"])
        if not copy_path.is_file():
            raise FileNotFoundError(copy_path)
        md = copy_path.read_text(encoding="utf-8")
        paragraphs = extract_pt_br_paragraphs(copy_path)
        headline = extract_headline(md) or paragraphs[0] if paragraphs else vid
        hero = ad.get("hero") or heroes.get(vid) or heroes.get(
            ad.get("image_variant_id", "")
        )
        if not hero and PRELANDER_URLS.exists():
            hero = heroes.get(vid)
        if not hero:
            hero = f"https://artigos.mimiepipo.com.br/creatives/{ad.get('image_variant_id') or vid}/hero.jpg"

        payload = {
            "id": vid,
            "headline": headline,
            "hero": hero,
            "pdp": PDP,
            "paragraphs": paragraphs,
        }
        (OUT_DIR / f"{vid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        index[vid] = {"headline": headline, "hero": hero}

    (OUT_DIR / "index.json").write_text(
        json.dumps({"pdp": PDP, "variants": index}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(index)} ad-copy JSON files to {OUT_DIR}")


if __name__ == "__main__":
    main()
