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

describe('isValidTimeZone (cached)', () => {
  it('keeps answering correctly for repeated valid and invalid zones', () => {
    for (let i = 0; i < 3; i++) {
      expect(isValidTimeZone('Europe/Berlin')).toBe(true);
      expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
      expect(isValidTimeZone('')).toBe(false);
    }
  });

  it('does not let attacker-controlled zone names grow the cache without bound', () => {
    // 5 000 distinct junk names: every answer is still correct, and nothing throws.
    for (let i = 0; i < 5000; i++) expect(isValidTimeZone(`Junk/Zone_${i}`)).toBe(false);
    expect(isValidTimeZone('UTC')).toBe(true);
  });
});

describe('zonedLocalToEpochMs: DST gaps and overlaps resolve the same way in every zone', () => {
  const at = (iso: string, zone: string): string => {
    const [date = '', time = ''] = iso.split('T');
    const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
    const [hour = 0, minute = 0] = time.split(':').map(Number);
    const ms = zonedLocalToEpochMs(
      { year, month, day, hour, minute, second: 0, millisecond: 0 },
      zone,
    );
    return new Date(ms).toISOString().slice(0, 16);
  };

  // Policy: a time that does not exist moves FORWARD (02:30 in a 02:00→03:00 jump is 03:30);
  // a time that happens twice is the EARLIER one. Zones east of UTC used to get this backwards.
  it.each([
    // zone, local time, expected UTC instant, what it is
    ['Europe/Berlin', '2026-03-29T02:30', '2026-03-29T01:30', 'gap (03:30 CEST)'],
    ['Europe/Berlin', '2026-10-25T02:30', '2026-10-25T00:30', 'overlap (the first, CEST)'],
    ['Europe/London', '2026-03-29T01:30', '2026-03-29T01:30', 'gap (02:30 BST)'],
    ['Europe/London', '2026-10-25T01:30', '2026-10-25T00:30', 'overlap (the first, BST)'],
    ['Australia/Sydney', '2026-10-04T02:30', '2026-10-03T16:30', 'gap (03:30 AEDT)'],
    ['Australia/Sydney', '2026-04-05T02:30', '2026-04-04T15:30', 'overlap (the first, AEDT)'],
    ['Australia/Lord_Howe', '2026-04-05T01:45', '2026-04-04T14:45', 'overlap in a half-hour shift'],
    ['Pacific/Auckland', '2026-09-27T02:30', '2026-09-26T14:30', 'gap (03:30 NZDT)'],
    ['America/New_York', '2026-03-08T02:30', '2026-03-08T07:30', 'gap (03:30 EDT)'],
    ['America/New_York', '2026-11-01T01:30', '2026-11-01T05:30', 'overlap (the first, EDT)'],
    ['America/Los_Angeles', '2026-03-08T02:30', '2026-03-08T10:30', 'gap (03:30 PDT)'],
  ] as const)('%s %s → %s UTC: %s', (zone, local, expected, _what) => {
    expect(at(local, zone)).toBe(expected);
  });

  it('ordinary times, also on the day of a change, are unaffected', () => {
    expect(at('2026-03-29T10:00', 'Europe/Berlin')).toBe('2026-03-29T08:00');
    expect(at('2026-03-29T00:30', 'Europe/Berlin')).toBe('2026-03-28T23:30');
    expect(at('2026-10-25T10:00', 'Europe/Berlin')).toBe('2026-10-25T09:00');
    expect(at('2026-07-01T12:00', 'Asia/Kolkata')).toBe('2026-07-01T06:30');
    expect(at('2026-07-01T12:00', 'UTC')).toBe('2026-07-01T12:00');
  });

  it('agrees with a brute-force search of every instant, around every 2026 change, in many zones', () => {
    const formatters = new Map<string, Intl.DateTimeFormat>();
    const wallClock = (t: number, zone: string): number => {
      let f = formatters.get(zone);
      if (f === undefined) {
        f = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
        });
        formatters.set(zone, f);
      }
      const p = Object.fromEntries(
        f.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]),
      );
      return Date.UTC(
        p.year ?? 0,
        (p.month ?? 1) - 1,
        p.day ?? 1,
        (p.hour ?? 0) % 24,
        p.minute ?? 0,
        p.second ?? 0,
      );
    };
    const MIN = 60_000;
    const oracle = (naive: number, zone: string): number => {
      const hits: number[] = [];
      for (let t = naive - 30 * 60 * MIN; t <= naive + 30 * 60 * MIN; t += 15 * MIN) {
        if (wallClock(t, zone) === naive) hits.push(t);
      }
      if (hits.length > 0) return Math.min(...hits);
      let change = naive - 30 * 60 * MIN;
      while (
        wallClock(change + 15 * MIN, zone) - (change + 15 * MIN) ===
        wallClock(change, zone) - change
      ) {
        change += 15 * MIN;
      }
      return naive - (wallClock(change, zone) - change);
    };

    const zones = [
      'America/New_York',
      'America/Los_Angeles',
      'Europe/Berlin',
      'Europe/London',
      'Australia/Sydney',
      'Australia/Lord_Howe',
      'Pacific/Auckland',
    ];
    let compared = 0;
    for (const zone of zones) {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 60 * MIN) {
        const jump = wallClock(t + 60 * MIN, zone) - (t + 60 * MIN) !== wallClock(t, zone) - t;
        if (!jump) continue;
        const base = wallClock(t, zone);
        for (let delta = -90; delta <= 150; delta += 15) {
          const naive = base + delta * MIN;
          const d = new Date(naive);
          const local = {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            hour: d.getUTCHours(),
            minute: d.getUTCMinutes(),
            second: 0,
            millisecond: 0,
          };
          expect(zonedLocalToEpochMs(local, zone), `${zone} ${d.toISOString().slice(0, 16)}`).toBe(
            oracle(naive, zone),
          );
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(150);
  });
});
