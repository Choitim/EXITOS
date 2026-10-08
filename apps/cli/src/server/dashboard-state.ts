import { existsSync } from 'node:fs';
import { VERSION } from '@exitos/shared';
import type { DashboardState } from '@exitos/core';
import { openStore, type StateLocation } from '../runtime/state.js';
import { reportFor } from '../commands/inspect-status-verify-report.js';

const EVENT_LIMIT = 250;

/** Read the state database (read-only) and assemble what the dashboard shows. */
export function buildDashboardState(
  location: StateLocation,
  now: Date = new Date(),
): DashboardState {
  const base = {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    exitosVersion: VERSION,
  };
  if (!existsSync(location.dbPath)) {
    return {
      ...base,
      mode: 'empty',
      plan: null,
      run: null,
      runs: [],
      events: [],
      verification: null,
      report: null,
    };
  }
  const store = openStore(location, { readOnly: true });
  try {
    const run = store.latestRun() ?? null;
    const plan = (run ? store.getPlan(run.planId) : store.latestPlan()) ?? null;
    if (!plan) {
      return {
        ...base,
        mode: 'empty',
        plan: null,
        run,
        runs: store.listRuns(),
        events: [],
        verification: null,
        report: null,
      };
    }
    const events = run ? store.listEvents(run.runId, 0, 100_000).slice(-EVENT_LIMIT) : [];
    return {
      ...base,
      mode: plan.mode,
      plan,
      run,
      runs: store.listRuns(),
      events,
      verification: run ? (store.getVerification(run.runId) ?? null) : null,
      report: reportFor(store, run, plan, now),
    };
  } finally {
    store.close();
  }
}
