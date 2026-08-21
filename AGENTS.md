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
- `src/ToolsPage.tsx`: tools dashboard shell. Current tools include 2FA, browser-side archive extraction/creation, and the image tools entry.
- `src/ImageToolsPage.tsx`: browser-side image format conversion plus encrypted noise-PNG creation and decryption UI.
- `src/imageTools.ts`: image conversion, AES-GCM encryption, and private PNG chunk helpers.
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
- Most non-RAR formats use `libarchive.js`, loaded from the React bundle, plus:
  - `/libarchive/worker-bundle.js`
  - `/libarchive/libarchive.wasm`
- RAR files use `node-unrar-js` from the browser memory API because `libarchive.js` can fail on some RAR archives with errors such as `Unsupported block header size`.
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

### Image Tools

- Image processing is entirely browser-side and does not upload images or keys.
- Format conversion supports one JPEG, PNG, or WebP image at a time. It preserves dimensions, replaces only the file extension, and removes EXIF metadata while re-encoding.
- Image encryption derives an AES-256-GCM key from the user passphrase with PBKDF2-HMAC-SHA-256 and writes the encrypted original into a private `dyIm` chunk inside a noise PNG.
- Encrypted images use the name `<original-base>_encrypted.png`; decryption restores the original filename and bytes.
- Keys are never persisted. Losing the key makes the encrypted image unrecoverable.
- Encrypted PNG files must be preserved or sent as files. Image recompression, resizing, or metadata/chunk cleanup can make them impossible to decrypt.

### ChatGPT Plus Checkout Link

- The ChatGPT checkout tool provides a one-click-copyable console script.
- Users paste the script into the browser console on `chatgpt.com` to automatically fetch and copy the Stripe checkout URL.
- The script runs entirely in the user's browser using their existing login session; no server-side proxy is involved.
- The tool page shows step-by-step instructions and a copy button for the script.

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
