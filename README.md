# ClipForge Studio

A **legal-first Shorts repurposing studio** — a 100% static web app. No backend, no build step, **no API keys required**.

## What it does

1. **Footage** — search reusable video from keyless sources:
   - NASA Image & Video Library (public domain, no key)
   - Archive.org public-domain films (no key)
   - Wikimedia Commons freely-licensed media (no key)
   - Optional YouTube CC search (only if you paste a Data API key; results are references for the Edit Plan — the app never rips videos)
   - Upload your own files
2. **Timeline** — trim clips (IN/OUT), reorder, write narration scripts
3. **Voiceover** — record original narration per clip in-browser (teleprompter), or upload audio
4. **Captions & Style** — auto-captions from your scripts, music bed upload, title card + watermark overlays, 9:16 Shorts or 16:9 long-form
5. **Render & Export** — ffmpeg.wasm renders everything **locally in the browser**; export MP4, `.srt`, Edit Plan JSON, and a title/description/hashtag pack with auto-generated attribution

## Run it

Just open `index.html` — or use the live link (GitHub Pages). Everything runs client-side; project data lives in localStorage/IndexedDB in your browser.

## Repo rules

- Static only. No secrets, no API keys in the repo.
- Never force-push or rebase pushed history.
- The YouTube tab is metadata-only by design (legal-first: no downloading of videos you don't have file access to).
