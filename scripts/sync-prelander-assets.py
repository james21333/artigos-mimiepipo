#!/usr/bin/env python3
"""Download reference prelander assets; flag product shots for Mimi & Pipo replacement."""

from __future__ import annotations

import json
import re
import struct
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WOLF_DIR = ROOT / "public/prelander/wolfroots"
PAW_DIR = ROOT / "public/prelander/pawlife"
REPLACE_DIR = ROOT / "public/prelander/needs-ai-replacement"
MANIFEST = ROOT / "public/prelander/asset-manifest.json"

WOLF_URL = "https://get.wolfroots.com/LP1-1756289600531311"
PAW_URL = "https://article.paw-life.shop/"

# Competitor product / offer graphics — never serve live; use replacements.
WOLF_PRODUCT = {
    "1686156553-1662477222-dmcaz.webp",
    "1685138542-1670950707-2__1_.webp",
    "1685138549-1670950692-1__1_.webp",
    "1686154966-1680512956-1677235652-1669739415.webp",
    "11_1_e6e55863-e013-422e-9e25-afa449269b8a.jpg",
    "1.jpg",
    "9.jpg",
    "1756982254-4X_MORE_CoQ10_than_fish__5_.webp",
}

PAW_PRODUCT = {
    "1748551908-KALMIO%20%281500%20x%201500%20px%29-2.png",
    "1748551908-KALMIO (1500 x 1500 px)-2.png",
    "1747602782-Untitled%20design%20%286%29.png",
    "1747602782-Untitled design (6).png",
    "1757939915-Untitled%20design.jpg",
    "1757940390-Untitled%20design%20%284%29%20%281%29.png",
    "1754785420-FureverPets_7.webp",
    "1754784687-FureverPets_Presentation_1.webp",
    "1754784742-image_1.webp",
    "02-1748551908-KALMIO%20%281500%20x%201500%20px%29-2.png",
}

REPLACEMENT_SLUGS = {
    ("pawlife", "1747602782-Untitled%20design%20%286%29.png"): "pawlife-01-offer-hero.png",
    ("pawlife", "1757939915-Untitled%20design.jpg"): "pawlife-02-promo-banner.jpg",
    ("pawlife", "1757940390-Untitled%20design%20%284%29%20%281%29.png"): "pawlife-03-bottom-cta.png",
    ("pawlife", "1754784687-FureverPets_Presentation_1.webp"): "pawlife-04-presentation.webp",
    ("pawlife", "1754784742-image_1.webp"): "pawlife-05-product-scene.webp",
    ("pawlife", "1754785420-FureverPets_7.webp"): "pawlife-06-lifestyle-product.webp",
    ("wolfroots", "1686154966-1680512956-1677235652-1669739415.webp"): "wolfroots-01-product-card.webp",
    ("wolfroots", "1685138549-1670950692-1__1_.webp"): "wolfroots-02-wide-banner-a.webp",
    ("wolfroots", "1685138542-1670950707-2__1_.webp"): "wolfroots-03-wide-banner-b.webp",
    ("wolfroots", "11_1_e6e55863-e013-422e-9e25-afa449269b8a.jpg"): "wolfroots-04-thumbnail.jpg",
    ("wolfroots", "1686156553-1662477222-dmcaz.webp"): "wolfroots-05-logo-strip.webp",
    ("wolfroots", "1.jpg"): "wolfroots-06-ugc-kitchen.jpg",
    ("wolfroots", "9.jpg"): "wolfroots-07-ugc-hand.jpg",
    ("wolfroots", "1756982254-4X_MORE_CoQ10_than_fish__5_.webp"): "wolfroots-08-product-hero.webp",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "ignore")


def image_size(path: Path) -> tuple[int, int] | None:
    if not path.is_file():
        return None
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data) - 8:
            if data[i] != 0xFF:
                break
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return w, h
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
            i += 2 + length
    if len(data) > 30 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        # VP8X
        if data[12:16] == b"VP8X":
            w = 1 + data[24] + (data[25] << 8) + (data[26] << 16)
            h = 1 + data[27] + (data[28] << 8) + (data[29] << 16)
            return w, h
    return None


def download(url: str, dest: Path) -> None:
    if url.startswith("//"):
        url = "https:" + url
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    dest.write_bytes(urllib.request.urlopen(req, timeout=60).read())


def safe_name(url: str) -> str:
    return url.split("/")[-1].split("?")[0]


