import type {
  IdMapping,
  MigrationCheckpoint,
  MigrationPlan,
  RunEvent,
  RunStatus,
  RunSummary,
  VerificationResult,
} from '../schema/index.js';

export interface NewRun {
  runId: string;
  plan: MigrationPlan;
  approvedAt: string;
}

export interface SucceededInput {
  destinationId: string;
  destinationUrl?: string | undefined;
  /** Written to the id map in the same transaction as the checkpoint. */
  mapping?: { sourceKey: string; scope: string } | undefined;
}

export type FailureStatus = 'failed' | 'ambiguous' | 'blocked';

/**
 * Persistence for runs, per-action checkpoints and source→destination id mappings.
 * The engine only talks to this interface; the default implementation is SQLite (ADR 0003).
 */
export interface StateStore {
  // plans & runs
  savePlan(plan: MigrationPlan): void;
  getPlan(planId: string): MigrationPlan | undefined;
  /** The most recently saved plan (so a dashboard can show a plan before any run exists). */
  latestPlan(): MigrationPlan | undefined;
  createRun(run: NewRun): RunSummary;
  getRun(runId: string): RunSummary | undefined;
  latestRun(): RunSummary | undefined;
  listRuns(): RunSummary[];
  setRunStatus(
    runId: string,
    status: RunStatus,
    extra?: { stopReason?: string | null; startedAt?: string; finishedAt?: string },
  ): RunSummary;

  // checkpoints
  getCheckpoint(runId: string, actionId: string): MigrationCheckpoint | undefined;
  listCheckpoints(runId: string): MigrationCheckpoint[];
  /** Write-ahead: persisted BEFORE the destination write is sent. Increments `attempts`. */
  markInFlight(runId: string, actionId: string): MigrationCheckpoint;
  markSucceeded(runId: string, actionId: string, input: SucceededInput): MigrationCheckpoint;
  markFailed(
    runId: string,
    actionId: string,
    status: FailureStatus,
    error: { code: string; message: string },
  ): MigrationCheckpoint;
  /** Return a non-succeeded action to `pending` (resume). Never touches succeeded actions. */
  resetToPending(runId: string, actionId: string): void;

  // id map
  getMapping(sourceKey: string, scope: string): IdMapping | undefined;
  listMappings(): IdMapping[];
  /** Record a destination item discovered via its provenance marker (adoption). */
  putMapping(mapping: Omit<IdMapping, 'createdAt'>): IdMapping;

  // events & verification
  addEvent(runId: string, level: RunEvent['level'], type: string, message: string): void;
  listEvents(runId: string, afterId?: number, limit?: number): RunEvent[];
  saveVerification(result: VerificationResult): void;
  getVerification(runId: string): VerificationResult | undefined;

  close(): void;
}
