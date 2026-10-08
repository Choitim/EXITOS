import type { Outcome } from '@exitos/core/schema';
import type { Tone } from './format';

export type IconName = 'check' | 'transform' | 'warning' | 'cross' | 'minus' | 'info';

export interface OutcomeMeta {
  label: string;
  /** What it means for the user, in the vocabulary of the compatibility summary. */
  plain: string;
  tone: Tone;
  icon: IconName;
}

export const OUTCOME_ORDER: readonly Outcome[] = [
  'supported',
  'transformed',
  'lossy',
  'unsupported',
  'skipped',
  'failed',
];

export const OUTCOME_META: Record<Outcome, OutcomeMeta> = {
  supported: { label: 'Supported', plain: 'Moves as-is', tone: 'ok', icon: 'check' },
  transformed: { label: 'Transformed', plain: 'Changes shape', tone: 'info', icon: 'transform' },
  lossy: { label: 'Lossy', plain: 'Loses detail', tone: 'warn', icon: 'warning' },
  unsupported: { label: 'Unsupported', plain: 'Cannot move', tone: 'bad', icon: 'cross' },
  skipped: {
    label: 'Skipped',
    plain: 'Intentionally not migrated',
    tone: 'neutral',
    icon: 'minus',
  },
  failed: { label: 'Failed', plain: 'Attempted and failed', tone: 'bad', icon: 'cross' },
};

const UNKNOWN_META: OutcomeMeta = {
  label: 'Unknown',
  plain: 'Unknown',
  tone: 'neutral',
  icon: 'info',
};

export function outcomeMeta(outcome: string): OutcomeMeta {
  return (
    (OUTCOME_META as Record<string, OutcomeMeta | undefined>)[outcome] ?? {
      ...UNKNOWN_META,
      label: outcome,
    }
  );
}

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
