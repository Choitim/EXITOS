import { SimulatedInterruptError, VirtualClock } from '@exitos/shared';
import { describe, expect, it } from 'vitest';
import { approveAndCreateRun, executePlan, type ExecutorEvent } from '../src/index.js';
import { createMemoryDestination } from '../src/testing/index.js';
import { makeAction, makePlan, memoryStore } from './helpers.js';

function setup(actionCount = 6, deps: Record<number, number[]> = {}) {
  const store = memoryStore();
  const dest = createMemoryDestination();
  const actions = Array.from({ length: actionCount }, (_, i) => i + 1).map((n) => makeAction(n));
  // wire dependencies by index
  const wired = actions.map((a, i) =>
    deps[i + 1]
      ? { ...a, dependsOn: (deps[i + 1] ?? []).map((d) => (actions[d - 1] as typeof a).id) }
      : a,
  );
  const plan = makePlan(wired);
  const run = approveAndCreateRun({
    plan,
    store,
    approvedPlanId: plan.planId,
    now: new Date('2026-01-01T00:00:00Z'),
  });
  const events: ExecutorEvent[] = [];
  const exec = (over: Partial<Parameters<typeof executePlan>[0]> = {}) =>
    executePlan({
      plan,
      destination: dest,
      store,
      runId: run.runId,
      concurrency: 3,
      clock: new VirtualClock(),
      onEvent: (e) => events.push(e),
      ...over,
    });
  return { store, dest, plan, run, exec, events, actions: wired };
}

describe('executePlan — happy path', () => {
  it('applies every action once and ends as "applied" (never "verified")', async () => {
    const { exec, dest, store, run } = setup(6);
    const result = await exec();
    expect(result.status).toBe('applied');
    expect(dest.items.size).toBe(6);
    expect(dest.duplicates).toEqual([]);
    expect(store.getRun(run.runId)?.status).toBe('applied');
    expect(store.getRun(run.runId)?.counts.succeeded).toBe(6);
  });

  it('records source→destination mappings for every item', async () => {
    const { exec, store } = setup(3);
    await exec();
    const mappings = store.listMappings();
    expect(mappings).toHaveLength(3);
    expect(mappings.map((m) => m.sourceKey).sort()).toEqual([
      'test:item:1',
      'test:item:2',
      'test:item:3',
    ]);
  });

  it('runs dependents only after their prerequisites', async () => {
    // 3 depends on 1 and 2; 5 depends on 3
    const { exec, dest } = setup(5, { 3: [1, 2], 5: [3] });
    await exec({ concurrency: 4 });
    const order = dest.applyCalls;
    expect(order.indexOf('test:item:3')).toBeGreaterThan(order.indexOf('test:item:1'));
    expect(order.indexOf('test:item:3')).toBeGreaterThan(order.indexOf('test:item:2'));
    expect(order.indexOf('test:item:5')).toBeGreaterThan(order.indexOf('test:item:3'));
  });

  it('never exceeds the concurrency bound', async () => {
    const { plan, store, run } = setup(12);
    let active = 0;
    let peak = 0;
    const dest = createMemoryDestination();
    const original = dest.apply.bind(dest);
    dest.apply = async (action, ctx) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setImmediate(r));
      const result = await original(action, ctx);
      active--;
      return result;
    };
    await executePlan({
      plan,
      destination: dest,
      store,
      runId: run.runId,
      concurrency: 3,
      clock: new VirtualClock(),
    });
    expect(peak).toBe(3);
  });

  it('skips actions that are already present and resolves their dependents', async () => {
    const store = memoryStore();
    const dest = createMemoryDestination();
    const a1 = makeAction(1, {
      disposition: 'skip',
      existing: 'pre-existing-1',
      outcome: 'skipped',
    });
    const a2 = makeAction(2, { deps: [a1.id] });
    const plan = makePlan([a1, a2]);
    const run = approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: new Date() });
    const result = await executePlan({
      plan,
      destination: dest,
      store,
      runId: run.runId,
      concurrency: 2,
      clock: new VirtualClock(),
    });
    expect(result.status).toBe('applied');
    expect(dest.applyCalls).toEqual(['test:item:2']);
    expect(store.getMapping('test:item:1', 'test:scope')?.destinationId).toBe('pre-existing-1');
  });
});

