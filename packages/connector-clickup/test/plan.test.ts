import { describe, expect, it } from 'vitest';
import { checkDestinationPlan } from '@exitos/core/testing';
import {
  ADA,
  adaObj,
  block,
  defaultConfigYaml,
  graceObj,
  linusObj,
  notionFixture,
  rowId,
  rt,
  uid,
  world,
} from './harness.js';
import type { PlanBody } from '@exitos/core';

const payloadOf = (plan: { actions: Array<{ payload: unknown }> }, i: number) =>
  plan.actions[i]?.payload as {
    body: Record<string, unknown>;
    listId: string;
    marker: string | null;
  };
const rule = (plan: PlanBody, name: string) => plan.mappings.find((m) => m.source.name === name)!;

describe('plan: mapping decisions', () => {
  it('infers status, priority, due date, tags and assignees; explicit config maps custom fields', async () => {
    const w = world({
      notion: notionFixture([
        {
          n: 1,
          title: 'Ship login',
          status: 'In progress',
          priority: 'High',
          due: ['2026-09-15', null, null],
          tags: ['frontend', 'backend'],
          points: 5,
          epic: 'Platform',
          spec: 'https://example.com/s',
          review: true,
          owner: [adaObj()],
        },
      ]),
    });
    const plan = await w.plan();
    const body = payloadOf(plan, 0).body;
    expect(body).toMatchObject({
      name: 'Ship login',
      status: 'in progress',
      priority: 2,
      due_date: Date.parse('2026-09-15T04:00:00Z'),
      due_date_time: false,
      assignees: [1001],
      tags: ['frontend', 'backend'],
      notify_all: false,
    });
    expect(body.custom_fields).toHaveLength(4);
    expect(body.custom_fields).toEqual(
      expect.arrayContaining([
        { id: 'cf-points', value: 5 },
        { id: 'cf-epic', value: 'opt-platform' },
        { id: 'cf-spec', value: 'https://example.com/s' },
        { id: 'cf-review', value: true },
      ]),
    );
    expect(rule(plan, 'Status').target.kind).toBe('status');
    expect(rule(plan, 'Priority').target.kind).toBe('priority');
    expect(rule(plan, 'Due').target.kind).toBe('due_date');
    expect(rule(plan, 'Owner').target.kind).toBe('assignees');
    expect(rule(plan, 'Tags').target.kind).toBe('tags');
    expect(rule(plan, 'Points').target).toMatchObject({
      kind: 'custom_field',
      customField: { id: 'cf-points', type: 'number' },
    });
    expect(rule(plan, 'Points')).toMatchObject({ explicit: true, outcome: 'supported' });
  });

  it('a status with no matching ClickUp status is lossy, keeps the value, and the plan suggests the fix', async () => {
    const w = world({
      notion: notionFixture([
        { n: 1, status: 'Not started' },
        { n: 2, status: 'In progress' },
        { n: 3, status: 'Blocked' },
      ]),
    });
    const plan = await w.plan();
    const status = rule(plan, 'Status');
    expect(status.outcome).toBe('lossy');
    expect([...(status.unmappedValues ?? [])].sort()).toEqual(['Blocked', 'Done', 'Not started']); // "In review" matches the ClickUp status "in review"
    expect(status.reason).toContain('"Not started": "to do"'); // suggested via the To-do group, never auto-applied
    const first = payloadOf(plan, 0).body;
    expect(first.status).toBeUndefined(); // falls back to the list default
    expect(String(first.markdown_content)).toContain('| Status | Not started |'); // value is not lost
    expect(plan.actions[0]?.findings.map((f) => f.code)).toContain('STATUS_VALUE_UNMAPPED');
    expect(payloadOf(plan, 1).body.status).toBe('in progress');
  });

  it('an explicit valueMap fixes it and is validated against the list', async () => {
    const yaml = defaultConfigYaml().replace(
      'fields:',
      'fields:\n        Status: { to: status, valueMap: { "Not started": "to do", Done: complete, Blocked: "in progress" } }',
    );
    const ok = world({
      notion: notionFixture([
        { n: 1, status: 'Not started' },
        { n: 2, status: 'Blocked' },
      ]),
      config: yaml,
    });
    const plan = await ok.plan();
    expect(payloadOf(plan, 0).body.status).toBe('to do');
    expect(payloadOf(plan, 1).body.status).toBe('in progress');
    expect(rule(plan, 'Status').explicit).toBe(true);

    const bad = world({
      notion: notionFixture([{ n: 1 }]),
      config: yaml.replace('Done: complete', 'Done: nonexistent'),
    });
    const badPlan = await bad.plan();
    expect(badPlan.findings.find((f) => f.code === 'MAPPING_STATUS_UNKNOWN')).toMatchObject({
      severity: 'error',
    });
    expect(() => bad.approve(badPlan)).toThrow(/blocking error/);
  });

  it('priority values without a ClickUp equivalent are reported, not guessed', async () => {
    const w = world({
      notion: notionFixture([
        { n: 1, priority: 'Urgent' },
        { n: 2, priority: 'Medium' },
        { n: 3, priority: 'Someday' },
      ]),
    });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.priority).toBe(1);
    expect(payloadOf(plan, 1).body.priority).toBe(3);
    expect(payloadOf(plan, 2).body.priority).toBeUndefined();
    expect(rule(plan, 'Priority')).toMatchObject({ outcome: 'lossy', unmappedValues: ['Someday'] });
    expect(String(payloadOf(plan, 2).body.markdown_content)).toContain('Someday');
  });

  it('tags are only applied when they already exist in the Space; the rest stay visible as text', async () => {
    const w = world({ notion: notionFixture([{ n: 1, tags: ['frontend', 'research'] }]) });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.tags).toEqual(['frontend']);
    expect(String(payloadOf(plan, 0).body.markdown_content)).toContain('research');
    expect(plan.inventory.find((f) => f.code === 'TAG_NOT_IN_SPACE')).toMatchObject({
      outcome: 'lossy',
    });
  });

  it('dropdown options that do not exist in ClickUp are never invented', async () => {
    const w = world({
      notion: notionFixture([
        { n: 1, epic: 'Growth' },
        { n: 2, epic: 'Mobile' },
      ]),
    });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.custom_fields).not.toContainEqual(
      expect.objectContaining({ id: 'cf-epic' }),
    );
    expect(String(payloadOf(plan, 0).body.markdown_content)).toContain('Growth');
    expect(payloadOf(plan, 1).body.custom_fields).toContainEqual({
      id: 'cf-epic',
      value: 'opt-mobile',
    });
    expect(rule(plan, 'Epic')).toMatchObject({ outcome: 'lossy', unmappedValues: ['Growth'] });
  });

  it('invalid values for typed custom fields fall back to text with a finding', async () => {
    const w = world({ notion: notionFixture([{ n: 1, spec: 'not a url at all' }]) });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.custom_fields).not.toContainEqual(
      expect.objectContaining({ id: 'cf-spec' }),
    );
    expect(plan.actions[0]?.findings.map((f) => f.code)).toContain('CUSTOM_FIELD_VALUE_INVALID');
    expect(String(payloadOf(plan, 0).body.markdown_content)).toContain('not a url at all');
  });

  it('unmapped fields are kept in a visible table, and can instead be dropped (and reported)', async () => {
    const keep = await world({
      notion: notionFixture([{ n: 1, notes: 'Remember **this**' }]),
    }).plan();
    // literal asterisks in the source text are escaped so they cannot change formatting
    expect(String(payloadOf(keep, 0).body.markdown_content)).toContain(
      '| Notes | Remember \\*\\*this\\*\\* |',
    );
    expect(rule(keep, 'Notes')).toMatchObject({
      target: { kind: 'description_table' },
      outcome: 'transformed',
    });

    const skip = await world({
      notion: notionFixture([{ n: 1, notes: 'Remember this' }]),
      config: defaultConfigYaml().replace('users:', 'options:\n  unmappedFields: skip\nusers:'),
    }).plan();
    expect(String(payloadOf(skip, 0).body.markdown_content)).not.toContain('Remember this');
    expect(rule(skip, 'Notes').outcome).toBe('unsupported');
    expect(skip.inventory.find((f) => f.code === 'FIELD_DROPPED')).toMatchObject({
      outcome: 'unsupported',
    });
  });
});

