# Sudoku Vision Solver

Point a camera or photo at a Sudoku puzzle and get it solved — entirely in the
browser. No backend, no upload, no external API calls of any kind. Works
offline once installed.

**Pipeline:** OpenCV.js (Web Worker) finds and warps the board → Tesseract.js
reads the 81 cells → an exact-cover (Dancing Links / Algorithm X) solver
solves it in single-digit milliseconds → an editable grid lets you fix any
misread digit before solving.

Ships as a installable **Progressive Web App**, built to deploy as static
files to **GitHub Pages** with zero server.

---

## Run locally

```bash
npm install
npm run dev       # http://localhost:3000
```

## Build the static export

```bash
npm run build      # → ./out
```

`./out` is a complete static site — every asset (including the 9.9MB
OpenCV.js and 11MB of Tesseract OCR data) is self-contained under it. Serve it
with any static file server to try the production build locally:

```bash
npx serve out
```

---

## Deploy to GitHub Pages

This repo ships a ready-to-go GitHub Actions workflow
(`.github/workflows/deploy.yml`) that builds and deploys on every push to
`main`. To go live:

1. **Create the GitHub repo** (not done by this tool — do this yourself):
   ```bash
   gh repo create <your-username>/sudoku-solve --public --source=. --push
   ```
   (or create it on github.com and `git remote add origin ...` + `git push -u origin main`)

2. **Enable Pages**: repo Settings → Pages → Source → **GitHub Actions**.

3. **Push to `main`** — the workflow builds and deploys automatically. Your
   app will be live at `https://<your-username>.github.io/sudoku-solve/`.

### Subpath handling

GitHub Pages project sites (`user.github.io/repo-name/`) serve from a
subpath, not the domain root. The workflow already sets
`NEXT_PUBLIC_BASE_PATH=/sudoku-solve` (derived from the repo name) at build
time — every asset path, the manifest, the service worker, and the CV/OCR
Web Workers all resolve relative to that path, so nothing needs to be
hardcoded for the app to work correctly.

If you rename the repo, or deploy it as a *user/org* site
(`<you>.github.io`) or under a custom domain instead of a project site, edit
the `NEXT_PUBLIC_BASE_PATH` line in `.github/workflows/deploy.yml` to match
(use an empty string `""` for a root deployment).

---

## Why this is a genuinely offline-capable PWA

- **`output: "export"`** in `next.config.ts` — the entire app is prerendered
  to static HTML/JS/CSS; there is no server runtime to deploy.
- **`public/sw.js`** — a hand-written service worker (no build tooling
  needed) that precaches the app shell plus the heavy CV/OCR assets on
  install, then cache-first-serves every same-origin request afterwards. It
  computes its own base path from `self.location`, so it works unmodified
  whether the app is served from `/` or a GitHub Pages subpath.
- **`public/manifest.json`** — installable (Chrome/Edge "Install app",
  Safari "Add to Home Screen"), with proper `any` and `maskable` icons.
- **All algorithms run client-side**: OpenCV.js and Tesseract.js execute in a
  Web Worker off the main thread; the Dancing Links solver is pure
  TypeScript. Nothing is ever uploaded anywhere.
- **State survives a closed tab**: puzzle progress auto-saves to
  `localStorage` (7-day expiry) and offers to resume on your next visit — see
  `src/lib/persistence/localStorage.ts`.

## Features

- **Capture**: live webcam (with alignment guide) or file upload/drag-drop.
- **Detect**: OpenCV.js CV pipeline + Tesseract.js OCR, both off the main
  thread.
- **Review & edit**: 9×9 editable grid — physical keyboard (1–9, Backspace,
  arrows) on desktop, on-screen keypad on touch devices, full ARIA labeling
  for screen readers.
- **Solve**: Dancing Links exact-cover solver, <10ms even on hard puzzles.
- **Export**: copy the grid as text, share/download a solved-board PNG
  (uses the native Web Share sheet on mobile), or download a JSON file.
- **Resume**: reopen the app and pick up exactly where you left off.
- **Offline indicator**: a badge confirms the app knows it's offline —
  everything still works.

## Project structure

```
src/
  app/                    Next.js App Router root (page.tsx = the whole UI)
  components/sudoku/      CapturePanel, EditableGrid, SolutionView
  components/ui/          shadcn/ui primitives actually used (5 total)
  lib/sudoku/             Board types, validator, Dancing Links solver
  lib/cv/                 Worker facade for the OpenCV.js pipeline
  lib/ocr/                Tesseract.js wrapper + per-cell preprocessing
  lib/export/             PNG/JSON/text export utilities
  lib/persistence/        localStorage save/load/resume
public/
  opencv.js                       9.9MB, WASM inlined as base64 — no external fetch
  opencv-sudoku.worker.js         classic Web Worker running the CV pipeline
  tesseract-*, tessdata/          Tesseract.js runtime + English digit model
  manifest.json, icons/, sw.js    PWA install + offline support
```

## Tech

Next.js 16 (static export) · React 19 · TypeScript · Tailwind CSS 4 ·
shadcn/ui · OpenCV.js · Tesseract.js · a from-scratch Dancing Links solver.
No backend, no database, no external API — ever.
