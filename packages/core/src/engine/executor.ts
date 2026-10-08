import {
  AbortedError,
  AmbiguousWriteError,
  ApiError,
  SimulatedInterruptError,
  nullLogger,
  toSafeMessage,
  type Clock,
  type Logger,
} from '@exitos/shared';
import type {
  MigrationAction,
  MigrationCheckpoint,
  MigrationPlan,
  RunStatus,
} from '../schema/index.js';
import type { ApplyContext, DestinationConnector, ReconcileResult } from '../sdk/types.js';
import { StateConflictError } from '../state/sqlite-store.js';
import type { StateStore } from '../state/store.js';

export type ExecutorEvent =
  | { type: 'run_started'; runId: string; total: number; resumed: boolean }
  | { type: 'action_started'; actionId: string; label: string; attempt: number }
  | { type: 'action_succeeded'; actionId: string; label: string; destinationId: string }
  | { type: 'action_failed'; actionId: string; label: string; message: string }
  | { type: 'action_blocked'; actionId: string; label: string }
  | {
      type: 'action_reconciled';
      actionId: string;
      label: string;
      outcome: 'found' | 'not_found' | 'undecidable';
    }
  | { type: 'run_stopped'; reason: string }
  | { type: 'run_finished'; status: RunStatus };

export interface ExecuteOptions {
  plan: MigrationPlan;
  destination: DestinationConnector;
  store: StateStore;
  runId: string;
  concurrency: number;
  clock: Clock;
  logger?: Logger;
  signal?: AbortSignal;
  /** Stop abruptly (as if the process died) after this many newly succeeded actions. */
  interruptAfter?: number;
  /** Consecutive item failures before the run stops itself. Default 5. */
  maxConsecutiveFailures?: number;
  /** Send attempts for an action whose earlier write was proven not to have happened. Default 3. */
  maxAttempts?: number;
  /** Action ids the operator confirmed were NOT created in the destination (explicit override). */
  assumeNotCreated?: readonly string[];
  onEvent?: (event: ExecutorEvent) => void;
  /** Test seam: runs after the destination write returns and before the checkpoint is saved. */
  afterWrite?: (action: MigrationAction) => void | Promise<void>;
}

export interface ExecuteResult {
  status: RunStatus;
  stopReason?: string;
}

/** Signals that the whole run must stop (as opposed to one item failing). */
class StopRun extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Execute (or resume) an approved plan.
 *
 * Guarantees:
 *  - every write is preceded by a persisted `in_flight` checkpoint (write-ahead);
 *  - a write with an unknown outcome is reconciled, never blindly re-sent (ADR 0007);
 *  - the destination id is recorded in the id map in the same transaction as the checkpoint, and a
 *    second, different destination for the same source is refused (duplicate prevention);
 *  - the run is only `applied` when every action is succeeded or skipped — never otherwise.
 */
