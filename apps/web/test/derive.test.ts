import { describe, expect, it } from 'vitest';
import {
  collectionNames,
  defaultTaskId,
  filterFindings,
  filterMappings,
  findingKey,
  groupFindingsByOutcome,
  matchesTerms,
  mergeFindings,
  nonVerifiedItems,
  planIssues,
  queryTerms,
  targetLabel,
  taskActions,
  taskPreview,
  transformLabel,
} from '../src/lib/derive';
import { finding, makePlan, makeVerification } from './fixtures';

const plan = makePlan();
const names = collectionNames(plan);

describe('search terms', () => {
  it('splits, lower-cases and drops empties', () => {
    expect(queryTerms('  Foo   BAR ')).toEqual(['foo', 'bar']);
    expect(queryTerms('')).toEqual([]);
    expect(queryTerms('   ')).toEqual([]);
  });

  it('requires every term to match (case-insensitive)', () => {
    expect(matchesTerms('Hello World', queryTerms('hello world'))).toBe(true);
    expect(matchesTerms('Hello World', queryTerms('hello mars'))).toBe(false);
    expect(matchesTerms('anything', [])).toBe(true);
  });

  it('treats regex characters literally', () => {
    expect(matchesTerms('a.b (c)', queryTerms('.b (c'))).toBe(true);
    expect(matchesTerms('axb', queryTerms('a.b'))).toBe(false);
  });
});

describe('mapping filters', () => {
  it('returns everything without filters', () => {
    expect(filterMappings(plan, { collection: 'all', query: '' })).toHaveLength(3);
  });

  it('filters by collection', () => {
    const roadmap = filterMappings(plan, { collection: 'notion:data_source:aaaaaaaa', query: '' });
    expect(roadmap.map((m) => m.id)).toEqual(['map_1', 'map_2']);
    const bugs = filterMappings(plan, { collection: 'notion:data_source:bbbbbbbb', query: '' });
    expect(bugs.map((m) => m.id)).toEqual(['map_3']);
    expect(filterMappings(plan, { collection: 'notion:data_source:nope', query: '' })).toEqual([]);
  });

  it('searches property, type, target, outcome, reason, unmapped values and collection name', () => {
    const ids = (query: string) =>
      filterMappings(plan, { collection: 'all', query }).map((m) => m.id);
    expect(ids('story')).toEqual(['map_2']);
    expect(ids('NUMBER')).toEqual(['map_2']);
    expect(ids('custom field')).toEqual(['map_2']);
    expect(ids('lossy')).toEqual(['map_1']);
    expect(ids('matching status')).toEqual(['map_1']);
    expect(ids('cosmetic')).toEqual(['map_3']);
    expect(ids('Bug Tracker')).toEqual(['map_3']);
    expect(ids('inferred')).toEqual(['map_2']);
    expect(ids('nothing like this')).toEqual([]);
  });

  it('combines the collection filter and the search', () => {
    expect(
      filterMappings(plan, { collection: 'notion:data_source:aaaaaaaa', query: 'priority' }),
    ).toEqual([]);
    expect(
      filterMappings(plan, { collection: 'notion:data_source:bbbbbbbb', query: 'priority' }).map(
        (m) => m.id,
      ),
    ).toEqual(['map_3']);
  });

  it('labels targets and transforms', () => {
    expect(targetLabel({ kind: 'due_date' })).toBe('Due date');
    expect(
      targetLabel({
        kind: 'custom_field',
        customField: { id: 'x', name: 'Epic', type: 'drop_down' },
      }),
    ).toBe('Custom field: Epic (drop_down)');
    expect(targetLabel({ kind: 'dropped' })).toBe('Dropped (not migrated)');
    expect(transformLabel('epoch_ms')).toBe('Date to epoch ms');
    expect(transformLabel('future_transform')).toBe('future_transform');
  });
});

describe('findings', () => {
  const inventory = plan.inventory;

  it('de-duplicates the plan inventory and the report list', () => {
    const merged = mergeFindings(inventory, [
      inventory[0]!,
      inventory[1]!,
      finding({ code: 'ONLY_IN_REPORT' }),
    ]);
    expect(merged.map((f) => f.code)).toEqual([
      'ATTACHMENT_HOSTED_NOT_MIGRATED',
      'FORMULA_SNAPSHOT',
      'FIELD_PRESERVED_AS_TEXT',
      'ONLY_IN_REPORT',
    ]);
    expect(new Set(merged.map(findingKey)).size).toBe(merged.length);
  });

  it('filters by outcome', () => {
    const codes = (outcome: 'all' | 'unsupported' | 'lossy' | 'transformed') =>
      filterFindings(inventory, { outcome, query: '' }, names).map((f) => f.code);
    expect(codes('all')).toHaveLength(3);
    expect(codes('unsupported')).toEqual(['ATTACHMENT_HOSTED_NOT_MIGRATED']);
    expect(codes('lossy')).toEqual(['FORMULA_SNAPSHOT']);
    expect(codes('transformed')).toEqual(['FIELD_PRESERVED_AS_TEXT']);
  });

  it('searches code, field, message and collection name, and combines with the outcome', () => {
    const codes = (query: string, outcome: 'all' | 'lossy' = 'all') =>
      filterFindings(inventory, { outcome, query }, names).map((f) => f.code);
    expect(codes('attachments')).toEqual(['ATTACHMENT_HOSTED_NOT_MIGRATED']);
    expect(codes('formula')).toEqual(['FORMULA_SNAPSHOT']);
    expect(codes('bug tracker')).toEqual(['FIELD_PRESERVED_AS_TEXT']);
    expect(codes('product roadmap')).toEqual([
      'ATTACHMENT_HOSTED_NOT_MIGRATED',
      'FORMULA_SNAPSHOT',
    ]);
    expect(codes('product roadmap', 'lossy')).toEqual(['FORMULA_SNAPSHOT']);
    expect(codes('zzz')).toEqual([]);
  });

  it('groups by outcome, what cannot move first, with counts', () => {
    const groups = groupFindingsByOutcome(inventory);
    expect(groups.map((g) => g.outcome)).toEqual(['unsupported', 'lossy', 'transformed']);
    expect(groups.map((g) => [g.kinds, g.occurrences])).toEqual([
      [1, 2],
      [1, 28],
      [1, 130],
    ]);
    expect(groupFindingsByOutcome([])).toEqual([]);
  });

  it('counts a finding without a count as one occurrence', () => {
    const [group] = groupFindingsByOutcome([
      finding({ outcome: 'lossy' }),
      finding({ outcome: 'lossy', count: 4 }),
    ]);
    expect(group).toMatchObject({ kinds: 2, occurrences: 5 });
  });

  it('splits plan-level findings by severity', () => {
    const issues = planIssues(plan.findings);
    expect(issues.errors.map((f) => f.code)).toEqual(['PLAN_ERROR']);
    expect(issues.warnings.map((f) => f.code)).toEqual(['PLAN_WARN']);
    expect(issues.infos.map((f) => f.code)).toEqual(['PLAN_INFO']);
  });
});

