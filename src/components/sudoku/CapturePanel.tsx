'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, Image as ImageIcon, X, RefreshCw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export type CaptureSource = 'webcam' | 'upload';

export interface CapturePanelProps {
  onCapture: (canvas: HTMLCanvasElement, source: CaptureSource) => void;
  busy?: boolean;
}

/**
 * Capture panel: toggles between live webcam capture and file upload/drag-drop.
 * Includes a visual alignment overlay (square guide box) when the camera is active.
 */
export function CapturePanel({ onCapture, busy }: CapturePanelProps) {
  const [mode, setMode] = useState<CaptureSource>('webcam');
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Camera lifecycle: start when entering webcam mode, stop on cleanup.
  // Streaming state is updated from the <video> element's onPlay / onPause /
  // onEnded events, not synchronously inside the effect body.
  useEffect(() => {
    if (mode !== 'webcam') {
      stopStream();
      return;
    }
    let cancelled = false;
    let localStream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStream = stream;
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play();
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission denied. Please allow camera access or use Upload instead.'
            : err?.message ?? 'Failed to start webcam.',
        );
      });
    return () => {
      cancelled = true;
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode, stopStream]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    onCapture(canvas, 'webcam');
  }, [onCapture]);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Please upload an image file (PNG, JPG, etc.).');
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        onCapture(canvas, 'upload');
      };
      img.onerror = () => {
        setError('Could not load the selected image.');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [onCapture],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          variant={mode === 'webcam' ? 'default' : 'outline'}
          onClick={() => setMode('webcam')}
          disabled={busy}
          className="flex-1"
        >
          <Camera className="size-4" /> Webcam
        </Button>
        <Button
          variant={mode === 'upload' ? 'default' : 'outline'}
          onClick={() => setMode('upload')}
          disabled={busy}
          className="flex-1"
        >
          <Upload className="size-4" /> Upload
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <X className="size-4" />
          <AlertTitle>Camera issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {mode === 'webcam' && (
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            onPlay={() => setStreaming(true)}
            onPause={() => setStreaming(false)}
            onEnded={() => setStreaming(false)}
            className={cn('size-full object-cover', !streaming && 'opacity-0')}
          />
          {/* alignment overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative aspect-square w-[80%] rounded-md border-2 border-white/70 shadow-[0_0_0_10000px_rgba(0,0,0,0.25)]">
              <span className="absolute -left-1 -top-1 size-4 border-l-4 border-t-4 border-yellow-400" />
              <span className="absolute -right-1 -top-1 size-4 border-r-4 border-t-4 border-yellow-400" />
              <span className="absolute -left-1 -bottom-1 size-4 border-l-4 border-b-4 border-yellow-400" />
              <span className="absolute -right-1 -bottom-1 size-4 border-r-4 border-b-4 border-yellow-400" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-medium uppercase tracking-wider text-white/80">
                Align Sudoku here
              </span>
            </div>
          </div>
          {!streaming && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
              <RefreshCw className="mr-2 size-4 animate-spin" /> Starting camera…
            </div>
          )}
        </div>
      )}

      {mode === 'upload' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50',
          )}
        >
          <ImageIcon className="size-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Click to upload or drag &amp; drop</p>
            <p className="text-xs text-muted-foreground">PNG, JPG, WEBP — Sudoku should fill most of the frame</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Upload Sudoku image"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {mode === 'webcam' && (
        <Button onClick={captureFrame} disabled={busy || !streaming} size="lg" className="w-full">
          <Zap className="size-4" /> {busy ? 'Processing…' : 'Capture & Detect'}
        </Button>
      )}
    </div>
  );
}
