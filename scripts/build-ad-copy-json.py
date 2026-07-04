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
UPLOAD_BATCHES = Path(
    "/Users/josh/Desktop/Facebook Ads/mimi and pipo/ads/creatives/pending-upload-jun23"
)
LAUNCH_MAP = Path(
    "/Users/josh/Desktop/Facebook Ads/mimi and pipo/ads/creatives/launch-map-jun23.json"
)
PDP = "https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003"

# All angles → Paw-Life prelander (WolfRoots paused).
DEFAULT_TEMPLATE = "angle2"
FOLDER_TEMPLATE: dict[str, str] = {}


def normalize(s: str) -> str:
    s = s.lower().replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    return re.sub(r"\s+", " ", s.strip().strip(".,;:!?…")).strip()


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
    return [p.strip() for p in re.split(r"\n\s*\n+", body) if p.strip()]


def should_not_split(text: str) -> bool:
    t = text.strip()
    if not t:
        return True
    if t.startswith("👉") or t.startswith("•"):
        return True
    if re.search(r"https?://", t):
        return True
    if re.match(r"^P\.?\s*P\.?\s*S", t, re.I):
        return True
    if t.endswith("..."):
        return True
    return False


def split_into_display_lines(text: str) -> list[str]:
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


def expand_display_paragraphs(blocks: list[str]) -> list[str]:
    out: list[str] = []
    for block in blocks:
        out.extend(split_into_display_lines(block))
    return out


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def paragraphs_from_primary(primary: str) -> list[str]:
    blocks = [p.strip() for p in re.split(r"\n\s*\n+", primary.strip()) if p.strip()]
    return expand_display_paragraphs(blocks)


def extract_headline(md: str) -> str | None:
    m = re.search(r"## Headline \(Meta\).*?\n- \*\*PT-BR:\*\* \"(.+?)\"", md, re.DOTALL)
    return m.group(1).strip() if m else None


def word_count(s: str) -> int:
    return len(s.split())


def pick_lead(headline: str, paragraphs: list[str]) -> str:
    if not paragraphs:
        return ""
    min_w, max_w, soft_max, hard_max = 30, 50, 55, 60
    h = normalize(headline).rstrip(".")
    rest: list[str] = []
    for para in paragraphs:
        pn = normalize(para).rstrip(".")
        if pn == h or (len(h) > 20 and (h in pn or pn in h)):
            continue
        rest.append(para)
    if not rest:
        return paragraphs[0]
    candidates: list[tuple[str, int]] = []
    acc: list[str] = []
    for para in rest:
        acc.append(para)
        candidates.append((" ".join(acc), word_count(" ".join(acc))))
    in_range = [c for c in candidates if min_w <= c[1] <= max_w]
    if in_range:
        return max(in_range, key=lambda x: x[1])[0]
    soft = [c for c in candidates if min_w <= c[1] <= soft_max]
    if soft:
        return max(soft, key=lambda x: x[1])[0]
    over = [c for c in candidates if max_w < c[1] <= hard_max]
    if over:
        return min(over, key=lambda x: x[1])[0]
    under = [c for c in candidates if c[1] <= max_w]
    if under:
        return max(under, key=lambda x: x[1])[0]
    return candidates[0][0]


def hero_slug(hero_url: str) -> str | None:
    m = re.search(r"/creatives/([^/]+)/hero", hero_url)
    return m.group(1) if m else None


def param_key(h1: str, lead: str, hero: str = "", problem: str = "") -> str:
    parts = [normalize(h1), normalize(lead)[:150]]
    slug = hero_slug(hero) if hero else ""
    if slug:
        parts.append(slug)
    if problem:
        parts.append(normalize(problem))
    return "::".join(parts)


def load_live_batch_keys() -> dict[str, str]:
    """Map submitted Meta URL params → variant id from upload batches."""
    out: dict[str, str] = {}
    if not UPLOAD_BATCHES.is_dir():
        return out
    for batch in sorted(UPLOAD_BATCHES.glob("batch_*.json")):
        for item in json.loads(batch.read_text(encoding="utf-8")):
            name = item.get("name", "")
            m = re.search(r"DS \| ([^|]+) \|", name)
            if not m:
                continue
            vid = m.group(1).strip()
            link = item.get("link_url", "")
            q = re.findall(r"[?&](h1|hero|lead|problem)=([^&]*)", link)
            params = {k: unquote_plus(v) for k, v in q}
            key = param_key(
                params.get("h1", ""),
                params.get("lead", ""),
                params.get("hero", ""),
                params.get("problem", ""),
            )
            if key:
                out[key] = vid
    return out


def unquote_plus(value: str) -> str:
    from urllib.parse import unquote_plus as _u

    return _u(value.replace("+", " ")).strip()


