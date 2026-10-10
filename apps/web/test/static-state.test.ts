/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_STATE_URL, loadStaticDemoState, type FetchLike } from '../src/lib/static-state';
import { makeState } from './fixtures';

const json = (value: unknown, init: ResponseInit = {}): Response =>
  new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

describe('static demo data loading', () => {
  it('asks for one relative URL, so any folder or sub-path works', () => {
    expect(DEMO_STATE_URL).toBe('./demo-state.json');
    expect(DEMO_STATE_URL.startsWith('./')).toBe(true);
    expect(DEMO_STATE_URL).not.toMatch(/^(?:\/|[a-z]+:)/i);
    expect(DEMO_STATE_URL).not.toContain('/api');
  });

  it('makes exactly one request, to that URL, without credentials or a referrer', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(json(makeState())));
    const result = await loadStaticDemoState(fetchImpl);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('./demo-state.json');
    expect(init).toMatchObject({
      cache: 'no-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('returns the state as recorded', async () => {
    const recorded = makeState();
    const result = await loadStaticDemoState(() => Promise.resolve(json(recorded)));
    expect(result).toEqual({ ok: true, state: recorded });
  });

  it('reports a missing or unreachable file in plain words', async () => {
    const missing = await loadStaticDemoState(() => Promise.resolve(json('nope', { status: 404 })));
    expect(missing).toMatchObject({ ok: false });
    expect(missing.ok ? '' : missing.error).toContain('HTTP 404');

    const offline = await loadStaticDemoState(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    expect(offline.ok ? '' : offline.error).toContain('could not be loaded');
  });

  it('rejects data it cannot read', async () => {
    const garbage = await loadStaticDemoState(() => Promise.resolve(json('{not json')));
    expect(garbage.ok).toBe(false);
    const wrongShape = await loadStaticDemoState(() => Promise.resolve(json({ mode: 'demo' })));
    expect(wrongShape.ok).toBe(false);
  });

  it('refuses to show anything that is not a demo recording', async () => {
    const live = await loadStaticDemoState(() =>
      Promise.resolve(json(makeState({ mode: 'live' }))),
    );
    expect(live.ok).toBe(false);
    expect(live.ok ? '' : live.error).toContain('not a demo recording');
    const empty = await loadStaticDemoState(() =>
      Promise.resolve(json(makeState({ mode: 'empty', plan: null, run: null, events: [] }))),
    );
    expect(empty.ok).toBe(false);
  });
});

describe('loading the demo at most once per page load', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shares one request between callers (React StrictMode mounts twice in development)', async () => {
    const { loadStaticDemoStateOnce } = await import('../src/lib/static-state');
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(json(makeState())));
    const [a, b] = await Promise.all([
      loadStaticDemoStateOnce(fetchImpl),
      loadStaticDemoStateOnce(fetchImpl),
    ]);
    expect(a).toBe(b);
    await loadStaticDemoStateOnce(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failure, so Retry works', async () => {
    const { loadStaticDemoStateOnce } = await import('../src/lib/static-state');
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(json(makeState()));
    expect((await loadStaticDemoStateOnce(fetchImpl)).ok).toBe(false);
    await Promise.resolve();
    expect((await loadStaticDemoStateOnce(fetchImpl)).ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('the static demo never polls or calls an API', () => {
  /** The file's code, without comments (which may say what the code does not do). */
  const source = (path: string): string =>
    readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it.each(['hooks/useStaticDemoState.ts', 'lib/static-state.ts', 'hooks/useReplay.ts'])(
    '%s has no timers that repeat, no /api URL, no visibility listener',
    (file) => {
      const text = source(file);
      expect(text).not.toMatch(/setInterval/);
      expect(text).not.toMatch(/['"`]\/api/);
      expect(text).not.toMatch(/visibilitychange/);
      expect(text).not.toMatch(/EventSource|WebSocket|XMLHttpRequest|sendBeacon/);
    },
  );
});
