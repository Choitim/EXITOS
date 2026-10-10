/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import type { DashboardState, RunEvent } from '@exitos/core/schema';
import { describe, expect, it } from 'vitest';
import { runProgress } from '../src/lib/format';
import { REPLAY_DURATION_MS, buildReplay, frameAt } from '../src/lib/replay';
import { counts, makeRun } from './fixtures';

const RUN_ID = 'run_20261008090028_3b63f1';

function event(id: number, type: string, message: string, runId = RUN_ID): RunEvent {
  return {
    id,
    runId,
    ts: `2026-10-08T09:00:${String(id % 60).padStart(2, '0')}.000Z`,
    level: 'info',
    type,
    message,
  };
}

/** The shape of the engine's own log: approved, started, N writes (one recovered), finished, verified. */
function recordedLog(writes: number, runId = RUN_ID): RunEvent[] {
  const log = [event(1, 'approved', 'Plan plan_x approved.', runId)];
  log.push(event(2, 'run_started', 'Run started.', runId));
  for (let i = 0; i < writes; i += 1) {
    if (i === 40)
      log.push(event(log.length + 1, 'action_reconciled', 'Create task "T40": found', runId));
    log.push(
      event(log.length + 1, 'action_succeeded', `Create task "T${i}" in list "Bugs"`, runId),
    );
  }
  log.push(event(log.length + 1, 'run_finished', 'All actions applied. Not verified yet.', runId));
  log.push(
    event(
      log.length + 1,
      'verification',
      `Verification passed: ${writes} verified, 0 mismatched, 0 missing, 0 unverified.`,
      runId,
    ),
  );
  return log;
}

const state = (events: RunEvent[], runCounts = counts({ succeeded: 175 })) =>
  ({ run: makeRun({ runId: RUN_ID, counts: runCounts }), events }) satisfies Pick<
    DashboardState,
    'run' | 'events'
  >;

function sweep(timelineState: Pick<DashboardState, 'run' | 'events'>) {
  const timeline = buildReplay(timelineState);
  if (timeline === null) throw new Error('no timeline');
  const frames = [];
  for (let t = 0; t < timeline.durationMs; t += 7) frames.push(frameAt(timeline, t));
  frames.push(frameAt(timeline, timeline.durationMs));
  return { timeline, frames };
}

describe('buildReplay', () => {
  it('has nothing to replay without a run or without events', () => {
    expect(buildReplay({ run: null, events: recordedLog(3) })).toBeNull();
    expect(buildReplay({ run: makeRun({ runId: RUN_ID }), events: [] })).toBeNull();
    // events of another run do not count
    expect(buildReplay(state(recordedLog(3, 'run_other')))).toBeNull();
  });

  it('reads the totals from the recorded run counts, not from anything else', () => {
    const timeline = buildReplay(state(recordedLog(175)));
    expect(timeline).not.toBeNull();
    expect(timeline?.events).toHaveLength(180);
    expect(timeline?.total).toBe(175);
    expect(timeline?.finalDone).toBe(175);
    expect(timeline?.unexplainedDone).toBe(0);
    expect(timeline?.durationMs).toBe(REPLAY_DURATION_MS);
  });

  it('takes about nine seconds, the window the brief asks for', () => {
    expect(REPLAY_DURATION_MS).toBeGreaterThanOrEqual(8_000);
    expect(REPLAY_DURATION_MS).toBeLessThanOrEqual(10_000);
  });

  it('orders events by id and ignores other runs', () => {
    const log = recordedLog(5);
    const shuffled = [...log].reverse();
    const timeline = buildReplay(
      state(
        [...shuffled, event(999, 'action_succeeded', 'x', 'run_other')],
        counts({ succeeded: 5 }),
      ),
    );
    expect(timeline?.events.map((e) => e.id)).toEqual(log.map((e) => e.id));
  });
});

