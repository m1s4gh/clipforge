# ClipForge Studio v1 — build notes for the page builder

This folder holds the complete, working app. Use these files AS-IS for the page
(do not rewrite the logic; wire them exactly):

- `index.html` — page shell, loads `app.js`, `render.js`, `export.js`, `styles.css`,
  plus the ffmpeg UMD script from jsDelivr (keep that CDN script tag).
- `styles.css` — dark studio theme.
- `app.js` — state, IndexedDB blob store, footage search (NASA / Archive.org /
  Wikimedia Commons / optional YouTube), timeline, voiceover recorder.
- `render.js` — ffmpeg.wasm 0.11.6 local render pipeline (trim, crop/scale,
  voice+music mix, caption burn-in with best-effort fallback, MP4 out).
- `export.js` — captions (SRT/ASS), attribution block, metadata pack, Edit Plan JSON.

Runtime behavior the page must keep:
- All footage/API calls happen client-side at user action (search button), never at page open.
- No API keys required: NASA (`images-api.nasa.gov`), Archive.org, Wikimedia Commons
  (with `origin=*`) are CORS-open and keyless. The YouTube tab is optional-key only.
- ffmpeg core loads from `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js`
  (single-thread build — no special headers needed).
- Everything stays in the browser: localStorage + IndexedDB. Nothing is uploaded anywhere.
