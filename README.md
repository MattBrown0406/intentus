# Intentus

Intentus is a Vite + React app for operating audits, 90-day plans, executive accountability check-ins, and coach-led accountability workflows.

It helps users:
- audit the metrics and behaviors that matter most
- surface strengths, weaknesses, blind spots, and contradictions
- generate a focused 90-day operating plan
- stay accountable with daily or weekly check-ins
- monitor drift versus adherence over time
- support coach-branded client accountability programs

## SEO and public-site notes

- Route-aware metadata, canonical tags, OG/Twitter tags, robots control, and JSON-LD via `src/components/seo/Seo.tsx`
- Public marketing pages for:
  - `/for-executives`
  - `/for-coaches`
  - `/operating-audit`
  - `/accountability-software`
  - `/faq`
- Static `public/sitemap.xml`
- `robots.txt` includes the sitemap location
- Route-level lazy loading in `src/App.tsx`
- Google Fonts moved from CSS `@import` to `<link>` tags in `index.html`

## Domain assumptions

This branch uses `https://intentusai.com` as the canonical production URL for metadata and the sitemap. If the live domain is different, update:

- `src/lib/site.ts`
- `index.html`
- `public/sitemap.xml`
- `public/robots.txt`

## SPA hosting fallback

Because this is a client-side routed SPA, the host must rewrite unknown paths to `index.html`.

### Netlify

Create `public/_redirects` with:

```txt
/* /index.html 200
```

### Vercel

Use `vercel.json`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Nginx

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Without this fallback, direct visits to routes like `/for-executives` or `/faq` will 404 on some hosts.

## Development

```bash
npm install
npm run build
```
