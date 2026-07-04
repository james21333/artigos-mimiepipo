#!/usr/bin/env python3
"""Generate fully static WolfRoots + Paw-Life prelander templates (no dynamic ad copy)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pawlife_render import CHECK, paw_img_class, render_pawlife_body

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "templates"
MANIFEST = ROOT / "public/prelander/asset-manifest.json"
BASE = "https://artigos.mimiepipo.com.br"
PDP = "https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003"
CTA = "VERIFICAR ESTOQUE EXCLUSIVO PARA LEITORAS"
CTA_SHORT = "Ver Digestão Saudável — Garantia de 60 dias"

WOLF_IMG_ORDER = [
    "1756983946-AS_SEEN_ON__1_.gif",
    "1757063800-_200__5_.webp",
    "1757063934-_200__6_.webp",
    "1757064247-_200__7_.webp",
    "1757064616-_200__8_.webp",
    "1757064757-_200__10_.webp",
    "1757065279-15.webp",
    "1757065282-16.webp",
    "1757065284-17.webp",
    "1757065653-_200__11_.webp",
    "1757065857-_200__12_.webp",
    "1757104337-4X_MORE_CoQ10_than_fish__6_.webp",
    "1757065983-_200__13_.webp",
    "1757105886-4X_MORE_CoQ10_than_fish__7_.webp",
    "1686154966-1680512956-1677235652-1669739415.webp",
    "1685138549-1670950692-1__1_.webp",
    "1685138542-1670950707-2__1_.webp",
    "1756982254-4X_MORE_CoQ10_than_fish__5_.webp",
    "1662480996-amazon-5-stars-png-1-.png",
    "1686153820-1663266021-check_2.webp",
    "1.jpg",
    "2.jpg",
    "9_1.jpg",
    "4.jpg",
    "5.jpg",
    "11_1_e6e55863-e013-422e-9e25-afa449269b8a.jpg",
    "9.jpg",
    "7.jpg",
    "8.jpg",
    "1_1.jpg",
    "2_1.jpg",
    "4_1.jpg",
    "13.jpg",
    "3_1.jpg",
    "5_1.jpg",
    "16.jpg",
    "6_1.jpg",
    "18.jpg",
    "19.jpg",
    "20.jpg",
    "21.jpg",
    "7_1.jpg",
    "8_1.jpg",
    "1686156553-1662477222-dmcaz.webp",
]

PAW_IMG_ORDER = [
    "1749939499-1713183115-1711366759829_bitmap.webp",
    "1751321630-1713201807-1711369581080_stars.webp",
    "1754784687-FureverPets_Presentation_1.webp",
    "1752793241-1731498747-dr%20blane%20square2.webp",
    "1754785228-shutterstock_1898468044.avif",
    "1754784742-image_1.webp",
    "1752794760-1734623169-1715414398-right.webp",
    "1754784766-Chihuahua-dog-lying-down-on-white-cloth-with-dog-food-bowl-beside-it.webp",
    "1747602782-Untitled%20design%20%286%29.png",
    "1757939915-Untitled%20design.jpg",
    "1754784931-dog-drinking-water-from-elevated-metal-bowl_Soho-A-Studio_Shutterstock.webp",
    "1754785420-FureverPets_7.webp",
    "1751286169-a1048d0d-d555-433c-9e08-1ec644f2d9d3.jpg",
    "1754785044-u7246313863_Veterinarians_arms_in_white_coat_sleeves_carefull_65d91b51-721b-43a3-89fd-8c55889494ae_0.webp",
    "1754784481-1731502777-Screenshot%202024-11-13%20at%2014.59.25.webp",
    "1753915787-1713240664-1711393011636_4_5_star_2x.webp",
    "1754784489-1736513873-review2.webp",
    "1757940390-Untitled%20design%20%284%29%20%281%29.png",
    "1751220960-1713245435-1711461897636_4.png",
    "1751220968-1713245469-1711461923065_2.png",
    "1751220977-1713245487-1711461935757_3.png",
    "1751220987-1713245504-1711461945141_1.png",
    "1751822293-74439263_3083194501694153_7842910741228158976_n.jpg",
]


REPLACEMENT_SLUGS: dict[tuple[str, str], str] = {
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

# Intrinsic display sizes (matches reference prelander layout).
IMG_DIMS: dict[tuple[str, str], tuple[int, int]] = {
    ("wolfroots", "1686154966-1680512956-1677235652-1669739415.webp"): (500, 412),
    ("wolfroots", "1685138549-1670950692-1__1_.webp"): (1267, 381),
    ("wolfroots", "1685138542-1670950707-2__1_.webp"): (1256, 327),
    ("wolfroots", "11_1_e6e55863-e013-422e-9e25-afa449269b8a.jpg"): (100, 100),
    ("wolfroots", "1686156553-1662477222-dmcaz.webp"): (150, 30),
    ("wolfroots", "1.jpg"): (1080, 1080),
    ("wolfroots", "9.jpg"): (1080, 1080),
    ("wolfroots", "1756982254-4X_MORE_CoQ10_than_fish__5_.webp"): (1080, 1080),
}

WOLF_AVATAR_FILES = {
    "9_1.jpg",
    "4.jpg",
    "5.jpg",
    "7.jpg",
    "8.jpg",
    "1_1.jpg",
    "2_1.jpg",
    "4_1.jpg",
    "13.jpg",
    "3_1.jpg",
    "5_1.jpg",
    "16.jpg",
    "6_1.jpg",
    "18.jpg",
    "19.jpg",
    "20.jpg",
    "21.jpg",
    "7_1.jpg",
    "8_1.jpg",
    "2.jpg",
    "11_1_e6e55863-e013-422e-9e25-afa449269b8a.jpg",
}

WOLF_TESTIMONIAL_HERO = ["9.jpg"]
WOLF_TESTIMONIAL_AVATARS = [
    "9_1.jpg",
    "4.jpg",
    "5.jpg",
    "7.jpg",
    "8.jpg",
    "1_1.jpg",
    "2_1.jpg",
    "4_1.jpg",
    "13.jpg",
    "3_1.jpg",
    "5_1.jpg",
    "16.jpg",
    "6_1.jpg",
    "18.jpg",
    "19.jpg",
    "20.jpg",
    "21.jpg",
    "7_1.jpg",
]
WOLF_TESTIMONIAL_FOOTER = [
    "8_1.jpg",
    "1686156553-1662477222-dmcaz.webp",
]

WOLF_MAIN_IMAGES = WOLF_IMG_ORDER[:24]
WOLF_TESTIMONIAL_IMAGES = set(WOLF_IMG_ORDER[21:])

IMG_CLASS: dict[tuple[str, str], str] = {
    ("wolfroots", "1686154966-1680512956-1677235652-1669739415.webp"): "pl-img--badge",
    ("wolfroots", "1685138549-1670950692-1__1_.webp"): "pl-img--wide",
    ("wolfroots", "1685138542-1670950707-2__1_.webp"): "pl-img--wide",
    ("wolfroots", "1686156553-1662477222-dmcaz.webp"): "pl-img--logo",
    ("wolfroots", "1.jpg"): "pl-img--photo",
    ("wolfroots", "9.jpg"): "pl-img--photo",
    ("wolfroots", "1756982254-4X_MORE_CoQ10_than_fish__5_.webp"): "pl-img--photo",
    ("wolfroots", "8_1.jpg"): "pl-img--logo",
    ("pawlife", "1747602782-Untitled%20design%20%286%29.png"): "pl-img--offer",
    ("pawlife", "1757939915-Untitled%20design.jpg"): "pl-img--offer",
    ("pawlife", "1757940390-Untitled%20design%20%284%29%20%281%29.png"): "pl-img--offer",
}


def replacement_file(prelander: str, filename: str) -> Path | None:
    repl_dir = ROOT / "public/prelander/mimiepipo/replacements"
    slug = REPLACEMENT_SLUGS.get((prelander, filename))
    for name in (slug, filename):
        if not name:
            continue
        path = repl_dir / name
        if path.is_file():
            return path
    return None


def load_serve_map() -> dict[tuple[str, str], str]:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    out: dict[tuple[str, str], str] = {}
    for asset in data["assets"]:
        key = (asset["prelander"], asset["file"])
        if asset.get("product"):
            repl = replacement_file(asset["prelander"], asset["file"])
            if repl:
                out[key] = f"{BASE}/prelander/mimiepipo/replacements/{quote(repl.name, safe='._-()')}"
            else:
                out[key] = f"{BASE}/prelander/mimiepipo/product-jar.png"
        else:
            out[key] = f"{BASE}/prelander/{asset['prelander']}/{quote(asset['file'], safe='._-()')}"
    return out


def img_class(prelander: str, filename: str) -> str:
    if prelander == "wolfroots" and filename in WOLF_AVATAR_FILES:
        return "pl-img--avatar"
    return IMG_CLASS.get((prelander, filename), "pl-img--content")


def img_dims(prelander: str, filename: str) -> tuple[int, int] | None:
    return IMG_DIMS.get((prelander, filename))


def img(
    prelander: str,
    filename: str,
    serve: dict[tuple[str, str], str],
    alt: str = "",
    width: str | None = None,
    original_only: bool = False,
) -> str:
    if original_only:
        src = f"{BASE}/prelander/{prelander}/{quote(filename, safe='._-()')}"
    else:
        repl = replacement_file(prelander, filename)
        if repl:
            src = f"{BASE}/prelander/mimiepipo/replacements/{quote(repl.name, safe='._-()')}"
        else:
            src = serve.get(
                (prelander, filename),
                f"{BASE}/prelander/{prelander}/{quote(filename, safe='._-()')}",
            )
    alt_attr = f' alt="{alt}"' if alt else ""
    if prelander == "pawlife" and width:
        cls = paw_img_class(filename, width)
    else:
        cls = img_class(prelander, filename)
    dims = img_dims(prelander, filename)
    size_attr = ""
    if dims:
        w, h = dims
        size_attr = f' width="{w}" height="{h}"'
    return f'<div class="pl-img {cls}"><img src="{src}"{alt_attr}{size_attr} loading="lazy"></div>'


def wolfroots_testimonials(serve: dict[tuple[str, str], str]) -> str:
    heroes = "".join(img("wolfroots", name, serve, "Depoimento com produto") for name in WOLF_TESTIMONIAL_HERO)
    avatars = "".join(img("wolfroots", name, serve, "Avaliação") for name in WOLF_TESTIMONIAL_AVATARS)
    footer = "".join(img("wolfroots", name, serve, "Marca") for name in WOLF_TESTIMONIAL_FOOTER)
    return f"""<h2>Depoimentos de tutores</h2>
