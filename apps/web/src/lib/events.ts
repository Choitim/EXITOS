/**
 * Human wording for the run's event log. The engine records short machine names (`action_succeeded`,
 * `action_reconciled`, ...); people should read "Created" and "Recovered after a lost reply". The
 * raw type stays available to the page (title attribute and a technical-details toggle) so nothing
 * is hidden from someone debugging a run.
 *
 * Only the events the engine actually writes are named here, plus the rate-limit wait the
 * dashboard has wording for should a future engine record it. Anything else is shown as its own
 * name with the underscores removed; it is never given an invented meaning.
 */
import type { RunEvent } from '@exitos/core/schema';
import type { Tone } from './format';
import type { IconName } from './outcomes';

export interface EventDescription {
  /** Short human label ("Created", "Run finished"). */
  label: string;
  icon: IconName;
  /** Colour of the icon. Never a chip: only warnings and errors get one. */
  tone: Tone;
  /** False when the type is not one this dashboard has wording for. */
  known: boolean;
}

type EventLike = Pick<RunEvent, 'type' | 'message'>;

const RATE_LIMIT_TYPES: ReadonlySet<string> = new Set([
  'rate_limit',
  'rate_limited',
  'rate_limit_wait',
  'waiting_for_rate_limit',
]);

/** `some_event_type` becomes `Some event type`; long or odd values are shortened for display. */
export function humanizeEventType(type: string): string {
  const spaced = type
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced === '') return 'Event';
  const text = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

function succeeded(message: string): EventDescription {
  // The engine records the action's label, which starts with the verb the connector used.
  if (/^Link\b/.test(message)) return { label: 'Linked', icon: 'link', tone: 'ok', known: true };
  if (/^Create\b/.test(message)) {
    return { label: 'Created', icon: 'plus', tone: 'ok', known: true };
  }
  return { label: 'Written', icon: 'check', tone: 'ok', known: true };
}

function reconciled(message: string): EventDescription {
  // The engine records `<action label>: <found | not_found | undecidable>`.
  const result = /:\s*(found|not_found|undecidable)\s*$/.exec(message)?.[1];
  switch (result) {
    case 'found':
      return {
        label: 'Recovered after a lost reply',
        icon: 'transform',
        tone: 'ok',
        known: true,
      };
    case 'not_found':
      return {
        label: 'Checked after a lost reply: not found',
        icon: 'transform',
        tone: 'warn',
        known: true,
      };
    case 'undecidable':
      return {
        label: 'Could not confirm after a lost reply',
        icon: 'warning',
        tone: 'warn',
        known: true,
      };
    default:
      return {
        label: 'Checked after a lost reply',
        icon: 'transform',
        tone: 'neutral',
        known: true,
      };
  }
}

function verification(message: string): EventDescription {
  const status = /^Verification\s+(passed|failed|incomplete)\b/i.exec(message)?.[1]?.toLowerCase();
  if (status === 'passed') {
    return { label: 'Verification passed', icon: 'verified', tone: 'ok', known: true };
  }
  if (status === 'failed') {
    return { label: 'Verification failed', icon: 'failed', tone: 'bad', known: true };
  }
  if (status === 'incomplete') {
    return { label: 'Verification incomplete', icon: 'warning', tone: 'warn', known: true };
  }
  return { label: 'Verification', icon: 'verified', tone: 'neutral', known: true };
}

export function describeEvent(event: EventLike): EventDescription {
  switch (event.type) {
    case 'approved':
      return { label: 'Plan approved', icon: 'check', tone: 'neutral', known: true };
    case 'run_started':
      return {
        label: /^Resuming\b/i.test(event.message) ? 'Run resumed' : 'Run started',
        icon: 'play',
        tone: 'neutral',
        known: true,
      };
    case 'action_succeeded':
      return succeeded(event.message);
    case 'action_reconciled':
      return reconciled(event.message);
    case 'action_failed':
      return { label: 'Write failed', icon: 'failed', tone: 'bad', known: true };
    case 'assume_not_created':
      return { label: 'Confirmed not created', icon: 'warning', tone: 'warn', known: true };
    case 'run_stopped':
      return { label: 'Run stopped', icon: 'warning', tone: 'warn', known: true };
    case 'run_finished':
      return { label: 'Run finished', icon: 'flag', tone: 'neutral', known: true };
    case 'verification':
      return verification(event.message);
    default:
      if (RATE_LIMIT_TYPES.has(event.type)) {
        return { label: 'Waiting for rate limit', icon: 'clock', tone: 'warn', known: true };
      }
      return { label: humanizeEventType(event.type), icon: 'info', tone: 'neutral', known: false };
  }
}

/** Only warnings and errors get a coloured chip next to the event; plain progress stays quiet. */
export function eventLevelChip(
  level: string,
): { label: string; tone: 'warn' | 'bad'; icon: 'warning' | 'cross' } | null {
  if (level === 'warn' || level === 'warning') {
    return { label: 'Warning', tone: 'warn', icon: 'warning' };
  }
  if (level === 'error') return { label: 'Error', tone: 'bad', icon: 'cross' };
  return null;
}