describe('plan: dates and time zones', () => {
  const dueOf = async (due: [string, string | null, string | null], tz = 'UTC') => {
    const w = world({
      notion: notionFixture([{ n: 1, due }]),
      config: defaultConfigYaml(`options:\n  timezone: ${tz}`),
    });
    return payloadOf(await w.plan(), 0).body;
  };

  it('date-only → 04:00 in the configured zone, no time flag', async () => {
    expect(await dueOf(['2026-09-15', null, null], 'Europe/Berlin')).toMatchObject({
      due_date: Date.parse('2026-09-15T02:00:00Z'),
      due_date_time: false,
    });
  });

  it('date-time with zone → exact instant with the time flag', async () => {
    expect(await dueOf(['2026-12-24T18:00:00', null, 'America/Los_Angeles'])).toMatchObject({
      due_date: Date.parse('2026-12-25T02:00:00Z'),
      due_date_time: true,
    });
  });

  it('a range sets both start and due date', async () => {
    expect(await dueOf(['2026-09-01', '2026-09-30', null])).toMatchObject({
      start_date: Date.parse('2026-09-01T04:00:00Z'),
      due_date: Date.parse('2026-09-30T04:00:00Z'),
    });
  });

  it('an unparseable date is reported and preserved as text', async () => {
    const w = world({ notion: notionFixture([{ n: 1, due: ['soon-ish', null, null] }]) });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.due_date).toBeUndefined();
    expect(plan.actions[0]?.findings.map((f) => f.code)).toContain('DATE_UNPARSEABLE');
  });
});

