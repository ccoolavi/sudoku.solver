import { Board, SolverResult } from './types';
import { validateBoard } from './validator';

/**
 * Dancing Links (DLX / Algorithm X) implementation for solving Sudoku.
 *
 * Sudoku is encoded as an Exact Cover problem with 4 constraint families:
 *  - Cell constraint: each cell must contain exactly one digit (81 constraints)
 *  - Row constraint: each row must contain each digit 1..9 exactly once (81 constraints)
 *  - Col constraint: each column must contain each digit 1..9 exactly once (81 constraints)
 *  - Box constraint: each 3x3 box must contain each digit 1..9 exactly once (81 constraints)
 *
 * Total: 324 columns. Each candidate placement (row, col, digit) covers exactly 4 columns,
 * yielding 729 candidate rows.
 *
 * Dancing Links uses a doubly-linked circular list of nodes for efficient cover/uncover
 * operations during backtracking search. The average Sudoku solves in <5ms with this
 * implementation.
 */

interface DLXNode {
  L: DLXNode;
  R: DLXNode;
  U: DLXNode;
  D: DLXNode;
  C: ColumnNode; // owning column header (for non-header nodes)
  row: number; // candidate row index (for non-header nodes); -1 for headers
  col: number; // column index
}

class ColumnNode implements DLXNode {
  L: DLXNode = this;
  R: DLXNode = this;
  U: DLXNode = this;
  D: DLXNode = this;
  C: ColumnNode = this;
  row = -1;
  col: number;
  size = 0;
  name: string;

  constructor(col: number, name: string) {
    this.col = col;
    this.name = name;
  }
}

class DataNode implements DLXNode {
  L: DLXNode;
  R: DLXNode;
  U: DLXNode;
  D: DLXNode;
  C: ColumnNode;
  row: number;
  col: number;

  constructor(row: number, col: number, header: ColumnNode) {
    this.row = row;
    this.col = col;
    this.C = header;
    this.L = this;
    this.R = this;
    this.U = this;
    this.D = this;
  }
}

const NUM_COLUMNS = 324; // 4 * 81
const BOARD_SIZE = 81;

function colIndexCell(cellIndex: number): number {
  return cellIndex; // 0..80
}
function colIndexRow(row: number, digit: number): number {
  return 81 + row * 9 + (digit - 1);
}
function colIndexCol(col: number, digit: number): number {
  return 162 + col * 9 + (digit - 1);
}
function colIndexBox(box: number, digit: number): number {
  return 243 + box * 9 + (digit - 1);
}

function buildDLX(): { root: ColumnNode; columns: ColumnNode[]; rows: DataNode[][] } {
  const root = new ColumnNode(-1, 'root');
  const columns: ColumnNode[] = [];

  // Build column headers chain
  let prev: ColumnNode = root;
  for (let c = 0; c < NUM_COLUMNS; c++) {
    const col = new ColumnNode(c, `c${c}`);
    col.L = prev;
    col.R = root;
    prev.R = col;
    root.L = col;
    prev = col;
    columns.push(col);
  }

  const rows: DataNode[][] = [];

  for (let cell = 0; cell < BOARD_SIZE; cell++) {
    const r = Math.floor(cell / 9);
    const c = cell % 9;
    const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

    for (let d = 1; d <= 9; d++) {
      const candidateRow = cell * 9 + (d - 1); // 0..728

      const colsForCandidate = [
        colIndexCell(cell),
        colIndexRow(r, d),
        colIndexCol(c, d),
        colIndexBox(b, d),
      ];

      const nodes: DataNode[] = [];
      for (const ci of colsForCandidate) {
        const header = columns[ci];
        const node = new DataNode(candidateRow, ci, header);
        // insert at bottom of column (above header)
        node.D = header;
        node.U = header.U;
        header.U.D = node;
        header.U = node;
        header.size++;
        nodes.push(node);
      }

      // link horizontally within this candidate row
      for (let i = 0; i < nodes.length; i++) {
        const left = nodes[(i - 1 + nodes.length) % nodes.length];
        const right = nodes[(i + 1) % nodes.length];
        nodes[i].L = left;
        nodes[i].R = right;
      }

      rows.push(nodes);
    }
  }

  return { root, columns, rows };
}

function cover(col: ColumnNode): void {
  col.R.L = col.L;
  col.L.R = col.R;
  for (let i = col.D as DLXNode; i !== col; i = i.D) {
    for (let j = i.R; j !== i; j = j.R) {
      j.D.U = j.U;
      j.U.D = j.D;
      j.C.size--;
    }
  }
}

function uncover(col: ColumnNode): void {
  for (let i = col.U as DLXNode; i !== col; i = i.U) {
    for (let j = i.L; j !== i; j = j.L) {
      j.C.size++;
      j.D.U = j;
      j.U.D = j;
    }
  }
  col.R.L = col;
  col.L.R = col;
}

