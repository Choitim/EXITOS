import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStateStore, approveAndCreateRun, type VerificationResult } from '../src/index.js';
import { makeAction, makePlan, memoryStore } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seeded() {
  const store = memoryStore();
  const plan = makePlan([makeAction(1), makeAction(2)]);
  const run = approveAndCreateRun({
    plan,
    store,
    approvedPlanId: plan.planId,
    now: new Date('2026-01-01T00:00:00Z'),
  });
  return { store, plan, run };
}

describe('SqliteStateStore', () => {
  it('creates one pending checkpoint per executable action and stores the plan', () => {
    const { store, plan, run } = seeded();
    expect(store.listCheckpoints(run.runId).map((c) => c.status)).toEqual(['pending', 'pending']);
    expect(store.getPlan(plan.planId)?.hash).toBe(plan.hash);
    expect(run.status).toBe('approved');
    expect(run.counts.pending).toBe(2);
  });

  it('write-ahead: markInFlight increments attempts and keeps the first in-flight timestamp', () => {
    const { store, plan, run } = seeded();
    const id = plan.actions[0]!.id;
    const first = store.markInFlight(run.runId, id);
    const second = store.markInFlight(run.runId, id);
    expect(first.attempts).toBe(1);
    expect(second.attempts).toBe(2);
    expect(second.inFlightSince).toBe(first.inFlightSince);
    expect(second.status).toBe('in_flight');
  });

  it('markSucceeded writes the checkpoint and the id mapping together', () => {
    const { store, plan, run } = seeded();
    const id = plan.actions[0]!.id;
    store.markInFlight(run.runId, id);
    const cp = store.markSucceeded(run.runId, id, {
      destinationId: 'D1',
      destinationUrl: 'https://example.test/D1',
      mapping: { sourceKey: 'test:item:1', scope: 'test:scope' },
    });
    expect(cp).toMatchObject({ status: 'succeeded', destinationId: 'D1' });
    expect(cp.inFlightSince).toBeUndefined();
    expect(store.getMapping('test:item:1', 'test:scope')?.destinationId).toBe('D1');
  });

  it('rolls back the whole transaction when the mapping conflicts', () => {
    const { store, plan, run } = seeded();
    const [a1, a2] = plan.actions;
    store.putMapping({
      sourceKey: 'test:item:2',
      scope: 'test:scope',
      destinationId: 'X',
      runId: run.runId,
    });
    store.markInFlight(run.runId, a2!.id);
    expect(() =>
      store.markSucceeded(run.runId, a2!.id, {
        destinationId: 'Y',
        mapping: { sourceKey: 'test:item:2', scope: 'test:scope' },
      }),
    ).toThrow(/already mapped/);
    expect(store.getCheckpoint(run.runId, a2!.id)?.status).toBe('in_flight');
    expect(a1).toBeDefined();
  });

  it('never resets a succeeded action to pending', () => {
    const { store, plan, run } = seeded();
    const id = plan.actions[0]!.id;
    store.markInFlight(run.runId, id);
    store.markSucceeded(run.runId, id, { destinationId: 'D1' });
    store.resetToPending(run.runId, id);
    expect(store.getCheckpoint(run.runId, id)?.status).toBe('succeeded');
    // and a failure report cannot overwrite success either
    store.markFailed(run.runId, id, 'failed', { code: 'X', message: 'late' });
    expect(store.getCheckpoint(run.runId, id)?.status).toBe('succeeded');
  });

  it('adopts skipped actions that already exist as mappings', () => {
    const store = memoryStore();
    const plan = makePlan([
      makeAction(1, { disposition: 'skip', existing: 'pre-1', outcome: 'skipped' }),
    ]);
    const run = approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: new Date() });
    expect(run.counts.skipped).toBe(1);
    expect(store.getMapping('test:item:1', 'test:scope')?.destinationId).toBe('pre-1');
  });

  it('tracks run status transitions and timestamps', () => {
    const { store, run } = seeded();
    store.setRunStatus(run.runId, 'applying', { startedAt: '2026-01-01T00:00:10.000Z' });
    store.setRunStatus(run.runId, 'stopped', {
      stopReason: 'because',
      finishedAt: '2026-01-01T00:00:20.000Z',
    });
    const got = store.getRun(run.runId)!;
    expect(got).toMatchObject({
      status: 'stopped',
      stopReason: 'because',
      startedAt: '2026-01-01T00:00:10.000Z',
    });
    store.setRunStatus(run.runId, 'applying', { stopReason: null });
    expect(store.getRun(run.runId)?.stopReason).toBeUndefined();
  });

  it('keeps an ordered, bounded event log', () => {
    const { store, run } = seeded();
    for (let i = 0; i < 5; i++) store.addEvent(run.runId, 'info', 't', `m${i}`);
    const all = store.listEvents(run.runId);
    expect(all.map((e) => e.message).slice(-5)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    const after = store.listEvents(run.runId, all[all.length - 3]!.id);
    expect(after).toHaveLength(2);
  });

  it('round-trips verification results', () => {
    const { store, plan, run } = seeded();
    const v: VerificationResult = {
      runId: run.runId,
      planId: plan.planId,
      verifiedAt: '2026-01-01T00:00:00.000Z',
      status: 'passed',
      counts: { verified: 2, mismatched: 0, missing: 0, unverified: 0 },
      targets: [],
      items: [],
      scope: 'test',
      notes: [],
    };
    store.saveVerification(v);
    expect(store.getVerification(run.runId)).toEqual(v);
  });

  it('persists to disk across reopen, with restrictive file permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exitos-state-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'state.db');
    const a = SqliteStateStore.open(path);
    const plan = makePlan([makeAction(1)]);
    const run = approveAndCreateRun({
      plan,
      store: a,
      approvedPlanId: plan.planId,
      now: new Date(),
    });
    a.markInFlight(run.runId, plan.actions[0]!.id);
    a.markSucceeded(run.runId, plan.actions[0]!.id, {
      destinationId: 'D1',
      mapping: { sourceKey: 'test:item:1', scope: 'test:scope' },
    });
    a.close();

    const b = SqliteStateStore.open(path);
    expect(b.latestRun()?.runId).toBe(run.runId);
    expect(b.getMapping('test:item:1', 'test:scope')?.destinationId).toBe('D1');
    b.close();

    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o077).toBe(0); // no group/other access
    }
  });

  it('can be opened read-only for the dashboard while another handle writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exitos-state-'));
    dirs.push(dir);
    const path = join(dir, 'state.db');
    const writer = SqliteStateStore.open(path);
    const plan = makePlan([makeAction(1)]);
    const run = approveAndCreateRun({
      plan,
      store: writer,
      approvedPlanId: plan.planId,
      now: new Date(),
    });
    const reader = SqliteStateStore.open(path, { readOnly: true });
    expect(reader.getRun(run.runId)?.status).toBe('approved');
    writer.setRunStatus(run.runId, 'applying');
    expect(reader.getRun(run.runId)?.status).toBe('applying');
    expect(() => reader.setRunStatus(run.runId, 'applied')).toThrow();
    reader.close();
    writer.close();
  });
});
