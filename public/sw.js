// Sudoku Vision Solver — offline-first service worker.
// Hand-written (no build tooling) so it works unmodified from a static `next export`
// output served from any path — domain root or a GitHub Pages project subpath.
//
// Strategy:
//  - Precache the app shell + the heavy CV/OCR assets on install, so the very first
//    visit already has everything needed to work offline afterwards.
//  - Navigations (the HTML document) are network-FIRST, cache as fallback. Next.js
//    content-hashes every JS/CSS chunk filename per build, so a stale cached HTML
//    document references chunk URLs from a previous deploy that no longer exist on
//    the server — cache-first here would mean "revisit after we ship an update" =
//    a page that looks broken/unstyled (missing CSS) with no obvious cause. Only
//    when the network is unreachable (actually offline) does it fall back to the
//    last cached shell, restoring state from localStorage client-side.
//  - Cache-first for everything else (JS/CSS/wasm/images) — safe *because* those
//    filenames are content-hashed and immutable; a new build simply references new
//    filenames, so a stale cache entry under an old name is never served by mistake.
//  - Runtime requests that aren't precached are cached the first time they're
//    fetched, so a second visit is fully offline too.

const CACHE_VERSION = 'v2';
const CACHE_NAME = `sudoku-solver-${CACHE_VERSION}`;

// Directory this service worker file lives in — works whether the app is served
// from the domain root ("/") or a GitHub Pages project path ("/sudoku-solve/").
const BASE_PATH = new URL('.', self.location).pathname;

const PRECACHE_URLS = [
  '',
  'manifest.json',
  'opencv.js',
  'opencv-sudoku.worker.js',
  'tesseract-worker.min.js',
  'tesseract-core.wasm.js',
  'tesseract-core.wasm',
  'tessdata/eng.traineddata.gz',
  'icons/icon-192.png',
  'icons/icon-512.png',
].map((p) => BASE_PATH + p);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
              console.warn('[sw] precache failed for', url, err);
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sudoku-solver-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (the HTML shell): network-first. See the strategy note above —
  // this is what prevents "revisit after a deploy" from serving a page that
  // references JS/CSS filenames the new deploy no longer has.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(BASE_PATH, response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const shell = await cache.match(BASE_PATH);
          if (shell) return shell;
          throw new Error('Offline and no cached shell available');
        }
      })(),
    );
    return;
  }

  // Everything else: cache-first (safe — content-hashed, immutable filenames).
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