describe('executePlan — partial failure and resume', () => {
  it('fails only the rejected item, blocks its dependents, and finishes the rest', async () => {
    const { exec, dest, store, run } = setup(5, { 3: [2], 4: [3] });
    dest.script('test:item:2', { fail: 400 });
    const result = await exec();
    expect(result.status).toBe('failed');
    const counts = store.getRun(run.runId)?.counts;
    expect(counts).toMatchObject({ succeeded: 2, failed: 1, blocked: 2, pending: 0 });
    expect([...dest.items.keys()].sort()).toEqual(['test:item:1', 'test:item:5']);
  });

  it('resume retries failed + blocked items and creates nothing twice', async () => {
    const { exec, dest, store, run } = setup(5, { 3: [2], 4: [3] });
    dest.script('test:item:2', { fail: 400 });
    await exec();
    const before = dest.applyCalls.length;

    const resumed = await exec(); // the scripted failure is consumed; now succeeds
    expect(resumed.status).toBe('applied');
    expect(dest.items.size).toBe(5);
    expect(dest.duplicates).toEqual([]);
    // Only the 3 previously incomplete items (2,3,4) were attempted again.
    expect(dest.applyCalls.length - before).toBe(3);
    expect(store.getRun(run.runId)?.counts.succeeded).toBe(5);
  });

  it('stops safely on an authentication failure and reports partial completion', async () => {
    const { exec, dest, store, run } = setup(6);
    dest.script('test:item:3', { fail: 401 });
    const result = await exec({ concurrency: 1 });
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toMatch(/credential/i);
    const counts = store.getRun(run.runId)?.counts;
    expect(counts?.succeeded).toBe(2);
    expect(counts?.pending).toBe(3);
    expect(dest.items.size).toBe(2);
  });

  it('stops after too many consecutive failures instead of hammering the API', async () => {
    const { exec, dest } = setup(10);
    for (let i = 1; i <= 10; i++) dest.script(`test:item:${i}`, { fail: 400 });
    const result = await exec({ concurrency: 1, maxConsecutiveFailures: 3 });
    expect(result.status).toBe('stopped');
    expect(dest.applyCalls).toHaveLength(3);
  });

  it('stops when the destination keeps rate limiting (429 exhausted)', async () => {
    const { exec, dest } = setup(4);
    dest.script('test:item:1', { fail: 429 });
    const result = await exec({ concurrency: 1 });
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toMatch(/rate limiting/i);
  });
});

