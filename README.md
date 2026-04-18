<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Deploy to Cloudflare Workers

This project is configured as a Cloudflare Workers + Vite application. The React app is built as static assets and served by Workers, and `worker/index.ts` is reserved for API routes or custom edge logic.

## Prerequisites

- Node.js 20+
- A Cloudflare account
- Wrangler authentication via `npx wrangler login`

## Local development

1. Install dependencies:
   `npm install`
2. Start the Workers-powered Vite dev server:
   `npm run dev`
3. Preview the production build when needed:
   `npm run build`
   `npm run preview`

## Deploy

1. Adjust the Worker name in `wrangler.jsonc` if you want a different deployed service name.
2. Log in to Cloudflare:
   `npx wrangler login`
3. Deploy:
   `npm run deploy`

## Project structure

- `src/`: React client application
- `worker/index.ts`: Worker entry for `/api/*` routes and asset fallback
- `wrangler.jsonc`: Cloudflare Workers configuration
