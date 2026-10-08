import {
  isAllowedLinkUrl,
  renderSpansToMarkdown,
  type DataRecord,
  type DateValue,
  type FieldDefinition,
  type FieldValue,
  type Finding,
} from '@exitos/core';
import {
  dateOnlyToEpochMs,
  isValidTimeZone,
  parseNotionDate,
  type ParsedDate,
} from '@exitos/shared';
import { CLICKUP_TASK_POLICY } from './markdown.js';

/** Lower-case and collapse punctuation/whitespace so "To-do", "to do" and "TO DO" compare equal. */
export function canon(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const PRIORITY_NAMES: Readonly<Record<string, 1 | 2 | 3 | 4>> = {
  urgent: 1,
  high: 2,
  normal: 3,
  medium: 3,
  low: 4,
};

export function priorityFrom(value: string | number): 1 | 2 | 3 | 4 | undefined {
  if (typeof value === 'number')
    return [1, 2, 3, 4].includes(value) ? (value as 1 | 2 | 3 | 4) : undefined;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber)) return priorityFrom(asNumber);
  return PRIORITY_NAMES[canon(value)];
}

/** An instant for ClickUp: milliseconds since the epoch and whether it has a time of day. */
export interface Instant {
  ms: number;
  time: boolean;
}

export interface ConvertedDate {
  start?: Instant;
  end?: Instant;
  findings: Array<Pick<Finding, 'code' | 'outcome' | 'severity' | 'category' | 'message'>>;
  invalid?: boolean;
}

function instantFrom(parsed: ParsedDate, timeZone: string): Instant {
  if (parsed.kind === 'date') {
    return { ms: dateOnlyToEpochMs(parsed, timeZone), time: false };
  }
  return { ms: parsed.epochMs, time: true };
}

/**
 * Notion date (ISO string, optional range, optional IANA zone) → ClickUp instants.
 *
 * - Date-only values use ClickUp's own convention for dates without a time (04:00 in the zone of
 *   whoever set them), here the configured `timezone`.
 * - Date-times with an offset or a zone name become exact instants. ClickUp stores UTC only, so the
 *   zone NAME is not preserved (reported as `transformed`).
 * - Floating date-times (no offset, no zone) are interpreted in the configured zone (reported).
 */
export function convertDate(value: DateValue, timeZone: string): ConvertedDate {
  const findings: ConvertedDate['findings'] = [];
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const start = parseNotionDate(value.start, value.timeZone, zone);
  const end = value.end ? parseNotionDate(value.end, value.timeZone, zone) : undefined;
  if (!start || (value.end && !end)) {
    return {
      findings: [
        {
          code: 'DATE_UNPARSEABLE',
          outcome: 'unsupported',
          severity: 'warning',
          category: 'data',
          message:
            'A date could not be parsed as ISO 8601 and was not set; the original text is kept in the description.',
        },
      ],
      invalid: true,
    };
  }
  if (value.timeZone) {
    findings.push({
      code: 'DATE_TIMEZONE_NAME_NOT_PRESERVED',
      outcome: 'transformed',
      severity: 'info',
      category: 'data',
      message:
        'ClickUp stores UTC instants; the time zone name of the original date is not kept (the moment in time is).',
    });
  }
  for (const parsed of [start, end]) {
    if (parsed?.kind === 'datetime' && parsed.assumedZone) {
      findings.push({
        code: 'DATE_ASSUMED_TIMEZONE',
        outcome: 'transformed',
        severity: 'info',
        category: 'data',
        message: `A date-time without a time zone was interpreted in ${zone} (options.timezone).`,
      });
      break;
    }
  }
  return {
    start: instantFrom(start, zone),
    ...(end === undefined ? {} : { end: instantFrom(end, zone) }),
    findings,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+\d[\d\s().-]{5,}$/;

export function validEmail(value: string): boolean {
  return EMAIL.test(value) && value.length <= 254;
}

/** ClickUp requires a country code ("+1 123 456 7890"). */
export function validPhone(value: string): boolean {
  return PHONE.test(value.trim());
}

export function validUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') && u.username === '' && u.password === ''
    );
  } catch {
    return false;
  }
}