describe('plan: people', () => {
  it('assigns only explicitly mapped people, lists the rest, and counts notifications', async () => {
    const w = world({
      notion: notionFixture([{ n: 1, owner: [adaObj(), graceObj(), linusObj()] }]),
    });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.assignees).toEqual([1001]);
    expect(plan.users.mapped.map((u) => [u.name, u.destinationId, u.via])).toEqual([
      ['Ada Lovelace', '1001', 'explicit'],
    ]);
    expect(plan.users.unmapped.map((u) => u.name).sort()).toEqual(['Grace Hopper', 'Linus T.']);
    expect(plan.users.assignmentsThatNotify).toBe(1);
    expect(plan.findings.find((f) => f.code === 'ASSIGNEES_WILL_BE_NOTIFIED')).toBeDefined();
    expect(String(payloadOf(plan, 0).body.markdown_content)).toContain('Grace Hopper, Linus T.');
    expect(plan.inventory.find((f) => f.code === 'USER_UNMAPPED')).toMatchObject({
      outcome: 'lossy',
    });
  });

  it('matchByEmail is opt-in and shown as such', async () => {
    const yaml = defaultConfigYaml().replace('users:', 'users:\n  matchByEmail: true');
    const w = world({ notion: notionFixture([{ n: 1, owner: [graceObj()] }]), config: yaml });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.assignees).toEqual([1002]);
    expect(plan.users.mapped[0]).toMatchObject({ via: 'email', destinationId: '1002' });
  });

  it('a mapping to a non-member is a blocking error', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }]),
      config: defaultConfigYaml().replace(': 1001', ': 4242'),
    });
    const plan = await w.plan();
    expect(plan.findings.find((f) => f.code === 'USER_MAP_UNKNOWN_TARGET')?.severity).toBe('error');
    expect(() => w.approve(plan)).toThrow(/blocking/);
  });

  it('with no mapping at all, nobody is assigned and nobody is notified', async () => {
    const yaml = defaultConfigYaml()
      .replace(`    "${ADA}": 1001`, '    {}')
      .replace('map:\n    {}', 'map: {}');
    const w = world({ notion: notionFixture([{ n: 1, owner: [adaObj()] }]), config: yaml });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.assignees).toBeUndefined();
    expect(plan.users.assignmentsThatNotify).toBe(0);
    expect(plan.findings.find((f) => f.code === 'ASSIGNEES_WILL_BE_NOTIFIED')).toBeUndefined();
  });
});

