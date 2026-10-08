import type { Clock } from '@exitos/shared';
import {
  VerificationResultSchema,
  type ItemVerification,
  type MigrationPlan,
  type RunStatus,
  type VerificationResult,
} from '../schema/index.js';
import type { DestinationConnector } from '../sdk/types.js';
import type { StateStore } from '../state/store.js';

export interface VerifyRunOptions {
  plan: MigrationPlan;
  destination: DestinationConnector;
  store: StateStore;
  runId: string;
  clock: Clock;
}

const FINISHED_APPLY: ReadonlySet<RunStatus> = new Set([
  'applied',
  'verifying',
  'verified',
  'verification_failed',
]);

/**
 * Compare the plan's intent with the destination's actual state.
 *
 * Every planned item ends up in exactly one bucket: verified, mismatched (exists but differs),
 * missing (never created / not found) or unverified (exists but could not be checked).
 * The run becomes `verified` only if there are zero mismatched, zero missing and zero unverified
 * items; the verification record always states its scope so it cannot be read as "zero data loss".
 */
export async function verifyRun(options: VerifyRunOptions): Promise<VerificationResult> {
  const { plan, destination, store, runId } = options;
  const run = store.getRun(runId);
  if (!run) throw new Error(`Run ${runId} does not exist.`);
  const applyFinished = FINISHED_APPLY.has(run.status);
  if (applyFinished) store.setRunStatus(runId, 'verifying');

  const checkpoints = new Map(store.listCheckpoints(runId).map((c) => [c.actionId, c]));
  const mappings: Array<{ actionId: string; destinationId: string }> = [];
  const never: ItemVerification[] = [];
  for (const action of plan.actions) {
    const cp = checkpoints.get(action.id);
    if (cp?.destinationId !== undefined && (cp.status === 'succeeded' || cp.status === 'skipped')) {
      mappings.push({ actionId: action.id, destinationId: cp.destinationId });
    } else if (action.disposition === 'execute') {
      never.push({
        actionId: action.id,
        source: action.source,
        status: 'missing',
        checks: [
          {
            field: 'existence',
            status: 'missing',
            note: `Not created (action status: ${cp?.status ?? 'unknown'}).`,
          },
        ],
      });
    }
  }

  const output = await destination.verify({ plan, mappings });
  const items = [...output.items, ...never];
  const counts = { verified: 0, mismatched: 0, missing: 0, unverified: 0 };
  for (const item of items) counts[item.status] += 1;

  const status =
    counts.mismatched > 0 || counts.missing > 0
      ? 'failed'
      : counts.unverified > 0
        ? 'incomplete'
        : 'passed';

  const result = VerificationResultSchema.parse({
    runId,
    planId: plan.planId,
    verifiedAt: new Date(options.clock.now()).toISOString(),
    status,
    counts,
    targets: output.targets,
    items,
    scope: output.scope,
    notes: output.notes,
  });
  store.saveVerification(result);
  store.addEvent(
    runId,
    status === 'passed' ? 'info' : 'warn',
    'verification',
    `Verification ${status}: ${counts.verified} verified, ${counts.mismatched} mismatched, ${counts.missing} missing, ${counts.unverified} unverified.`,
  );

  if (applyFinished) {
    // Only a fully passing verification of a fully applied run completes the migration.
    store.setRunStatus(
      runId,
      status === 'passed' ? 'verified' : status === 'failed' ? 'verification_failed' : 'applied',
    );
  }
  return result;
}
