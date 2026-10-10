/**
 * The stage tracker: Inspect -> Plan -> Approve -> Apply -> Verify.
 *
 * Derived only from what is in the state document (the plan, the run, the verification). It says
 * honestly which stage the migration is at, for example "a plan exists but there is no run yet" is
 * "Approve: waiting for approval". Pure functions only, so the derivation is unit-tested in Node.
 *
 * Exactly one stage is `current`. In the one finished situation (the run is `verified`) that is the
 * last stage, shown with its result, because there is nothing left to wait for.
 */
import type { MigrationPlan, RunSummary, VerificationResult } from '@exitos/core/schema';
import { formatNumber, pluralize, runProgress } from './format';

export type StageId = 'inspect' | 'plan' | 'approve' | 'apply' | 'verify';

/** `done` has a check; `current` is where the migration is now; `upcoming` has not started. */
export type StageStatus = 'done' | 'current' | 'upcoming';

/**
 * What the current stage is doing. `waiting`: it needs a person. `active`: the tool is working.
 * `attention`: something needs a look. `failed` and `verified` are the two run-level states.
 */
export type StageResult = 'waiting' | 'active' | 'attention' | 'failed' | 'verified';

export interface Stage {
  id: StageId;
  label: string;
  status: StageStatus;
  /** Only set on the current stage. */
  result: StageResult | null;
  /** A few words: "Waiting for approval". */
  headline: string;
  /** One sentence of supporting fact, taken from the state. */
  detail: string;
}

/** Which situation the state is in; the tests and the page both key off this. */
export type MigrationPhase =
  | 'planned'
  | 'blocked'
  | 'approved'
  | 'applying'
  | 'stopped'
  | 'failed'
  | 'applied'
  | 'verifying'
  | 'verified'
  | 'verification_failed'
  | 'verification_incomplete';

export interface StageTracker {
  phase: MigrationPhase;
  stages: Stage[];
  current: Stage;
  /** "Current stage: Approve. Waiting for approval." */
  summary: string;
}

export interface StageInput {
  plan: Pick<MigrationPlan, 'collections' | 'summary'>;
  run: Pick<RunSummary, 'status' | 'counts' | 'stopReason'> | null;
  verification: Pick<VerificationResult, 'status' | 'counts'> | null;
}

const LABELS: Record<StageId, string> = {
  inspect: 'Inspect',
  plan: 'Plan',
  approve: 'Approve',
  apply: 'Apply',
  verify: 'Verify',
};

const ORDER: readonly StageId[] = ['inspect', 'plan', 'approve', 'apply', 'verify'];

type Slot = Pick<Stage, 'status' | 'result' | 'headline' | 'detail'>;

const done = (headline: string, detail: string): Slot => ({
  status: 'done',
  result: null,
  headline,
  detail,
});
const upcoming = (headline: string, detail: string): Slot => ({
  status: 'upcoming',
  result: null,
  headline,
  detail,
});
const current = (result: StageResult, headline: string, detail: string): Slot => ({
  status: 'current',
  result,
  headline,
  detail,
});

function writtenText(counts: RunSummary['counts']): string {
  const { done: finished, total } = runProgress(counts);
  return `${formatNumber(finished)} of ${formatNumber(total)} actions written or skipped`;
}

