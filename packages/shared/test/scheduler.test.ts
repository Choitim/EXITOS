import { describe, expect, it } from 'vitest';
import {
  RequestScheduler,
  VirtualClock,
  parseResetTimestamp,
  parseRetryAfter,
  type RetryEvent,
} from '../src/index.js';
import { jsonResponse, scriptedFetch } from './http-helpers.js';

function make(overrides: Partial<ConstructorParameters<typeof RequestScheduler>[0]> = {}) {
  const clock = new VirtualClock();
  const events: RetryEvent[] = [];
  const scheduler = new RequestScheduler({
    clock,
    concurrency: 4,
    random: () => 0.5,
    onRetry: (e) => events.push(e),
    ...overrides,
  });
  return { clock, scheduler, events };
}

const run = (
  s: RequestScheduler,
  fetch: ReturnType<typeof scriptedFetch>['fetch'],
  opts: { idempotent: boolean; label?: string } = { idempotent: true },
) =>
  s.run(() => fetch('https://x.test/a'), {
    label: opts.label ?? 'GET /a',
    idempotent: opts.idempotent,
  });

describe('header parsing', () => {
  it('parses Retry-After as seconds and as an HTTP date', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter('0.5', 0)).toBe(500);
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('parses ClickUp X-RateLimit-Reset as a Unix timestamp (seconds or ms)', () => {
    const now = 1_700_000_000_000;
    expect(parseResetTimestamp('1700000005', now)).toBe(5000);
    expect(parseResetTimestamp('1700000005000', now)).toBe(5000);
    expect(parseResetTimestamp('1699999990', now)).toBe(0);
    expect(parseResetTimestamp('abc', now)).toBeUndefined();
  });
});

describe('RequestScheduler retries', () => {
  it('honours Retry-After on 429 and then succeeds', async () => {
    const { scheduler, clock, events } = make();
    const { fetch, calls } = scriptedFetch([
      jsonResponse(429, { code: 'rate_limited' }, { 'retry-after': '2' }),
      jsonResponse(200, { ok: true }),
    ]);
    const res = await run(scheduler, fetch);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({ reason: 'rate_limited', status: 429, waitMs: 2000 }),
    ]);
    expect(clock.slept).toBeGreaterThanOrEqual(2000);
    expect(scheduler.stats.rateLimited).toBe(1);
  });

  it('prefers a connector-specific reset header over Retry-After', async () => {
    const { scheduler, clock } = make({
      rateLimitDelayMs: (response, now) =>
        parseResetTimestamp(response.headers.get('x-ratelimit-reset'), now),
    });
    const resetAt = Math.floor((clock.now() + 7000) / 1000);
    const { fetch } = scriptedFetch([
      jsonResponse(429, {}, { 'x-ratelimit-reset': String(resetAt), 'retry-after': '1' }),
      jsonResponse(200, {}),
    ]);
    await run(scheduler, fetch);
    expect(clock.slept).toBeGreaterThanOrEqual(6000);
  });

  it('retries 429 for non-idempotent requests (the write was rejected, not executed)', async () => {
    const { scheduler } = make();
    const { fetch, calls } = scriptedFetch([
      jsonResponse(429, {}, { 'retry-after': '1' }),
      jsonResponse(200, { id: '1' }),
    ]);
    const res = await run(scheduler, fetch, { idempotent: false });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry 5xx for non-idempotent requests but DOES for reads', async () => {
    const write = make();
    const w = scriptedFetch([jsonResponse(503, {}), jsonResponse(200, {})]);
    const wr = await run(write.scheduler, w.fetch, { idempotent: false });
    expect(wr.status).toBe(503);
    expect(w.calls).toHaveLength(1);

    const read = make();
    const r = scriptedFetch([jsonResponse(503, {}), jsonResponse(502, {}), jsonResponse(200, {})]);
    const rr = await run(read.scheduler, r.fetch, { idempotent: true });
    expect(rr.status).toBe(200);
    expect(r.calls).toHaveLength(3);
  });

  it('retries network errors for reads only; for writes the error is surfaced', async () => {
    const read = make();
    const r = scriptedFetch([new Error('ECONNRESET'), jsonResponse(200, {})]);
    expect((await run(read.scheduler, r.fetch)).status).toBe(200);

    const write = make();
    const w = scriptedFetch([new Error('ECONNRESET'), jsonResponse(200, {})]);
    await expect(run(write.scheduler, w.fetch, { idempotent: false })).rejects.toThrow(
      /request failed/,
    );
    expect(w.calls).toHaveLength(1);
  });

  it('uses exponential backoff with jitter when the server gives no hint', async () => {
    const { scheduler, events } = make({ random: () => 1 });
    const { fetch } = scriptedFetch([
      jsonResponse(503, {}),
      jsonResponse(503, {}),
      jsonResponse(503, {}),
      jsonResponse(200, {}),
    ]);
    await run(scheduler, fetch);
    expect(events.map((e) => e.waitMs)).toEqual([500, 1000, 2000]);
  });

  it('gives up after maxAttempts and returns the last response for the caller to report', async () => {
    const { scheduler } = make({ retry: { maxAttempts: 3 } });
    const { fetch, calls } = scriptedFetch(
      Array.from({ length: 5 }, () => jsonResponse(429, {}, { 'retry-after': '1' })),
    );
    const res = await run(scheduler, fetch);
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(3);
  });

  it('refuses to stall for an absurd server hint and returns the 429 instead', async () => {
    const { scheduler, clock } = make({ retry: { maxHintMs: 60_000 } });
    const { fetch, calls } = scriptedFetch([jsonResponse(429, {}, { 'retry-after': '3600' })]);
    const res = await run(scheduler, fetch);
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(1);
    expect(clock.slept).toBe(0);
  });

  it('one 429 pauses every queued request (global gate)', async () => {
    const { scheduler, clock } = make({ concurrency: 3 });
    const times: number[] = [];
    const { fetch } = scriptedFetch([
      jsonResponse(429, {}, { 'retry-after': '10' }),
      jsonResponse(200, {}),
      jsonResponse(200, {}),
      jsonResponse(200, {}),
    ]);
    const timed = () =>
      scheduler.run(
        async () => {
          times.push(clock.now());
          return fetch('https://x.test/a');
        },
        { label: 'GET /a', idempotent: true },
      );
    await Promise.all([timed(), timed(), timed()]);
    const start = Date.UTC(2026, 0, 1);
    // Three first attempts happen at t=0; the retry and nothing else after the 10 s pause.
    expect(times.filter((t) => t === start).length).toBeGreaterThanOrEqual(1);
    expect(times.filter((t) => t >= start + 10_000).length).toBeGreaterThanOrEqual(1);
  });

  it('paces requests to the sustained budget with a token bucket', async () => {
    const { scheduler, clock } = make({ requestsPerMinute: 60, burst: 2, concurrency: 1 });
    const { fetch } = scriptedFetch(Array.from({ length: 6 }, () => jsonResponse(200, {})));
    const start = clock.now();
    for (let i = 0; i < 6; i++) await run(scheduler, fetch);
    // 2 immediate (burst) then 4 more at 1/s => ~4 s of virtual waiting.
    const elapsed = clock.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(3900);
    expect(elapsed).toBeLessThan(5000);
  });

  it('bounds concurrency', async () => {
    const { scheduler } = make({ concurrency: 2 });
    let active = 0;
    let peak = 0;
    const task = () =>
      scheduler.run(
        async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setImmediate(r));
          active--;
          return jsonResponse(200, {});
        },
        { label: 'GET /a', idempotent: true },
      );
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(2);
  });
});
