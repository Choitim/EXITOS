import { Semaphore } from '../async.js';
import { AbortedError, NetworkError } from '../errors.js';
import type { Clock } from '../clock.js';

export interface RetryPolicy {
  /** Total attempts including the first. Notion recommends at most 6. */
  maxAttempts: number;
  baseDelayMs: number;
  /** Ceiling for self-computed exponential backoff. */
  maxDelayMs: number;
  /**
   * Longest server-provided wait (`Retry-After`, `X-RateLimit-Reset`) we will honour. A larger
   * hint is surfaced to the caller as the original 429 instead of stalling the run for hours.
   */
  maxHintMs: number;
  /** Statuses that mean "the request was rejected and NOT executed" — safe to retry for any method. */
  rejectedStatuses: readonly number[];
  /** Statuses retried only for idempotent requests (reads). */
  transientStatuses: readonly number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 6,
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  maxHintMs: 15 * 60_000,
  rejectedStatuses: [429, 529],
  transientStatuses: [500, 502, 503, 504],
};

export type RetryReason = 'rate_limited' | 'transient_status' | 'network';

export interface RetryEvent {
  label: string;
  attempt: number;
  reason: RetryReason;
  status?: number;
  waitMs: number;
}

export interface SchedulerOptions {
  clock: Clock;
  /** Maximum simultaneous in-flight requests. */
  concurrency: number;
  /** Sustained request budget per minute (e.g. 90 for ClickUp's 100/min). Omit for unthrottled. */
  requestsPerMinute?: number;
  /** Tokens available immediately; defaults to min(requestsPerMinute, 5). */
  burst?: number;
  retry?: Partial<RetryPolicy>;
  /** Randomness source for jitter; inject for determinism. */
  random?: () => number;
  /**
   * Connector-specific wait derivation for rate-limited responses (e.g. ClickUp's
   * `X-RateLimit-Reset`). Return `undefined` to fall back to `Retry-After`/backoff.
   */
  rateLimitDelayMs?: (response: Response, nowMs: number) => number | undefined;
  onRetry?: (event: RetryEvent) => void;
}

/** `Retry-After` is either delta-seconds or an HTTP date. Returns milliseconds or undefined. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

/** ClickUp: `X-RateLimit-Reset` is a Unix timestamp (seconds; tolerate milliseconds). */
export function parseResetTimestamp(value: string | null, nowMs: number): number | undefined {
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  const resetMs = n > 1e12 ? n : n * 1000;
  return Math.max(0, resetMs - nowMs);
}

export interface RunContext {
  /** Human label for telemetry, e.g. "GET /v2/list/:id/task". Must not contain secrets. */
  label: string;
  /** Reads are retried on transient 5xx and network errors; writes are not. */
  idempotent: boolean;
  signal?: AbortSignal;
}

/**
 * Paces, bounds and retries outbound requests.
 *
 *  - token bucket (sustained `requestsPerMinute`, small burst);
 *  - bounded concurrency;
 *  - a shared "blocked until" gate: one 429 pauses every queued request (Retry-After is respected
 *    globally, not per call);
 *  - exponential backoff with full jitter when the server gives no wait hint;
 *  - 429/529 retried for any method (the request was rejected), 5xx and network errors retried only
 *    for idempotent requests. A non-idempotent request that fails ambiguously is surfaced to the
 *    caller (never silently re-sent).
 */
export class RequestScheduler {
  readonly #clock: Clock;
  readonly #semaphore: Semaphore;
  readonly #policy: RetryPolicy;
  readonly #random: () => number;
  readonly #options: SchedulerOptions;
  readonly #ratePerMs: number | undefined;
  readonly #capacity: number;
  #tokens: number;
  #lastRefill: number;
  #blockedUntil = 0;
  #queue: Promise<void> = Promise.resolve();

  /** Cumulative counters, exposed for progress displays and tests. */
  readonly stats = { requests: 0, retries: 0, rateLimited: 0, waitedMs: 0 };