function trouble(counts: RunSummary['counts']): string {
  const parts = [
    counts.failed > 0 ? `${formatNumber(counts.failed)} failed` : null,
    counts.blocked > 0 ? `${formatNumber(counts.blocked)} blocked` : null,
    counts.ambiguous > 0 ? `${formatNumber(counts.ambiguous)} of unknown outcome` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? '' : `; ${parts.join(', ')}`;
}

function inspectSlot(plan: StageInput['plan']): Slot {
  const rows = plan.collections.reduce((sum, c) => sum + c.recordCount, 0);
  return done(
    'Source read',
    `${pluralize(plan.collections.length, 'collection')} and ${pluralize(rows, 'row')} read from the source.`,
  );
}

function planSlot(plan: StageInput['plan']): Slot {
  const { actions, blockingErrors } = plan.summary;
  return done(
    'Plan ready',
    `${pluralize(actions.total, 'action')} planned${
      blockingErrors > 0 ? `, ${pluralize(blockingErrors, 'blocking error')}` : ''
    }.`,
  );
}

/** Work out where the migration stands. */
export function deriveStages(input: StageInput): StageTracker {
  const { plan, run, verification } = input;
  const slots: Record<StageId, Slot> = {
    inspect: inspectSlot(plan),
    plan: planSlot(plan),
    approve: upcoming('Not approved', ''),
    apply: upcoming('Not started', 'Nothing is written until the plan is approved.'),
    verify: upcoming('Not verified', 'Verification comes after apply.'),
  };
  let phase: MigrationPhase;

  if (run === null) {
    const blocking = plan.summary.blockingErrors;
    if (blocking > 0) {
      phase = 'blocked';
      slots.approve = current(
        'attention',
        'Blocked by errors',
        `${pluralize(blocking, 'blocking error')} must be fixed first; apply refuses this plan until then.`,
      );
    } else {
      phase = 'planned';
      slots.approve = current(
        'waiting',
        'Waiting for approval',
        'A plan exists but there is no run. Nothing has been written; it is written only after you approve.',
      );
    }
  } else {
    slots.approve = done('Approved', 'This plan was approved and a run was created.');
    const progress = writtenText(run.counts);
    switch (run.status) {
      case 'approved':
        phase = 'approved';
        slots.apply = current('waiting', 'Approved, not started', `${progress}.`);
        break;
      case 'applying':
        phase = 'applying';
        slots.apply = current(
          run.counts.failed + run.counts.blocked + run.counts.ambiguous > 0
            ? 'attention'
            : 'active',
          'Applying',
          `${progress}${trouble(run.counts)}.`,
        );
        break;
      case 'stopped':
        phase = 'stopped';
        slots.apply = current(
          'attention',
          'Stopped early',
          `${progress}${trouble(run.counts)}.${run.stopReason ? ` ${run.stopReason}` : ''}`,
        );
        break;
      case 'failed':
        phase = 'failed';
        slots.apply = current(
          'failed',
          'Failed',
          `${progress}${trouble(run.counts)}.${run.stopReason ? ` ${run.stopReason}` : ''}`,
        );
        break;
      default: {
        // applied, verifying, verified, verification_failed (or an unknown later status).
        const skipped =
          run.counts.skipped > 0 ? `, ${formatNumber(run.counts.skipped)} skipped` : '';
        slots.apply = done('Applied', `${formatNumber(run.counts.succeeded)} written${skipped}.`);
        if (run.status === 'verifying') {
          phase = 'verifying';
          slots.verify = current('active', 'Verifying', 'Comparing the destination with the plan.');
        } else if (run.status === 'verified') {
          phase = 'verified';
          slots.verify = current(
            'verified',
            'Verified',
            verification
              ? `${pluralize(verification.counts.verified, 'item')} matched the plan, within the declared scope.`
              : 'Verification passed, within the declared scope.',
          );
        } else if (run.status === 'verification_failed') {
          phase = 'verification_failed';
          slots.verify = current(
            'failed',
            'Verification failed',
            verification
              ? `${pluralize(verification.counts.mismatched, 'item')} ${verification.counts.mismatched === 1 ? 'differs' : 'differ'} from the plan and ${pluralize(verification.counts.missing, 'item')} ${verification.counts.missing === 1 ? 'is' : 'are'} missing in the destination.`
              : 'Some items differ from the plan or are missing in the destination.',
          );
        } else if (verification?.status === 'incomplete') {
          phase = 'verification_incomplete';
          slots.verify = current(
            'attention',
            'Verification incomplete',
            `${pluralize(verification.counts.unverified, 'item')} could not be checked.`,
          );
        } else {
          phase = 'applied';
          slots.verify = current(
            'waiting',
            'Waiting for verification',
            'Applied, but not verified yet. Nothing has been compared with the plan.',
          );
        }
      }
    }
  }

  const stages: Stage[] = ORDER.map((id) => ({ id, label: LABELS[id], ...slots[id] }));
  const now = stages.find((stage) => stage.status === 'current') as Stage;
  const summary =
    phase === 'verified'
      ? 'All five stages are done: this run is verified, within the declared scope.'
      : `Current stage: ${now.label}. ${now.headline}.`;
  return { phase, stages, current: now, summary };
}