<div class="pl-testimonials">
  {heroes}
  <div class="pl-testimonials-grid">{avatars}</div>
  {footer}
</div>"""


def cta_block(cls: str = "pl-cta") -> str:
    return f"""<div class="pl-cta-wrap">
  <a class="{cls}" href="__PDP__">{CTA}</a>
  <p class="pl-cta-note">30% de desconto + frete grátis para leitoras · garantia de 60 dias</p>
</div>"""


def wolfroots_template(serve: dict[tuple[str, str], str]) -> str:
    i = iter(WOLF_MAIN_IMAGES)
    g = lambda alt="": img("wolfroots", next(i), serve, alt)

    body = f"""
    <p class="pl-stars">⭐ ⭐ ⭐ ⭐ ⭐ 4,7/5 — 635+ avaliações</p>
    {g("Como visto em")}
    <p class="pl-byline">Por Dra. Camila Rocha, MV | __PUBLISHED_DATE__</p>

    <h1 class="pl-title">A descoberta que milhares de tutores brasileiros fizeram sobre por que a barriga do cão nunca estabiliza de verdade</h1>
    <p class="pl-subtitle">E o petisco diário de 30 segundos que devolve cocô firme, menos coceira e mais energia — sem trocar a ração</p>

    <p>A Dra. Camila viu a mesma cena centenas de vezes: cães com barriga sensível, cocô irregular, coceira que volta — e tutores exaustos depois de probiótico que só funciona por alguns dias.</p>
    <p>O veterinário dizia: “É stress, é idade.” Mas cães jovens pioravam rápido. A conta subia todo mês.</p>

    <h2>O momento em que tudo mudou</h2>
    {g("Conferência de nutrição veterinária")}
    {g("Palestrante veterinário")}
    <p>Num congresso, ela ouviu: <em>“O intestino moderno está faminto — não de comida, mas do que alimenta a flora certa.”</em></p>
    {g("Comparativo nutrição")}
    <p>Cães compartilham quase todo o DNA com lobos. A diferença é o que entra na tigela: ultraprocessado, antibióticos repetidos, zero prebiótico real.</p>

    <h2>Por que seu cão está perdendo 30% do suporte intestinal que o corpo espera</h2>
    {g("Dieta natural vs ração")}
    {g("Órgãos e nutrientes")}
    {g("CoQ10 e micronutrientes")}
    {g("Comparativo absorção")}
    {g("Gráfico nutricional")}
    {g("Dados comparativos")}
    {g("Infográfico intestinal")}
    {g("Mecanismo de absorção")}
    {g("Nutrientes prebióticos")}
    {g("Suporte à mucosa")}
    {g("Flora intestinal")}
    {g("Comparativo prebiótico")}
    {g("Produto Digestão Saudável")}
    {g("Antes e depois")}
    {g("Fórmula prebiótica")}
    {g("Benefícios do protocolo")}
    {g("Avaliações")}
    {g("Lista de benefícios")}

    <p>Quando a parede intestinal fica permeável, toxinas escapam. A pele coça. A glândula anal entope. Giardia volta. O cão come grama de desespero.</p>

    <h2>A solução que a Dra. Camila passou a recomendar</h2>
    <p>Prebiótico estruturado + Boswellia + gengibre + Yucca — em petisco palatável, formulado por veterinários, sem maltodextrina.</p>
    {cta_block("pl-cta")}

    {wolfroots_testimonials(serve)}
    <p><strong>⚠ Estoque limitado:</strong> 30% OFF + frete grátis nesta página para leitoras.</p>
    {cta_block("pl-cta")}
    <p>Garantia de 60 dias. Se não notar melhora, devolve.</p>
    """

    return shell(
        title="A descoberta que milhares de tutores fizeram sobre a barriga do cão",
        body=body,
        font="Merriweather:wght@400;700;900&family=Open+Sans:wght@400;600;700",
        sticky=True,
    )


def pawlife_template(serve: dict[tuple[str, str], str]) -> str:
    def paw_img(filename: str, width: str, alt: str = "") -> str:
        return img(
            "pawlife",
            filename,
            serve,
            alt,
            width=width,
            original_only=(filename == CHECK and width == "35px"),
        )

    main = render_pawlife_body(paw_img, lambda: cta_block("pl-cta"))
    sidebar_product = f"{BASE}/prelander/mimiepipo/product-jar.png"

    return shell(
        title="Por que 80% dos cães perdem anos de vida com a barriga quase normal",
        body=f"""<div class="pl-layout"><div class="pl-main">{main}</div>