describe('plan: configuration errors are blocking, never guessed around', () => {
  const planWith = async (fields: string, rows = [{ n: 1 }]) => {
    const yaml = defaultConfigYaml().replace('fields:', `fields:\n${fields}`);
    return world({ notion: notionFixture(rows), config: yaml }).plan();
  };
  const codes = (p: { findings: Array<{ code: string; severity: string }> }) =>
    p.findings.filter((f) => f.severity === 'error').map((f) => f.code);

  it('unknown source property', async () => {
    expect(codes(await planWith('        Nope: { to: status }'))).toContain(
      'MAPPING_UNKNOWN_FIELD',
    );
  });

  it('incompatible target for the property type', async () => {
    expect(codes(await planWith('        Notes: { to: due_date }'))).toContain(
      'MAPPING_INCOMPATIBLE',
    );
  });

  it('unknown custom field (ClickUp cannot create fields)', async () => {
    const p = await planWith('        Notes: { to: custom_field, field: "Does not exist" }');
    expect(codes(p)).toContain('MAPPING_CUSTOM_FIELD_UNKNOWN');
    expect(p.findings.find((f) => f.code === 'MAPPING_CUSTOM_FIELD_UNKNOWN')?.message).toMatch(
      /cannot create/,
    );
  });

  it('incompatible custom field type', async () => {
    expect(
      codes(await planWith('        Notes: { to: custom_field, field: Story points }')),
    ).toContain('MAPPING_CUSTOM_FIELD_TYPE');
  });

  it('two properties for one target', async () => {
    expect(
      codes(await planWith('        Status: { to: status }\n        Priority: { to: status }')),
    ).toContain('MAPPING_TARGET_CONFLICT');
  });

  it('a list that does not exist', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }]),
      config: defaultConfigYaml().replace('901001', '999999'),
    });
    const plan = await w.plan();
    expect(codes(plan)).toContain('DEST_LIST_NOT_FOUND');
    expect(plan.actions).toHaveLength(0);
  });

  it('a mapping that references a data source that was not read', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }]),
      config: defaultConfigYaml().replace('source: Roadmap', 'source: Backlog'),
    });
    expect(codes(await w.plan())).toContain('CONFIG_SOURCE_NOT_SELECTED');
  });

  it('a data source with no list mapping is reported as not migrated, never silently dropped', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }, { n: 2 }]),
      config: defaultConfigYaml().replace(/lists:[\s\S]*?(?=\nusers:)/, 'lists: []'),
    });
    const plan = await w.plan();
    expect(plan.actions).toHaveLength(0);
    expect(plan.findings.find((f) => f.code === 'COLLECTION_NOT_MAPPED')).toMatchObject({
      outcome: 'skipped',
    });
    expect(plan.collections[0]).toMatchObject({ recordCount: 2, target: null });
  });
});

describe('plan: content', () => {
  it('writes the page body as Markdown plus a provenance footer with the reconciliation marker', async () => {
    const w = world({
      notion: notionFixture([{ n: 1, title: 'With body' }], {
        [rowId(1)]: [
          block.heading(uid('a'), rowId(1), 2, 'Overview'),
          block.paragraph(uid('b'), rowId(1), [
            rt('Plain and '),
            rt('bold', { bold: true }),
            rt(' and underlined', { underline: true }),
          ]),
          block.todo(uid('c'), rowId(1), 'Ship it', false),
          block.imageHosted(uid('d'), rowId(1), 'diagram.png'),
        ],
      }),
    });
    const plan = await w.plan();
    const md = String(payloadOf(plan, 0).body.markdown_content);
    expect(md).toContain('## Overview');
    expect(md).toContain('Plain and **bold** and underlined');
    expect(md).toContain('- [ ] Ship it');
    expect(md).toContain('*[Image not migrated: "diagram.png" (hosted by Notion)]*');
    expect(md).toContain('`exitos-key:notion:page:' + rowId(1).replace(/-/g, '') + '`');
    expect(payloadOf(plan, 0).marker).toBe('exitos-key:notion:page:' + rowId(1).replace(/-/g, ''));
    const codes = plan.inventory.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'FORMAT_UNDERLINE_DROPPED',
        'BLOCK_TODO_AS_TEXT',
        'ATTACHMENT_HOSTED_NOT_MIGRATED',
      ]),
    );
    expect(plan.summary.notPreserved.unsupported).toBeGreaterThan(0);
  });

  it('never leaks signed Notion URLs into the plan', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }], {
        [rowId(1)]: [
          block.imageHosted(uid('d'), rowId(1), 'a.png'),
          block.pdfHosted(uid('e'), rowId(1), 'b.pdf'),
        ],
      }),
    });
    const text = JSON.stringify(await w.plan());
    expect(text).not.toMatch(/X-Amz|amazonaws|FIXTURE_SIGNATURE/);
  });

  it('provenance: none omits the marker and warns about weaker reconciliation', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }]),
      config: defaultConfigYaml('options:\n  provenance: none'),
    });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).marker).toBeNull();
    expect(String(payloadOf(plan, 0).body.markdown_content)).not.toContain('exitos-key');
    expect(plan.findings.find((f) => f.code === 'PROVENANCE_DISABLED')).toMatchObject({
      severity: 'warning',
    });
  });

  it('normalises multi-line titles and Unicode survives', async () => {
    const w = world({ notion: notionFixture([{ n: 1, title: 'Tâche — 日本語 🚀\nsecond line' }]) });
    const plan = await w.plan();
    expect(payloadOf(plan, 0).body.name).toBe('Tâche — 日本語 🚀 second line');
    expect(plan.inventory.map((f) => f.code)).toContain('NAME_NORMALIZED');
  });

  it('relations become links only between migrated items; out-of-scope targets are reported', async () => {
    const f = notionFixture([{ n: 1, deps: [2, 99] }, { n: 2 }]);
    const w = world({ notion: f });
    const plan = await w.plan();
    const links = plan.actions.filter((a) => a.kind === 'clickup.link_tasks');
    expect(links).toHaveLength(1);
    expect(links[0]?.dependsOn).toHaveLength(2);
    expect(plan.inventory.find((x) => x.code === 'RELATION_TARGET_OUT_OF_SCOPE')).toMatchObject({
      outcome: 'unsupported',
    });
    // order: tasks first, links last
    expect(plan.actions.map((a) => a.kind)).toEqual([
      'clickup.create_task',
      'clickup.create_task',
      'clickup.link_tasks',
    ]);
  });

  it('dual relations produce one link, not two', async () => {
    const w = world({
      notion: notionFixture([
        { n: 1, deps: [2] },
        { n: 2, deps: [1] },
      ]),
    });
    const plan = await w.plan();
    expect(plan.actions.filter((a) => a.kind === 'clickup.link_tasks')).toHaveLength(1);
  });

  it('relations: skip keeps the related titles as text and creates no links', async () => {
    const yaml = defaultConfigYaml().replace('fields:', 'relations: skip\n      fields:');
    const w = world({
      notion: notionFixture([
        { n: 1, title: 'A', deps: [2] },
        { n: 2, title: 'B' },
      ]),
      config: yaml,
    });
    const plan = await w.plan();
    expect(plan.actions.some((a) => a.kind === 'clickup.link_tasks')).toBe(false);
    expect(String(payloadOf(plan, 0).body.markdown_content)).toContain('| Depends on | B |');
  });
});

