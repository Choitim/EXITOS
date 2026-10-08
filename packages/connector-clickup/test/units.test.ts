import { describe, expect, it } from 'vitest';
import { epochToIso } from '@exitos/shared';
import {
  UserResolver,
  canon,
  classifyClickUpRequest,
  convertDate,
  markersIn,
  normalizeMarkdownForCompare,
  priorityFrom,
  userKey,
  validEmail,
  validPhone,
  validUrl,
  pruneMigratedChildPages,
} from '../src/index.js';

const ms = (c: ReturnType<typeof convertDate>['start']): string => epochToIso(c?.ms ?? 0);

describe('convertDate', () => {
  it('date-only values use ClickUp’s 04:00 convention in the configured zone, without a time', () => {
    const c = convertDate({ start: '2026-09-15' }, 'Europe/Berlin');
    expect(c.start).toEqual({ ms: Date.parse('2026-09-15T02:00:00.000Z'), time: false });
    expect(c.findings).toEqual([]);
    expect(ms(convertDate({ start: '2026-01-15' }, 'America/Los_Angeles').start)).toBe(
      '2026-01-15T12:00:00.000Z',
    );
  });

  it('date-times with an offset become exact instants and flag the time-zone-name loss', () => {
    const c = convertDate({ start: '2026-03-10T09:00:00+01:00', timeZone: 'Europe/Berlin' }, 'UTC');
    expect(c.start).toEqual({ ms: Date.parse('2026-03-10T08:00:00.000Z'), time: true });
    expect(c.findings.map((f) => f.code)).toEqual(['DATE_TIMEZONE_NAME_NOT_PRESERVED']);
  });

  it('floating date-times use the property zone, or the configured one (and say so)', () => {
    const named = convertDate(
      { start: '2026-12-24T18:00:00', timeZone: 'America/Los_Angeles' },
      'UTC',
    );
    expect(ms(named.start)).toBe('2026-12-25T02:00:00.000Z');
    const assumed = convertDate({ start: '2026-06-01T09:30:00' }, 'Europe/Berlin');
    expect(ms(assumed.start)).toBe('2026-06-01T07:30:00.000Z');
    expect(assumed.findings.map((f) => f.code)).toEqual(['DATE_ASSUMED_TIMEZONE']);
  });

  it('keeps a range as start and end', () => {
    const c = convertDate({ start: '2026-09-01', end: '2026-09-30' }, 'UTC');
    expect(ms(c.start)).toBe('2026-09-01T04:00:00.000Z');
    expect(ms(c.end)).toBe('2026-09-30T04:00:00.000Z');
  });

  it('survives DST transitions on both sides', () => {
    // Berlin springs forward on 2026-03-29: 04:00 local is UTC+2 afterwards, UTC+1 before.
    expect(ms(convertDate({ start: '2026-03-28' }, 'Europe/Berlin').start)).toBe(
      '2026-03-28T03:00:00.000Z',
    );
    expect(ms(convertDate({ start: '2026-03-30' }, 'Europe/Berlin').start)).toBe(
      '2026-03-30T02:00:00.000Z',
    );
  });

  it('rejects unparseable dates explicitly', () => {
    const c = convertDate({ start: 'next Tuesday' }, 'UTC');
    expect(c.invalid).toBe(true);
    expect(c.findings[0]).toMatchObject({ code: 'DATE_UNPARSEABLE', outcome: 'unsupported' });
    expect(convertDate({ start: '2026-01-01', end: '2026-02-31' }, 'UTC').invalid).toBe(true);
  });

  it('falls back to UTC when the configured zone is invalid', () => {
    expect(ms(convertDate({ start: '2026-09-15' }, 'Not/AZone').start)).toBe(
      '2026-09-15T04:00:00.000Z',
    );
  });
});

describe('value helpers', () => {
  it('canon makes status/option names comparable', () => {
    expect(canon('To-do')).toBe('to do');
    expect(canon('  IN   PROGRESS ')).toBe('in progress');
    expect(canon('Café — Ünï')).toBe('café ünï');
    expect(canon('日本語 タスク')).toBe('日本語 タスク');
  });

  it('priorityFrom accepts numbers, names and numeric strings', () => {
    expect(priorityFrom(1)).toBe(1);
    expect(priorityFrom('High')).toBe(2);
    expect(priorityFrom('medium')).toBe(3);
    expect(priorityFrom('4')).toBe(4);
    expect(priorityFrom('Someday')).toBeUndefined();
    expect(priorityFrom(9)).toBeUndefined();
  });

  it('validates e-mail, phone (country code required) and URLs', () => {
    expect(validEmail('a@b.co')).toBe(true);
    expect(validEmail('nope')).toBe(false);
    expect(validPhone('+49 30 12345678')).toBe(true);
    expect(validPhone('030 12345678')).toBe(false);
    expect(validUrl('https://example.com')).toBe(true);
    expect(validUrl('javascript:alert(1)')).toBe(false);
    expect(validUrl('https://u:p@example.com')).toBe(false);
  });

  it('extracts provenance markers from descriptions', () => {
    const text =
      'body\n\n`exitos-key:notion:page:abc123`\nmore `exitos-key:notion:page:def456#page`';
    expect(markersIn(text)).toEqual(['notion:page:abc123', 'notion:page:def456#page']);
    expect(markersIn('nothing here')).toEqual([]);
  });

  it('normalises Markdown for comparison without hiding real differences', () => {
    expect(normalizeMarkdownForCompare('a  \r\nb\n\n\n\nc  ')).toBe('a\nb\n\nc');
    expect(normalizeMarkdownForCompare('A')).not.toBe(normalizeMarkdownForCompare('a'));
    expect(normalizeMarkdownForCompare('é')).toBe(normalizeMarkdownForCompare('é'));
  });

  it('prunes only the child pages that are migrated separately', () => {
    const blocks = [
      {
        id: '1',
        kind: 'childPage',
        sourceType: 'child_page',
        text: [],
        children: [],
        target: 'notion:page:aaa',
      },
      {
        id: '2',
        kind: 'childPage',
        sourceType: 'child_page',
        text: [],
        children: [],
        target: 'notion:page:bbb',
      },
    ] as never;
    const kept = pruneMigratedChildPages(blocks, new Set(['notion:page:aaa']));
    expect(kept.map((b) => b.id)).toEqual(['2']);
  });
});

