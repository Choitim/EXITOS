/**
 * Time-zone aware date handling with no dependencies (Intl only).
 *
 * ClickUp stores UTC instants (milliseconds since epoch); Notion stores ISO 8601 strings that may be
 * date-only, offset-qualified, or "floating" (no offset, with or without a separate IANA zone name).
 */

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export type ParsedDate =
  | { kind: 'date'; year: number; month: number; day: number }
  | {
      kind: 'datetime';
      epochMs: number;
      /** True when the source string carried an explicit offset or `Z`. */
      hadOffset: boolean;
      /** True when no offset and no zone name were given, so a default zone had to be assumed. */
      assumedZone: boolean;
    };

const zoneValidity = new Map<string, boolean>();

export function isValidTimeZone(timeZone: string): boolean {
  const known = zoneValidity.get(timeZone);
  if (known !== undefined) return known;
  let valid: boolean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    valid = true;
  } catch {
    valid = false;
  }
  // Checked once per row on big migrations; zone names come from data, so keep the cache bounded.
  if (zoneValidity.size < 1000) zoneValidity.set(timeZone, valid);
  return valid;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset (zone − UTC) in milliseconds in effect at the given instant. */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Convert a wall-clock time in `timeZone` to an instant.
 * DST gap (non-existent local time): resolved forward, like most calendar software.
 * DST overlap (ambiguous local time): resolved to the earlier of the two instants.
 *
 * A zone's offset changes at most once near any given moment, so the offsets one day before and one
 * day after the wall-clock time bracket every possibility. Each offset yields one candidate instant,
 * and a candidate is real only if the zone really has that offset there:
 *  - both real  -> the clocks went back and this time happened twice: take the earlier one;
 *  - one real   -> the ordinary case;
 *  - neither    -> the clocks went forward over this time: use the offset from before the change,
 *                  which lands just after the gap (02:30 in a 02:00 -> 03:00 jump becomes 03:30).
 */
export function zonedLocalToEpochMs(local: LocalDateTime, timeZone: string): number {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond,
  );
  const DAY_MS = 86_400_000;
  const before = zoneOffsetMs(naive - DAY_MS, timeZone);
  const after = zoneOffsetMs(naive + DAY_MS, timeZone);
  if (before === after) return naive - before;

  const early = naive - before;
  const late = naive - after;
  const earlyIsReal = zoneOffsetMs(early, timeZone) === before;
  const lateIsReal = zoneOffsetMs(late, timeZone) === after;
  if (earlyIsReal && lateIsReal) return Math.min(early, late);
  if (lateIsReal) return late;
  return early;
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

function validCivil(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function parseOffsetMinutes(token: string): number {
  if (token === 'Z') return 0;
  const sign = token.startsWith('-') ? -1 : 1;
  const digits = token.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4) || '0');
  return sign * (hours * 60 + minutes);
}

/**
 * Parse a Notion date `start`/`end` string.
 *
 * @param zoneName      the property's `time_zone` (IANA) when Notion supplies one
 * @param defaultZone   zone to assume for floating times (configured by the user)
 * @returns `undefined` when the string is not a valid ISO 8601 date/datetime
 */
export function parseNotionDate(
  value: string,
  zoneName: string | null | undefined,
  defaultZone: string,
): ParsedDate | undefined {
  const m = DATE_RE.exec(value.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!validCivil(year, month, day)) return undefined;
  if (m[4] === undefined) return { kind: 'date', year, month, day };

  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');
  const millisecond = Number((m[7] ?? '0').padEnd(3, '0').slice(0, 3));
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  if (m[8] !== undefined) {
    const offsetMin = parseOffsetMinutes(m[8]);
    const epochMs =
      Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMin * 60_000;
    return { kind: 'datetime', epochMs, hadOffset: true, assumedZone: false };
  }

  const zone = zoneName && isValidTimeZone(zoneName) ? zoneName : defaultZone;
  const epochMs = zonedLocalToEpochMs(
    { year, month, day, hour, minute, second, millisecond },
    zone,
  );
  return { kind: 'datetime', epochMs, hadOffset: false, assumedZone: !zoneName };
}

/**
 * ClickUp shows date-only values as 04:00 in the local zone of the user who set them
 * (docs: "Date formatting"). We follow the same convention in the configured zone.
 */
export function dateOnlyToEpochMs(
  date: { year: number; month: number; day: number },
  timeZone: string,
  hour = 4,
): number {
  return zonedLocalToEpochMs({ ...date, hour, minute: 0, second: 0, millisecond: 0 }, timeZone);
}

export function epochToIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** `YYYY-MM-DD` of an instant as seen in a time zone. */
export function epochToZonedDate(epochMs: number, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
