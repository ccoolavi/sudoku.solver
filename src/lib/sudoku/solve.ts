import { Board, SolverAlgorithm, SolverResult } from './types';
import { solveSudoku as solveDLX } from './solver';
import { solveBacktracking } from './backtracking';
import { solveConstraintPropagation } from './constraint-propagation';

export const ALGORITHMS: Array<{ id: SolverAlgorithm; label: string; description: string }> = [
  { id: 'dlx', label: 'Dancing Links', description: 'Exact-cover search (Algorithm X) — the default, fastest to compute.' },
  { id: 'backtracking', label: 'Backtracking', description: 'Classic trial-and-error with a fewest-options-first heuristic.' },
  {
    id: 'constraint-propagation',
    label: 'Human-style',
    description: 'Naked & hidden singles first, guessing only when logic runs out.',
  },
];

export interface SolveOptions {
  algorithm?: SolverAlgorithm;
  recordSteps?: boolean;
  maxSteps?: number;
}

/** Runs the selected algorithm. DLX is the default (matches solveSudoku's prior default behavior). */
export function solve(board: Board, options: SolveOptions = {}): SolverResult {
  const { algorithm = 'dlx', recordSteps = false, maxSteps = 1000 } = options;
  switch (algorithm) {
    case 'backtracking':
      return solveBacktracking(board, { recordSteps, maxSteps });
    case 'constraint-propagation':
      return solveConstraintPropagation(board, { recordSteps, maxSteps });
    case 'dlx':
    default:
      return solveDLX(board, { recordSteps, maxSteps });
  }
}
