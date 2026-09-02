import { Board, CellValue, SolveStep, SolverResult, colOf, rowOf } from './types';
import { validateBoard } from './validator';

/**
 * "Human-style" solver: repeatedly applies the two logical techniques a
 * person actually uses on paper —
 *  - naked single: a cell has exactly one remaining candidate
 *  - hidden single: a digit has exactly one possible cell left within some
 *    row/column/box, even if that cell still has other candidates too
 * — until no more progress can be made purely by deduction. Most published
 * puzzles need at least one guess beyond that (that's normal, not a bug in
 * the technique set), so when stuck it falls back to a single MRV-ordered
 * guess and resumes logical deduction from there, backtracking on failure.
 *
 * This produces the most human-readable step captions of the three
 * algorithms, since each step names the actual technique used.
 */

interface Unit {
  kind: 'row' | 'column' | 'box';
  n: number; // 1-based row/col/box number, for captions
  indices: number[];
}

const UNITS: Unit[] = buildUnits();

function buildUnits(): Unit[] {
  const units: Unit[] = [];
  for (let r = 0; r < 9; r++) {
    units.push({ kind: 'row', n: r + 1, indices: Array.from({ length: 9 }, (_, c) => r * 9 + c) });
  }
  for (let c = 0; c < 9; c++) {
    units.push({ kind: 'column', n: c + 1, indices: Array.from({ length: 9 }, (_, r) => r * 9 + c) });
  }
  for (let b = 0; b < 9; b++) {
    const br = Math.floor(b / 3) * 3;
    const bc = (b % 3) * 3;
    const indices: number[] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) indices.push((br + dr) * 9 + (bc + dc));
    units.push({ kind: 'box', n: b + 1, indices });
  }
  return units;
}

const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const peers = new Set<number>();
  for (const unit of UNITS) if (unit.indices.includes(i)) for (const j of unit.indices) if (j !== i) peers.add(j);
  return Array.from(peers);
});

function candidatesFor(board: Board, index: number): CellValue[] {
  if (board[index] !== 0) return [];
  const used = new Set<number>();
  for (const p of PEERS[index]) if (board[p] !== 0) used.add(board[p]);
  const out: CellValue[] = [];
  for (let d = 1; d <= 9; d++) if (!used.has(d)) out.push(d as CellValue);
  return out;
}

function label(index: number): string {
  return `R${rowOf(index) + 1}C${colOf(index) + 1}`;
}

interface Ctx {
  steps: SolveStep[] | null;
  maxSteps: number;
  nodes: number;
  maxNodes: number;
}

function pushStep(ctx: Ctx, step: SolveStep): void {
  if (ctx.steps && ctx.steps.length < ctx.maxSteps) ctx.steps.push(step);
}

/** Applies naked + hidden singles in place until no more progress is possible. */
function propagate(b: Board, ctx: Ctx): void {
  let progress = true;
  while (progress) {
    progress = false;

    for (let i = 0; i < 81; i++) {
      if (b[i] !== 0) continue;
      const cands = candidatesFor(b, i);
      if (cands.length === 1) {
        b[i] = cands[0];
        progress = true;
        pushStep(ctx, {
          kind: 'place',
          index: i,
          digit: cands[0],
          message: `Naked single: ${label(i)} can only be ${cands[0]}`,
        });
      }
    }

    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        let count = 0;
        let foundIndex = -1;
        for (const idx of unit.indices) {
          if (b[idx] !== 0) continue;
          if (candidatesFor(b, idx).includes(d as CellValue)) {
            count++;
            foundIndex = idx;
          }
        }
        if (count === 1 && b[foundIndex] === 0) {
          b[foundIndex] = d as CellValue;
          progress = true;
          pushStep(ctx, {
            kind: 'place',
            index: foundIndex,
            digit: d as CellValue,
            message: `Hidden single: ${d} can only go in ${label(foundIndex)} within ${unit.kind} ${unit.n}`,
          });
        }
      }
    }
  }
}

function findBestCell(b: Board): {
  done: boolean;
  contradiction: boolean;
  index: number;
  candidates: CellValue[];
} {
  let bestIndex = -1;
  let best: CellValue[] | null = null;
  for (let i = 0; i < 81; i++) {
    if (b[i] !== 0) continue;
    const cands = candidatesFor(b, i);
    if (cands.length === 0) return { done: false, contradiction: true, index: i, candidates: [] };
    if (best === null || cands.length < best.length) {
      best = cands;
      bestIndex = i;
      if (cands.length === 1) break;
    }
  }
  if (bestIndex === -1) return { done: true, contradiction: false, index: -1, candidates: [] };
  return { done: false, contradiction: false, index: bestIndex, candidates: best! };
}

function solveRec(board: Board, ctx: Ctx): Board | null {
  if (ctx.nodes > ctx.maxNodes) return null;

  const b = board.slice() as Board;
  propagate(b, ctx);

  const info = findBestCell(b);
  if (info.contradiction) return null;
  if (info.done) return b;

  ctx.nodes++;
  for (const d of info.candidates) {
    pushStep(ctx, {
      kind: 'try',
      index: info.index,
      digit: d,
      message: `No logical move left — guessing ${d} at ${label(info.index)} (${info.candidates.length} options)`,
    });
    b[info.index] = d;

    const result = solveRec(b, ctx);
    if (result) return result;

    b[info.index] = 0;
    pushStep(ctx, {
      kind: 'remove',
      index: info.index,
      digit: d,
      message: `Guessing ${d} at ${label(info.index)} didn't pan out — undoing`,
    });
  }
  return null;
}

export function solveConstraintPropagation(
  board: Board,
  options: { recordSteps?: boolean; maxSteps?: number; maxNodes?: number } = {},
): SolverResult {
  const { recordSteps = false, maxSteps = 1000, maxNodes = 500_000 } = options;
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const validation = validateBoard(board);
  if (!validation.valid) {
    return {
      solved: false,
      diagnostics: validation.message ?? 'Board has conflicting givens.',
      elapsedMs: elapsedSince(start),
    };
  }

  const ctx: Ctx = { steps: recordSteps ? [] : null, maxSteps, nodes: 0, maxNodes };
  pushStep(ctx, { kind: 'note', index: -1, message: 'Scanning for naked and hidden singles…' });
  const result = solveRec(board, ctx);

  if (!result) {
    return {
      solved: false,
      diagnostics:
        ctx.nodes >= maxNodes
          ? `Search exceeded node budget (${maxNodes}). Puzzle may be too hard or invalid.`
          : 'No solution exists for the given puzzle (unsolvable).',
      elapsedMs: elapsedSince(start),
    };
  }

  return {
    solved: true,
    solution: result,
    elapsedMs: elapsedSince(start),
    steps: ctx.steps ?? undefined,
    algorithm: 'constraint-propagation',
  };
}

function elapsedSince(start: number): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.max(0, Math.round((now - start) * 1000) / 1000);
}
