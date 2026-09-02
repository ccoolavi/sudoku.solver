'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, rowOf, colOf } from '@/lib/sudoku/types';
import { Button } from '@/components/ui/button';
import { Eye, Grid3x3, Copy, Download, RotateCcw, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadBoardAsJSON, shareOrDownloadSolutionPNG } from '@/lib/export';

export interface SolutionViewProps {
  /** The original givens (0 = blank). */
  givens: Board;
  /** The full solution (all 81 cells filled). */
  solution: Board;
  /** The warped board preview ImageData (top-down view) for augmented overlay. */
  warpedPreview?: ImageData | null;
}

/**
 * Renders the solved Sudoku. Two visualization modes:
 *   1. Grid view: classic 9x9 grid with givens in bold black, solved digits in blue.
 *   2. Augmented view: overlays solved digits in red directly on the warped board image.
 *
 * Includes "Copy Grid State" and "Reset" actions.
 */
export function SolutionView({ givens, solution, warpedPreview }: SolutionViewProps) {
  const [view, setView] = useState<'grid' | 'augmented'>('grid');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const warpedUrl = useMemo(() => {
    if (!warpedPreview) return null;
    const canvas = document.createElement('canvas');
    canvas.width = warpedPreview.width;
    canvas.height = warpedPreview.height;
    canvas.getContext('2d')!.putImageData(warpedPreview, 0, 0);
    return canvas.toDataURL('image/png');
  }, [warpedPreview]);

  useEffect(() => {
    if (view !== 'augmented' || !warpedPreview || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = warpedPreview.width;
    canvas.height = warpedPreview.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(warpedPreview, 0, 0);

    const cellSize = warpedPreview.width / 9;
    ctx.font = `bold ${Math.floor(cellSize * 0.55)}px var(--font-geist-mono), monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dc2626'; // red-600

    for (let i = 0; i < 81; i++) {
      const given = givens[i];
      if (given !== 0) continue; // only draw solved digits
      const sol = solution[i];
      if (sol === 0) continue;
      const r = rowOf(i);
      const c = colOf(i);
      const x = c * cellSize + cellSize / 2;
      const y = r * cellSize + cellSize / 2;
      ctx.fillText(String(sol), x, y);
    }
  }, [view, warpedPreview, givens, solution]);

  const copyState = async () => {
    const text = Array.from({ length: 9 }, (_, r) =>
      Array.from({ length: 9 }, (_, c) => {
        const v = solution[r * 9 + c];
        return v === 0 ? '.' : String(v);
      }).join(''),
    ).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Solution copied to clipboard');
    } catch {
      toast.error('Could not access clipboard');
    }
  };

  const [exporting, setExporting] = useState(false);

  const exportImage = async () => {
    setExporting(true);
    try {
      const result = await shareOrDownloadSolutionPNG(givens, solution);
      toast.success(result === 'shared' ? 'Shared' : 'Image downloaded');
    } catch {
      toast.error('Could not export image');
    } finally {
      setExporting(false);
    }
  };

  const exportJSON = () => {
    downloadBoardAsJSON(givens, solution);
    toast.success('Puzzle downloaded as JSON');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          variant={view === 'grid' ? 'default' : 'outline'}
          onClick={() => setView('grid')}
          className="flex-1"
        >
          <Grid3x3 className="size-4" /> Grid
        </Button>
        <Button
          variant={view === 'augmented' ? 'default' : 'outline'}
          onClick={() => setView('augmented')}
          disabled={!warpedPreview}
          className="flex-1"
        >
          <Eye className="size-4" /> Augmented
        </Button>
      </div>

      {view === 'grid' ? (
        <div
          className="grid grid-cols-9 gap-0 rounded-lg overflow-hidden border-2 border-foreground bg-foreground"
          style={{ aspectRatio: '1 / 1' }}
          role="grid"
          aria-label="Solved Sudoku board"
        >
          {solution.map((v, i) => {
            const r = rowOf(i);
            const c = colOf(i);
            const isGiven = givens[i] !== 0;
            const borderClasses = [
              'border',
              r % 3 === 0 && r !== 0 ? 'border-t-2' : 'border-t',
              c % 3 === 0 && c !== 0 ? 'border-l-2' : 'border-l',
              r === 8 ? 'border-b-2' : '',
              c === 8 ? 'border-r-2' : '',
            ].join(' ');
            const bg = isGiven ? 'bg-background' : 'bg-blue-50 dark:bg-blue-950/30';
            const text = isGiven ? 'text-foreground' : 'text-blue-600 dark:text-blue-400';
            return (
              <div
                key={i}
                className={`flex items-center justify-center ${borderClasses} ${bg} ${text}`}
                style={{
                  fontSize: 'clamp(1rem, 3.5vw, 1.6rem)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-geist-mono), monospace',
                }}
              >
                {v === 0 ? '' : v}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border">
          {warpedUrl && (
            <img src={warpedUrl} alt="Warped board preview" className="absolute inset-0 size-full object-contain" />
          )}
          <canvas ref={canvasRef} className="absolute inset-0 size-full object-contain" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={copyState} variant="outline">
          <Copy className="size-4" /> Copy text
        </Button>
        <Button onClick={exportImage} variant="outline" disabled={exporting}>
          <Share2 className="size-4" /> {exporting ? 'Exporting…' : 'Share / Save image'}
        </Button>
        <Button onClick={exportJSON} variant="outline">
          <Download className="size-4" /> Download JSON
        </Button>
        <Button
          onClick={() => {
            const event = new CustomEvent('sudoku-reset');
            window.dispatchEvent(event);
          }}
          variant="outline"
        >
          <RotateCcw className="size-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