describe('frameAt', () => {
  it('starts empty and ends at the recorded totals', () => {
    const { timeline, frames } = sweep(state(recordedLog(175)));
    const first = frames[0];
    expect(first).toMatchObject({
      revealed: 0,
      done: 0,
      total: 175,
      percent: 0,
      finished: false,
      milestone: null,
      counts: null,
    });
    const last = frameAt(timeline, timeline.durationMs);
    expect(last).toMatchObject({
      revealed: 180,
      done: 175,
      total: 175,
      percent: 100,
      finished: true,
    });
    expect(last.counts).toEqual(counts({ succeeded: 175 }));
    expect(last.milestone?.type).toBe('verification');
  });

  it('never goes backwards and never shows more than was recorded', () => {
    const { timeline, frames } = sweep(state(recordedLog(175)));
    for (let i = 1; i < frames.length; i += 1) {
      const [a, b] = [frames[i - 1], frames[i]];
      expect(b?.revealed).toBeGreaterThanOrEqual(a?.revealed ?? 0);
      expect(b?.done).toBeGreaterThanOrEqual(a?.done ?? 0);
      expect(b?.ratio).toBeGreaterThanOrEqual(a?.ratio ?? 0);
      expect(b?.elapsedMs).toBeGreaterThan(a?.elapsedMs ?? -1);
    }
    for (const frame of frames) {
      expect(frame.done).toBeLessThanOrEqual(timeline.finalDone);
      expect(frame.revealed).toBeLessThanOrEqual(timeline.events.length);
    }
  });

  it('counts only writes that are in the events it has shown (nothing is invented)', () => {
    const { timeline, frames } = sweep(state(recordedLog(175)));
    const seen = new Set<number>();
    for (const frame of frames) {
      const shown = timeline.events.slice(0, frame.revealed);
      expect(frame.done).toBe(shown.filter((e) => e.type === 'action_succeeded').length);
      seen.add(frame.done);
    }
    // every integer between 0 and the total was passed through, in order: no jumps, no made-up values
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 176 }, (_x, i) => i));
  });

  it('shows the recorded events themselves, in the recorded order', () => {
    const log = recordedLog(20);
    const timeline = buildReplay(state(log, counts({ succeeded: 20 })));
    if (timeline === null) throw new Error('no timeline');
    const middle = frameAt(timeline, timeline.durationMs / 2);
    expect(timeline.events.slice(0, middle.revealed)).toEqual(log.slice(0, middle.revealed));
  });

  it('tracks the latest stage of the run', () => {
    const timeline = buildReplay(state(recordedLog(10), counts({ succeeded: 10 })));
    if (timeline === null) throw new Error('no timeline');
    const at = (revealed: number) =>
      frameAt(timeline, ((revealed + 0.5) / timeline.events.length) * timeline.durationMs).milestone
        ?.type ?? null;
    expect(at(0)).toBeNull();
    expect(at(1)).toBe('approved');
    expect(at(2)).toBe('run_started');
    expect(at(8)).toBe('run_started');
    expect(at(timeline.events.length - 1)).toBe('run_finished');
    expect(at(timeline.events.length)).toBe('verification');
  });

  it('clamps odd times', () => {
    const timeline = buildReplay(state(recordedLog(10), counts({ succeeded: 10 })));
    if (timeline === null) throw new Error('no timeline');
    expect(frameAt(timeline, -50).revealed).toBe(0);
    expect(frameAt(timeline, Number.NaN).revealed).toBe(0);
    expect(frameAt(timeline, Number.NEGATIVE_INFINITY).revealed).toBe(0);
    expect(frameAt(timeline, Number.POSITIVE_INFINITY).finished).toBe(true);
    expect(frameAt(timeline, timeline.durationMs * 3)).toMatchObject({
      finished: true,
      done: 10,
      elapsedMs: timeline.durationMs,
    });
  });

  it('ends at what the run really recorded, not at 100%, when the run did not finish cleanly', () => {
    const runCounts = counts({ succeeded: 6, failed: 2, blocked: 1, pending: 1 });
    const timeline = buildReplay(state(recordedLog(6), runCounts));
    if (timeline === null) throw new Error('no timeline');
    const last = frameAt(timeline, timeline.durationMs);
    expect(last.total).toBe(10);
    expect(last.done).toBe(6);
    expect(last.percent).toBe(60);
    expect(last.counts).toEqual(runCounts);
    expect(last.ratio).toBeLessThan(1);
  });

  it('counts skipped actions as done from the start, and says so', () => {
    const runCounts = counts({ succeeded: 8, skipped: 3 });
    const { timeline, frames } = sweep(state(recordedLog(8), runCounts));
    expect(timeline.unexplainedDone).toBe(3);
    expect(frames[0]?.done).toBe(3);
    expect(frames.at(-1)?.done).toBe(11);
    expect(frames.at(-1)?.total).toBe(11);
  });

  it('copes with a log that was cut to its latest events', () => {
    // 250 writes in the run, but only the last 100 events are kept
    const log = recordedLog(100);
    const { timeline, frames } = sweep(state(log, counts({ succeeded: 250 })));
    expect(timeline.unexplainedDone).toBe(150);
    expect(frames[0]?.done).toBe(150);
    expect(frames.at(-1)).toMatchObject({ done: 250, total: 250, finished: true });
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i]?.done).toBeGreaterThanOrEqual(frames[i - 1]?.done ?? 0);
    }
  });

  it('never shows more than the recorded counts allow, even if the log has extra success events', () => {
    const { timeline, frames } = sweep(state(recordedLog(12), counts({ succeeded: 10 })));
    expect(Math.max(...frames.map((f) => f.done))).toBe(10);
    expect(frames.at(-1)?.done).toBe(timeline.finalDone);
  });
});

describe('the recorded demo (when it has been built)', () => {
  const file = new URL('../dist-demo/demo-state.json', import.meta.url);

  it.skipIf(!existsSync(file))('replays to the numbers in the recording', () => {
    const recorded = JSON.parse(readFileSync(file, 'utf8')) as DashboardState;
    const timeline = buildReplay(recorded);
    if (timeline === null || recorded.run === null) throw new Error('the recording has no run');
    const expected = runProgress(recorded.run.counts);
    const last = frameAt(timeline, timeline.durationMs);
    expect(last.done).toBe(expected.done);
    expect(last.total).toBe(expected.total);
    expect(last.counts).toEqual(recorded.run.counts);
    expect(timeline.unexplainedDone).toBe(0);
    expect(timeline.events).toHaveLength(recorded.events.length);
    const successes = recorded.events.filter((e) => e.type === 'action_succeeded').length;
    expect(successes).toBe(recorded.run.counts.succeeded);
  });
});