def load_variant_meta() -> dict[str, dict]:
    if not LAUNCH_MAP.is_file():
        return {}
    data = json.loads(LAUNCH_MAP.read_text(encoding="utf-8"))
    meta: dict[str, dict] = {}
    for ad in data.get("ads", []):
        vid = ad.get("variant")
        folder = ad.get("folder", "")
        if not vid:
            continue
        meta[vid] = {
            "folder": folder,
            "template": FOLDER_TEMPLATE.get(folder, DEFAULT_TEMPLATE),
            "adset_id": ad.get("adset_id", ""),
        }
    return meta


def prefer_variant_id(ids: list[str]) -> str:
    """When live Meta URLs collide (regular + CalmAxis), prefer the base variant."""
    plain = [i for i in ids if not i.endswith("-calmaxis")]
    if len(plain) == 1:
        return plain[0]
    if plain:
        return sorted(plain)[0]
    return sorted(ids)[0]


def main() -> None:
    plan = json.loads(PUBLISH_PLAN.read_text(encoding="utf-8"))
    heroes: dict[str, str] = {}
    problems: dict[str, str] = {}
    if PRELANDER_URLS.exists():
        pre = json.loads(PRELANDER_URLS.read_text(encoding="utf-8"))
        for vid, entry in pre.get("ads", {}).items():
            if entry.get("hero"):
                heroes[vid] = entry["hero"]
            if entry.get("problem"):
                problems[vid] = entry["problem"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index: dict[str, dict] = {}
    by_headline_lead: dict[str, str] = {}
    by_headline: dict[str, list[str]] = {}
    by_hero: dict[str, list[str]] = {}
    by_params: dict[str, list[str]] = {}
    live_batch = load_live_batch_keys()
    variant_meta = load_variant_meta()

    for ad in plan["ads"]:
        vid = ad["id"]
        copy_path = Path(ad["copy_file"])
        if not copy_path.is_file():
            raise FileNotFoundError(copy_path)
        md = copy_path.read_text(encoding="utf-8")
        primary = ad.get("primary_text", "")
        if primary:
            blocks = [
                p.strip()
                for p in re.split(r"\n\s*\n+", primary.strip())
                if p.strip()
            ]
        else:
            blocks = extract_pt_br_paragraphs(copy_path)
        paragraphs = expand_display_paragraphs(blocks)
        headline = extract_headline(md) or (paragraphs[0] if paragraphs else vid)
        lead = pick_lead(headline, blocks)
        wc = word_count(primary) if primary else word_count(" ".join(blocks))
        hero = heroes.get(vid) or heroes.get(ad.get("image_variant_id", ""))
        problem = problems.get(vid, "")
        if not hero:
            hero = f"https://artigos.mimiepipo.com.br/creatives/{ad.get('image_variant_id') or vid}/hero.jpg"

        payload = {
            "id": vid,
            "headline": headline,
            "lead": lead,
            "hero": hero,
            "pdp": PDP,
            "wordCount": wc,
            "paragraphs": paragraphs,
        }
        (OUT_DIR / f"{vid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        meta = variant_meta.get(vid, {"folder": "", "template": DEFAULT_TEMPLATE, "adset_id": ""})
        index[vid] = {
            "headline": headline,
            "lead": lead,
            "hero": hero,
            "folder": meta.get("folder", ""),
            "template": meta.get("template", DEFAULT_TEMPLATE),
        }

        hl = normalize(headline)
        ld = normalize(lead)[:150]
        hl_key = f"{hl}::{ld}"
        pk = param_key(headline, lead, hero, problem)
        by_params.setdefault(pk, [])
        if vid not in by_params[pk]:
            by_params[pk].append(vid)
        if hl_key not in by_headline_lead:
            by_headline_lead[hl_key] = vid
        by_headline.setdefault(hl, [])
        if vid not in by_headline[hl]:
            by_headline[hl].append(vid)
        slug = hero_slug(hero)
        if slug:
            by_hero.setdefault(slug, [])
            if vid not in by_hero[slug]:
                by_hero[slug].append(vid)

    (OUT_DIR / "index.json").write_text(
        json.dumps({"pdp": PDP, "variants": index}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    for key, vid in live_batch.items():
        by_params.setdefault(key, [])
        if vid not in by_params[key]:
            by_params[key].append(vid)

    by_params_resolved = {
        k: prefer_variant_id(v) if len(v) > 1 else v[0] for k, v in by_params.items()
    }

    (OUT_DIR / "lookup.json").write_text(
        json.dumps(
            {
                "variants": index,
                "variantMeta": variant_meta,
                "byHeadlineLead": by_headline_lead,
                "byHeadline": by_headline,
                "byHero": by_hero,
                "byParams": by_params_resolved,
                "byParamsAll": by_params,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(index)} ad-copy JSON files to {OUT_DIR}")


if __name__ == "__main__":
    main()
