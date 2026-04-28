# Frontier Farms App

Mobile-first web app for the farm owner. Four screens: Home, Brief, Fields, Inventory.

## Files
- `index.html`    — Home screen (status + generate button)
- `brief.html`    — Daily AI brief
- `fields.html`   — Field status + pollination windows
- `inventory.html`— Inventory snapshot
- `settings.html` — API key, fields, email config
- `app.js`        — All shared logic
- `style.css`     — All shared styles
- `_redirects`    — Cloudflare Pages routing

## Deploy to Cloudflare Pages (10 min)

1. github.com → New repository → "frontier-farms-app" → upload this folder
2. pages.cloudflare.com → Create project → Connect GitHub repo
3. Leave build settings blank → Deploy
4. App is live at: your-repo-name.pages.dev

## Add to iPhone home screen

Safari → open your app URL → Share button → "Add to Home Screen"
Opens full-screen like a native app.

## First-time setup (owner does this once)

1. Open the app → tap Settings (bottom-right of home screen via quick link)
2. Paste Anthropic API key (from console.anthropic.com)
3. Enter owner email address
4. Confirm field names, planting dates, hybrid RM ratings
5. Paste Google Sheet URL for manager log
6. Tap Save

## Weekly maintenance (1 minute)

- Update GDU offset in Settings → save
  Pull current number from: greencastonline.com → Growing Degree Days → your zip

## Access control

Cloudflare Pages → Settings → Access → Add email addresses for office/admin staff.
Free for up to 50 users. No passwords — one-time email code.
