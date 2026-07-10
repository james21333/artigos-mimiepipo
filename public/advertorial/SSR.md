# Advertorial — server-side rendering (Cloudflare Pages)

Dynamic ATF fields are rendered **on the server** before HTML reaches the browser — no client-side content shifting for Meta crawlers.

## Routes (SSR via Pages Functions)

- `/advertorial2.html`
- `/advertorial2`

Both read `public/advertorial.template.html` and inject query params at the edge.

**Note:** `/advertorial.html` is now the **Quiz 1** lander (static HTML, no SSR). Story prelanders and `?id=` / `?angle=` URLs should use **advertorial2**.

## URL parameters

| Param | Purpose | Overrides |
|-------|---------|-----------|
| `h1` | Exact ad hook → page H1 | yes |
| `hero` | Same 4:5 creative image URL as Meta ad | yes |
| `lead` | Hand-off paragraph immediately after hero | yes |
| `problem` | Symptom inserted into pull-quote list | yes |
| `quote` | Full pull-quote override | yes |
| `angle` | Preset bundle (see below) | used when explicit params omitted |

### Angle presets

| `?angle=` | H1 theme | Hero |
|-----------|----------|------|
| `digestion` | Digestão / intestino hook | `/advertorial/angles/digestion-hero.jpg` |
| `shinycoat` | Pelo opaco hook | `/advertorial/angles/shinycoat-hero.jpg` |

Example:

```
https://artigos.mimiepipo.com.br/advertorial2.html?angle=digestion
```

Per-ad URLs from `prelander-urls.json` still use explicit `h1`, `hero`, `lead`, `problem` (recommended for hook match).

## ATF order (ad → prelander continuity)

1. **H1** — same hook as ad  
2. **Hero** — same 4:5 native image (`aspect-ratio: 4/5`)  
3. **Lead** — continues ad copy  
4. Pull-quote + byline + skip  
5. Body narrative  

## Regenerate static fallback

After editing `advertorial.template.html`:

```bash
node scripts/bake-advertorial.mjs
```

Produces `public/advertorial2.html` (fallback if Functions unavailable).

## Deploy

Push to `main` → Cloudflare Pages rebuild (includes `/functions`).
