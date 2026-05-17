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

Cloudflare is connected to the GitHub repository and deploys automatically after changes are pushed to GitHub.

For normal releases, commit the code and push to the tracked GitHub branch. Use a manual Wrangler deploy only as a fallback or when explicitly needed:

1. Log in to Cloudflare:
   `npx wrangler login`
2. Deploy:
   `npm run deploy`

## Project structure

- `src/`: React client application
- `worker/index.ts`: Worker entry for `/api/*` routes and asset fallback
- `wrangler.jsonc`: Cloudflare Workers configuration
