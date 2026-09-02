'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Board, CellValue, rowOf, colOf, boxOf } from '@/lib/sudoku/types';
import { cn } from '@/lib/utils';

export interface EditableGridProps {
  /** 81-cell row-major board (0 = blank). */
  value: Board;
  /** Cell indices that are recognized from the image (highlighted as "given"). */
  recognizedIndices?: Set<number>;
  /** Cell indices that are in conflict (highlighted as error). */
  conflictIndices?: Set<number>;
  /** Cell indices that were filled by the solver (highlighted as "solved"). */
  solvedIndices?: Set<number>;
  /** Cell currently being animated during solve replay (pulses amber). */
  activeIndex?: number | null;
  /** Per-cell OCR confidence (0..1). Used to render a subtle indicator. */
  confidence?: Array<number | undefined>;
  /** Disable editing (e.g., during processing). */
  readOnly?: boolean;
  /** Called when the user edits a cell. */
  onChange?: (index: number, value: CellValue) => void;
}

/**
 * 9x9 interactive Sudoku grid. Cells can be clicked to focus, then edited via
 * keyboard (1-9 to set, 0/Backspace/Delete to clear, arrow keys to move) or via
 * the on-screen keypad below the grid — needed on touch devices, which have no
 * reliable way to send keydown events without a hardware keyboard.
 *
 * Visual conventions:
 *  - empty cell: faint dashed border
 *  - given (recognized) cell: bold dark text on neutral background
 *  - solved cell: blue text
 *  - conflict cell: red text on red-tinted background
 *  - low-confidence recognized cell: amber underline
 */
export function EditableGrid({
  value,
  recognizedIndices,
  conflictIndices,
  solvedIndices,
  activeIndex,
  confidence,
  readOnly,
  onChange,
}: EditableGridProps) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const focusRef = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  useEffect(() => {
    if (focusRef.current != null) {
      refs.current[focusRef.current]?.focus();
      focusRef.current = null;
    }
  }, [value]);

  const announce = useCallback((idx: number, v: CellValue) => {
    const r = rowOf(idx);
    const c = colOf(idx);
    setLiveMessage(`Row ${r + 1}, column ${c + 1}: ${v === 0 ? 'cleared' : v}`);
  }, []);

  const setCell = useCallback(
    (idx: number, v: CellValue) => {
      onChange?.(idx, v);
      announce(idx, v);
    },
    [onChange, announce],
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, idx: number) => {
      const r = rowOf(idx);
      const c = colOf(idx);
      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowUp':
          nextIdx = r > 0 ? (r - 1) * 9 + c : null;
          break;
        case 'ArrowDown':
          nextIdx = r < 8 ? (r + 1) * 9 + c : null;
          break;
        case 'ArrowLeft':
          nextIdx = c > 0 ? r * 9 + c - 1 : null;
          break;
        case 'ArrowRight':
          nextIdx = c < 8 ? r * 9 + c + 1 : null;
          break;
        case 'Backspace':
        case 'Delete':
        case '0':
          setCell(idx, 0);
          e.preventDefault();
          return;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          setCell(idx, parseInt(e.key, 10) as CellValue);
          e.preventDefault();
          return;
        default:
          return;
      }
      if (nextIdx != null) {
        e.preventDefault();
        focusRef.current = nextIdx;
        refs.current[nextIdx]?.focus();
      }
    },
    [setCell],
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid grid-cols-9 gap-0 rounded-lg overflow-hidden border-2 border-foreground bg-foreground select-none touch-manipulation"
        style={{ aspectRatio: '1 / 1' }}
        role="grid"
        aria-label="Sudoku board"
      >
        {value.map((v, i) => {
          const r = rowOf(i);
          const c = colOf(i);
          const b = boxOf(i);
          const isGiven = recognizedIndices?.has(i) ?? false;
          const isSolved = solvedIndices?.has(i) ?? false;
          const isConflict = conflictIndices?.has(i) ?? false;
          const isFocused = focusedIndex === i;
          const isActive = activeIndex === i;
          const conf = confidence?.[i];

          // Thick borders between 3x3 boxes
          const borderClasses = [
            'border',
            r % 3 === 0 && r !== 0 ? 'border-t-2' : 'border-t',
            c % 3 === 0 && c !== 0 ? 'border-l-2' : 'border-l',
            r === 8 ? 'border-b-2' : '',
            c === 8 ? 'border-r-2' : '',
          ].join(' ');

          const bg = isActive
            ? 'bg-amber-200 dark:bg-amber-500/30'
            : isConflict
            ? 'bg-red-100 dark:bg-red-950/40'
            : isSolved
            ? 'bg-blue-50 dark:bg-blue-950/30'
            : isGiven
            ? 'bg-background'
            : isFocused
            ? 'bg-primary/10'
            : 'bg-muted/30';

          const text = isConflict
            ? 'text-red-600 dark:text-red-400'
            : isSolved
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-foreground';

          return (
            <div
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="gridcell"
              aria-label={`Row ${r + 1}, column ${c + 1}, box ${b + 1}: ${v === 0 ? 'empty' : v}`}
              aria-selected={isFocused}
              tabIndex={readOnly ? -1 : 0}
              onClick={() => !readOnly && refs.current[i]?.focus()}
              onFocus={() => setFocusedIndex(i)}
              onKeyDown={(e) => !readOnly && handleKey(e, i)}
              className={cn(
                'relative flex min-h-11 items-center justify-center outline-none transition-colors duration-150',
                'focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10',
                isActive && 'z-10 ring-2 ring-amber-500 scale-105',
                borderClasses,
                bg,
                text,
                readOnly ? 'cursor-default' : 'cursor-pointer',
              )}
              style={{
                fontSize: 'clamp(1rem, 3.5vw, 1.6rem)',
                fontWeight: isGiven || isSolved ? 600 : 400,
                fontFamily: 'var(--font-geist-mono), monospace',
              }}
            >
              {v === 0 ? '' : v}
              {isGiven && conf != null && conf > 0 && conf < 0.85 && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-500"
                  title={`Low confidence: ${Math.round(conf * 100)}%`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {!readOnly && (
        <Keypad
          disabled={focusedIndex == null}
          onDigit={(d) => {
            if (focusedIndex == null) return;
            setCell(focusedIndex, d);
          }}
          onClear={() => {
            if (focusedIndex == null) return;
            setCell(focusedIndex, 0);
          }}
        />
      )}
    </div>
  );
}

/**
 * On-screen number pad — the only way to enter digits on touch devices, which
 * don't reliably fire keydown events without a hardware keyboard attached.
 */
function Keypad({
  disabled,
  onDigit,
  onClear,
}: {
  disabled: boolean;
  onDigit: (d: CellValue) => void;
  onClear: () => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:hidden" aria-label="Digit entry pad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button
          key={d}
          type="button"
          disabled={disabled}
          onClick={() => onDigit(d as CellValue)}
          className="flex h-11 items-center justify-center rounded-md border bg-background text-base font-medium text-foreground transition-colors disabled:opacity-40 active:bg-primary/10"
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={onClear}
        aria-label="Clear cell"
        className="flex h-11 items-center justify-center rounded-md border bg-background text-foreground transition-colors disabled:opacity-40 active:bg-primary/10"
      >
        <Delete className="size-4" />
      </button>
    </div>
  );
}