describe('executePlan — ambiguous writes and duplicate prevention', () => {
  it('reconciles a write that happened but whose response was lost (no duplicate)', async () => {
    const { exec, dest, store, run } = setup(3);
    dest.script('test:item:2', { ambiguous: 'created' });
    const result = await exec({ concurrency: 1 });
    expect(result.status).toBe('applied');
    expect(dest.applyCalls.filter((k) => k === 'test:item:2')).toHaveLength(1); // not re-sent
    expect(dest.duplicates).toEqual([]);
    expect(dest.items.size).toBe(3);
    expect(store.getRun(run.runId)?.counts.succeeded).toBe(3);
  });

  it('re-sends only when reconciliation proves the write did not happen', async () => {
    const { exec, dest } = setup(3);
    dest.script('test:item:2', { ambiguous: 'not_created' });
    const result = await exec({ concurrency: 1 });
    expect(result.status).toBe('applied');
    expect(dest.applyCalls.filter((k) => k === 'test:item:2')).toHaveLength(2);
    expect(dest.duplicates).toEqual([]);
    expect(dest.items.size).toBe(3);
  });

  it('stops and asks the operator when the outcome cannot be determined', async () => {
    const { exec, dest, store, run, actions } = setup(3);
    dest.script('test:item:2', { ambiguous: 'created' });
    dest.reconcileUndecidable = true;
    const result = await exec({ concurrency: 1 });
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toContain('--assume-not-created');
    expect(result.stopReason).toContain(actions[1]?.id);
    expect(store.getRun(run.runId)?.counts.ambiguous).toBe(1);
    // Item 3 must NOT have been attempted past an unresolved ambiguous write.
    expect(dest.items.has('test:item:3')).toBe(false);
  });

  it('after the operator resolves it (item really missing), --assume-not-created continues', async () => {
    const { exec, dest, actions } = setup(3);
    dest.script('test:item:2', { ambiguous: 'not_created' });
    dest.reconcileUndecidable = true;
    await exec({ concurrency: 1 });
    dest.reconcileUndecidable = false;
    const resumed = await exec({ concurrency: 1, assumeNotCreated: [actions[1]?.id ?? ''] });
    expect(resumed.status).toBe('applied');
    expect(dest.items.size).toBe(3);
    expect(dest.duplicates).toEqual([]);
  });

  it('survives a crash AFTER the destination wrote but BEFORE the checkpoint (adopts, no duplicate)', async () => {
    const { exec, dest, store, run } = setup(4);
    await expect(
      exec({
        concurrency: 1,
        afterWrite: (action) => {
          if (action.idempotencyKey === 'test:item:2') throw new SimulatedInterruptError(1);
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedInterruptError);

    // The process "died": item 2 exists remotely but its checkpoint is still in_flight.
    expect(dest.items.has('test:item:2')).toBe(true);
    expect(store.getCheckpoint(run.runId, makeAction(2).id)?.status).toBe('in_flight');

    const resumed = await exec({ concurrency: 1 });
    expect(resumed.status).toBe('applied');
    expect(dest.duplicates).toEqual([]);
    expect(dest.applyCalls.filter((k) => k === 'test:item:2')).toHaveLength(1);
    expect(dest.items.size).toBe(4);
  });

  it('survives a crash BEFORE the destination wrote (re-sends safely)', async () => {
    const { exec, dest, store, run } = setup(3);
    const original = dest.apply.bind(dest);
    dest.apply = async (action, ctx) => {
      if (
        action.idempotencyKey === 'test:item:2' &&
        dest.applyCalls.filter((k) => k === action.idempotencyKey).length === 0
      ) {
        dest.applyCalls.push(action.idempotencyKey);
        throw new SimulatedInterruptError(1); // died before anything was sent
      }
      return original(action, ctx);
    };
    await expect(exec({ concurrency: 1 })).rejects.toBeInstanceOf(SimulatedInterruptError);
    expect(dest.items.has('test:item:2')).toBe(false);
    const resumed = await exec({ concurrency: 1 });
    expect(resumed.status).toBe('applied');
    expect(dest.items.size).toBe(3);
    expect(dest.duplicates).toEqual([]);
    expect(store.getRun(run.runId)?.status).toBe('applied');
  });

  it('interruptAfter simulates an abrupt stop mid-run and resume finishes the job', async () => {
    const { exec, dest, store, run } = setup(7);
    await expect(exec({ concurrency: 1, interruptAfter: 3 })).rejects.toBeInstanceOf(
      SimulatedInterruptError,
    );
    expect(store.getRun(run.runId)?.status).toBe('applying'); // like a crashed process
    expect(dest.items.size).toBe(3);

    const resumed = await exec({ concurrency: 2 });
    expect(resumed.status).toBe('applied');
    expect(dest.items.size).toBe(7);
    expect(dest.duplicates).toEqual([]);
  });

  it('refuses to record a second destination for the same source (duplicate guard)', () => {
    const { store, run, actions } = setup(1);
    store.markInFlight(run.runId, (actions[0] as { id: string }).id);
    store.markSucceeded(run.runId, (actions[0] as { id: string }).id, {
      destinationId: 'A',
      mapping: { sourceKey: 'test:item:1', scope: 'test:scope' },
    });
    expect(() =>
      store.putMapping({
        sourceKey: 'test:item:1',
        scope: 'test:scope',
        destinationId: 'B',
        runId: run.runId,
      }),
    ).toThrow(/already mapped/);
  });
});

describe('executePlan — cancellation', () => {
  it('marks the in-flight write ambiguous and stops when aborted', async () => {
    const { plan, store, run } = setup(4);
    const controller = new AbortController();
    const dest = createMemoryDestination();
    const original = dest.apply.bind(dest);
    let calls = 0;
    dest.apply = async (action, ctx) => {
      calls++;
      if (calls === 2) {
        controller.abort();
        const { AbortedError } = await import('@exitos/shared');
        throw new AbortedError();
      }
      return original(action, ctx);
    };
    const result = await executePlan({
      plan,
      destination: dest,
      store,
      runId: run.runId,
      concurrency: 1,
      clock: new VirtualClock(),
      signal: controller.signal,
    });
    expect(result.status).toBe('stopped');
    expect(store.getRun(run.runId)?.counts.ambiguous).toBe(1);
  });
});
