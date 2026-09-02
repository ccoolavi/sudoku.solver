import { Board, colOf, rowOf } from '@/lib/sudoku/types';

/** Serialize a board to an 81-char string, '.' for blanks (standard Sudoku text format). */
export function boardToDigitString(board: Board): string {
  return board.map((v) => (v === 0 ? '.' : String(v))).join('');
}

/** Parse an 81-char digit string (0/. for blanks) back into a Board. Returns null if invalid. */
export function digitStringToBoard(text: string): Board | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned.length !== 81) return null;
  return cleaned.split('').map((c) => (c === '.' ? 0 : parseInt(c, 10))) as Board;
}

export async function copyBoardAsText(board: Board): Promise<void> {
  await navigator.clipboard.writeText(boardToDigitString(board));
}

/** Renders the solved board (givens in black, solved digits in blue) to a PNG blob. */
export function renderSolutionPNG(
  givens: Board,
  solution: Board,
  size = 900,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const cell = size / 9;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.floor(cell * 0.5)}px ui-monospace, "SF Mono", Menlo, monospace`;

  for (let i = 0; i < 81; i++) {
    const r = rowOf(i);
    const c = colOf(i);
    const v = solution[i];
    if (v === 0) continue;
    ctx.fillStyle = givens[i] !== 0 ? '#0a0a0a' : '#2563eb';
    ctx.fillText(String(v), c * cell + cell / 2, r * cell + cell / 2 + 1);
  }

  // Grid lines
  ctx.strokeStyle = '#0a0a0a';
  for (let i = 0; i <= 9; i++) {
    const w = i % 3 === 0 ? 4 : 1;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to render PNG'));
    }, 'image/png');
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Downloads the solved grid as a PNG. Uses the Web Share API on mobile when available. */
export async function shareOrDownloadSolutionPNG(givens: Board, solution: Board): Promise<'shared' | 'downloaded'> {
  const blob = await renderSolutionPNG(givens, solution);
  const filename = `sudoku-solution-${Date.now()}.png`;

  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Sudoku solution' });
        return 'shared';
      } catch (err) {
        // User cancelled the share sheet — fall through to download.
        if ((err as DOMException)?.name === 'AbortError') return 'downloaded';
      }
    }
  }

  triggerBlobDownload(blob, filename);
  return 'downloaded';
}

/** Downloads the puzzle (givens + solution + metadata) as a JSON file. */
export function downloadBoardAsJSON(
  givens: Board,
  solution: Board | null,
  meta: Record<string, unknown> = {},
): void {
  const payload = {
    givens: boardToDigitString(givens),
    solution: solution ? boardToDigitString(solution) : null,
    exportedAt: new Date().toISOString(),
    ...meta,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerBlobDownload(blob, `sudoku-${Date.now()}.json`);
}
