// Core Sudoku types shared across the app.

export type CellValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Board = CellValue[]; // length 81, row-major (row * 9 + col)

export type SolverAlgorithm = 'dlx' | 'backtracking' | 'constraint-propagation';

/**
 * One event in a solver's step trace, replayed by the UI as an animation.
 *  - 'try': tentatively places `digit` at `index` (may later be undone by 'remove')
 *  - 'place': places `digit` at `index` with logical certainty (never undone)
 *  - 'remove': undoes a previous 'try' at `index` (dead end / backtrack)
 *  - 'note': no board change, just a caption (e.g. "Starting logical pass")
 */
export interface SolveStep {
  kind: 'try' | 'place' | 'remove' | 'note';
  index: number;
  digit?: CellValue;
  message: string;
}

export interface SolverResult {
  solved: boolean;
  solution?: Board;
  diagnostics?: string;
  elapsedMs: number;
  /** Step-by-step trace for animated replay, in solve order. */
  steps?: SolveStep[];
  algorithm?: SolverAlgorithm;
}

export interface CellRecognition {
  index: number;
  digit: CellValue; // 0 means blank
  confidence: number; // 0..1
}

export interface BoardValidation {
  valid: boolean;
  conflicts: Array<{ index: number; reason: string }>;
  message?: string;
}

export const EMPTY_BOARD: Board = Array.from({ length: 81 }, () => 0 as CellValue);

export function cloneBoard(board: Board): Board {
  return board.slice() as Board;
}

export function boardFromDigits(digits: number[]): Board {
  if (digits.length !== 81) {
    throw new Error(`Board must have exactly 81 cells, got ${digits.length}`);
  }
  return digits.map((d) => {
    if (d < 0 || d > 9 || !Number.isInteger(d)) {
      throw new Error(`Invalid cell value: ${d}`);
    }
    return d as CellValue;
  });
}

export function rowOf(index: number): number {
  return Math.floor(index / 9);
}

export function colOf(index: number): number {
  return index % 9;
}

export function boxOf(index: number): number {
  const r = rowOf(index);
  const c = colOf(index);
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}
