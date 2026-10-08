import { describe, expect, it } from 'vitest';
import {
  Semaphore,
  ValidationError,
  assertSafePathSegment,
  chunk,
  isSafePathSegment,
  mapWithConcurrency,
} from '../src/index.js';

describe('mapWithConcurrency', () => {
  it('preserves input order and bounds parallelism', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('stops scheduling after the first failure and rethrows it', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });

  it('handles empty input', async () => {
    expect(await mapWithConcurrency([], 4, async (n: number) => n)).toEqual([]);
  });
});

describe('Semaphore & chunk', () => {
  it('never exceeds its limit', async () => {
    const s = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        s.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setImmediate(r));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('chunks arrays', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('path segment validation', () => {
  it('accepts ClickUp/Notion style identifiers', () => {
    for (const ok of ['901234567', '86abc12', '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', '2kz5-123']) {
      expect(isSafePathSegment(ok)).toBe(true);
    }
  });

  it('rejects traversal, separators, queries and over-long values', () => {
    for (const bad of [
      '../x',
      'a/b',
      'a?b=1',
      'a#b',
      'a b',
      '',
      'x'.repeat(65),
      'a%2e%2e',
      'a\\b',
    ]) {
      expect(isSafePathSegment(bad)).toBe(false);
      expect(() => assertSafePathSegment(bad, 'listId')).toThrow(ValidationError);
    }
  });
});