/** Plain-text view of a field value (used for text custom fields and as a fallback). */
export function valueToPlain(value: FieldValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  switch (value.kind) {
    case 'title':
    case 'text':
      return value.text;
    case 'number':
      return value.value === null ? undefined : String(value.value);
    case 'select':
    case 'status':
      return value.name ?? undefined;
    case 'multiSelect':
      return value.names.length === 0 ? undefined : value.names.join(', ');
    case 'date':
      return value.value === null ? undefined : formatDate(value.value);
    case 'checkbox':
      return value.value ? 'Yes' : 'No';
    case 'url':
    case 'email':
    case 'phone':
      return value.value ?? undefined;
    case 'person':
      return value.users.length === 0
        ? undefined
        : value.users.map((u) => u.name ?? u.email ?? u.id).join(', ');
    case 'relation':
      return value.targets.length === 0 ? undefined : `${value.targets.length} linked item(s)`;
    case 'files':
      return value.attachments.length === 0
        ? undefined
        : value.attachments.map((a) => a.name).join(', ');
    case 'computed':
      return value.display ?? undefined;
    case 'timestamp':
      return value.iso ?? undefined;
    case 'userStamp':
      return value.user ? (value.user.name ?? value.user.id) : undefined;
    case 'uniqueId':
      return value.display ?? undefined;
    case 'unsupported':
      return undefined;
  }
}

export function formatDate(d: DateValue): string {
  const zone = d.timeZone ? ` (${d.timeZone})` : '';
  return d.end ? `${d.start} → ${d.end}${zone}` : `${d.start}${zone}`;
}

export interface TextOfValue {
  markdown: string;
  findings: Finding[];
}

/**
 * Markdown for a field value inside the "Properties from Notion" table. Rich text keeps its
 * formatting; links are only emitted for http(s) URLs.
 */
export function valueToMarkdown(
  value: FieldValue | undefined,
  field: FieldDefinition,
  record: DataRecord,
  titleOfRecord: (key: string) => string | undefined,
): TextOfValue | undefined {
  if (value === undefined) return undefined;
  const ctx = { entity: record.key, collection: record.collection };
  switch (value.kind) {
    case 'title':
    case 'text': {
      if (value.spans && value.spans.length > 0) {
        const r = renderSpansToMarkdown(value.spans, CLICKUP_TASK_POLICY, ctx);
        return r.markdown === '' ? undefined : { markdown: r.markdown, findings: r.findings };
      }
      return value.text === '' ? undefined : { markdown: value.text, findings: [] };
    }
    case 'url':
      return value.value === null || value.value === ''
        ? undefined
        : {
            markdown: isAllowedLinkUrl(value.value)
              ? `[${value.value}](${value.value})`
              : value.value,
            findings: [],
          };
    case 'relation': {
      if (value.targets.length === 0) return undefined;
      const names = value.targets.map(
        (t) => titleOfRecord(t.key) ?? '(item outside this migration)',
      );
      return { markdown: names.join(', '), findings: [] };
    }
    case 'files': {
      if (value.attachments.length === 0) return undefined;
      const findings: Finding[] = [];
      const parts = value.attachments.map((a) => {
        if (a.hosting === 'external' && a.url !== undefined && isAllowedLinkUrl(a.url))
          return `[${a.name}](${a.url})`;
        findings.push({
          code: 'ATTACHMENT_HOSTED_NOT_MIGRATED',
          outcome: 'unsupported',
          severity: 'warning',
          category: 'attachment',
          message:
            'Files hosted by Notion are not downloaded or re-uploaded in this version; only the file name is kept.',
          entity: record.key,
          collection: record.collection,
          field: field.name,
        });
        return `${a.name} (file not migrated)`;
      });
      return { markdown: parts.join(', '), findings };
    }
    default: {
      const plain = valueToPlain(value);
      return plain === undefined || plain === '' ? undefined : { markdown: plain, findings: [] };
    }
  }
}
