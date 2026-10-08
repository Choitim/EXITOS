import { describe, expect, it } from 'vitest';
import {
  dateOnlyToEpochMs,
  epochToIso,
  epochToZonedDate,
  isValidTimeZone,
  parseNotionDate,
  zoneOffsetMs,
  zonedLocalToEpochMs,
} from '../src/index.js';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => ({
  year: y,
  month: mo,
  day: d,
  hour: h,
  minute: mi,
  second: 0,
  millisecond: 0,
});

describe('time zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });

  it('computes offsets across DST', () => {
    const winter = Date.UTC(2026, 0, 15, 12);
    const summer = Date.UTC(2026, 6, 15, 12);
    expect(zoneOffsetMs(winter, 'Europe/Berlin')).toBe(3_600_000);
    expect(zoneOffsetMs(summer, 'Europe/Berlin')).toBe(7_200_000);
    expect(zoneOffsetMs(summer, 'Asia/Kolkata')).toBe(19_800_000);
    expect(zoneOffsetMs(summer, 'Pacific/Kiritimati')).toBe(14 * 3_600_000);
  });

  it('converts wall-clock times in regular periods', () => {
    expect(epochToIso(zonedLocalToEpochMs(local(2026, 7, 1, 9, 0), 'America/New_York'))).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(epochToIso(zonedLocalToEpochMs(local(2026, 1, 1, 9, 0), 'Asia/Tokyo'))).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('resolves a DST gap forward (02:30 does not exist on 2026-03-08 in New York)', () => {
    const ms = zonedLocalToEpochMs(local(2026, 3, 8, 2, 30), 'America/New_York');
    expect(epochToIso(ms)).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT
  });

  it('resolves a DST overlap to the earlier instant (01:30 happens twice on 2026-11-01)', () => {
    const ms = zonedLocalToEpochMs(local(2026, 11, 1, 1, 30), 'America/New_York');
    expect(epochToIso(ms)).toBe('2026-11-01T05:30:00.000Z'); // first 01:30 = EDT
  });

  it('applies ClickUp’s 04:00-local convention to date-only values', () => {
    const date = { year: 2026, month: 9, day: 15 };
    expect(epochToIso(dateOnlyToEpochMs(date, 'UTC'))).toBe('2026-09-15T04:00:00.000Z');
    expect(epochToIso(dateOnlyToEpochMs(date, 'Europe/Berlin'))).toBe('2026-09-15T02:00:00.000Z');
    expect(epochToIso(dateOnlyToEpochMs(date, 'America/Los_Angeles'))).toBe(
      '2026-09-15T11:00:00.000Z',
    );
  });

  it('keeps the calendar day stable for far-east and far-west zones', () => {
    const date = { year: 2026, month: 1, day: 1 };
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata']) {
      expect(epochToZonedDate(dateOnlyToEpochMs(date, tz), tz)).toBe('2026-01-01');
    }
  });
});

describe('parseNotionDate', () => {
  it('parses date-only values', () => {
    expect(parseNotionDate('2026-09-15', null, 'UTC')).toEqual({
      kind: 'date',
      year: 2026,
      month: 9,
      day: 15,
    });
  });

  it('honours explicit offsets and Z', () => {
    const a = parseNotionDate('2026-09-15T10:00:00.000+02:00', null, 'UTC');
    const b = parseNotionDate('2026-09-15T08:00:00Z', null, 'Asia/Tokyo');
    expect(a).toMatchObject({ kind: 'datetime', hadOffset: true, assumedZone: false });
    expect(a && a.kind === 'datetime' && epochToIso(a.epochMs)).toBe('2026-09-15T08:00:00.000Z');
    expect(b && b.kind === 'datetime' && b.epochMs).toBe(
      a && a.kind === 'datetime' ? a.epochMs : -1,
    );
  });

  it('uses the property time_zone for floating times', () => {
    const p = parseNotionDate('2026-12-24T18:00:00', 'America/Los_Angeles', 'UTC');
    expect(p).toMatchObject({ kind: 'datetime', hadOffset: false, assumedZone: false });
    expect(p && p.kind === 'datetime' && epochToIso(p.epochMs)).toBe('2026-12-25T02:00:00.000Z');
  });

  it('flags that a default zone was assumed when none is supplied', () => {
    const p = parseNotionDate('2026-06-01T09:30', null, 'Europe/Berlin');
    expect(p).toMatchObject({ kind: 'datetime', assumedZone: true });
    expect(p && p.kind === 'datetime' && epochToIso(p.epochMs)).toBe('2026-06-01T07:30:00.000Z');
  });

  it('falls back to the default zone when the named zone is invalid', () => {
    const p = parseNotionDate('2026-06-01T09:30:00', 'Nowhere/Land', 'UTC');
    expect(p && p.kind === 'datetime' && epochToIso(p.epochMs)).toBe('2026-06-01T09:30:00.000Z');
  });

  it('rejects impossible or malformed dates', () => {
    expect(parseNotionDate('2026-02-30', null, 'UTC')).toBeUndefined();
    expect(parseNotionDate('2026-13-01', null, 'UTC')).toBeUndefined();
    expect(parseNotionDate('2026-01-01T25:00:00Z', null, 'UTC')).toBeUndefined();
    expect(parseNotionDate('yesterday', null, 'UTC')).toBeUndefined();
    expect(parseNotionDate('', null, 'UTC')).toBeUndefined();
  });

  it('accepts leap days only in leap years', () => {
    expect(parseNotionDate('2028-02-29', null, 'UTC')).toBeDefined();
    expect(parseNotionDate('2027-02-29', null, 'UTC')).toBeUndefined();
  });
});