describe('user mapping (ADR 0010)', () => {
  const members = [
    { id: 1001, username: 'ada', email: 'ada@example.com' },
    { id: 1002, username: 'grace', email: 'Grace@Example.com' },
  ];
  const user = (id: string, email?: string) => ({
    key: `notion:user:${id}` as const,
    id,
    type: 'person' as const,
    ...(email ? { email } : {}),
  });
  const cfg = (
    over: Partial<{ matchByEmail: boolean; map: Record<string, string | number> }> = {},
  ) => ({
    matchByEmail: false,
    unmapped: 'description' as const,
    map: {},
    ...over,
  });

  it('never assumes ids correspond across systems', () => {
    const r = new UserResolver(cfg(), members);
    expect(r.resolve(user('1001'))).toBeUndefined();
    expect(r.resolve(user('abc', 'ada@example.com'))).toBeUndefined(); // e-mail matching is opt-in
  });

  it('maps by explicit Notion user id or e-mail, case-insensitively', () => {
    const id = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const r = new UserResolver(
      cfg({ map: { '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0': 1001, 'Linus@Example.com': '1002' } }),
      members,
    );
    expect(r.resolve(user(id))).toEqual({ id: 1001, via: 'explicit' });
    expect(r.resolve(user('other', 'linus@example.com'))).toEqual({ id: 1002, via: 'explicit' });
  });

  it('matchByEmail needs an exact (case-insensitive) e-mail and is labelled as such', () => {
    const r = new UserResolver(cfg({ matchByEmail: true }), members);
    expect(r.resolve(user('x', 'GRACE@example.com'))).toEqual({ id: 1002, via: 'email' });
    expect(r.resolve(user('y', 'grace@example.org'))).toBeUndefined();
    expect(r.resolve(user('z'))).toBeUndefined();
  });

  it('reports mapping targets that are not Workspace members as blocking errors', () => {
    const r = new UserResolver(cfg({ map: { someone: 9999, other: 'not-a-number' } }), members);
    expect(r.findings.map((f) => [f.code, f.severity])).toEqual([
      ['USER_MAP_UNKNOWN_TARGET', 'error'],
      ['USER_MAP_UNKNOWN_TARGET', 'error'],
    ]);
    expect(r.resolve(user('someone'))).toBeUndefined();
  });

  it('userKey normalises ids and e-mails', () => {
    expect(userKey(' ABC@X.IO ')).toBe('abc@x.io');
    expect(userKey('0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0')).toBe(
      '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    );
  });
});

describe('network policy: the only writes ExitOS can ever send', () => {
  const c = (method: string, path: string) =>
    classifyClickUpRequest({ method, url: new URL(`https://api.clickup.com${path}`) });

  it('allows reads', () => {
    expect(c('GET', '/api/v2/team')).toBe('read');
    expect(c('GET', '/api/v3/workspaces/1/docs')).toBe('read');
  });

  it('allows exactly four write endpoints', () => {
    expect(c('POST', '/api/v2/list/901/task')).toBe('write');
    expect(c('POST', '/api/v2/task/abc/link/def')).toBe('write');
    expect(c('POST', '/api/v3/workspaces/123/docs')).toBe('write');
    expect(c('POST', '/api/v3/workspaces/123/docs/2kd-1/pages')).toBe('write');
  });

  it('refuses everything else — v0.1 never deletes, updates or moves anything', () => {
    for (const [m, p] of [
      ['DELETE', '/api/v2/task/abc'],
      ['PUT', '/api/v2/task/abc'],
      ['PUT', '/api/v2/list/901/task'],
      ['POST', '/api/v2/task/abc'],
      ['DELETE', '/api/v2/task/abc/link/def'],
      ['PUT', '/api/v3/workspaces/123/docs/2kd-1/pages/2kp-1'],
      ['POST', '/api/v2/list/901/task/extra'],
      ['POST', '/api/v2/list/../team/1/task'],
      ['GET', '/other/path'],
    ] as const) {
      expect(c(m, p)).toBe('unknown');
    }
  });
});
