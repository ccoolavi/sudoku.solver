// Re-export barrel for the sudoku engine so UI code has a single entry point.
export type { Board, CellValue, CellRecognition, SolverResult, BoardValidation } from './types';
export { EMPTY_BOARD, cloneBoard, boardFromDigits, rowOf, colOf, boxOf } from './types';
export { solveSudoku } from './solver';
export { validateBoard, isComplete } from './validator';
