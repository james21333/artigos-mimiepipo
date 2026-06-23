# Prelander 02 — Advertorial template (Pawsy-style)

## Live URL (after deploy)

`https://artigos.mimiepipo.com.br/advertorial.html`

## Template reference

Structure mirrored from [Pawsy parasite advertorial](https://pawsylabs.com/pages/pawsy-parasite-adv) — layout blocks only. Copy, product, author, and offers are Mimi & Pipo.

## Above-the-fold (URL parameters)

Pass query params so the prelander matches the Meta ad click. All values should be **URL-encoded** (`encodeURIComponent`).

| Param | Element | Purpose |
|-------|---------|---------|
| `h1` | `#dynamic-h1` | Exact ad hook line (H1) |
| `hero` | `#dynamic-hero` `src` | Same 4:5 image as the ad creative |
| `lead` | `#dynamic-lead` | Hand-off paragraph after skip button |
| `problem` | `#dynamic-quote` | Symptom phrase inserted into pull-quote problem list |
| `quote` | `#dynamic-quote` | Optional full quote override (replaces built quote) |

**Pull-quote:** Default list + `problem` param from ad issue. Example: `...reinfecta depois do vermífugo, tem cocô mole ou acorda...`

**Layout:** Mirrors [Pawsy parasite adv](https://pawsylabs.com/pages/pawsy-parasite-adv) — centered `740px` column, cream `#f4ecd9` background, dark journal bar, orange CTA buttons, **no sidebar product card**.

## Funnel

| Role | URL |
|------|-----|
| **Meta ad** | `advertorial.html?h1=...&hero=...&lead=...` |
| **All CTAs** | `https://mimiepipo.com.br/products/digestao-saudavel?variant=47890765775003` |

## Offers (Mimi & Pipo — not Pawsy)

- **30% OFF** on 2 pots (most popular bundle)
- **Frete grátis** on orders R$ 199+
- **60-day** guarantee (not 90)

## Page blocks

1. Masthead: **DIÁRIO DE SAÚDE CANINA — Advertorial**
2. Dynamic date (pt-BR, today)
3. Dynamic H1 + 4:5 hero + dynamic lead
4. Author byline: **Juliana Da Silva**
5. Qualifying intro + story sections
6. **7 inline images** — see `artigos-mimiepipo/public/advertorial/README.md` (Pawsy placement)
7. Mechanism / comparison / proof sections
8. Product + bottom CTA (30% off + frete grátis)
9. Testimonials + P.S. + decision block
10. Black footer bar (disclaimer + legal links)

## Regenerate URLs after copy edits

```bash
python3 "mimi and pipo/ads/creatives/scripts/build-prelander-urls.py"
python3 "mimi and pipo/ads/creatives/scripts/build-publish-plan.py"
```

Updates `prelander-urls.json`, `upload-plan.json`, `publish-plan.json`, and **Prelander:** lines in each ad `.md` file.

## Deploy

```bash
cp "/Users/josh/Desktop/Facebook Ads/mimi and pipo/prelanders/02-advertorial-template/page.html" \
   "/Users/josh/Desktop/artigos-mimiepipo/public/advertorial.html"
cd "/Users/josh/Desktop/artigos-mimiepipo" && git add public/advertorial.html && git commit -m "Add advertorial template (Pawsy-style, URL params)." && git push
```

## Status

- [x] HTML shell + Pawsy block structure
- [x] URL param injection (h1, hero, lead, quote)
- [x] Dynamic date, author, footer links
- [x] Deploy to artigos host
- [x] 24 campaign ads wired — see `ads/creatives/prelander-urls.json`
- [ ] Per-ad final copy in body placeholders
- [ ] Push prelander URLs to Meta (not done — waiting on QA)
