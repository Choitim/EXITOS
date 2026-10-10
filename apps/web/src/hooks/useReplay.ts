import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/browser';
import { frameAt, type ReplayFrame, type ReplayTimeline } from '../lib/replay';

export type ReplayMode = 'idle' | 'running' | 'done';

export interface ReplayControls {
  mode: ReplayMode;
  /** `null` when the recording has nothing to replay. */
  frame: ReplayFrame | null;
  start: () => void;
  /** Jump to the end: the recorded totals. */
  skip: () => void;
  /** Back to the beginning, nothing shown. */
  reset: () => void;
}

/**
 * Drives `frameAt` with the clock. The state is only updated when a new recorded event becomes
 * visible (a few times per second), not on every animation frame. With `prefers-reduced-motion`
 * the replay does not animate: Start shows the finished replay at once.
 */
export function useReplay(timeline: ReplayTimeline | null): ReplayControls {
  const [mode, setMode] = useState<ReplayMode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const frameRequest = useRef<number | null>(null);

  const stop = useCallback((): void => {
    if (frameRequest.current !== null) {
      cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback((): void => {
    if (timeline === null) return;
    stop();
    if (prefersReducedMotion()) {
      setElapsed(timeline.durationMs);
      setMode('done');
      return;
    }
    const begin = performance.now();
    let lastRevealed = -1;
    setElapsed(0);
    setMode('running');
    const tick = (now: number): void => {
      const t = now - begin;
      if (t >= timeline.durationMs) {
        frameRequest.current = null;
        setElapsed(timeline.durationMs);
        setMode('done');
        return;
      }
      const revealed = frameAt(timeline, t).revealed;
      if (revealed !== lastRevealed) {
        lastRevealed = revealed;
        setElapsed(t);
      }
      frameRequest.current = requestAnimationFrame(tick);
    };
    frameRequest.current = requestAnimationFrame(tick);
  }, [timeline, stop]);

  const skip = useCallback((): void => {
    if (timeline === null) return;
    stop();
    setElapsed(timeline.durationMs);
    setMode('done');
  }, [timeline, stop]);

  const reset = useCallback((): void => {
    stop();
    setElapsed(0);
    setMode('idle');
  }, [stop]);

  const frame = useMemo(
    () => (timeline === null ? null : frameAt(timeline, elapsed)),
    [timeline, elapsed],
  );

  return { mode, frame, start, skip, reset };
}
