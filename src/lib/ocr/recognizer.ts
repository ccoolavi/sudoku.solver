'use client';

import Tesseract, { createWorker } from 'tesseract.js';
import { CellRecognition, CellValue } from '../sudoku/types';

/**
 * Digit recognizer built on top of tesseract.js.
 *
 * Tesseract is configured for single-character digit recognition:
 *   - tessedit_char_whitelist = '123456789' (no 0 - Sudoku uses 1..9)
 *   - psm = 10 (single character / single line)
 *
 * For each cell we run a light preprocessing pass (grayscale + Otsu-style
 * threshold) to maximize OCR accuracy on the warped board crops. Cells whose
 * recognition confidence falls below `confidenceThreshold` OR whose recognized
 * text is empty/invalid are treated as blank (digit 0).
 *
 * The Tesseract worker is created lazily and reused across the 81 cells to
 * amortize its ~1-2s initialization cost.
 */

let workerPromise: Promise<Tesseract.Worker> | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const worker = await createWorker('eng', 1, {
      logger: () => {
        /* silence tesseract's per-page progress spam */
      },
      ...TESSERACT_WORKER_OPTIONS,
    });
    await worker.setParameters({
      tessedit_char_whitelist: '123456789',
      tessedit_pageseg_mode: '10' as any, // PSM.SINGLE_CHAR
      preserve_interword_spaces: '0',
    });
    return worker;
  })();
  return workerPromise;
}

export interface RecognizeOptions {
  confidenceThreshold?: number; // default 0.4 (lowered for sparser digits)
  onProgress?: (done: number, total: number, current: number) => void;
}

// basePath is required on GitHub Pages project sites, which serve from a
// subpath (e.g. /repo-name) rather than the domain root.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

const TESSERACT_WORKER_OPTIONS = {
  // All local — Tesseract.js loads worker.min.js, tesseract-core.wasm.js, and
  // eng.traineddata.gz from these paths, no CDN fallback needed since they
  // ship in /public and are precached by the service worker.
  workerPath: `${BASE_PATH}/tesseract-worker.min.js`,
  corePath: `${BASE_PATH}/tesseract-core.wasm.js`,
  workerBlobURL: false,
  langPath: `${BASE_PATH}/tessdata`,
};

/**
 * Pre-process a cell ImageData for OCR:
 *  - convert to grayscale
 *  - apply a binary threshold (Otsu's method, computed manually)
 * Returns a new ImageData (RGBA, black on white) suitable for tesseract.
 */
function preprocessCell(img: ImageData): ImageData {
  const { data, width, height } = img;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // luminance
    gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }

  // Otsu threshold
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  // Detect whether the digit is dark-on-light or light-on-dark by sampling
  // the border pixels (presumably background). If background is dark, invert.
  let borderSum = 0;
  let borderCount = 0;
  for (let x = 0; x < width; x++) {
    borderSum += gray[x] + gray[(height - 1) * width + x];
    borderSum += gray[x] + gray[(height - 1) * width + x];
    borderCount += 2;
  }
  for (let y = 0; y < height; y++) {
    borderSum += gray[y * width] + gray[y * width + width - 1];
    borderSum += gray[y * width] + gray[y * width + width - 1];
    borderCount += 2;
  }
  const borderMean = borderSum / borderCount;

  // We want digit = dark, background = light (Tesseract default).
  // If border is dark, invert.
  const invert = borderMean < threshold;

  const out = new ImageData(width, height);
  for (let i = 0, j = 0; i < out.data.length; i += 4, j++) {
    let v = gray[j];
    if (invert) v = 255 - v;
    const bin = v > threshold ? 255 : 0;
    out.data[i] = bin;
    out.data[i + 1] = bin;
    out.data[i + 2] = bin;
    out.data[i + 3] = 255;
  }
  return out;
}

function hasInk(img: ImageData, minInkRatio = 0.04): boolean {
  // Returns true if at least minInkRatio of pixels are "dark" (digit ink).
  let dark = 0;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (l < 128) dark++;
  }
  return dark / (data.length / 4) >= minInkRatio;
}

/**
 * Recognize all 81 cells. Returns a parallel array of CellRecognition objects.
 *
 * The cells are processed sequentially to avoid hammering Tesseract's
 * single-threaded worker; in practice this still completes in 1-3 seconds.
 */
export async function recognizeCells(
  cells: ImageData[],
  opts: RecognizeOptions = {},
): Promise<CellRecognition[]> {
  const threshold = opts.confidenceThreshold ?? 0.4;
  let worker: Tesseract.Worker | null = null;
  try {
    worker = await getWorker();
  } catch (err: any) {
    console.error('[OCR] Failed to init Tesseract:', err?.message || err);
    // Return all blanks if Tesseract can't load (cells will be editable)
    return cells.map((_, i) => ({ index: i, digit: 0 as CellValue, confidence: 0 }));
  }
  const results: CellRecognition[] = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!hasInk(cell)) {
      results.push({ index: i, digit: 0 as CellValue, confidence: 0 });
      opts.onProgress?.(i + 1, cells.length, i);
      continue;
    }

    const preprocessed = preprocessCell(cell);
    const canvas = document.createElement('canvas');
    canvas.width = preprocessed.width;
    canvas.height = preprocessed.height;
    canvas.getContext('2d')!.putImageData(preprocessed, 0, 0);

    let digit: CellValue = 0;
    let confidence = 0;
    try {
      const { data } = await worker.recognize(canvas);
      const text = (data.text || '').trim();
      confidence = data.confidence / 100;
      const parsed = parseInt(text.replace(/[^1-9]/g, '').slice(0, 1), 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 9 && confidence >= threshold) {
        digit = parsed as CellValue;
      }
    } catch {
      // ignore single-cell errors; treat as blank
    }

    results.push({ index: i, digit, confidence });
    opts.onProgress?.(i + 1, cells.length, i);
  }

  return results;
}

export async function terminateRecognizer(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
