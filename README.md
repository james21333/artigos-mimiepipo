# artigos.mimiepipo.com.br

Static article / story landing pages for **Mimi & Pipo** (Brazil). Deployed to Cloudflare Pages project **`mimi-pipo`**.

| Item | Value |
|------|-------|
| **Live URL** | https://artigos.mimiepipo.com.br/ |
| **Pages project** | `mimi-pipo` (`mimi-pipo.pages.dev`) |
| **GitHub** | https://github.com/james21333/artigos-mimiepipo |
| **Publish folder** | `public/` |

## Auto-deploy on commit

Choose **one** of these (Cloudflare Git is fastest if you have not added API secrets yet).

### Option A — Connect Git in Cloudflare (recommended first)

1. Open [Cloudflare Dashboard → Workers & Pages](https://dash.cloudflare.com/) → project **`mimi-pipo`**
2. **Settings** → **Builds & deployments** → **Connect to Git**
3. Select **`james21333/artigos-mimiepipo`**, branch **`main`**, build output directory **`public`**
4. Save. Every push to `main` deploys to https://artigos.mimiepipo.com.br/

### Option B — GitHub Actions (workflow in repo, needs secrets)

Push includes `.github/workflows/deploy-cloudflare-pages.yml`. Requires GitHub token with **`workflow`** scope to push the workflow file (re-auth `gh auth login -s workflow` if push is rejected).

Add repo secrets: **Settings → Secrets and variables → Actions**

| Secret | Where to get it |
|--------|-----------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** (or custom with Account / Cloudflare Pages / Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → any zone → Overview → right column **Account ID** |

After both secrets exist, push `main` to trigger deploy.

### Alternative note

Use either Cloudflare Git integration **or** GitHub Actions — not both required.

## Local structure

```
public/           # Static files served at artigos.mimiepipo.com.br
  index.html      # Hub page
  _headers        # Cloudflare Pages headers
```

Add new article HTML files under `public/` (e.g. `public/giardia-vizinha.html`).

## Related ad copy workspace

Meta ad drafts and creatives live in the separate **Facebook Ads** workspace (`mimi and pipo/ads/`). Link articles from ads to paths on this domain when you add landing pages.
