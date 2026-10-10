/**
 * The one place that decides what the dashboard calls things.
 *
 * Six states are explained to the reader (see `OutcomeLegend`). Four describe what happens to a
 * piece of content and come straight from the plan's `Outcome` data values; two describe the run
 * and come from the run and the verification:
 *
 *   Preserved         `supported`    moves as-is
 *   Transformed       `transformed`  changes shape
 *   Requires review   `lossy`        loses detail
 *   Unsupported       `unsupported`  cannot move
 *   Failed            run level      a write failed, or verification found a mismatch or a gap
 *   Verified          run level      verification compared the destination with the plan and passed
 *
 * The data values, finding codes and JSON fields keep their names; only the words shown to people
 * live here. The plain sub-labels deliberately repeat the wording of the CLI summary
 * (MOVES AS-IS / CHANGES SHAPE / LOSES DETAIL / CANNOT MOVE).
 *
 * Every state has its own icon AND its own word, so colour is never the only signal.
 */
import type { Outcome } from '@exitos/core/schema';
import type { Tone } from './format';

export type IconName =
  | 'check'
  | 'transform'
  | 'warning'
  | 'cross'
  | 'minus'
  | 'info'
  | 'verified'
  | 'failed'
  | 'plus'
  | 'link'
  | 'clock'
  | 'flag'
  | 'play'
  | 'chevron';

export interface OutcomeMeta {
  /** What the dashboard calls it. */
  label: string;
  /** The plain-language sub-label, in the vocabulary of the CLI summary. */
  plain: string;
  tone: Tone;
  icon: IconName;
  /** Run-level states are drawn as strong, filled chips so they cannot be mistaken for item outcomes. */
  solid: boolean;
  /** `item`: about a piece of content (from the plan). `run`: about the run or its verification. */
  level: 'item' | 'run';
}

export interface StateMeta extends OutcomeMeta {
  /** One sentence for the legend. */
  description: string;
}

/** The six states of the legend, in the order they are explained. */
export type StateKey =
  'supported' | 'transformed' | 'lossy' | 'unsupported' | 'failed' | 'verified';

export const STATE_ORDER: readonly StateKey[] = [
  'supported',
  'transformed',
  'lossy',
  'unsupported',
  'failed',
  'verified',
];

export const STATE_META: Record<StateKey, StateMeta> = {
  supported: {
    label: 'Preserved',
    plain: 'Moves as-is',
    description: 'Arrives intact, with the same meaning.',
    tone: 'ok',
    icon: 'check',
    solid: false,
    level: 'item',
  },
  transformed: {
    label: 'Transformed',
    plain: 'Changes shape',
    description: 'Arrives in a different form. The information is kept.',
    tone: 'info',
    icon: 'transform',
    solid: false,
    level: 'item',
  },
  lossy: {
    label: 'Requires review',
    plain: 'Loses detail',
    description: 'Arrives, but some detail is lost. Look at it before you rely on it.',
    tone: 'warn',
    icon: 'warning',
    solid: false,
    level: 'item',
  },
  unsupported: {
    label: 'Unsupported',
    plain: 'Cannot move',
    description: 'Does not move at all. It is listed here and never dropped silently.',
    tone: 'bad',
    icon: 'cross',
    solid: false,
    level: 'item',
  },
  failed: {
    label: 'Failed',
    plain: 'Write or check failed',
    description:
      'A write failed, or verification found an item that differs from the plan or is missing.',
    tone: 'bad',
    icon: 'failed',
    solid: true,
    level: 'run',
  },
  verified: {
    label: 'Verified',
    plain: 'Checked in the destination',
    description:
      'Verification compared the destination with the plan and everything matched, for the declared scope only.',
    tone: 'ok',
    icon: 'verified',
    solid: true,
    level: 'run',
  },
};

/** Order used by tallies, bars and tables: what moves cleanly first. */
export const OUTCOME_ORDER: readonly Outcome[] = [
  'supported',
  'transformed',
  'lossy',
  'unsupported',
  'skipped',
  'failed',
];

const SKIPPED_META: OutcomeMeta = {
  label: 'Skipped',
  plain: 'Intentionally not migrated',
  tone: 'neutral',
  icon: 'minus',
  solid: false,
  level: 'item',
};

/** Meta for every value of the data enum `Outcome`. */
export const OUTCOME_META: Record<Outcome, OutcomeMeta> = {
  supported: STATE_META.supported,
  transformed: STATE_META.transformed,
  lossy: STATE_META.lossy,
  unsupported: STATE_META.unsupported,
  skipped: SKIPPED_META,
  failed: STATE_META.failed,
};

const UNKNOWN_META: OutcomeMeta = {
  label: 'Unknown',
  plain: 'Unknown',
  tone: 'neutral',
  icon: 'info',
  solid: false,
  level: 'item',
};

/** Tolerant of values this dashboard does not know (a newer server): shows them as they are. */
export function outcomeMeta(outcome: string): OutcomeMeta {
  return (
    (OUTCOME_META as Record<string, OutcomeMeta | undefined>)[outcome] ?? {
      ...UNKNOWN_META,
      label: outcome,
      plain: outcome,
    }
  );
}

/** `Requires review (loses detail)`: for select options, aria-labels and titles. */
export function outcomeWithPlain(outcome: string): string {
  const meta = outcomeMeta(outcome);
  return `${meta.label} (${meta.plain.toLowerCase()})`;
}

// ---- severity -----------------------------------------------------------------------------------

export interface SeverityMeta {
  label: string;
  tone: Tone;
  icon: IconName;
}

export function severityMeta(severity: string): SeverityMeta {
  switch (severity) {
    case 'error':
      return { label: 'Error', tone: 'bad', icon: 'cross' };
    case 'warning':
      return { label: 'Warning', tone: 'warn', icon: 'warning' };
    case 'info':
      return { label: 'Info', tone: 'info', icon: 'info' };
    default:
      return { label: severity, tone: 'neutral', icon: 'info' };
  }
}

// ---- run level ----------------------------------------------------------------------------------

export interface RunStatusStyle {
  icon: IconName;
  /** Draw as the strong `Failed` / `Verified` chip. */
  solid: boolean;
}

/** Icon (and weight) for a run status chip; the words come from `describeRunStatus`. */
export function runStatusStyle(status: string): RunStatusStyle {
  switch (status) {
    case 'verified':
      return { icon: STATE_META.verified.icon, solid: true };
    case 'failed':
    case 'verification_failed':
      return { icon: STATE_META.failed.icon, solid: true };
    case 'stopped':
    case 'applied':
      return { icon: 'warning', solid: false };
    case 'approved':
      return { icon: 'check', solid: false };
    case 'applying':
    case 'verifying':
      return { icon: 'transform', solid: false };
    default:
      return { icon: 'info', solid: false };
  }
}