def wolf_urls(html: str) -> list[str]:
    urls = re.findall(
        r"https://assets\.imagehub\.io/Funnel/assets/images/[^\"\s>]+\.(?:webp|jpg|jpeg|png|gif)(?:\?[^\"\s>]*)?",
        html,
        re.I,
    )
    return list(dict.fromkeys(urls))


def paw_urls(html: str) -> list[str]:
    urls = []
    for ss in re.findall(r"srcset=\"(//img\.funnelish\.com[^\"]+)\"", html):
        for part in ss.split(","):
            u = part.strip().split()[0]
            if u.startswith("//"):
                urls.append("https:" + u)
    # also img src if any real
    for u in re.findall(r"src=\"(//img\.funnelish\.com[^\"]+)\"", html):
        urls.append("https:" + u if u.startswith("//") else u)
    return list(dict.fromkeys(urls))


def is_product(filename: str, product_set: set[str]) -> bool:
    fn = filename
    decoded = fn.replace("%20", " ").replace("%28", "(").replace("%29", ")")
    if fn in product_set or decoded in product_set:
        return True
    low = fn.lower()
    return any(
        k in low
        for k in (
            "kalmio",
            "fureverpets",
            "dmcaz",
            "untitled%20design",
            "untitled design",
            "presentation_1",
            "image_1.webp",
        )
    )


def public_url(folder: str, filename: str) -> str:
    from urllib.parse import quote

    return f"https://artigos.mimiepipo.com.br/prelander/{folder}/{quote(filename, safe='._-()')}"


def main() -> None:
    wolf_html = fetch(WOLF_URL)
    paw_html = fetch(PAW_URL)
    w_urls = wolf_urls(wolf_html)
    p_urls = paw_urls(paw_html)

    entries: list[dict] = []
    replacements: list[dict] = []

    for url in w_urls:
        name = safe_name(url)
        dest = WOLF_DIR / name
        try:
            download(url, dest)
        except Exception as exc:
            print("wolf fail", name, exc)
            continue
        prod = is_product(name, WOLF_PRODUCT)
        entry = {
            "prelander": "wolfroots",
            "file": name,
            "url": public_url("wolfroots", name),
            "product": prod,
        }
        sz = image_size(dest)
        if sz:
            entry["width"], entry["height"] = sz
        if prod:
            REPLACE_DIR.mkdir(parents=True, exist_ok=True)
            ref = REPLACE_DIR / f"wolfroots-{name}"
            ref.write_bytes(dest.read_bytes())
            replacements.append(
                {
                    **entry,
                    "referenceForAI": public_url(
                        "needs-ai-replacement", f"wolfroots-{name}"
                    ),
                    "deliverAs": f"wolfroots-{name.rsplit('.', 1)[0]}-mimiepipo.{name.rsplit('.', 1)[-1]}",
                    "notes": "Replace competitor product with Digestão Saudável jar; keep layout/background.",
                }
            )
            entry["serveAs"] = "mimiepipo/product-jar.png"
        entries.append(entry)
        print("wolf", name, "PRODUCT" if prod else "ok")

    for url in p_urls:
        name = safe_name(url)
        dest = PAW_DIR / name
        try:
            download(url, dest)
        except Exception as exc:
            print("paw fail", name, exc)
            continue
        prod = is_product(name, PAW_PRODUCT)
        entry = {
            "prelander": "pawlife",
            "file": name,
            "url": public_url("pawlife", name),
            "product": prod,
        }
        sz = image_size(dest)
        if sz:
            entry["width"], entry["height"] = sz
        if prod:
            REPLACE_DIR.mkdir(parents=True, exist_ok=True)
            ref = REPLACE_DIR / f"pawlife-{name}"
            ref.write_bytes(dest.read_bytes())
            replacements.append(
                {
                    **entry,
                    "referenceForAI": public_url(
                        "needs-ai-replacement", f"pawlife-{name}"
                    ),
                    "deliverAs": f"pawlife-{name.rsplit('.', 1)[0]}-mimiepipo.{name.rsplit('.', 1)[-1]}",
                    "notes": "Replace competitor dental/Kalmio product with Digestão Saudável; keep composition.",
                }
            )
            entry["serveAs"] = "mimiepipo/product-jar.png"
        entries.append(entry)
        print("paw", name, "PRODUCT" if prod else "ok")

    MANIFEST.write_text(
        json.dumps(
            {"assets": entries, "productReplacementsNeeded": replacements},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote {len(entries)} assets, {len(replacements)} need AI product swaps")


if __name__ == "__main__":
    main()
