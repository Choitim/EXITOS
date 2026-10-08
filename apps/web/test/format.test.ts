import { describe, expect, it } from 'vitest';
import {
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  approveCommand,
  describeReportState,
  describeRunStatus,
  describeVerification,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTime,
  isRunActive,
  isoFromEpochMs,
  pluralize,
  pollIntervalMs,
  priorityLabel,
  runProgress,
} from '../src/lib/format';
import { counts } from './fixtures';

describe('numbers', () => {
  it('formats with thousands separators', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(Number.NaN)).toBe('–');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('–');
  });

  it('pluralizes', () => {
    expect(pluralize(1, 'item')).toBe('1 item');
    expect(pluralize(0, 'item')).toBe('0 items');
    expect(pluralize(1500, 'finding')).toBe('1,500 findings');
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('formats percentages honestly', () => {
    expect(formatPercent(0, 10)).toBe('0%');
    expect(formatPercent(3, 175)).toBe('1.7%');
    expect(formatPercent(115, 175)).toBe('66%');
    expect(formatPercent(175, 175)).toBe('100%');
    expect(formatPercent(1, 100_000)).toBe('<0.1%');
    expect(formatPercent(1, 0)).toBe('–');
    expect(formatPercent(Number.NaN, 5)).toBe('–');
  });
});

