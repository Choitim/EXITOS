/**
 * Formatting helpers and the wording of statuses. Pure functions only (no DOM) so they can be
 * unit-tested in Node.
 */
import type { VerificationResult } from '@exitos/core/schema';

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : '–';
}

export function pluralize(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** `part / total` as a percentage string; one decimal below 10 %, none above. `–` when total is 0. */
export function formatPercent(part: number, total: number): string {
  if (!(total > 0) || !Number.isFinite(part)) return '–';
  const value = (part / total) * 100;
  if (value === 0) return '0%';
  if (value < 0.1) return '<0.1%';
  return `${value < 10 ? value.toFixed(1) : Math.round(value).toString()}%`;
}

export interface DateFormatOptions {
  /** IANA zone name; defaults to the viewer's local zone. Tests pass `UTC`. */
  timeZone?: string;
  locale?: string;
}

function parseIso(iso: string | undefined | null): Date | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-10-08 09:00:28` in the requested (default: local) time zone, or the raw text if unparsable. */
export function formatDateTime(
  iso: string | undefined | null,
  options: DateFormatOptions = {},
): string {
  const date = parseIso(iso);
  if (date === null) return typeof iso === 'string' && iso !== '' ? iso : '–';
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** `09:00:28` (time of day only). */
export function formatTime(
  iso: string | undefined | null,
  options: DateFormatOptions = {},
): string {
  const full = formatDateTime(iso, options);
  return /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})$/.exec(full)?.[1] ?? full;
}

/** Short name of the zone used by `formatDateTime`, e.g. `UTC` or `GMT+2`. */
export function timeZoneLabel(options: DateFormatOptions = {}): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    timeZoneName: 'short',
  }).formatToParts(new Date(0));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Epoch milliseconds (as ClickUp stores dates) to an ISO-8601 UTC instant; `null` if invalid. */
export function isoFromEpochMs(value: unknown): string | null {
  const ms = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ClickUp priorities: 1 urgent, 2 high, 3 normal, 4 low. */
export function priorityLabel(value: unknown): string {
  switch (value) {
    case 1:
      return 'Urgent (1)';
    case 2:
      return 'High (2)';
    case 3:
      return 'Normal (3)';
    case 4:
      return 'Low (4)';
    default:
      return typeof value === 'number' ? `Priority ${value}` : 'none';
  }
}

/** The command a person types to approve and apply a plan. Shown, copied, never executed here. */
export function approveCommand(planId: string): string {
  return `exitos apply --plan migration-plan.json --approve ${planId}`;
}

export const VERIFY_COMMAND = 'exitos verify';

export interface StateWording {
  tone: Tone;
  title: string;
  detail: string;
}

/**
 * Honest wording for the migration state. Only `verified` is ever presented as a success, and even
 * that is scoped; nothing else may be described as finished.
 */
export function describeReportState(state: string): StateWording {
  switch (state) {
    case 'planned_only':
      return {
        tone: 'info',
        title: 'Planned only: nothing has been written',
        detail:
          'This is a dry-run plan. No run has been approved, so nothing exists in the destination yet. Review the plan, then approve it explicitly.',
      };
    case 'in_progress':
      return {
        tone: 'info',
        title: 'In progress: not finished',
        detail:
          'Items are still being written or checked. Do not rely on the destination until the run has finished and been verified.',
      };
    case 'partial':
      return {
        tone: 'warn',
        title: 'Partially applied: the run stopped early',
        detail:
          'Some items were written and some were not. Continue with `exitos resume`, then run `exitos verify`.',
      };
    case 'failed':
      return {
        tone: 'bad',
        title: 'Failed: the run did not finish',
        detail:
          'The run ended with an error. Items written before the failure remain in the destination. Check the event log, then `exitos resume`.',
      };
    case 'applied_unverified':
      return {
        tone: 'warn',
        title: 'Applied, but NOT verified',
        detail:
          'Items were written to the destination, but nothing has been compared with the plan yet. The migration is not finished until `exitos verify` passes.',
      };
    case 'verification_failed':
      return {
        tone: 'bad',
        title: 'Verification failed',
        detail:
          'Some items differ from the plan or are missing in the destination. The migration is not verified; see the verification report below.',
      };
    case 'verified':
      return {
        tone: 'ok',
        title: 'Verified within the declared scope',
        detail:
          'Every planned item matched the plan in the destination, for the fields listed in the verification scope. Anything outside that scope, and everything under Unsupported content, was not checked or did not move.',
      };
    default:
      return {
        tone: 'neutral',
        title: `Unknown state: ${String(state)}`,
        detail: 'This dashboard does not recognise the state reported by the server.',
      };
  }
}

export function describeRunStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'approved':
      return { label: 'Approved (not started)', tone: 'info' };
    case 'applying':
      return { label: 'Applying', tone: 'info' };
    case 'stopped':
      return { label: 'Stopped', tone: 'warn' };
    case 'failed':
      return { label: 'Failed', tone: 'bad' };
    case 'applied':
      return { label: 'Applied (not verified)', tone: 'warn' };
    case 'verifying':
      return { label: 'Verifying', tone: 'info' };
    case 'verified':
      return { label: 'Verified', tone: 'ok' };
    case 'verification_failed':
      return { label: 'Verification failed', tone: 'bad' };
    default:
      return { label: String(status), tone: 'neutral' };
  }
}

/** Run statuses during which the state changes quickly and the dashboard polls every 2 s. */
const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(['approved', 'applying', 'verifying']);

export const POLL_ACTIVE_MS = 2_000;
export const POLL_IDLE_MS = 10_000;

export function isRunActive(status: string | null | undefined): boolean {
  return typeof status === 'string' && ACTIVE_RUN_STATUSES.has(status);
}

export function pollIntervalMs(runStatus: string | null | undefined): number {
  return isRunActive(runStatus) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

export interface Progress {
  done: number;
  total: number;
  /** 0..1 */
  ratio: number;
  /** Whole percent, 0..100. */
  percent: number;
}

export type RunCounts = {
  pending: number;
  in_flight: number;
  succeeded: number;
  failed: number;
  ambiguous: number;
  blocked: number;
  skipped: number;
};

/** Progress = (succeeded + skipped) / all actions of the run. */
export function runProgress(counts: RunCounts): Progress {
  const total =
    counts.pending +
    counts.in_flight +
    counts.succeeded +
    counts.failed +
    counts.ambiguous +
    counts.blocked +
    counts.skipped;
  const done = counts.succeeded + counts.skipped;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return { done, total, ratio, percent: Math.floor(ratio * 100) };
}

export function describeVerification(result: Pick<VerificationResult, 'status' | 'counts'>): {
  label: string;
  tone: Tone;
  summary: string;
} {
  const { counts } = result;
  const total = counts.verified + counts.mismatched + counts.missing + counts.unverified;
  switch (result.status) {
    case 'passed':
      return {
        label: 'PASSED',
        tone: 'ok',
        summary: `${pluralize(counts.verified, 'item')} of ${formatNumber(total)} matched the plan within the verification scope.`,
      };
    case 'failed':
      return {
        label: 'FAILED',
        tone: 'bad',
        summary: `${pluralize(counts.mismatched, 'item')} ${counts.mismatched === 1 ? 'differs' : 'differ'} and ${pluralize(counts.missing, 'item')} ${counts.missing === 1 ? 'is' : 'are'} missing in the destination.`,
      };
    case 'incomplete':
      return {
        label: 'INCOMPLETE',
        tone: 'warn',
        summary: `Nothing is known to be wrong, but ${pluralize(counts.unverified, 'item')} could not be checked.`,
      };
    default:
      return { label: String(result.status).toUpperCase(), tone: 'neutral', summary: '' };
  }
}