<aside class="pl-sidebar"><div class="pl-sidebar-card">
<img src="{sidebar_product}" alt="Digestão Saudável">
<p class="pl-sidebar-title">Digestão Saudável</p>
<p>30% OFF + frete grátis</p>
<a class="pl-cta" href="__PDP__">Ver oferta</a>
</div></aside></div>""",
        font="Montserrat:wght@400;600;700;800&family=Open+Sans:wght@400;600;700",
        sticky=False,
        paw_sticky=True,
    )


def shell(
    title: str,
    body: str,
    font: str,
    sticky: bool = False,
    paw_sticky: bool = False,
) -> str:
    sticky_html = "__STICKY_CTA__" if sticky else ""
    paw_sticky_html = """
  <div class="pl-sticky" id="plSticky"><a href="__PDP__">Ganhe 30% de desconto + frete grátis — Digestão Saudável</a></div>
  <script>(function(){var el=document.getElementById('plSticky');if(!el)return;function s(){el.classList.toggle('is-visible',window.scrollY>1300)}window.addEventListener('scroll',s,{passive:true});s();})();</script>""" if paw_sticky else ""

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>__PAGE_TITLE__</title>
  <meta name="description" content="Advertorial — Digestão Saudável Mimi &amp; Pipo.">
  <meta name="robots" content="noindex, nofollow">
  <link href="https://fonts.googleapis.com/css2?family={font}&display=swap" rel="stylesheet">
  __META_PIXEL_HEAD__
  <style>
    *,*::before,*::after{{box-sizing:border-box}}
    body{{margin:0;background:#fff;color:#222;font-family:"Open Sans",system-ui,sans-serif;font-size:17px;line-height:1.65;padding-bottom:96px}}
    img{{max-width:100%;height:auto;display:block}}
    a{{color:inherit;text-decoration:none}}
    .pl-topbar{{background:#f4f4f4;border-bottom:1px solid #e0e0e0;padding:10px 16px;font-size:13px;color:#666}}
    .pl-shell{{max-width:1170px;margin:0 auto;padding:0 16px 48px}}
    .pl-layout{{display:block;margin-top:16px}}
    .pl-main{{min-width:0;max-width:760px;margin:0 auto}}
    .pl-sidebar{{display:none}}
    .pl-title{{font-size:28px;line-height:1.25;font-weight:800;margin:20px 0 12px;color:#111}}
    .pl-subtitle{{font-size:18px;color:#444;margin:0 0 20px;font-style:italic}}
    .pl-stars{{color:#f5a623;font-weight:700;margin:16px 0 8px}}
    .pl-byline{{font-size:14px;color:#555;border-bottom:1px solid #eee;padding-bottom:16px;margin-bottom:20px}}
    .pl-body h2{{font-size:24px;font-weight:800;margin:32px 0 14px;color:#111}}
    .pl-body p{{margin:0 0 16px}}
    .pl-img{{margin:18px 0}}
    .pl-img img{{max-width:100%;height:auto}}
    .pl-img--content img{{width:100%;height:auto}}
    .pl-img--wide img{{width:100%;height:auto}}
    .pl-img--photo{{text-align:center}}
    .pl-img--photo img{{width:100%;max-width:540px;height:auto;margin:0 auto}}
    .pl-img--badge{{text-align:center;margin:24px auto}}
    .pl-img--badge img{{width:250px;max-width:72vw;height:auto;margin:0 auto;object-fit:contain}}
    .pl-img--logo{{text-align:center;margin:12px auto}}
    .pl-img--logo img{{width:150px;max-width:50vw;height:auto;margin:0 auto;object-fit:contain}}
    .pl-img--offer img{{width:100%;max-width:640px;height:auto;margin:0 auto}}
    .pl-testimonials{{margin:8px 0 24px}}
    .pl-testimonials-grid{{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;max-width:420px;margin:0 auto 20px}}
    .pl-testimonials-grid .pl-img{{margin:0}}
    .pl-img--avatar img{{width:100%;aspect-ratio:1/1;height:auto;border-radius:50%;object-fit:cover}}
    .pl-cta-wrap{{margin:28px 0;text-align:center}}
    .pl-cta{{display:block;background:#2d8659;color:#fff!important;font-weight:800;padding:18px 22px;border-radius:8px;text-align:center;font-size:17px}}
    .pl-cta-note{{margin-top:12px;font-size:15px;color:#444;text-align:center}}
    .pl-author{{display:flex;gap:14px;align-items:center;margin:20px 0;padding-bottom:16px;border-bottom:1px solid #eee}}
    .pl-author .pl-img{{margin:0}}
    .pl-author img{{width:72px;height:72px;border-radius:50%;object-fit:cover}}
    .pl-author-name{{font-weight:700}}
    .pl-author-title{{font-size:14px;color:#555}}
    .pl-quote{{font-size:18px;font-style:italic;color:#444;border-left:4px solid #2d8659;padding-left:16px;margin:16px 0 24px;line-height:1.5}}
    .pl-ratings{{display:flex;align-items:center;gap:10px;margin:12px 0 20px;font-weight:700;color:#207185}}
    .pl-ratings .pl-img{{margin:0}}
    .pl-img--bitmap img{{width:51px;height:24px;object-fit:contain}}
    .pl-img--stars img{{width:113px;height:auto;object-fit:contain}}
    .pl-img--arrow img{{width:24px;height:24px;object-fit:contain}}
    .pl-img--check img{{width:35px;height:35px;object-fit:contain}}
    .pl-img--avatar-inline img{{width:51px;height:51px;border-radius:50%;object-fit:cover}}
    .pl-img--inline img{{width:100%;max-width:374px;height:auto;margin:0 auto}}
    .pl-img--hero img{{width:100%;height:auto}}
    .pl-icon-list{{margin:16px 0 24px;padding-left:8px}}
    .pl-icon-row{{display:flex;align-items:flex-start;gap:10px;margin:6px 0}}
    .pl-icon-row .pl-img{{margin:0;flex-shrink:0}}
    .pl-icon-row p{{margin:0;padding-top:2px}}
    .pl-signs-row{{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:24px 0}}
    .pl-signs-row .pl-img{{margin:0}}
    .pl-img--sign img{{width:80px;height:auto;object-fit:contain}}
    .pl-review{{display:flex;gap:12px;margin:24px 0;padding:16px;border:1px solid #eee;border-radius:8px}}
    .pl-review .pl-img--review-avatar{{margin:0;flex-shrink:0}}
    .pl-img--review-avatar img{{width:52px;height:52px;border-radius:50%;object-fit:cover}}
    .pl-img--review-stars img{{width:127px;height:auto;object-fit:contain}}
    .pl-review-name{{margin:0 0 6px}}
    .pl-review-title{{margin:8px 0 4px}}
    .pl-review-meta{{margin:0 0 4px;font-size:14px;color:#666}}
    .pl-review-helpful{{font-size:13px;color:#666;margin-top:8px}}
    .pl-urgency{{text-align:center;margin:16px 0}}
    .pl-sidebar-card{{background:#f7f7f7;border:1px solid #e5e5e5;border-radius:8px;padding:18px;text-align:center;position:sticky;top:16px}}
    .pl-sidebar-card img{{max-width:180px;margin:0 auto 12px}}
    .pl-sidebar-title{{font-weight:800;margin:0 0 8px}}
    .pl-footer{{background:#222;color:rgba(255,255,255,.65);padding:24px 16px;font-size:11px;text-align:center}}
    .pl-footer a{{color:rgba(255,255,255,.85)}}
    .pl-sticky{{position:fixed;left:0;right:0;bottom:0;z-index:1001;transform:translateY(110%);transition:transform .25s;background:rgba(45,134,89,.97);padding:10px 12px calc(10px + env(safe-area-inset-bottom))}}
    .pl-sticky.is-visible{{transform:translateY(0)}}
    .pl-sticky a{{display:block;color:#fff!important;font-weight:800;text-align:center;font-size:15px}}
    .pag-sticky-cta{{position:fixed;left:0;right:0;bottom:0;z-index:1000;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);border-top:1px solid rgba(45,134,89,.35)}}
    .pag-cta-btn{{display:block;width:100%;background:#2d8659;color:#fff!important;font-weight:700;padding:14px 16px;border-radius:6px;text-align:center;font-size:14px}}
    @media(min-width:960px){{.pl-layout{{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:32px;align-items:start}}.pl-main{{margin:0}}.pl-sidebar{{display:block}}}}
    @media(min-width:760px){{.pl-img--badge img{{width:500px;max-width:100%}}}}
    @media(max-width:600px){{.pl-title{{font-size:24px}}.pl-testimonials-grid{{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;max-width:100%}}}}
  </style>
</head>
<body>
  <div class="pl-topbar">Início &gt; Pets &gt; Saúde</div>
  <div class="pl-shell pl-body">
    {body}
  </div>
  <footer class="pl-footer">
    <p style="font-style:italic">Conteúdo informativo — consulte seu veterinário.</p>
    <p><a href="https://mimiepipo.com.br/pages/politica-de-privacidade">Privacidade</a> · <a href="https://mimiepipo.com.br/pages/termos-e-condicoes">Termos</a></p>
    <p>&copy; __FOOTER_YEAR__ Mimi &amp; Pipo</p>
  </footer>
  {sticky_html}
  {paw_sticky_html}
  __META_PIXEL_SCRIPT__
</body>
</html>"""


def main() -> None:
    serve = load_serve_map()
    OUT.mkdir(parents=True, exist_ok=True)
    wolf = wolfroots_template(serve)
    paw = pawlife_template(serve)
    (OUT / "wolfroots.template.html").write_text(wolf, encoding="utf-8")
    (OUT / "pawlife.template.html").write_text(paw, encoding="utf-8")
    (ROOT / "public/advertorial.template.html").write_text(wolf, encoding="utf-8")
    print(f"Wrote static templates to {OUT}")


if __name__ == "__main__":
    main()
