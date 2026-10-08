import { ApprovalError, ConfigError, sha256Hex } from '@exitos/shared';
import type { MigrationPlan, RunSummary } from '../schema/index.js';
import type { StateStore } from '../state/store.js';
import { blockingFindings, verifyPlanIntegrity } from './plan.js';

export interface ApproveInput {
  plan: MigrationPlan;
  store: StateStore;
  /** What the human typed or passed via `--approve`. Must equal `plan.planId`. */
  approvedPlanId: string | undefined;
  now: Date;
}

/** Deterministic run id: sortable timestamp + short hash of the plan. */
export function newRunId(planId: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  return `run_${stamp}_${sha256Hex(`${planId}|${now.toISOString()}`).slice(0, 6)}`;
}

/**
 * The only way to start a run. Checks, in order: the plan is intact, it has no blocking errors, the
 * human approved exactly this plan, and it has not already been run. Nothing is sent to any
 * system here — this only records the approval and creates the checkpoint rows.
 */
export function approveAndCreateRun(input: ApproveInput): RunSummary {
  const { plan, store } = input;
  verifyPlanIntegrity(plan);

  const blockers = blockingFindings(plan);
  if (blockers.length > 0) {
    const first = blockers
      .slice(0, 5)
      .map((f) => `  • [${f.code}] ${f.message}`)
      .join('\n');
    throw new ConfigError(
      `This plan has ${blockers.length} blocking error(s) and cannot be applied:\n${first}\nFix the configuration or the destination and run \`exitos plan\` again.`,
    );
  }

  if (input.approvedPlanId !== plan.planId) {
    throw new ApprovalError(
      input.approvedPlanId === undefined
        ? `Approval required. Review the plan, then approve exactly this plan by passing --approve ${plan.planId}`
        : `Approval does not match this plan. Expected ${plan.planId}, got ${input.approvedPlanId}.`,
    );
  }

  const existing = store.listRuns().find((r) => r.planId === plan.planId);
  if (existing) {
    throw new ConfigError(
      `This plan already has run ${existing.runId} (status: ${existing.status}). ` +
        'Use `exitos resume` to continue it, `exitos verify` to check it, or create a new plan.',
    );
  }

  const runId = newRunId(plan.planId, input.now);
  const run = store.createRun({ runId, plan, approvedAt: input.now.toISOString() });
  store.addEvent(runId, 'info', 'approved', `Plan ${plan.planId} approved.`);
  return run;
}
