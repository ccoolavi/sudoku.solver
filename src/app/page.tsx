'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CapturePanel } from '@/components/sudoku/CapturePanel';
import { EditableGrid } from '@/components/sudoku/EditableGrid';
import { SolutionView } from '@/components/sudoku/SolutionView';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Camera,
  CheckCircle2,
  ClipboardPaste,
  FastForward,
  Hash,
  History,
  ImageIcon,
  PencilLine,
  ScanLine,
  Sparkles,
  Trash2,
  Trophy,
  Wand2,
  WifiOff,
} from 'lucide-react';
import { ALGORITHMS, Board, CellValue, EMPTY_BOARD, SolveStep, SolverAlgorithm, solve } from '@/lib/sudoku/solver-wrapper';
import { validateBoard } from '@/lib/sudoku/validator';
import { extractBoard, imageDataToCanvas } from '@/lib/cv/processImage';
import { recognizeCells } from '@/lib/ocr/recognizer';
import {
  clearPuzzleState,
  loadPrefs,
  loadPuzzleState,
  PersistedPuzzle,
  savePrefs,
  savePuzzleState,
} from '@/lib/persistence/localStorage';

type Stage = 'capture' | 'processing' | 'review' | 'solving' | 'solved';

const SAMPLE_PUZZLES: Array<{ name: string; givens: string }> = [
  {
    name: 'Easy',
    givens:
      '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  },
  {
    name: 'Medium',
    givens:
      '000260701680070090190004500820100040004602900050003028009300074040050036703018000',
  },
  {
    name: 'Hard',
    givens:
      '800000000003600000070090200050007000000045700000100030001000068008500010090000400',
  },
];

export default function Home() {
  const [stage, setStage] = useState<Stage>('capture');
  const [cvProgress, setCvProgress] = useState<string>('');
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number }>({ done: 0, total: 81 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [warpedPreview, setWarpedPreview] = useState<ImageData | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD.slice() as Board);
  const [confidence, setConfidence] = useState<Array<number | undefined>>(Array(81));
  const [recognizedSet, setRecognizedSet] = useState<Set<number>>(new Set());
  const [solution, setSolution] = useState<Board | null>(null);
  const [solvedSet, setSolvedSet] = useState<Set<number>>(new Set());
  const [solverMeta, setSolverMeta] = useState<{ elapsedMs: number; algorithm: SolverAlgorithm } | null>(null);

  // Algorithm choice + animate-solving toggle, remembered across sessions.
  const [prefs, setPrefsState] = useState(() => loadPrefs());
  const algorithm = prefs.algorithm;
  const animateSolving = prefs.animateSolving;
  const setAlgorithm = useCallback((a: SolverAlgorithm) => {
    setPrefsState((p) => {
      const next = { ...p, algorithm: a };
      savePrefs(next);
      return next;
    });
  }, []);
  const setAnimateSolving = useCallback((v: boolean) => {
    setPrefsState((p) => {
      const next = { ...p, animateSolving: v };
      savePrefs(next);
      return next;
    });
  }, []);

  // Solve animation: `solve()` always runs at full computer speed — these
  // only replay its recorded step trace at a human-watchable pace afterward.
  const [solvingSteps, setSolvingSteps] = useState<SolveStep[] | null>(null);
  const [solvingIndex, setSolvingIndex] = useState(0);
  const [liveBoard, setLiveBoard] = useState<Board | null>(null);
  const [liveCaption, setLiveCaption] = useState('');
  const [liveActiveIndex, setLiveActiveIndex] = useState<number | null>(null);
  const [pendingSolution, setPendingSolution] = useState<Board | null>(null);
  const [pendingMeta, setPendingMeta] = useState<{ elapsedMs: number; algorithm: SolverAlgorithm } | null>(null);

  // Offer to resume a previous session's puzzle (survives closing the browser —
  // it's read from localStorage, not from a server, so this works fully offline).
  // Lazy initializer instead of an effect: loadPuzzleState() already guards on
  // `typeof window`, so this is safe during the static-export prerender too.
  const [resumeAvailable, setResumeAvailable] = useState<PersistedPuzzle | null>(() => loadPuzzleState());

  // Surface offline status: everything still works without a network (that's the
  // point of the PWA), but it's reassuring to confirm rather than leave it silent.
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Auto-save review/solved state to localStorage (debounced) so a puzzle in
  // progress survives an accidental tab close or browser restart.
  useEffect(() => {
    if (stage !== 'review' && stage !== 'solved') return;
    const handle = window.setTimeout(() => {
      const warpedPreviewDataUrl = warpedPreview ? imageDataToCanvas(warpedPreview).toDataURL('image/png') : null;
      savePuzzleState({
        stage,
        board,
        confidence,
        recognizedIndices: Array.from(recognizedSet),
        solution,
        solvedIndices: Array.from(solvedSet),
        solverElapsedMs: solverMeta?.elapsedMs ?? null,
        solverAlgorithm: solverMeta?.algorithm ?? null,
        warpedPreviewDataUrl,
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [stage, board, confidence, recognizedSet, solution, solvedSet, solverMeta, warpedPreview]);

  const resumePuzzle = useCallback((saved: PersistedPuzzle) => {
    setBoard(saved.board);
    setConfidence(saved.confidence);
    setRecognizedSet(new Set(saved.recognizedIndices));
    setSolution(saved.solution);
    setSolvedSet(new Set(saved.solvedIndices));
    setSolverMeta(
      saved.solverElapsedMs != null
        ? { elapsedMs: saved.solverElapsedMs, algorithm: saved.solverAlgorithm ?? 'dlx' }
        : null,
    );
    if (saved.warpedPreviewDataUrl) {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        setWarpedPreview(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.src = saved.warpedPreviewDataUrl;
    }
    setStage(saved.stage);
    setResumeAvailable(null);
    toast.success('Resumed your last puzzle');
  }, []);

  const dismissResume = useCallback(() => {
    clearPuzzleState();
    setResumeAvailable(null);
  }, []);

  const reset = useCallback(() => {
    clearPuzzleState();
    setStage('capture');
    setWarpedPreview(null);
    setBoard(EMPTY_BOARD.slice() as Board);
    setConfidence(Array(81));
    setRecognizedSet(new Set());
    setSolution(null);
    setSolvedSet(new Set());
    setSolverMeta(null);
    setErrorMsg(null);
    setCvProgress('');
    setOcrProgress({ done: 0, total: 81 });
    setSolvingSteps(null);
    setSolvingIndex(0);
    setLiveBoard(null);
    setLiveActiveIndex(null);
    setLiveCaption('');
    setPendingSolution(null);
    setPendingMeta(null);
  }, []);

  // Listen for "Reset" events from SolutionView
  useEffect(() => {
    const handler = () => reset();
    window.addEventListener('sudoku-reset', handler);
    return () => window.removeEventListener('sudoku-reset', handler);
  }, [reset]);

  const validation = useMemo(() => validateBoard(board), [board]);
  const conflictSet = useMemo(
    () => new Set(validation.conflicts.map((c) => c.index)),
    [validation],
  );
  // Cells the animation has placed so far that weren't originally given —
  // drives the blue "solved" styling on the live grid during playback.
  const liveSolvedIndices = useMemo(() => {
    if (!liveBoard) return new Set<number>();
    const s = new Set<number>();
    for (let i = 0; i < 81; i++) {
      if (liveBoard[i] !== 0 && !recognizedSet.has(i)) s.add(i);
    }
    return s;
  }, [liveBoard, recognizedSet]);

  const handleCapture = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setStage('processing');
      setErrorMsg(null);
      setCvProgress('starting');
      setOcrProgress({ done: 0, total: 81 });

      try {
        const result = await extractBoard(canvas, (stage) => setCvProgress(stage));
        setWarpedPreview(result.warped);

        const recs = await recognizeCells(result.cells, {
          confidenceThreshold: 0.4,
          onProgress: (done, total) => setOcrProgress({ done, total }),
        });

        const newBoard: Board = EMPTY_BOARD.slice() as Board;
        const newConf: Array<number | undefined> = Array(81);
        const newRec = new Set<number>();
        for (const r of recs) {
          newBoard[r.index] = r.digit;
          newConf[r.index] = r.confidence;
          if (r.digit !== 0) newRec.add(r.index);
        }
        setBoard(newBoard);
        setConfidence(newConf);
        setRecognizedSet(newRec);
        setStage('review');

        const filledCount = recs.filter((r) => r.digit !== 0).length;
        toast.success(`Detected ${filledCount} / 81 cells`);
      } catch (err: any) {
        setErrorMsg(err?.message ?? 'Failed to process image.');
        setStage('capture');
      }
    },
    [],
  );

  const handleSolve = useCallback(() => {
    const v = validateBoard(board);
    if (!v.valid) {
      toast.error(v.message ?? 'Board has conflicts.');
      return;
    }
    // The solve itself always runs at full speed regardless of the animate
    // toggle — recordSteps just also captures a trace of it for replay.
    // High cap: the tick-batching in the playback effect keeps total watch
    // time bounded regardless of trace length, so there's no need to
    // truncate the trace itself (truncating would cause a jarring instant
    // jump to the final board once the recorded steps run out).
    const result = solve(board, { algorithm, recordSteps: animateSolving, maxSteps: 50_000 });
    if (!result.solved || !result.solution) {
      toast.error(result.diagnostics ?? 'Could not solve the puzzle.');
      setErrorMsg(result.diagnostics ?? 'Could not solve the puzzle.');
      return;
    }

    if (!animateSolving || !result.steps || result.steps.length === 0) {
      const solved = new Set<number>();
      for (let i = 0; i < 81; i++) {
        if (board[i] === 0 && result.solution[i] !== 0) solved.add(i);
      }
      setSolution(result.solution);
      setSolvedSet(solved);
      setSolverMeta({ elapsedMs: result.elapsedMs, algorithm });
      setStage('solved');
      toast.success(`Solved in ${result.elapsedMs} ms`);
      return;
    }

    setPendingSolution(result.solution);
    setPendingMeta({ elapsedMs: result.elapsedMs, algorithm });
    setSolvingSteps(result.steps);
    setSolvingIndex(0);
    setLiveBoard(board.slice() as Board);
    setLiveCaption('Starting…');
    setLiveActiveIndex(null);
    setStage('solving');
  }, [board, algorithm, animateSolving]);

  const finishSolving = useCallback(() => {
    if (pendingSolution) {
      const solved = new Set<number>();
      for (let i = 0; i < 81; i++) {
        if (board[i] === 0 && pendingSolution[i] !== 0) solved.add(i);
      }
      setSolution(pendingSolution);
      setSolvedSet(solved);
      setSolverMeta(pendingMeta);
      toast.success(`Solved in ${pendingMeta?.elapsedMs ?? 0} ms`);
    }
    setSolvingSteps(null);
    setSolvingIndex(0);
    setLiveBoard(null);
    setLiveActiveIndex(null);
    setLiveCaption('');
    setPendingSolution(null);
    setPendingMeta(null);
    setStage('solved');
  }, [board, pendingSolution, pendingMeta]);

  // Plays back the recorded step trace at a human-watchable pace, with total
  // playback time kept bounded regardless of trace length (2.5s-18s).
  //
  // Two regimes, chosen per-solve from the actual trace length:
  //  - Short/typical traces (a DLX solve is usually ~1 step per filled cell,
  //    so ~50-80 steps): one step per tick, ticking at ~140ms — a relaxed,
  //    individually-readable pace.
  //  - Long backtracking-heavy traces (a hard puzzle can need thousands of
  //    try/remove events): a single 140ms-per-step pace would take minutes,
  //    so instead the tick rate is floored at 40ms and multiple steps are
  //    applied per tick, batched just enough that the whole trace still
  //    finishes within the time budget — still visibly stepping through the
  //    board rather than jumping straight to the answer.
  useEffect(() => {
    if (stage !== 'solving' || !solvingSteps) return;
    if (solvingIndex >= solvingSteps.length) {
      const handle = window.setTimeout(finishSolving, 0);
      return () => window.clearTimeout(handle);
    }

    const total = solvingSteps.length;
    const targetTotalMs = Math.max(2500, Math.min(18000, total * 140));
    const idealPerStepMs = targetTotalMs / total;
    const MIN_TICK_MS = 40;
    const tickMs = idealPerStepMs >= MIN_TICK_MS ? idealPerStepMs : MIN_TICK_MS;
    const stepsPerTick =
      idealPerStepMs >= MIN_TICK_MS ? 1 : Math.max(1, Math.ceil((total * MIN_TICK_MS) / targetTotalMs));

    const timer = window.setTimeout(() => {
      const end = Math.min(solvingIndex + stepsPerTick, total);
      let lastMessage = '';
      let lastIndex: number | null = null;
      setLiveBoard((prev) => {
        if (!prev) return prev;
        const next = prev.slice() as Board;
        for (let i = solvingIndex; i < end; i++) {
          const step = solvingSteps[i];
          if (step.kind === 'try' || step.kind === 'place') {
            if (step.digit != null) next[step.index] = step.digit;
            lastIndex = step.index;
          } else if (step.kind === 'remove') {
            next[step.index] = 0;
            lastIndex = step.index;
          }
          lastMessage = step.message;
        }
        return next;
      });
      setLiveActiveIndex(lastIndex);
      setLiveCaption(lastMessage);
      setSolvingIndex(end);
    }, tickMs);

    return () => window.clearTimeout(timer);
  }, [stage, solvingSteps, solvingIndex, finishSolving]);

  const loadSample = useCallback((givens: string) => {
    const digits = givens.split('').map((c) => parseInt(c, 10));
    if (digits.length !== 81) return;
    setBoard(digits as Board);
    setRecognizedSet(new Set(digits.map((d, i) => (d !== 0 ? i : -1)).filter((i) => i >= 0)));
    setConfidence(Array(81).fill(1));
    setWarpedPreview(null);
    setSolution(null);
    setSolvedSet(new Set());
    setSolverMeta(null);
    setErrorMsg(null);
    setStage('review');
  }, []);

  const setCell = useCallback((idx: number, v: CellValue) => {
    setBoard((prev) => {
      const next = prev.slice() as Board;
      next[idx] = v;
      return next;
    });
    setRecognizedSet((prev) => {
      const next = new Set(prev);
      if (v === 0) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = text.replace(/[^0-9.]/g, '');
      if (cleaned.length !== 81) {
        toast.error('Clipboard text must contain exactly 81 digits (use . for blanks).');
        return;
      }
      const digits = cleaned.split('').map((c) => (c === '.' ? 0 : parseInt(c, 10)));
      setBoard(digits as Board);
      setRecognizedSet(new Set(digits.map((d, i) => (d !== 0 ? i : -1)).filter((i) => i >= 0)));
      setConfidence(Array(81).fill(1));
      setWarpedPreview(null);
      setStage('review');
      toast.success('Puzzle loaded from clipboard');
    } catch {
      toast.error('Could not read clipboard.');
    }
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        {/* Header */}
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Hash className="size-5" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Sudoku Vision Solver</h1>
                {isOffline && (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <WifiOff className="size-3" /> Offline — still fully functional
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                100% client-side: OpenCV.js + Tesseract.js + Dancing Links solver — your photos never leave your browser.
              </p>
            </div>
          </div>
          <Stepper stage={stage} />
        </header>

        {/* Main */}
        <section className="flex-1">
          {resumeAvailable && stage === 'capture' && (
            <Alert className="mb-4">
              <History className="size-4" />
              <AlertTitle>Resume your last puzzle?</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>
                  You have a puzzle from {new Date(resumeAvailable.timestamp).toLocaleString()} saved on this device
                  ({resumeAvailable.board.filter((v) => v !== 0).length} / 81 cells filled).
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => resumePuzzle(resumeAvailable)}>
                    <History className="size-4" /> Resume
                  </Button>
                  <Button size="sm" variant="outline" onClick={dismissResume}>
                    <Trash2 className="size-4" /> Dismiss
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {errorMsg && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          {stage === 'capture' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Camera className="size-4" /> 1 · Capture
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CapturePanel onCapture={handleCapture} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="size-4" /> Or try a sample / paste
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">
                    No camera or photo handy? Load a known puzzle to explore the solver, or paste an 81-character string
                    (use <code className="rounded bg-muted px-1">.</code> for blanks).
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {SAMPLE_PUZZLES.map((p) => (
                      <Button key={p.name} variant="outline" onClick={() => loadSample(p.givens)}>
                        {p.name} puzzle
                      </Button>
                    ))}
                  </div>
                  <Button variant="outline" onClick={pasteFromClipboard}>
                    <ClipboardPaste className="size-4" /> Paste from clipboard
                  </Button>
                  <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
                    <p className="mb-2 font-medium text-foreground">How it works</p>
                    <ol className="list-decimal space-y-1 pl-4">
                      <li>Web Worker loads OpenCV.js and runs grayscale + Gaussian blur + adaptive threshold.</li>
                      <li>Largest 4-point contour is warped into a 450×450 top-down view.</li>
                      <li>81 cells are sliced (10% border trim) and recognized by Tesseract.js (digits 1–9 only).</li>
                      <li>Editable grid lets you fix any misread digit before solving.</li>
                      <li>Pick a solving algorithm and watch it work, step by step, with an augmented overlay option.</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {stage === 'processing' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScanLine className="size-4 animate-pulse" /> Processing
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <ProgressRow
                  icon={<ImageIcon className="size-4" />}
                  label="Computer vision"
                  detail={prettyCvStage(cvProgress)}
                  value={cvProgressToPercent(cvProgress)}
                />
                <ProgressRow
                  icon={<Brain className="size-4" />}
                  label="Digit recognition"
                  detail={`${ocrProgress.done} / ${ocrProgress.total} cells`}
                  value={(ocrProgress.done / ocrProgress.total) * 100}
                />
                <p className="text-xs text-muted-foreground">
                  OpenCV.js runs inside a Web Worker, so your UI stays responsive. Tesseract.js initializes once and
                  then recognizes each 50×50 cell in sequence.
                </p>
              </CardContent>
            </Card>
          )}

          {stage === 'review' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PencilLine className="size-4" /> 2 · Review &amp; edit
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <EditableGrid
                    value={board}
                    recognizedIndices={recognizedSet}
                    conflictIndices={conflictSet}
                    confidence={confidence}
                    onChange={setCell}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      <span className="mr-1 inline-block size-2 rounded-sm bg-foreground" /> Given
                    </Badge>
                    <Badge variant="outline">
                      <span className="mr-1 inline-block size-2 rounded-sm bg-blue-500" /> Empty
                    </Badge>
                    <Badge variant="outline">
                      <span className="mr-1 inline-block size-2 rounded-sm bg-red-500" /> Conflict
                    </Badge>
                    <Badge variant="outline">
                      <span className="mr-1 inline-block h-[2px] w-3 bg-amber-500" /> Low confidence
                    </Badge>
                    <span className="ml-auto hidden sm:inline">Click a cell, then press 1–9 / Backspace / arrows.</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Validation</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>Filled cells</span>
                    <Badge variant="secondary">{board.filter((v) => v !== 0).length} / 81</Badge>
                  </div>
                  {validation.valid ? (
                    <Alert>
                      <CheckCircle2 className="size-4" />
                      <AlertTitle>No conflicts</AlertTitle>
                      <AlertDescription>Board is consistent — ready to solve.</AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive">
                      <AlertTitle>Conflicts detected</AlertTitle>
                      <AlertDescription>{validation.message}</AlertDescription>
                    </Alert>
                  )}
                  {warpedPreview && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Warped board preview</span>
                      <div className="overflow-hidden rounded-lg border">
                        <img
                          src={imageDataToDataURL(warpedPreview)}
                          alt="Warped Sudoku board"
                          className="size-full object-contain"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Algorithm</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {ALGORITHMS.map((a) => (
                        <Button
                          key={a.id}
                          type="button"
                          size="sm"
                          variant={algorithm === a.id ? 'default' : 'outline'}
                          onClick={() => setAlgorithm(a.id)}
                          title={a.description}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {ALGORITHMS.find((a) => a.id === algorithm)?.description}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant={animateSolving ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAnimateSolving(!animateSolving)}
                    className="justify-start"
                  >
                    <Wand2 className="size-4" /> Animate solving: {animateSolving ? 'On' : 'Off'}
                  </Button>

                  <div className="flex flex-col gap-2">
                    <Button onClick={handleSolve} disabled={!validation.valid} size="lg">
                      <Trophy className="size-4" /> Solve puzzle
                    </Button>
                    <Button variant="outline" onClick={reset}>
                      <ArrowLeft className="size-4" /> Start over
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {stage === 'solving' && liveBoard && solvingSteps && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wand2 className="size-4" /> Solving — {ALGORITHMS.find((a) => a.id === (pendingMeta?.algorithm ?? algorithm))?.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <EditableGrid
                    value={liveBoard}
                    recognizedIndices={recognizedSet}
                    solvedIndices={liveSolvedIndices}
                    activeIndex={liveActiveIndex}
                    readOnly
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">What it's doing</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div
                    key={solvingIndex}
                    className="min-h-[3lh] rounded-lg border bg-muted/30 p-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-150"
                  >
                    {liveCaption}
                  </div>
                  <Progress value={(solvingIndex / solvingSteps.length) * 100} className="h-2" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Step {Math.min(solvingIndex + 1, solvingSteps.length)} / {solvingSteps.length}
                    </span>
                  </div>
                  <Button variant="outline" onClick={finishSolving}>
                    <FastForward className="size-4" /> Skip to result
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {stage === 'solved' && solution && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy className="size-4" /> 3 · Solution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SolutionView
                    givens={board}
                    solution={solution}
                    warpedPreview={warpedPreview}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {solverMeta && (
                    <div className="flex items-center justify-between">
                      <span>Solver time</span>
                      <Badge variant="secondary">{solverMeta.elapsedMs} ms</Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Givens</span>
                    <Badge variant="secondary">{board.filter((v) => v !== 0).length}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Solved</span>
                    <Badge variant="secondary">{solvedSet.size}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Algorithm</span>
                    <Badge variant="outline">
                      {ALGORITHMS.find((a) => a.id === solverMeta?.algorithm)?.label ?? 'Dancing Links'}
                    </Badge>
                  </div>
                  <Button variant="outline" onClick={reset} className="mt-2">
                    <ArrowRight className="size-4" /> Solve another
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        <footer className="mt-auto border-t pt-4 text-center text-xs text-muted-foreground">
          Built with Next.js · OpenCV.js (WebAssembly, Web Worker) · Tesseract.js · 3 solving algorithms · 100% in-browser
        </footer>
      </div>
    </main>
  );
}

function Stepper({ stage }: { stage: Stage }) {
  const steps: Array<{ key: Stage; label: string; icon: React.ReactNode }> = [
    { key: 'capture', label: 'Capture', icon: <Camera className="size-3.5" /> },
    { key: 'processing', label: 'Detect', icon: <ScanLine className="size-3.5" /> },
    { key: 'review', label: 'Review', icon: <PencilLine className="size-3.5" /> },
    { key: 'solving', label: 'Solving', icon: <Wand2 className="size-3.5" /> },
    { key: 'solved', label: 'Solved', icon: <Trophy className="size-3.5" /> },
  ];
  const activeIdx = steps.findIndex((s) => s.key === stage);
  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => {
        const active = i === activeIdx;
        const done = i < activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : done
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-muted text-muted-foreground'
              }`}
            >
              {s.icon}
              <span>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div className="h-px w-4 bg-muted" />}
          </div>
        );
      })}
    </div>
  );
}

function ProgressRow({
  icon,
  label,
  detail,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {label}
        </span>
        <span className="text-muted-foreground">{detail}</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  );
}

function prettyCvStage(stage: string): string {
  switch (stage) {
    case 'opencv-ready':
      return 'OpenCV.js ready';
    case 'preprocessing':
      return 'Grayscale + blur + threshold';
    case 'finding-contours':
      return 'Locating Sudoku outline';
    case 'warping':
      return 'Perspective warp → 450×450';
    case 'segmenting-cells':
      return 'Slicing 81 cells';
    case 'starting':
    default:
      return 'Starting…';
  }
}

function cvProgressToPercent(stage: string): number {
  switch (stage) {
    case 'opencv-ready':
      return 15;
    case 'preprocessing':
      return 35;
    case 'finding-contours':
      return 55;
    case 'warping':
      return 75;
    case 'segmenting-cells':
      return 90;
    default:
      return 5;
  }
}

function imageDataToDataURL(img: ImageData): string {
  return imageDataToCanvas(img).toDataURL('image/png');
}
