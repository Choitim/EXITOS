import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type * as Sqlite from 'node:sqlite';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { ExitOsError } from '@exitos/shared';
import {
  MigrationPlanSchema,
  VerificationResultSchema,
  type ActionStatus,
  type IdMapping,
  type MigrationCheckpoint,
  type MigrationPlan,
  type RunEvent,
  type RunStatus,
  type RunSummary,
  type VerificationResult,
} from '../schema/index.js';
import type { FailureStatus, NewRun, StateStore, SucceededInput } from './store.js';

const SCHEMA_VERSION = '1';

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY, hash TEXT NOT NULL, mode TEXT NOT NULL, json TEXT NOT NULL, saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(plan_id), plan_hash TEXT NOT NULL,
  mode TEXT NOT NULL, status TEXT NOT NULL, approved_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  updated_at TEXT NOT NULL, stop_reason TEXT
);
CREATE TABLE IF NOT EXISTS actions (
  run_id TEXT NOT NULL REFERENCES runs(run_id), action_id TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, destination_id TEXT, destination_url TEXT,
  last_error_code TEXT, last_error_message TEXT, in_flight_since TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, action_id)
);
CREATE TABLE IF NOT EXISTS id_map (
  source_key TEXT NOT NULL, scope TEXT NOT NULL, destination_id TEXT NOT NULL, destination_url TEXT,
  run_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (source_key, scope)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts TEXT NOT NULL, level TEXT NOT NULL,
  type TEXT NOT NULL, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events (run_id, id);
CREATE TABLE IF NOT EXISTS verifications (run_id TEXT PRIMARY KEY, verified_at TEXT NOT NULL, json TEXT NOT NULL);
`;

export class StateConflictError extends ExitOsError {
  constructor(message: string) {
    super('STATE_CONFLICT', message);
  }
}

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string => {
  const v = row[key];
  if (typeof v !== 'string')
    throw new ExitOsError('STATE_CORRUPT', `State column "${key}" is not text.`);
  return v;
};
const optStr = (row: Row, key: string): string | undefined => {
  const v = row[key];
  return typeof v === 'string' ? v : undefined;
};
const num = (row: Row, key: string): number => {
  const v = row[key];
  if (typeof v !== 'number' && typeof v !== 'bigint') {
    throw new ExitOsError('STATE_CORRUPT', `State column "${key}" is not a number.`);
  }
  return Number(v);
};

/** `node:sqlite` prints an ExperimentalWarning on first load; silence only that one (ADR 0003). */
function loadSqlite(): typeof Sqlite {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- only restored below, never invoked unbound
  const original = process.emitWarning;
  const forward = original.bind(process) as (...args: unknown[]) => void;
  process.emitWarning = (warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/SQLite is an experimental feature/i.test(text)) return;
    forward(warning, ...rest);
  };
  try {
    return createRequire(import.meta.url)('node:sqlite') as typeof Sqlite;
  } finally {
    process.emitWarning = original;
  }
}

export interface SqliteStoreOptions {
  readOnly?: boolean;
  /** Injectable clock (ISO strings), for deterministic tests. */
  now?: () => string;
}

export class SqliteStateStore implements StateStore {
  readonly #db: DatabaseSync;
  readonly #now: () => string;
  readonly #stmts = new Map<string, StatementSync>();

  private constructor(db: DatabaseSync, now: () => string) {
    this.#db = db;
    this.#now = now;
  }

  /** Open (creating if needed) the state database at `path`, or `:memory:` for tests. */
  static open(path: string, options: SqliteStoreOptions = {}): SqliteStateStore {
    const { DatabaseSync: Database } = loadSqlite();
    const isMemory = path === ':memory:';
    if (!isMemory && !options.readOnly) {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const db = new Database(path, options.readOnly ? { readOnly: true } : {});
    const store = new SqliteStateStore(db, options.now ?? (() => new Date().toISOString()));
    db.exec('PRAGMA busy_timeout = 5000;');
    if (!options.readOnly) {
      if (!isMemory) db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
      db.exec(DDL);
      db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
        'schema_version',
        SCHEMA_VERSION,
      );
      if (!isMemory) {
        try {
          chmodSync(path, 0o600);
        } catch {
          /* best effort on platforms without POSIX modes */
        }
      }
    }
    return store;
  }

  #stmt(sql: string): StatementSync {
    let s = this.#stmts.get(sql);
    if (!s) {
      s = this.#db.prepare(sql);
      this.#stmts.set(sql, s);
    }
    return s;
  }

  #all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.#stmt(sql).all(...params);
  }

  #get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.#stmt(sql).get(...params);
  }

  #run(sql: string, ...params: SQLInputValue[]): void {
    this.#stmt(sql).run(...params);
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---- plans & runs ------------------------------------------------------------------------

  savePlan(plan: MigrationPlan): void {
    this.#run(
      `INSERT INTO plans (plan_id, hash, mode, json, saved_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(plan_id) DO UPDATE SET saved_at = excluded.saved_at`,
      plan.planId,
      plan.hash,
      plan.mode,
      JSON.stringify(plan),
      this.#now(),
    );
  }

  getPlan(planId: string): MigrationPlan | undefined {
    const row = this.#get('SELECT json FROM plans WHERE plan_id = ?', planId);
    return row ? MigrationPlanSchema.parse(JSON.parse(str(row, 'json'))) : undefined;
  }

  latestPlan(): MigrationPlan | undefined {
    const row = this.#get('SELECT json FROM plans ORDER BY saved_at DESC, rowid DESC LIMIT 1');
    return row ? MigrationPlanSchema.parse(JSON.parse(str(row, 'json'))) : undefined;
  }

  createRun(run: NewRun): RunSummary {
    const { plan } = run;
    this.#tx(() => {
      this.savePlan(plan);
      const now = this.#now();
      this.#run(
        `INSERT INTO runs (run_id, plan_id, plan_hash, mode, status, approved_at, updated_at)
         VALUES (?, ?, ?, ?, 'approved', ?, ?)`,
        run.runId,
        plan.planId,
        plan.hash,
        plan.mode,
        run.approvedAt,
        now,
      );
      for (const action of plan.actions) {
        const skipped = action.disposition === 'skip';
        this.#run(
          `INSERT INTO actions (run_id, action_id, status, destination_id, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          run.runId,
          action.id,
          skipped ? 'skipped' : 'pending',
          action.existingDestinationId ?? null,
          now,
        );
        if (skipped && action.existingDestinationId !== undefined) {
          // Adopted items become mappings so later runs never recreate them.
          this.#run(
            `INSERT OR IGNORE INTO id_map (source_key, scope, destination_id, run_id, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            action.idempotencyKey,
            action.scope,
            action.existingDestinationId,
            run.runId,
            now,
          );
        }
      }
    });
    return this.requireRun(run.runId);
  }

  private requireRun(runId: string): RunSummary {
    const run = this.getRun(runId);
    if (!run) throw new StateConflictError(`Run ${runId} does not exist.`);
    return run;
  }

  #summary(row: Row): RunSummary {
    const counts = {
      pending: 0,
      in_flight: 0,
      succeeded: 0,
      failed: 0,
      ambiguous: 0,
      blocked: 0,
      skipped: 0,
    };
    for (const c of this.#all(
      'SELECT status, COUNT(*) AS n FROM actions WHERE run_id = ? GROUP BY status',
      str(row, 'run_id'),
    )) {
      const status = str(c, 'status') as ActionStatus;
      if (status in counts) counts[status] = num(c, 'n');
    }
    const startedAt = optStr(row, 'started_at');
    const finishedAt = optStr(row, 'finished_at');
    const stopReason = optStr(row, 'stop_reason');
    return {
      runId: str(row, 'run_id'),
      planId: str(row, 'plan_id'),
      planHash: str(row, 'plan_hash'),
      mode: str(row, 'mode') as RunSummary['mode'],
      status: str(row, 'status') as RunStatus,
      approvedAt: str(row, 'approved_at'),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(finishedAt === undefined ? {} : { finishedAt }),
      updatedAt: str(row, 'updated_at'),
      counts,
      ...(stopReason === undefined ? {} : { stopReason }),
    };
  }

  getRun(runId: string): RunSummary | undefined {
    const row = this.#get('SELECT * FROM runs WHERE run_id = ?', runId);
    return row ? this.#summary(row) : undefined;
  }

  latestRun(): RunSummary | undefined {
    const row = this.#get('SELECT * FROM runs ORDER BY approved_at DESC, rowid DESC LIMIT 1');
    return row ? this.#summary(row) : undefined;
  }

  listRuns(): RunSummary[] {
    return this.#all('SELECT * FROM runs ORDER BY approved_at DESC, rowid DESC').map((r) =>
      this.#summary(r),
    );
  }

  setRunStatus(
    runId: string,
    status: RunStatus,
    extra: { stopReason?: string | null; startedAt?: string; finishedAt?: string } = {},
  ): RunSummary {
    this.#run(
      `UPDATE runs SET status = ?, updated_at = ?,
         started_at = COALESCE(?, started_at),
         finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
         stop_reason = CASE WHEN ? THEN ? ELSE stop_reason END
       WHERE run_id = ?`,
      status,
      this.#now(),
      extra.startedAt ?? null,
      extra.finishedAt === undefined ? 0 : 1,
      extra.finishedAt ?? null,
      extra.stopReason === undefined ? 0 : 1,
      extra.stopReason ?? null,
      runId,
    );
    return this.requireRun(runId);
  }

  // ---- checkpoints -------------------------------------------------------------------------

  #checkpoint(row: Row): MigrationCheckpoint {
    const destinationId = optStr(row, 'destination_id');
    const destinationUrl = optStr(row, 'destination_url');
    const code = optStr(row, 'last_error_code');
    const message = optStr(row, 'last_error_message');
    const inFlightSince = optStr(row, 'in_flight_since');
    return {
      runId: str(row, 'run_id'),
      actionId: str(row, 'action_id'),
      status: str(row, 'status') as ActionStatus,
      attempts: num(row, 'attempts'),
      ...(destinationId === undefined ? {} : { destinationId }),
      ...(destinationUrl === undefined ? {} : { destinationUrl }),
      ...(code === undefined || message === undefined ? {} : { lastError: { code, message } }),
      ...(inFlightSince === undefined ? {} : { inFlightSince }),
      updatedAt: str(row, 'updated_at'),
    };
  }

  getCheckpoint(runId: string, actionId: string): MigrationCheckpoint | undefined {
    const row = this.#get(
      'SELECT * FROM actions WHERE run_id = ? AND action_id = ?',
      runId,
      actionId,
    );
    return row ? this.#checkpoint(row) : undefined;
  }

  listCheckpoints(runId: string): MigrationCheckpoint[] {
    return this.#all('SELECT * FROM actions WHERE run_id = ? ORDER BY rowid', runId).map((r) =>
      this.#checkpoint(r),
    );
  }

  markInFlight(runId: string, actionId: string): MigrationCheckpoint {
    const now = this.#now();
    this.#run(
      `UPDATE actions SET status = 'in_flight', attempts = attempts + 1,
         in_flight_since = COALESCE(in_flight_since, ?), updated_at = ?
       WHERE run_id = ? AND action_id = ? AND status <> 'succeeded' AND status <> 'skipped'`,
      now,
      now,
      runId,
      actionId,
    );
    return this.#mustCheckpoint(runId, actionId);
  }

  markSucceeded(runId: string, actionId: string, input: SucceededInput): MigrationCheckpoint {
    this.#tx(() => {
      const now = this.#now();
      if (input.mapping) {
        const existing = this.getMapping(input.mapping.sourceKey, input.mapping.scope);
        if (existing && existing.destinationId !== input.destinationId) {
          throw new StateConflictError(
            `Refusing to record a second destination for ${input.mapping.sourceKey}: it is already mapped (would create a duplicate).`,
          );
        }
        this.#run(
          `INSERT OR IGNORE INTO id_map (source_key, scope, destination_id, destination_url, run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          input.mapping.sourceKey,
          input.mapping.scope,
          input.destinationId,
          input.destinationUrl ?? null,
          runId,
          now,
        );
      }
      this.#run(
        `UPDATE actions SET status = 'succeeded', destination_id = ?, destination_url = ?,
           last_error_code = NULL, last_error_message = NULL, in_flight_since = NULL, updated_at = ?
         WHERE run_id = ? AND action_id = ?`,
        input.destinationId,
        input.destinationUrl ?? null,
        now,
        runId,
        actionId,
      );
    });
    return this.#mustCheckpoint(runId, actionId);
  }

  markFailed(
    runId: string,
    actionId: string,
    status: FailureStatus,
    error: { code: string; message: string },
  ): MigrationCheckpoint {
    this.#run(
      `UPDATE actions SET status = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
       WHERE run_id = ? AND action_id = ? AND status <> 'succeeded'`,
      status,
      error.code.slice(0, 60),
      error.message.slice(0, 500),
      this.#now(),
      runId,
      actionId,
    );
    return this.#mustCheckpoint(runId, actionId);
  }

  resetToPending(runId: string, actionId: string): void {
    this.#run(
      `UPDATE actions SET status = 'pending', last_error_code = NULL, last_error_message = NULL,
         in_flight_since = NULL, updated_at = ?
       WHERE run_id = ? AND action_id = ? AND status NOT IN ('succeeded', 'skipped')`,
      this.#now(),
      runId,
      actionId,
    );
  }

  #mustCheckpoint(runId: string, actionId: string): MigrationCheckpoint {
    const c = this.getCheckpoint(runId, actionId);
    if (!c) throw new StateConflictError(`Unknown action ${actionId} in run ${runId}.`);
    return c;
  }

  // ---- id map ------------------------------------------------------------------------------

  #mapping(row: Row): IdMapping {
    const destinationUrl = optStr(row, 'destination_url');
    return {
      sourceKey: str(row, 'source_key'),
      scope: str(row, 'scope'),
      destinationId: str(row, 'destination_id'),
      ...(destinationUrl === undefined ? {} : { destinationUrl }),
      runId: str(row, 'run_id'),
      createdAt: str(row, 'created_at'),
    };
  }

  getMapping(sourceKey: string, scope: string): IdMapping | undefined {
    const row = this.#get(
      'SELECT * FROM id_map WHERE source_key = ? AND scope = ?',
      sourceKey,
      scope,
    );
    return row ? this.#mapping(row) : undefined;
  }

  listMappings(): IdMapping[] {
    return this.#all('SELECT * FROM id_map ORDER BY created_at, source_key').map((r) =>
      this.#mapping(r),
    );
  }

  putMapping(mapping: Omit<IdMapping, 'createdAt'>): IdMapping {
    const existing = this.getMapping(mapping.sourceKey, mapping.scope);
    if (existing) {
      if (existing.destinationId !== mapping.destinationId) {
        throw new StateConflictError(
          `${mapping.sourceKey} is already mapped to a different destination item.`,
        );
      }
      return existing;
    }
    this.#run(
      `INSERT INTO id_map (source_key, scope, destination_id, destination_url, run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      mapping.sourceKey,
      mapping.scope,
      mapping.destinationId,
      mapping.destinationUrl ?? null,
      mapping.runId,
      this.#now(),
    );
    return this.#mapping(
      this.#get(
        'SELECT * FROM id_map WHERE source_key = ? AND scope = ?',
        mapping.sourceKey,
        mapping.scope,
      ) ?? {},
    );
  }

  // ---- events & verification ---------------------------------------------------------------

  addEvent(runId: string, level: RunEvent['level'], type: string, message: string): void {
    this.#run(
      'INSERT INTO events (run_id, ts, level, type, message) VALUES (?, ?, ?, ?, ?)',
      runId,
      this.#now(),
      level,
      type.slice(0, 60),
      message.slice(0, 1000),
    );
  }

  listEvents(runId: string, afterId = 0, limit = 500): RunEvent[] {
    return this.#all(
      'SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?',
      runId,
      afterId,
      limit,
    ).map((r) => ({
      id: num(r, 'id'),
      runId: str(r, 'run_id'),
      ts: str(r, 'ts'),
      level: str(r, 'level') as RunEvent['level'],
      type: str(r, 'type'),
      message: str(r, 'message'),
    }));
  }

  saveVerification(result: VerificationResult): void {
    this.#run(
      `INSERT INTO verifications (run_id, verified_at, json) VALUES (?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET verified_at = excluded.verified_at, json = excluded.json`,
      result.runId,
      result.verifiedAt,
      JSON.stringify(result),
    );
  }

  getVerification(runId: string): VerificationResult | undefined {
    const row = this.#get('SELECT json FROM verifications WHERE run_id = ?', runId);
    return row ? VerificationResultSchema.parse(JSON.parse(str(row, 'json'))) : undefined;
  }

  close(): void {
    this.#stmts.clear();
    this.#db.close();
  }
}