describe('dates', () => {
  it('formats an ISO instant in the requested time zone', () => {
    expect(formatDateTime('2026-10-08T09:00:28.934Z', { timeZone: 'UTC' })).toBe(
      '2026-10-08 09:00:28',
    );
    expect(formatDateTime('2026-10-08T09:00:28.934Z', { timeZone: 'Asia/Tokyo' })).toBe(
      '2026-10-08 18:00:28',
    );
    expect(formatDateTime('2026-12-31T23:59:59Z', { timeZone: 'UTC' })).toBe('2026-12-31 23:59:59');
  });

  it('formats midnight as 00, not 24', () => {
    expect(formatDateTime('2026-10-08T00:00:00Z', { timeZone: 'UTC' })).toBe('2026-10-08 00:00:00');
  });

  it('formats the time of day', () => {
    expect(formatTime('2026-10-08T09:00:28.934Z', { timeZone: 'UTC' })).toBe('09:00:28');
  });

  it('falls back for missing or unparsable values', () => {
    expect(formatDateTime(undefined)).toBe('–');
    expect(formatDateTime(null)).toBe('–');
    expect(formatDateTime('')).toBe('–');
    expect(formatDateTime('yesterday')).toBe('yesterday');
    expect(formatTime('yesterday')).toBe('yesterday');
  });

  it('converts ClickUp epoch milliseconds to ISO', () => {
    expect(isoFromEpochMs(1_788_314_400_000)).toBe('2026-09-02T02:00:00.000Z');
    expect(isoFromEpochMs('1788314400000')).toBe('2026-09-02T02:00:00.000Z');
    expect(isoFromEpochMs(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(isoFromEpochMs(Number.NaN)).toBeNull();
    expect(isoFromEpochMs('soon')).toBeNull();
    expect(isoFromEpochMs(null)).toBeNull();
    expect(isoFromEpochMs(8.7e15)).toBeNull(); // beyond the Date range
  });
});

describe('priority', () => {
  it('names ClickUp priorities', () => {
    expect(priorityLabel(1)).toBe('Urgent (1)');
    expect(priorityLabel(2)).toBe('High (2)');
    expect(priorityLabel(3)).toBe('Normal (3)');
    expect(priorityLabel(4)).toBe('Low (4)');
    expect(priorityLabel(9)).toBe('Priority 9');
    expect(priorityLabel(null)).toBe('none');
  });
});

describe('approve command', () => {
  it('is exactly the documented command', () => {
    expect(approveCommand('plan_1ae61146a28c')).toBe(
      'exitos apply --plan migration-plan.json --approve plan_1ae61146a28c',
    );
  });
});

describe('state wording', () => {
  const states = [
    'planned_only',
    'in_progress',
    'partial',
    'failed',
    'applied_unverified',
    'verification_failed',
    'verified',
  ] as const;

  it('describes every report state', () => {
    for (const state of states) {
      const w = describeReportState(state);
      expect(w.title.length).toBeGreaterThan(5);
      expect(w.detail.length).toBeGreaterThan(20);
    }
  });

  it('only a verified state is a success tone', () => {
    for (const state of states) {
      expect(describeReportState(state).tone === 'ok').toBe(state === 'verified');
    }
  });

  it('never says "complete" or "done" for anything that is not verified', () => {
    for (const state of states) {
      if (state === 'verified') continue;
      const w = describeReportState(state);
      const words = `${w.title} ${w.detail}`.toLowerCase();
      expect(words).not.toMatch(/\bcomplete(d)?\b/);
      expect(words).not.toMatch(/\bdone\b|\bsuccess/);
    }
  });

  it('scopes the verified claim and never claims zero loss', () => {
    const w = describeReportState('verified');
    expect(w.title).toMatch(/declared scope/i);
    expect(`${w.title} ${w.detail}`.toLowerCase()).not.toMatch(
      /zero|no data (was )?lost|everything moved/,
    );
  });

  it('tells the user what to do when applied but not verified', () => {
    const w = describeReportState('applied_unverified');
    expect(w.title).toMatch(/not verified/i);
    expect(w.detail).toContain('exitos verify');
    expect(w.tone).toBe('warn');
  });

  it('degrades gracefully for an unknown state', () => {
    const w = describeReportState('teleported');
    expect(w.tone).toBe('neutral');
    expect(w.title).toContain('teleported');
  });

  it('describes run statuses', () => {
    expect(describeRunStatus('verified')).toEqual({ label: 'Verified', tone: 'ok' });
    expect(describeRunStatus('applied').label).toMatch(/not verified/i);
    expect(describeRunStatus('failed').tone).toBe('bad');
    expect(describeRunStatus('mystery')).toEqual({ label: 'mystery', tone: 'neutral' });
  });
});

describe('verification wording', () => {
  it('describes passed, failed and incomplete', () => {
    const passed = describeVerification({
      status: 'passed',
      counts: { verified: 175, mismatched: 0, missing: 0, unverified: 0 },
    });
    expect(passed.label).toBe('PASSED');
    expect(passed.summary).toBe('175 items of 175 matched the plan within the verification scope.');
    const failed = describeVerification({
      status: 'failed',
      counts: { verified: 3, mismatched: 1, missing: 2, unverified: 0 },
    });
    expect(failed.label).toBe('FAILED');
    expect(failed.tone).toBe('bad');
    expect(failed.summary).toBe('1 item differ and 2 items are missing in the destination.');
    const incomplete = describeVerification({
      status: 'incomplete',
      counts: { verified: 3, mismatched: 0, missing: 0, unverified: 1 },
    });
    expect(incomplete.label).toBe('INCOMPLETE');
    expect(incomplete.tone).toBe('warn');
  });
});

describe('progress and polling', () => {
  it('counts succeeded plus skipped over everything', () => {
    expect(runProgress(counts({ succeeded: 50, skipped: 10, pending: 40 }))).toEqual({
      done: 60,
      total: 100,
      ratio: 0.6,
      percent: 60,
    });
    expect(
      runProgress(
        counts({
          succeeded: 1,
          failed: 1,
          blocked: 1,
          ambiguous: 1,
          in_flight: 1,
          pending: 1,
          skipped: 0,
        }),
      ),
    ).toMatchObject({ done: 1, total: 6, percent: 16 });
  });

  it('is 0 for an empty run and never exceeds 100', () => {
    expect(runProgress(counts())).toEqual({ done: 0, total: 0, ratio: 0, percent: 0 });
    expect(runProgress(counts({ succeeded: 3 })).percent).toBe(100);
  });

  it('polls every 2 s while the run is active and every 10 s otherwise', () => {
    for (const status of ['approved', 'applying', 'verifying']) {
      expect(isRunActive(status)).toBe(true);
      expect(pollIntervalMs(status)).toBe(2000);
    }
    for (const status of [
      'applied',
      'stopped',
      'failed',
      'verified',
      'verification_failed',
      undefined,
      null,
      'unknown',
    ]) {
      expect(isRunActive(status)).toBe(false);
      expect(pollIntervalMs(status)).toBe(10_000);
    }
    expect(POLL_ACTIVE_MS).toBe(2000);
    expect(POLL_IDLE_MS).toBe(10_000);
  });
});
