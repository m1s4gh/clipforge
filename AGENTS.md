# AGENTS.md — ClipForge

- Static app: `index.html` + `styles.css` + `app.js` / `render.js` / `export.js`. No build, no backend, no secrets.
- Video engine: `@ffmpeg/ffmpeg@0.11.6` (single-thread UMD via jsDelivr) + `@ffmpeg/core@0.11.0`. Single-thread build = no COOP/COEP headers needed.
- Footage APIs are all CORS-open and keyless: `images-api.nasa.gov`, `archive.org`, `commons.wikimedia.org` (with `origin=*`). If a source changes its API shape, fix the parser in `app.js` (searchNASA/searchArchive/searchCommons).
- Font for burn-in: Roboto variable TTF from jsDelivr GH mirror of google/fonts, fallback to raw.githubusercontent. If both fail, render.js skips burn-in and still delivers video + SRT.
- Blobs (uploads, voice recordings, music) live in IndexedDB `clipforge/blobs`; project JSON in localStorage `clipforge1`.
- Never force-push main.