describe('task preview', () => {
  it('lists only task-creating actions', () => {
    expect(taskActions(plan).map((a) => a.id)).toEqual([
      'act_000000000001',
      'act_000000000002',
      'act_000000000003',
    ]);
  });

  it('extracts every field of a rich task', () => {
    const rich = taskActions(plan)[1]!;
    const preview = taskPreview(rich, plan);
    expect(preview.name).toBe('Rich task');
    expect(preview.listId).toBe('901001');
    expect(preview.listName).toBe('Roadmap');
    expect(preview.status).toBe('in progress');
    expect(preview.priority).toBe(2);
    expect(preview.dueDate).toEqual({ iso: '2026-09-02T02:00:00.000Z', hasTime: false });
    expect(preview.startDate).toEqual({ iso: '2026-08-29T10:40:00.000Z', hasTime: true });
    expect(preview.assignees).toEqual([
      { id: '1001', name: 'Ada Lovelace' },
      { id: '4242', name: null },
    ]);
    expect(preview.tags).toEqual(['design', 'research']);
    expect(preview.customFields).toEqual([
      { id: 'cf-points', name: 'Story points', value: '8' },
      { id: 'cf-unknown', name: null, value: '{"nested":true}' },
    ]);
    expect(preview.markdown).toContain('# Title');
  });

  it('copes with a bare task', () => {
    const preview = taskPreview(taskActions(plan)[0]!, plan);
    expect(preview).toMatchObject({
      name: 'Plain task',
      status: null,
      priority: null,
      dueDate: null,
      startDate: null,
      assignees: [],
      tags: [],
      customFields: [],
      markdown: 'short',
    });
  });

  it('copes with malformed payloads', () => {
    const broken = {
      ...taskActions(plan)[0]!,
      label: 'Fallback label',
      payload: { listId: 5, body: 'not an object' },
    };
    const preview = taskPreview(broken, plan);
    expect(preview.name).toBe('Fallback label');
    expect(preview.listId).toBeNull();
    expect(preview.markdown).toBe('');
    // Not valid JSON values on purpose: the preview must survive whatever a hand-edited plan holds.
    const odd = {
      ...broken,
      payload: {
        body: {
          name: 7,
          assignees: 'x',
          tags: [1, 'ok'],
          custom_fields: [null, { id: 3, value: undefined }],
          due_date: 'soon',
          markdown_content: null,
        },
      },
    } as unknown as typeof broken;
    expect(() => taskPreview(odd, plan)).not.toThrow();
    expect(taskPreview(odd, plan).tags).toEqual(['ok']);
    expect(taskPreview(odd, plan).dueDate).toEqual({ iso: null, hasTime: null });
  });

  it('prefers the most informative task as the default', () => {
    const previews = taskActions(plan).map((a) => taskPreview(a, plan));
    expect(defaultTaskId(previews)).toBe('act_000000000002');
    expect(defaultTaskId([])).toBeNull();
  });
});

describe('verification rows', () => {
  it('lists only items that are not verified, with their failing checks', () => {
    const rows = nonVerifiedItems(makeVerification(), plan);
    expect(rows.map((r) => r.item.actionId)).toEqual(['act_000000000002', 'act_000000000003']);
    expect(rows[0]?.label).toBe('Create task Rich task');
    expect(rows[0]?.failing).toEqual([
      {
        field: 'status',
        status: 'mismatched',
        expected: 'in progress',
        actual: 'to do',
        note: 'differs',
      },
    ]);
    expect(rows[1]?.failing).toEqual([]);
  });

  it('falls back to the action id when the plan has no such action', () => {
    const rows = nonVerifiedItems(makeVerification(), null);
    expect(rows[0]?.label).toBe('act_000000000002');
  });

  it('is empty when everything verified', () => {
    const all = makeVerification({
      items: makeVerification().items.filter((i) => i.status === 'verified'),
    });
    expect(nonVerifiedItems(all, plan)).toEqual([]);
  });
});
