// OpenCV Sudoku worker - loaded as a classic worker via /public/opencv-sudoku.worker.js
// This file is plain JavaScript (no TypeScript) so it runs without bundling.
//
// Note: We use direct callbacks instead of Promises because OpenCV.js's emscripten
// runtime can interfere with microtask scheduling in some environments, causing
// `await`/`.then()` continuations to never fire even after `resolve()` is called.

// Resolve relative to this worker script's own directory, not the origin root —
// required for GitHub Pages project sites, which serve from a subpath
// (e.g. https://user.github.io/repo/opencv-sudoku.worker.js).
const WORKER_BASE_PATH = self.location.pathname.replace(/[^/]*$/, '');
const OPENCV_CDN_URLS = [
  self.location.origin + WORKER_BASE_PATH + 'opencv.js',
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
  'https://docs.opencv.org/4.10.0/opencv.js',
  'https://docs.opencv.org/4.x/opencv.js',
];
const WARP_SIZE = 450;
const CELL_SIZE = 50;
const CELL_MARGIN = 0.1;

let cvState = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'failed'
const cvWaiters = []; // callbacks waiting for cv to be ready

function notifyWaiters() {
  while (cvWaiters.length > 0) {
    const cb = cvWaiters.shift();
    try {
      cb(self.cv);
    } catch (err) {
      // Continue notifying other waiters
    }
  }
}

function loadOpenCV(cb) {
  if (cvState === 'ready') {
    cb(self.cv);
    return;
  }
  if (cvState === 'loading') {
    cvWaiters.push(cb);
    return;
  }
  cvState = 'loading';
  cvWaiters.push(cb);
  startLoading(0);
}

function startLoading(urlIdx) {
  if (urlIdx >= OPENCV_CDN_URLS.length) {
    cvState = 'failed';
    while (cvWaiters.length > 0) {
      const cb = cvWaiters.shift();
      try { cb(null); } catch (e) {}
    }
    return;
  }
  const url = OPENCV_CDN_URLS[urlIdx];
  try {
    self.importScripts(url);
    if (self.cv) {
      // Poll until cv.Mat is available (WASM still initializing asynchronously)
      let attempts = 0;
      const interval = self.setInterval(function () {
        attempts++;
        if (self.cv && self.cv.Mat) {
          self.clearInterval(interval);
          cvState = 'ready';
          notifyWaiters();
        } else if (attempts > 600) { // 60s
          self.clearInterval(interval);
          startLoading(urlIdx + 1);
        }
      }, 100);
    } else {
      startLoading(urlIdx + 1);
    }
  } catch (err) {
    startLoading(urlIdx + 1);
  }
}

function orderPoints(pts) {
  const sortedBySum = pts.slice().sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]); });
  const tl = sortedBySum[0];
  const br = sortedBySum[sortedBySum.length - 1];
  const sortedByDiff = pts.slice().sort(function (a, b) { return (a[1] - a[0]) - (b[1] - b[0]); });
  const tr = sortedByDiff[0];
  const bl = sortedByDiff[sortedByDiff.length - 1];
  return [tl, tr, br, bl];
}

function findLargestQuadContour(cv, srcGray) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(srcGray, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let bestQuad = null;
  let bestArea = 0;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < 1000) { cnt.delete(); continue; }
    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
    if (approx.rows === 4 && area > bestArea) {
      const pts = [];
      for (let r = 0; r < 4; r++) {
        // approx is a (4,1) CV_32SC2 Mat. Each row is one point with 2 int32 channels (x, y).
        const ptr = approx.intPtr(r, 0);
        const x = ptr[0];
        const y = ptr[1];
        pts.push([x, y]);
      }
      bestArea = area;
      bestQuad = pts;
    }
    approx.delete();
    cnt.delete();
  }
  contours.delete();
  hierarchy.delete();
  return bestQuad;
}

function processImage(req) {
  self.postMessage({ id: req.id, type: 'progress', stage: 'processImage-start' });
  loadOpenCV(function (cv) {
    if (!cv || !cv.matFromImageData) {
      self.postMessage({ id: req.id, type: 'error', message: 'OpenCV.js failed to load. Check network connection.' });
      return;
    }
    try {
      self.postMessage({ id: req.id, type: 'progress', stage: 'opencv-ready' });
      const src = cv.matFromImageData(req.imageData);
      self.postMessage({ id: req.id, type: 'progress', stage: 'preprocessing' });

      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      const blur = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

      const thresh = new cv.Mat();
      cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

      self.postMessage({ id: req.id, type: 'progress', stage: 'finding-contours' });
      const quad = findLargestQuadContour(cv, thresh);
      if (!quad) {
        src.delete(); gray.delete(); blur.delete(); thresh.delete();
        self.postMessage({ id: req.id, type: 'error', message: 'No Sudoku grid detected. Please align the puzzle or adjust lighting.' });
        return;
      }

      self.postMessage({ id: req.id, type: 'progress', stage: 'warping' });
      const ordered = orderPoints(quad);
      const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
        ordered[0][0], ordered[0][1],
        ordered[1][0], ordered[1][1],
        ordered[2][0], ordered[2][1],
        ordered[3][0], ordered[3][1],
      ]);
      const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        WARP_SIZE - 1, 0,
        WARP_SIZE - 1, WARP_SIZE - 1,
        0, WARP_SIZE - 1,
      ]);
      const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
      const warped = new cv.Mat();
      cv.warpPerspective(src, warped, M, new cv.Size(WARP_SIZE, WARP_SIZE));

      const warpedImageData = new ImageData(new Uint8ClampedArray(warped.data), WARP_SIZE, WARP_SIZE);

      self.postMessage({ id: req.id, type: 'progress', stage: 'segmenting-cells' });
      const cells = [];
      const trim = Math.floor(CELL_SIZE * CELL_MARGIN);
      const innerSize = CELL_SIZE - 2 * trim;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const rect = new cv.Rect(c * CELL_SIZE + trim, r * CELL_SIZE + trim, innerSize, innerSize);
          const cellMat = warped.roi(rect);
          const upscaled = new cv.Mat();
          cv.resize(cellMat, upscaled, new cv.Size(innerSize * 2, innerSize * 2), 0, 0, cv.INTER_CUBIC);
          cells.push(new ImageData(new Uint8ClampedArray(upscaled.data), upscaled.cols, upscaled.rows));
          cellMat.delete();
          upscaled.delete();
        }
      }

      src.delete(); gray.delete(); blur.delete(); thresh.delete();
      srcPoints.delete(); dstPoints.delete(); M.delete(); warped.delete();

      const buffers = [warpedImageData.data.buffer].concat(cells.map(function (c) { return c.data.buffer; }));
      self.postMessage({ id: req.id, type: 'result', warped: warpedImageData, cells: cells }, buffers);
    } catch (err) {
      self.postMessage({ id: req.id, type: 'error', message: 'processImage failed: ' + ((err && err.message) || err) + ' stack: ' + ((err && err.stack) || '').substring(0, 500) });
    }
  });
}

self.onmessage = function (e) {
  const data = e.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'process') {
    try {
      processImage(data);
    } catch (err) {
      self.postMessage({ id: data.id, type: 'error', message: 'worker onmessage error: ' + ((err && err.message) || err) });
    }
  }
};
