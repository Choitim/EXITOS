import { AbortedError } from './errors.js';

/** Injectable time source so retry/backoff logic is testable without real waiting. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortedError());
        return;
      }
      const timer = setTimeout(
        () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        Math.max(0, ms),
      );
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new AbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
};

/**
 * Deterministic clock: `sleep` advances virtual time instantly. Used by tests, and by the offline
 * demo so simulated rate-limit waits do not slow the run (the waits are still reported).
 */
export class VirtualClock implements Clock {
  #now: number;
  /** Total virtual milliseconds slept. */
  slept = 0;
  readonly sleeps: number[] = [];

  constructor(start = Date.UTC(2026, 0, 1)) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    const duration = Math.max(0, ms);
    this.#now += duration;
    this.slept += duration;
    this.sleeps.push(duration);
    // Yield to the event loop so concurrent tasks interleave realistically.
    return new Promise((resolve) => setImmediate(resolve));
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}
