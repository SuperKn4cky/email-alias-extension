# Email Alias Extension (Chromium)

Chromium MV3 extension to generate random aliases for your own domain and use Cloudflare Email Routing so aliases forward to your personal mailbox.

## Features

- Alias format: `site-slug-random@yourdomain.tld`
- Site-aware slug from current tab (ex: `amazon-abc123@...`)
- Main action: **Generate + Create + Copy**
- Optional action: fill detected email input on current page
- Local alias history (Chrome local storage)
- Cloudflare API integration:
  - ensure destination address exists
  - ensure catch-all rule forwards to destination email

## Requirements

- Cloudflare Email Routing enabled on your domain
- A Cloudflare API token with minimal scopes for Email Routing and zone read/edit as needed
- Chromium/Chrome in developer mode for unpacked extension

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build:
   ```bash
   npm run build
   ```
3. Load extension from `dist/` in `chrome://extensions` (Developer mode).
4. Open extension options and set:
   - Domain (ex: `example.com`)
   - Forward destination email (your personal inbox)
   - Cloudflare Account ID
   - Cloudflare Zone ID
   - Cloudflare API token
5. Use popup button **Generate + Create + Copy**.

## Bitwarden workflow

1. Open signup page.
2. Click extension icon.
3. Click **Generate + Create + Copy**.
4. Paste alias in email field.
5. Save credentials in Bitwarden.

## Development commands

```bash
npm run typecheck
npm run test
npm run build
npm run ci:check
```