export async function executePlan(options: ExecuteOptions): Promise<ExecuteResult> {
  const { plan, destination, store, runId } = options;
  const logger = options.logger ?? nullLogger;
  const emit = (event: ExecutorEvent): void => options.onEvent?.(event);
  const maxFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_FAILURES;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const assume = new Set(options.assumeNotCreated ?? []);
  const nowIso = (): string => new Date(options.clock.now()).toISOString();

  const run = store.getRun(runId);
  if (!run) throw new Error(`Run ${runId} does not exist.`);
  const resumed = run.startedAt !== undefined;
  store.setRunStatus(runId, 'applying', {
    stopReason: null,
    ...(resumed ? {} : { startedAt: nowIso() }),
  });
  emit({ type: 'run_started', runId, total: plan.actions.length, resumed });
  store.addEvent(runId, 'info', 'run_started', resumed ? 'Resuming run.' : 'Run started.');

  // ---- resume preparation: a previous process may have died mid-write -----------------------
  for (const cp of store.listCheckpoints(runId)) {
    if (cp.status === 'in_flight') {
      store.markFailed(runId, cp.actionId, 'ambiguous', {
        code: 'INTERRUPTED',
        message: 'The process stopped while this write was in flight.',
      });
    } else if (cp.status === 'failed' || cp.status === 'blocked') {
      store.resetToPending(runId, cp.actionId);
    }
  }

  const index = new Map(plan.actions.map((a, i) => [a.id, i]));
  const actionAt = (i: number): MigrationAction => plan.actions[i] as MigrationAction;

  let consecutiveFailures = 0;
  let newSuccesses = 0;
  let stop: StopRun | undefined;

  const applyContext = (attempt: number): ApplyContext => ({
    runId,
    attempt,
    resolveDependency: (actionId) => {
      const cp = store.getCheckpoint(runId, actionId);
      if (cp?.destinationId === undefined) return undefined;
      return {
        destinationId: cp.destinationId,
        ...(cp.destinationUrl === undefined ? {} : { destinationUrl: cp.destinationUrl }),
      };
    },
    lookupBySource: (sourceKey, scope) => {
      const mapping = store.getMapping(sourceKey, scope);
      if (!mapping) return undefined;
      return {
        destinationId: mapping.destinationId,
        ...(mapping.destinationUrl === undefined ? {} : { destinationUrl: mapping.destinationUrl }),
      };
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  const markSucceeded = (
    action: MigrationAction,
    result: { destinationId: string; destinationUrl?: string },
  ): void => {
    store.markSucceeded(runId, action.id, {
      destinationId: result.destinationId,
      destinationUrl: result.destinationUrl,
      mapping: { sourceKey: action.idempotencyKey, scope: action.scope },
    });
    store.addEvent(runId, 'info', 'action_succeeded', action.label);
    emit({
      type: 'action_succeeded',
      actionId: action.id,
      label: action.label,
      destinationId: result.destinationId,
    });
  };

  const reconcile = async (
    action: MigrationAction,
    cp: MigrationCheckpoint,
  ): Promise<ReconcileResult> => {
    if (!destination.reconcile) {
      return {
        status: 'undecidable',
        reason: 'This destination connector cannot reconcile ambiguous writes.',
      };
    }
    const result = await destination.reconcile(action, {
      since: cp.inFlightSince ?? nowIso(),
      attempt: cp.attempts,
      resolveDependency: (id) => applyContext(cp.attempts).resolveDependency(id),
    });
    emit({
      type: 'action_reconciled',
      actionId: action.id,
      label: action.label,
      outcome: result.status,
    });
    store.addEvent(runId, 'info', 'action_reconciled', `${action.label}: ${result.status}`);
    return result;
  };

  const safeReconcile = async (
    action: MigrationAction,
    cp: MigrationCheckpoint,
  ): Promise<ReconcileResult> => {
    try {
      return await reconcile(action, cp);
    } catch (error) {
      return { status: 'undecidable', reason: toSafeMessage(error) };
    }
  };

  const cannotTell = (action: MigrationAction, reason?: string): StopRun =>
    new StopRun(
      `Cannot tell whether "${action.label}" was created${reason ? ` (${reason})` : ''}. ` +
        `Check the destination, then run: exitos resume --assume-not-created ${action.id}`,
    );

  // ---- phase 1: settle writes left ambiguous by a previous process --------------------------
  for (const cp of store.listCheckpoints(runId)) {
    if (cp.status !== 'ambiguous') continue;
    const action = actionAt(index.get(cp.actionId) ?? -1);
    if (assume.has(action.id)) {
      store.resetToPending(runId, action.id);
      store.addEvent(
        runId,
        'warn',
        'assume_not_created',
        `Operator confirmed "${action.label}" was not created.`,
      );
      continue;
    }
    const outcome = await safeReconcile(action, cp);
    if (outcome.status === 'found') {
      markSucceeded(action, outcome);
    } else if (outcome.status === 'not_found' && outcome.confident) {
      store.resetToPending(runId, action.id);
    } else {
      stop = cannotTell(
        action,
        outcome.status === 'undecidable'
          ? outcome.reason
          : 'the destination listing may be incomplete',
      );
      break;
    }
  }

  // ---- phase 2: dependency-ordered execution with bounded concurrency -----------------------
  const dependents = new Map<string, string[]>();
  const remaining = new Map<string, number>();
  const done = new Set<string>();
  for (const cp of store.listCheckpoints(runId)) {
    if (cp.status === 'succeeded' || cp.status === 'skipped') done.add(cp.actionId);
  }
  for (const action of plan.actions) {
    for (const dep of action.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), action.id]);
    }
    remaining.set(action.id, action.dependsOn.filter((d) => !done.has(d)).length);
  }

  /** Indices (into plan.actions) of actions ready to run, ascending = plan order. */
  const ready: number[] = [];
  const enqueue = (id: string): void => {
    const i = index.get(id) as number;
    let lo = 0;
    let hi = ready.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((ready[mid] as number) < i) lo = mid + 1;
      else hi = mid;
    }
    ready.splice(lo, 0, i);
  };
  for (const action of plan.actions) {
    const status = store.getCheckpoint(runId, action.id)?.status;
    if (status === 'pending' && remaining.get(action.id) === 0) enqueue(action.id);
  }

  const release = (id: string): void => {
    for (const next of dependents.get(id) ?? []) {
      const left = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, left);
      if (left === 0 && store.getCheckpoint(runId, next)?.status === 'pending') enqueue(next);
    }
  };

  const blockDependents = (id: string): void => {
    const stack = [...(dependents.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      const cp = store.getCheckpoint(runId, next);
      if (cp?.status !== 'pending') continue;
      store.markFailed(runId, next, 'blocked', {
        code: 'DEPENDENCY_FAILED',
        message: 'A prerequisite action did not succeed.',
      });
      const blocked = actionAt(index.get(next) as number);
      emit({ type: 'action_blocked', actionId: blocked.id, label: blocked.label });
      stack.push(...(dependents.get(next) ?? []));
    }
  };

  const runOne = async (action: MigrationAction): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) throw new AbortedError();
      const cp = store.markInFlight(runId, action.id);
      const attempt = cp.attempts;
      emit({ type: 'action_started', actionId: action.id, label: action.label, attempt });
      try {
        const result = await destination.apply(action, applyContext(attempt));
        await options.afterWrite?.(action);
        markSucceeded(action, result);
        consecutiveFailures = 0;
        newSuccesses += 1;
        release(action.id);
        return;
      } catch (error) {
        if (error instanceof SimulatedInterruptError) throw error;

        if (error instanceof AbortedError) {
          store.markFailed(runId, action.id, 'ambiguous', {
            code: 'ABORTED',
            message: 'Interrupted while the write was in flight.',
          });
          throw error;
        }

        if (error instanceof AmbiguousWriteError) {
          store.markFailed(runId, action.id, 'ambiguous', {
            code: error.code,
            message: toSafeMessage(error),
          });
          const outcome = await safeReconcile(
            action,
            store.getCheckpoint(runId, action.id) as MigrationCheckpoint,
          );
          if (outcome.status === 'found') {
            markSucceeded(action, outcome);
            consecutiveFailures = 0;
            newSuccesses += 1;
            release(action.id);
            return;
          }
          if (outcome.status === 'not_found' && outcome.confident && attempt < maxAttempts) {
            logger.warn('Write had no effect; sending again', { action: action.id, attempt });
            store.resetToPending(runId, action.id);
            continue;
          }
          throw cannotTell(
            action,
            outcome.status === 'undecidable'
              ? outcome.reason
              : 'the destination listing may be incomplete',
          );
        }

        if (error instanceof StateConflictError) {
          // The item exists in the destination but its source is already mapped elsewhere: a
          // duplicate. Stop everything rather than risk creating more.
          store.markFailed(runId, action.id, 'failed', {
            code: 'DUPLICATE_DETECTED',
            message: toSafeMessage(error),
          });
          throw new StopRun(
            `Duplicate detected for "${action.label}": its source is already mapped to a different destination item. Inspect the destination before resuming.`,
          );
        }

        const message = toSafeMessage(error);
        const code = error instanceof ApiError ? `HTTP_${error.status}` : 'ACTION_FAILED';
        store.markFailed(runId, action.id, 'failed', { code, message });
        store.addEvent(runId, 'error', 'action_failed', `${action.label}: ${message}`);
        emit({ type: 'action_failed', actionId: action.id, label: action.label, message });
        blockDependents(action.id);
        consecutiveFailures += 1;
        if (error instanceof ApiError && error.status === 429) {
          throw new StopRun(
            'The destination is rate limiting and retries were exhausted. Wait a few minutes, then run `exitos resume`.',
          );
        }
        if (error instanceof ApiError && error.isAuthFailure) {
          throw new StopRun(
            'The destination rejected the credential (HTTP 401/403). Fix the token or its permissions, then run `exitos resume`.',
          );
        }
        if (consecutiveFailures >= maxFailures) {
          throw new StopRun(`Stopped after ${maxFailures} consecutive failures.`);
        }
        return;
      }
    }
  };

  const running = new Map<string, Promise<void>>();
  try {
    for (;;) {
      if (options.signal?.aborted) throw new AbortedError();
      const interruptReached =
        options.interruptAfter !== undefined && newSuccesses >= options.interruptAfter;
      if (interruptReached) break;

      while (
        stop === undefined &&
        ready.length > 0 &&
        running.size < Math.max(1, options.concurrency) &&
        (options.interruptAfter === undefined ||
          newSuccesses + running.size < options.interruptAfter)
      ) {
        const action = actionAt(ready.shift() as number);
        const task = runOne(action)
          .catch((error: unknown) => {
            if (error instanceof StopRun) stop ??= error;
            else throw error;
          })
          .finally(() => {
            running.delete(action.id);
          });
        running.set(action.id, task);
      }
      if (running.size === 0) break;
      await Promise.race(running.values());
    }
    await Promise.all(running.values());
  } catch (error) {
    // Let in-flight work settle so their checkpoints are accurate before propagating.
    await Promise.allSettled(running.values());
    if (error instanceof AbortedError) {
      const reason = 'Interrupted by the operator.';
      store.setRunStatus(runId, 'stopped', { stopReason: reason });
      emit({ type: 'run_stopped', reason });
      return { status: 'stopped', stopReason: reason };
    }
    throw error;
  }

  if (options.interruptAfter !== undefined && newSuccesses >= options.interruptAfter) {
    const unfinished = store.getRun(runId)?.counts.pending ?? 0;
    if (unfinished > 0) {
      // Deliberately leave the run as `applying`, exactly like a crashed process would.
      throw new SimulatedInterruptError(newSuccesses);
    }
  }

  const counts = store.getRun(runId)?.counts;
  const stopped = stop;
  const allDone =
    counts !== undefined &&
    counts.pending === 0 &&
    counts.in_flight === 0 &&
    counts.failed === 0 &&
    counts.ambiguous === 0 &&
    counts.blocked === 0;

  if (allDone && stopped === undefined) {
    store.setRunStatus(runId, 'applied', { finishedAt: nowIso() });
    store.addEvent(runId, 'info', 'run_finished', 'All actions applied. Not verified yet.');
    emit({ type: 'run_finished', status: 'applied' });
    return { status: 'applied' };
  }

  const status: RunStatus = stopped !== undefined ? 'stopped' : 'failed';
  const reason =
    stopped?.reason ??
    `${counts?.failed ?? 0} action(s) failed and ${counts?.blocked ?? 0} were blocked by them.`;
  store.setRunStatus(runId, status, { stopReason: reason, finishedAt: nowIso() });
  store.addEvent(runId, 'error', 'run_stopped', reason);
  emit({ type: 'run_stopped', reason });
  emit({ type: 'run_finished', status });
  return { status, stopReason: reason };
}