describe('plan: properties of the plan itself', () => {
  it('is deterministic: planning the same inputs twice gives the same hash', async () => {
    const fixture = notionFixture([
      { n: 1, owner: [adaObj()], tags: ['frontend'] },
      { n: 2, deps: [1] },
    ]);
    const a = await world({ notion: fixture }).plan();
    const b = await world({ notion: fixture }).plan();
    expect(a.hash).toBe(b.hash);
    expect(a.planId).toBe(b.planId);
    expect(JSON.stringify({ ...a, generatedAt: '' })).toBe(
      JSON.stringify({ ...b, generatedAt: '' }),
    );
  });

  it('contains no credentials', async () => {
    const w = world({ notion: notionFixture([{ n: 1 }]) });
    const text = JSON.stringify(await w.plan());
    expect(text).not.toContain('harnesstoken');
    expect(text).not.toContain('HARNESSTOKEN');
    expect(text).not.toMatch(/Bearer|authorization/i);
  });

  it('estimates requests and time at the rate limit', async () => {
    const w = world({
      notion: notionFixture(Array.from({ length: 30 }, (_, i) => ({ n: i + 1 }))),
    });
    const plan = await w.plan();
    expect(plan.estimate.writeRequests).toBe(30);
    expect(plan.estimate.requestsPerMinute).toBe(90);
    expect(plan.estimate.minutesAtRateLimit).toBeCloseTo(0.3, 1);
    expect(plan.estimate.readRequests).toBeGreaterThan(0);
  });

  it('lists what can never migrate', async () => {
    const plan = await world({ notion: notionFixture([{ n: 1 }]) }).plan();
    expect(plan.knownLimits.join(' ')).toMatch(/Comments/);
    expect(plan.knownLimits.join(' ')).toMatch(/cannot be created/);
  });

  it('passes the destination conformance kit', async () => {
    const w = world({
      notion: notionFixture([
        { n: 1, owner: [adaObj()] },
        { n: 2, deps: [1] },
      ]),
    });
    const raw = await w.source.extract();
    const snapshot = w.source.normalize(raw);
    const inspection = await w.destRO.inspect();
    const report = checkDestinationPlan(w.destRO, {
      snapshot,
      inspection,
      config: w.config,
      mode: 'live',
      existing: new Map(),
    });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  });
});