  constructor(options: SchedulerOptions) {
    this.#options = options;
    this.#clock = options.clock;
    this.#semaphore = new Semaphore(Math.max(1, options.concurrency));
    this.#policy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.#random = options.random ?? Math.random;
    this.#ratePerMs =
      options.requestsPerMinute === undefined ? undefined : options.requestsPerMinute / 60_000;
    this.#capacity = Math.max(1, options.burst ?? Math.min(options.requestsPerMinute ?? 1, 5));
    this.#tokens = this.#capacity;
    this.#lastRefill = this.#clock.now();
  }

  async run(task: (attempt: number) => Promise<Response>, context: RunContext): Promise<Response> {
    return this.#semaphore.run(async () => {
      let lastNetworkError: unknown;
      for (let attempt = 1; ; attempt++) {
        await this.#awaitTurn(context.signal);
        this.stats.requests += 1;

        let response: Response;
        try {
          response = await task(attempt);
        } catch (error) {
          if (error instanceof AbortedError || context.signal?.aborted) throw error;
          lastNetworkError = error;
          if (context.idempotent && attempt < this.#policy.maxAttempts) {
            await this.#backoff(context, attempt, 'network', undefined, undefined);
            continue;
          }
          throw new NetworkError(
            `${context.label}: request failed (${error instanceof Error ? error.message : 'network error'})`,
            { cause: lastNetworkError },
          );
        }

        const status = response.status;
        const rejected = this.#policy.rejectedStatuses.includes(status);
        const transient = context.idempotent && this.#policy.transientStatuses.includes(status);
        if ((rejected || transient) && attempt < this.#policy.maxAttempts) {
          if (status === 429) this.stats.rateLimited += 1;
          const hint = this.#waitHint(response);
          if (hint !== undefined && hint > this.#policy.maxHintMs) return response;
          await response.body?.cancel().catch(() => undefined);
          await this.#backoff(
            context,
            attempt,
            rejected ? 'rate_limited' : 'transient_status',
            status,
            hint,
          );
          continue;
        }
        return response;
      }
    });
  }

  #waitHint(response: Response): number | undefined {
    const now = this.#clock.now();
    return (
      this.#options.rateLimitDelayMs?.(response, now) ??
      parseRetryAfter(response.headers.get('retry-after'), now)
    );
  }

  async #backoff(
    context: RunContext,
    attempt: number,
    reason: RetryReason,
    status: number | undefined,
    hintMs: number | undefined,
  ): Promise<void> {
    const exponential = Math.min(
      this.#policy.maxDelayMs,
      this.#policy.baseDelayMs * 2 ** (attempt - 1),
    );
    // A server hint wins; otherwise full jitter over the exponential window.
    const waitMs =
      hintMs !== undefined ? Math.max(0, hintMs) : Math.round(this.#random() * exponential);
    this.stats.retries += 1;
    // Pause the whole scheduler, not just this call: every queued request honours the hint.
    this.#blockedUntil = Math.max(this.#blockedUntil, this.#clock.now() + waitMs);
    this.#options.onRetry?.({
      label: context.label,
      attempt,
      reason,
      ...(status === undefined ? {} : { status }),
      waitMs,
    });
  }

  /** Wait for the global gate and a rate-limit token, serialised FIFO. */
  #awaitTurn(signal: AbortSignal | undefined): Promise<void> {
    const turn = this.#queue.then(async () => {
      for (;;) {
        if (signal?.aborted) throw new AbortedError();
        const now = this.#clock.now();
        if (now < this.#blockedUntil) {
          await this.#sleep(this.#blockedUntil - now, signal);
          continue;
        }
        if (this.#ratePerMs === undefined) return;
        this.#refill(now);
        if (this.#tokens >= 1) {
          this.#tokens -= 1;
          return;
        }
        const deficit = 1 - this.#tokens;
        await this.#sleep(Math.ceil(deficit / this.#ratePerMs), signal);
      }
    });
    // Keep the chain alive even if this turn rejects (abort), so later calls still proceed.
    this.#queue = turn.catch(() => undefined);
    return turn;
  }

  #refill(now: number): void {
    if (this.#ratePerMs === undefined) return;
    const elapsed = Math.max(0, now - this.#lastRefill);
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#ratePerMs);
    this.#lastRefill = now;
  }

  async #sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
    this.stats.waitedMs += ms;
    await this.#clock.sleep(ms, signal);
  }
}