function chooseColumn(root: ColumnNode): ColumnNode | null {
  let best: ColumnNode | null = null;
  let bestSize = Infinity;
  for (let c = root.R as ColumnNode; c !== root; c = c.R as ColumnNode) {
    if (c.size < bestSize) {
      bestSize = c.size;
      best = c;
      if (bestSize <= 1) break; // cannot do better
    }
  }
  return best;
}

/**
 * Pre-applies the givens by covering the columns associated with each given digit.
 * Returns the list of selected candidate rows for restoration on completion.
 */
function applyGivens(
  root: ColumnNode,
  rows: DataNode[][],
  board: Board,
): { ok: boolean; selected: number[]; reason?: string } {
  const selected: number[] = [];
  for (let cell = 0; cell < BOARD_SIZE; cell++) {
    const d = board[cell];
    if (d === 0) continue;
    const candidateRow = cell * 9 + (d - 1);
    const nodes = rows[candidateRow];
    // The candidate may have been covered already by another given's cover (illegal puzzle)
    // Check by seeing if any column already has size 0 / removed.
    // Easiest robust check: ensure all 4 columns are still in the active list
    // (i.e. their L/R pointers are wired normally to non-removed columns).
    // A simpler check is to try covering and detect duplicates: if two givens cover
    // the same column from different candidate rows, the second will find its node
    // already removed when traversing; we detect this by checking header.size after cover.

    let alreadyConflicting = false;
    for (const node of nodes) {
      // If the column header is no longer reachable from root, this column was already covered
      // by a previous given -> the givens conflict.
      let reachable = false;
      for (let c = root.R as ColumnNode; c !== root; c = c.R as ColumnNode) {
        if (c === node.C) {
          reachable = true;
          break;
        }
      }
      if (!reachable) {
        alreadyConflicting = true;
        break;
      }
    }
    if (alreadyConflicting) {
      return { ok: false, selected, reason: `Conflicting given at cell ${cell} (digit ${d})` };
    }

    // Cover all 4 columns of this candidate row.
    // Standard DLX "select row" procedure.
    for (const node of nodes) {
      cover(node.C);
    }
    selected.push(candidateRow);
  }
  return { ok: true, selected };
}

function search(
  root: ColumnNode,
  solution: number[],
  maxNodes: number,
  counter: { nodes: number },
): boolean {
  if (counter.nodes > maxNodes) return false;
  if (root.R === root) {
    return true; // all columns covered -> solved
  }
  const col = chooseColumn(root);
  if (!col || col.size === 0) return false; // dead end

  counter.nodes++;
  cover(col);
  for (let r = col.D as DLXNode; r !== col; r = r.D as DLXNode) {
    solution.push((r as DataNode).row);
    for (let j = r.R; j !== r; j = j.R) {
      cover((j as DataNode).C);
    }

    if (search(root, solution, maxNodes, counter)) {
      return true;
    }

    // backtrack
    for (let j = r.L; j !== r; j = j.L) {
      uncover((j as DataNode).C);
    }
    solution.pop();
  }
  uncover(col);
  return false;
}

/**
 * Solve a Sudoku board using DLX.
 *
 * @param board 81-cell row-major board (0 = blank)
 * @param maxNodes safety bound to prevent runaway search
 */
export function solveSudoku(board: Board, maxNodes = 200_000): SolverResult {
  const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Quick structural validation - reject duplicates up front so DLX does not silently fail.
  const validation = validateBoard(board);
  if (!validation.valid) {
    return {
      solved: false,
      diagnostics: validation.message ?? 'Board has conflicting givens.',
      elapsedMs: elapsedSince(start),
    };
  }

  const { root, rows } = buildDLX();
  const givenResult = applyGivens(root, rows, board);
  if (!givenResult.ok) {
    return {
      solved: false,
      diagnostics: givenResult.reason ?? 'Conflicting givens detected.',
      elapsedMs: elapsedSince(start),
    };
  }

  const solution: number[] = [];
  const counter = { nodes: 0 };
  const ok = search(root, solution, maxNodes, counter);

  if (!ok) {
    if (counter.nodes >= maxNodes) {
      return {
        solved: false,
        diagnostics: `Search exceeded node budget (${maxNodes}). Puzzle may be too hard or invalid.`,
        elapsedMs: elapsedSince(start),
      };
    }
    return {
      solved: false,
      diagnostics: 'No solution exists for the given puzzle (unsolvable).',
      elapsedMs: elapsedSince(start),
    };
  }

  const out: Board = Array.from({ length: 81 }, () => 0 as 0);
  for (const candidateRow of [...givenResult.selected, ...solution]) {
    const cell = Math.floor(candidateRow / 9);
    const d = (candidateRow % 9) + 1;
    out[cell] = d as 0;
  }

  return {
    solved: true,
    solution: out,
    elapsedMs: elapsedSince(start),
  };
}

function elapsedSince(start: number): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.max(0, Math.round((now - start) * 1000) / 1000);
}
