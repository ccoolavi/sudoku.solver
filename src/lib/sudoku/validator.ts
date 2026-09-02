import { Board, BoardValidation, rowOf, colOf, boxOf } from './types';

/**
 * Validates a Sudoku board against the standard rules:
 * no duplicate non-zero digits in any row, column, or 3x3 box.
 *
 * Returns an array of cell indices that conflict with at least one other cell.
 */
export function validateBoard(board: Board): BoardValidation {
  const conflicts: Array<{ index: number; reason: string }> = [];
  const conflictCells = new Set<number>();

  const groups: Array<{ type: string; indices: number[] }> = [];
  // Rows
  for (let r = 0; r < 9; r++) {
    groups.push({ type: 'row', indices: Array.from({ length: 9 }, (_, c) => r * 9 + c) });
  }
  // Cols
  for (let c = 0; c < 9; c++) {
    groups.push({ type: 'col', indices: Array.from({ length: 9 }, (_, r) => r * 9 + c) });
  }
  // Boxes
  for (let b = 0; b < 9; b++) {
    const indices: number[] = [];
    const br = Math.floor(b / 3) * 3;
    const bc = (b % 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) {
        indices.push((br + dr) * 9 + (bc + dc));
      }
    }
    groups.push({ type: 'box', indices });
  }

  for (const group of groups) {
    const map = new Map<number, number[]>();
    for (const idx of group.indices) {
      const v = board[idx];
      if (v === 0) continue;
      const arr = map.get(v) ?? [];
      arr.push(idx);
      map.set(v, arr);
    }
    for (const [digit, cells] of map.entries()) {
      if (cells.length > 1) {
        for (const idx of cells) {
          conflictCells.add(idx);
          conflicts.push({
            index: idx,
            reason: `Duplicate ${digit} in ${describeGroup(group.type, idx)}`,
          });
        }
      }
    }
  }

  if (conflictCells.size === 0) {
    return { valid: true, conflicts: [] };
  }

  return {
    valid: false,
    conflicts,
    message: `Found ${conflictCells.size} conflicting cell(s). Fix duplicates before solving.`,
  };
}

function describeGroup(type: string, idx: number): string {
  if (type === 'row') return `row ${rowOf(idx) + 1}`;
  if (type === 'col') return `col ${colOf(idx) + 1}`;
  return `box ${boxOf(idx) + 1}`;
}

/**
 * Returns true if the board is fully solved (all cells filled and valid).
 */
export function isComplete(board: Board): boolean {
  for (const v of board) {
    if (v === 0) return false;
  }
  return validateBoard(board).valid;
}
