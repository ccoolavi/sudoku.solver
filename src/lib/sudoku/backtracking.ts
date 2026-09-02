import { Board, CellValue, SolveStep, SolverResult, colOf, rowOf } from './types';
import { validateBoard } from './validator';

/**
 * Classic constraint backtracking with a Minimum-Remaining-Values (MRV)
 * heuristic: always branch on the empty cell with the fewest legal candidates.
 * This keeps the number of guesses (and therefore the step trace) small even
 * on "hard" puzzles — typically tens, not thousands, of tries.
 *
 * Unlike DLX this is a plain, easy-to-follow trial-and-error search, which is
 * exactly what it looks like when animated: try a digit, recurse, and if that
 * leads nowhere, undo it and try the next one.
 */

const UNITS: number[][] = buildUnits();

function buildUnits(): number[][] {
  const units: number[][] = [];
  for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const br = Math.floor(b / 3) * 3;
    const bc = (b % 3) * 3;
    const indices: number[] = [];
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) indices.push((br + dr) * 9 + (bc + dc));
    units.push(indices);
  }
  return units;
}

/** Peer cells (same row, col, or box) for each cell index, precomputed once. */
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const peers = new Set<number>();
  for (const unit of UNITS) {
    if (unit.includes(i)) for (const j of unit) if (j !== i) peers.add(j);
  }
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

function backtrack(board: Board, ctx: Ctx): boolean {
  if (ctx.nodes > ctx.maxNodes) return false;

  let bestIndex = -1;
  let bestCandidates: CellValue[] | null = null;
  for (let i = 0; i < 81; i++) {
    if (board[i] !== 0) continue;
    const cands = candidatesFor(board, i);
    if (cands.length === 0) return false; // dead end, no legal digit for this cell
    if (bestCandidates === null || cands.length < bestCandidates.length) {
      bestCandidates = cands;
      bestIndex = i;
      if (cands.length === 1) break; // can't do better than a forced cell
    }
  }
  if (bestIndex === -1) return true; // no empty cells left -> solved

  ctx.nodes++;
  for (const d of bestCandidates!) {
    board[bestIndex] = d;
    if (ctx.steps && ctx.steps.length < ctx.maxSteps) {
      ctx.steps.push({
        kind: 'try',
        index: bestIndex,
        digit: d,
        message:
          bestCandidates!.length === 1
            ? `Only ${d} fits at ${label(bestIndex)} — placing it`
            : `Trying ${d} at ${label(bestIndex)} (${bestCandidates!.length} options)`,
      });
    }

    if (backtrack(board, ctx)) return true;

    board[bestIndex] = 0;
    if (ctx.steps && ctx.steps.length < ctx.maxSteps) {
      ctx.steps.push({
        kind: 'remove',
        index: bestIndex,
        digit: d,
        message: `${d} at ${label(bestIndex)} leads to a dead end — undoing it`,
      });
    }
  }
  return false;
}

export function solveBacktracking(
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

  const working = board.slice() as Board;
  const steps: SolveStep[] | null = recordSteps ? [] : null;
  const ctx: Ctx = { steps, maxSteps, nodes: 0, maxNodes };
  const ok = backtrack(working, ctx);

  if (!ok) {
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
    solution: working,
    elapsedMs: elapsedSince(start),
    steps: steps ?? undefined,
    algorithm: 'backtracking',
  };
}

function elapsedSince(start: number): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.max(0, Math.round((now - start) * 1000) / 1000);
}
