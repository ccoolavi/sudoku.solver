import { Board, EMPTY_BOARD, SolverAlgorithm } from '@/lib/sudoku/types';

const STORAGE_KEY = 'sudoku-solver:v1';
const PREFS_KEY = 'sudoku-solver:prefs:v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type PersistedStage = 'review' | 'solved';

export interface PersistedPuzzle {
  version: 1;
  timestamp: number;
  stage: PersistedStage;
  board: Board;
  confidence: Array<number | undefined>;
  recognizedIndices: number[];
  solution: Board | null;
  solvedIndices: number[];
  solverElapsedMs: number | null;
  solverAlgorithm: SolverAlgorithm | null;
  /** Warped board preview, stored as a PNG data URL (small enough for localStorage). */
  warpedPreviewDataUrl: string | null;
}

export function savePuzzleState(state: Omit<PersistedPuzzle, 'version' | 'timestamp'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedPuzzle = { version: 1, timestamp: Date.now(), ...state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Quota exceeded or storage disabled (private browsing) — persistence is a
    // convenience, never let it break the app.
    console.warn('[persistence] failed to save puzzle state:', err);
  }
}

export function loadPuzzleState(): PersistedPuzzle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPuzzle;
    if (parsed.version !== 1) return null;
    if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
      clearPuzzleState();
      return null;
    }
    if (!Array.isArray(parsed.board) || parsed.board.length !== 81) return null;
    return parsed;
  } catch (err) {
    console.warn('[persistence] failed to load puzzle state:', err);
    return null;
  }
}

export function clearPuzzleState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function emptyBoard(): Board {
  return EMPTY_BOARD.slice() as Board;
}

export interface SolverPrefs {
  algorithm: SolverAlgorithm;
  animateSolving: boolean;
}

const DEFAULT_PREFS: SolverPrefs = { algorithm: 'dlx', animateSolving: true };

export function loadPrefs(): SolverPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      algorithm: parsed.algorithm ?? DEFAULT_PREFS.algorithm,
      animateSolving: typeof parsed.animateSolving === 'boolean' ? parsed.animateSolving : DEFAULT_PREFS.animateSolving,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: SolverPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore — preference persistence is a convenience, not load-bearing
  }
}
