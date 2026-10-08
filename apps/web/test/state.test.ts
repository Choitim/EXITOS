import { describe, expect, it } from 'vitest';
import { contentSignature, parseDashboardState, validateDashboardState } from '../src/lib/state';
import { makePlan, makeRun, makeState, makeVerification } from './fixtures';

function withReport() {
  const plan = makePlan();
  const run = makeRun();
  return makeState({
    plan,
    run,
    verification: makeVerification(),
    report: {
      schemaVersion: 1,
      generatedAt: '2026-10-08T09:03:00.000Z',
      exitosVersion: '0.1.0',
      mode: 'demo',
      redacted: false,
      state: 'verification_failed',
      headline: 'VERIFICATION FAILED',
      plan: {
        planId: plan.planId,
        hash: plan.hash,
        source: { system: 'notion', workspace: 'Acme' },
        destination: { system: 'clickup', workspace: 'Acme' },
        summary: plan.summary,
      },
      run,
      items: [],
      notPreserved: [],
      verification: makeVerification(),
      mappings: [],
      requests: null,
      disclaimers: ['Not a claim of zero data loss.'],
    },
  });
}

describe('validateDashboardState', () => {
  it('accepts a complete state (with and without a report)', () => {
    expect(validateDashboardState(makeState()).ok).toBe(true);
    expect(validateDashboardState(withReport()).ok).toBe(true);
  });

  it('accepts the empty state', () => {
    const empty = makeState({ mode: 'empty', plan: null, run: null, runs: [], events: [] });
    expect(validateDashboardState(empty).ok).toBe(true);
  });

  it('ignores unknown extra fields', () => {
    const state = JSON.parse(JSON.stringify(makeState())) as Record<string, unknown>;
    state.somethingNew = { a: 1 };
    (state.plan as Record<string, unknown>).alsoNew = true;
    expect(validateDashboardState(state).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'state'],
    ['a number', 42],
  ])('rejects %s', (_name, value) => {
    expect(validateDashboardState(value).ok).toBe(false);
  });

  it('rejects an unknown schema version', () => {
    const result = validateDashboardState({ ...makeState(), schemaVersion: 2 });
    expect(result).toEqual({ ok: false, error: 'state.schemaVersion must be 1 (got 2)' });
  });

  it('names the path of a missing required field', () => {
    const state = JSON.parse(JSON.stringify(makeState())) as {
      plan: { summary: Record<string, unknown> };
    };
    delete state.plan.summary.items;
    const result = validateDashboardState(state);
    expect(result).toEqual({ ok: false, error: 'state.plan.summary.items is missing' });
  });

  it('names the path of a mistyped field inside an array', () => {
    const state = JSON.parse(JSON.stringify(makeState())) as {
      plan: { mappings: Array<Record<string, unknown>> };
    };
    state.plan.mappings[1] = { ...state.plan.mappings[1], reason: 42 };
    const result = validateDashboardState(state);
    expect(result).toEqual({
      ok: false,
      error: 'state.plan.mappings[1].reason must be a string (got number)',
    });
  });

  it('rejects a bad mode and a non-empty mode without a plan', () => {
    expect(validateDashboardState({ ...makeState(), mode: 'production' }).ok).toBe(false);
    const result = validateDashboardState(makeState({ plan: null }));
    expect(result.ok).toBe(false);
  });

  it('rejects non-finite numbers and wrong container types', () => {
    const state = JSON.parse(JSON.stringify(makeState())) as {
      plan: { estimate: Record<string, unknown>; collections: unknown };
    };
    state.plan.estimate.readRequests = '10';
    expect(validateDashboardState(state).ok).toBe(false);
    const state2 = JSON.parse(JSON.stringify(makeState())) as { plan: { collections: unknown } };
    state2.plan.collections = {};
    expect(validateDashboardState(state2).ok).toBe(false);
  });

  it('never throws on arbitrary junk', () => {
    for (const junk of [
      undefined,
      NaN,
      () => 1,
      Symbol('x'),
      { plan: { actions: [null] } },
      { mode: 'demo', plan: {} },
    ]) {
      expect(() => validateDashboardState(junk)).not.toThrow();
      expect(validateDashboardState(junk).ok).toBe(false);
    }
  });
});

describe('parseDashboardState', () => {
  it('parses JSON text', () => {
    const result = parseDashboardState(JSON.stringify(makeState()));
    expect(result.ok && result.state.plan?.planId).toBe('plan_0123456789ab');
  });

  it('reports invalid JSON', () => {
    expect(parseDashboardState('{nope')).toEqual({
      ok: false,
      error: 'The response is not valid JSON.',
    });
    expect(parseDashboardState('')).toEqual({
      ok: false,
      error: 'The response is not valid JSON.',
    });
  });
});

describe('contentSignature', () => {
  it('ignores generatedAt so unchanged data compares equal', () => {
    const a = JSON.stringify(makeState({ generatedAt: '2026-10-08T09:00:00.000Z' }));
    const b = JSON.stringify(makeState({ generatedAt: '2026-10-08T09:00:02.000Z' }));
    expect(a).not.toBe(b);
    expect(contentSignature(a)).toBe(contentSignature(b));
  });

  it('differs when the data differs', () => {
    const a = JSON.stringify(makeState());
    const b = JSON.stringify(makeState({ run: makeRun({ status: 'applying' }) }));
    expect(contentSignature(a)).not.toBe(contentSignature(b));
  });
});
