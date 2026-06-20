# artigos.mimiepipo.com.br

Static article / story landing pages for **Mimi & Pipo** (Brazil). Deployed to Cloudflare Pages project **`mimi-pipo`**.

| Item | Value |
|------|-------|
| **Live URL** | https://artigos.mimiepipo.com.br/ |
| **Pages project** | `mimi-pipo` (`mimi-pipo.pages.dev`) |
| **GitHub** | https://github.com/james21333/artigos-mimiepipo |
| **Publish folder** | `public/` |

## Auto-deploy on commit

Push to **`main`** triggers `.github/workflows/deploy-cloudflare-pages.yml`.

### One-time: add GitHub secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Where to get it |
|--------|-----------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** (or custom with Account / Cloudflare Pages / Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → any zone → Overview → right column **Account ID** |

After both secrets exist, the next push to `main` deploys automatically.

### Alternative: connect Git in Cloudflare (no Actions secrets)

Cloudflare Dashboard → **Workers & Pages** → project **mimi-pipo** → **Settings** → **Builds & deployments** → **Connect to Git** → select `james21333/artigos-mimiepipo`, branch `main`, build output directory `public`.

Use either GitHub Actions **or** Cloudflare Git integration — not both required.

## Local structure

```
public/           # Static files served at artigos.mimiepipo.com.br
  index.html      # Hub page
  _headers        # Cloudflare Pages headers
```

Add new article HTML files under `public/` (e.g. `public/giardia-vizinha.html`).

## Related ad copy workspace

Meta ad drafts and creatives live in the separate **Facebook Ads** workspace (`mimi and pipo/ads/`). Link articles from ads to paths on this domain when you add landing pages.
