'use client';

import { CellRecognition } from '../sudoku/types';

/**
 * Main-thread facade around the OpenCV Web Worker.
 *
 * The worker is loaded from `/public/opencv-sudoku.worker.js` as a classic
 * Web Worker. It loads OpenCV.js (from /public/opencv.js with CDN fallbacks)
 * and runs the full CV pipeline off the main thread: grayscale → Gaussian
 * blur → adaptive threshold → largest 4-point contour → perspective warp to
 * 450×450 → slice into 81 cells (50×50, 10% border trim).
 */

type ProgressCb = (stage: string) => void;

export interface CvResult {
  warped: ImageData;
  cells: ImageData[];
}

let workerPromise: Promise<Worker> | null = null;
const pending = new Map<string, { resolve: (r: CvResult) => void; reject: (e: Error) => void }>();
let progressListener: ProgressCb | null = null;

function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = new Promise<Worker>((resolve, reject) => {
    try {
      // Load the worker from /public/opencv-sudoku.worker.js as a classic worker.
      // This avoids bundler-specific issues with `new Worker(new URL(...))` and
      // gives us a stable, debuggable worker entry point. basePath is required
      // on GitHub Pages project sites, which serve from a subpath.
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const worker = new Worker(`${basePath}/opencv-sudoku.worker.js`);
      worker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (!data) return;
        if (data.type === 'progress') {
          if (progressListener) progressListener(data.stage);
          return;
        }
        if (!data.id) return;
        const entry = pending.get(data.id);
        if (!entry) return;
        if (data.type === 'result') {
          pending.delete(data.id);
          entry.resolve({ warped: data.warped, cells: data.cells });
        } else if (data.type === 'error') {
          pending.delete(data.id);
          entry.reject(new Error(data.message));
        }
      };
      worker.onerror = (err) => {
        for (const [id, entry] of pending) {
          pending.delete(id);
          entry.reject(new Error(err.message || 'Worker crashed'));
        }
        reject(new Error(err.message || 'Worker failed to initialize'));
        workerPromise = null;
      };
      resolve(worker);
    } catch (err: any) {
      workerPromise = null;
      reject(err);
    }
  });
  return workerPromise;
}

export function onCvProgress(cb: ProgressCb | null) {
  progressListener = cb;
}

export async function processImage(imageData: ImageData): Promise<CvResult> {
  const worker = await getWorker();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<CvResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(
      { id, type: 'process', imageData, width: imageData.width, height: imageData.height },
      [imageData.data.buffer],
    );
  });
}

/**
 * Convenience: detect Sudoku board + segment cells from an HTMLImageElement
 * or HTMLCanvasElement. Returns the warped ImageData and per-cell ImageData.
 */
export async function extractBoard(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  onProgress?: ProgressCb,
): Promise<CvResult> {
  if (onProgress) onCvProgress(onProgress);
  else onCvProgress(null);
  const w = 'videoWidth' in source ? source.videoWidth : 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h = 'videoHeight' in source ? source.videoHeight : 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, 1024 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, cw, ch);
  const imageData = ctx.getImageData(0, 0, cw, ch);
  return processImage(imageData);
}

/**
 * Helper: draw a single ImageData onto a canvas at given size (for OCR / preview).
 */
export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export type { CellRecognition };
