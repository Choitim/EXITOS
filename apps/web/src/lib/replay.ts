/**
 * The replay behind the online demo's "Simulate the migration" step.
 *
 * Nothing here simulates anything. The static demo ships the state that the real ExitOS engine
 * recorded during its offline demo (plan, run counts, event log, verification). The replay walks
 * that recorded event log from the first event to the last, in a fixed number of seconds, and
 * reads every number it shows from it:
 *
 *   - the events shown at time t are a PREFIX of the recorded events (their own messages and
 *     recorded timestamps, in the recorded order);
 *   - "actions written" at time t is the number of `action_succeeded` events in that prefix;
 *   - when the last event has been shown, the figures are exactly the recorded run counts.
 *
 * Only the pacing is ours: events are spread evenly over the replay's duration. Pure functions, no
 * DOM, so the derivation can be unit-tested in Node.
 */
import type { DashboardState, RunEvent } from '@exitos/core/schema';
import { runProgress, type RunCounts } from './format';

/** How long the replay takes. The recorded run itself is not replayed in real time. */
export const REPLAY_DURATION_MS = 9_000;

/** Event types that mark a stage of the run (as opposed to one write). */
const MILESTONE_TYPES: ReadonlySet<string> = new Set([
  'approved',
  'run_started',
  'run_stopped',
  'run_finished',
  'verification',
]);

export interface ReplayTimeline {
  /** The recorded events of the run, oldest first. */
  events: readonly RunEvent[];
  /** `written[i]` = `action_succeeded` events among the first `i` events (`written[0]` is 0). */
  written: readonly number[];
  /** `lastMilestone[i]` = index of the latest milestone event among the first `i` events, or -1. */
  lastMilestone: readonly number[];
  /**
   * Actions that the recorded counts say are done but that no retained event explains (skipped
   * actions, or writes older than the retained event window). Counted as done from the start;
   * 0 for a complete log such as the demo's.
   */
  unexplainedDone: number;
  /** Every action of the run, from the recorded counts. */
  total: number;
  /** Actions written or skipped at the end, from the recorded counts. */
  finalDone: number;
  /** The recorded run counts, shown once the replay has finished. */
  recorded: RunCounts;
  durationMs: number;
}

export interface ReplayFrame {
  /** The elapsed time the frame was computed for, clamped to the replay's duration. */
  elapsedMs: number;
  /** How many recorded events have been shown. */
  revealed: number;
  /** Actions written or skipped so far. */
  done: number;
  total: number;
  /** 0..1 */
  ratio: number;
  /** Whole percent, 0..100 (rounded down, like the Progress section). */
  percent: number;
  /** True when every recorded event has been shown. */
  finished: boolean;
  /** The latest stage-level event shown (plan approved, run started, run finished, verification). */
  milestone: RunEvent | null;
  /** The recorded run counts; only present once the replay has finished. */
  counts: RunCounts | null;
}

/**
 * Builds the timeline from a recorded state, or `null` when there is nothing to replay (no run,
 * or a run without events).
 */
export function buildReplay(
  state: Pick<DashboardState, 'run' | 'events'>,
  durationMs: number = REPLAY_DURATION_MS,
): ReplayTimeline | null {
  const { run } = state;
  if (run === null) return null;
  const events = state.events
    .filter((event) => event.runId === run.runId)
    .sort((a, b) => a.id - b.id);
  if (events.length === 0) return null;

  const written: number[] = [0];
  const lastMilestone: number[] = [-1];
  let successes = 0;
  let milestone = -1;
  events.forEach((event, index) => {
    if (event.type === 'action_succeeded') successes += 1;
    if (MILESTONE_TYPES.has(event.type)) milestone = index;
    written.push(successes);
    lastMilestone.push(milestone);
  });

  const progress = runProgress(run.counts);
  return {
    events,
    written,
    lastMilestone,
    unexplainedDone: Math.max(0, progress.done - successes),
    total: progress.total,
    finalDone: progress.done,
    recorded: run.counts,
    durationMs,
  };
}

/** The replay as it looks `elapsedMs` after it started. Monotonic in `elapsedMs`. */
export function frameAt(timeline: ReplayTimeline, elapsedMs: number): ReplayFrame {
  const { events, durationMs } = timeline;
  const count = events.length;
  const elapsed = Number.isNaN(elapsedMs) ? 0 : Math.min(Math.max(elapsedMs, 0), durationMs);
  const revealed =
    elapsed >= durationMs ? count : Math.min(count, Math.floor((elapsed / durationMs) * count));
  const finished = revealed === count;

  const done = finished
    ? timeline.finalDone
    : Math.min(timeline.finalDone, timeline.unexplainedDone + (timeline.written[revealed] ?? 0));
  const ratio = timeline.total > 0 ? Math.min(1, done / timeline.total) : 0;
  const milestoneIndex = timeline.lastMilestone[revealed] ?? -1;

  return {
    elapsedMs: elapsed,
    revealed,
    done,
    total: timeline.total,
    ratio,
    percent: Math.floor(ratio * 100),
    finished,
    milestone: milestoneIndex >= 0 ? (events[milestoneIndex] ?? null) : null,
    counts: finished ? timeline.recorded : null,
  };
}
