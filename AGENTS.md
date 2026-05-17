# Project Notes for Codex

This repository is a Cloudflare Workers + Vite + React site for `dploveyuyu.site`.

## Quick Context

- Main public site: `https://dploveyuyu.site/`
- Tools page: use `https://tools.dploveyuyu.site/` directly when checking the tools UI.
- The `/tools` path also renders the tools page, but on the main host it may pass through the cabin access gate first.
- The tools subdomain is intentionally treated as a tools host in both the Worker and client router.
- Local dev usually serves at `http://127.0.0.1:8080/` because the Cloudflare Vite plugin controls the port.

## Important Files

- `src/main.tsx`: chooses between `App` and `ToolsPage`.
- `src/App.tsx`: the main memory/photo site.
- `src/ToolsPage.tsx`: tools dashboard. Current tools include 2FA, browser-side archive extraction, and browser-side archive creation.
- `src/index.css`: Tailwind import, theme fonts, global body styles.
- `worker/index.ts`: Cloudflare Worker entry, auth gate, metadata rewrite, API routes.
- `worker/totp.ts`: TOTP generation logic for `/api/tools/totp`.
- `public/libarchive/`: static WebAssembly worker assets used by the archive extraction tool.
- `wrangler.jsonc`: Cloudflare Workers deployment config.

## Routing and Auth

- Client routing logic:
  - `hostname === 'tools.dploveyuyu.site'` renders `ToolsPage`.
  - `pathname === '/tools'` also renders `ToolsPage`.
- Worker auth logic:
  - Main host requires the `love_cabin_access=verified` cookie for most pages.
  - `tools.dploveyuyu.site` bypasses the cabin auth gate.
  - Local HTTP testing may not persist the auth cookie from the form because the Worker sets it with `Secure`.
  - For local browser testing only, setting `document.cookie = 'love_cabin_access=verified; Path=/; SameSite=Lax'` is enough to bypass the local gate.

## Tools Page Notes

### 2FA

- The 2FA tool calls `POST /api/tools/totp`.
- The secret is sent to the Worker, and the Worker returns the current TOTP code.

### Archive Extraction

- Archive extraction is done entirely in the browser.
- It uses `libarchive.js`, loaded from the React bundle, plus:
  - `/libarchive/worker-bundle.js`
  - `/libarchive/libarchive.wasm`
- It does not call WinRAR, 7-Zip, system shell commands, or backend extraction.
- Supported formats are shown in the UI: ZIP, 7z, RAR v4/v5, TAR, GZIP, BZIP2, XZ, LZMA, DEFLATE.
- After extraction, users can download single files or use `保存为文件夹`.
- `保存为文件夹` uses the browser File System Access API, so it mainly works in Chrome and Edge.
- File and folder names must be sanitized before calling `getDirectoryHandle` or `getFileHandle`; otherwise Chromium may throw `Name is not allowed`.

### Archive Creation

- Archive creation is also done in the browser.
- ZIP creation uses `@zip.js/zip.js` because `libarchive.js` currently writes empty ZIP/7z files in browser testing.
- ZIP supports optional password encryption through `zip.js`.
- TAR, TAR.GZ, TAR.BZ2, TAR.XZ, and TAR.LZMA use `libarchive.js`.
- The compression tool accepts multiple files, whole folders via `webkitdirectory`, and drag-and-drop files/folders.
- Folder uploads rely on browser-specific file path APIs; Chrome and Edge are the practical target browsers.

## Common Commands

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
npm.cmd run deploy
```

Use `npm.cmd` on this Windows machine instead of `npm` because PowerShell script execution policy may block `npm.ps1`.

## Deployment Notes

- Cloudflare is connected to the GitHub repository and deploys automatically after changes are pushed to GitHub.
- For normal releases, commit and push the intended changes to GitHub; do not run `npm.cmd run deploy` unless the user explicitly asks for a manual Cloudflare deploy or automatic deployment is known to be unavailable.
- `npm.cmd run deploy` is kept as a manual fallback command.

## Development Notes

- Prefer keeping UI changes in `src/ToolsPage.tsx` scoped to the relevant tool.
- Do not remove `public/libarchive/*`; production builds need these files copied as static assets.
- Run `npm.cmd run lint` and `npm.cmd run build` before calling work complete.
- If a dev server was started for testing, stop the matching local Vite/npm process and clean temporary `.codex-*` test files afterward.
