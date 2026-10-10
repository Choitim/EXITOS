import { describe, expect, it } from 'vitest';
import {
  GROUP_CAP,
  PAGE_SIZE,
  capGroup,
  chipOutcomes,
  collectionNames,
  defaultTaskId,
  describeRowCount,
  describeTaskSummary,
  filterFindings,
  filterMappings,
  findingKey,
  groupFindingsByOutcome,
  isGroupOpenByDefault,
  mappingOutcomeCounts,
  matchesTerms,
  mergeFindings,
  nonVerifiedItems,
  planIssues,
  queryTerms,
  targetLabel,
  taskActions,
  taskOutcomeSummary,
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

describe('outcome filters and chip counts for the mapping table', () => {
  const ids = (outcome: 'all' | 'supported' | 'transformed' | 'lossy' | 'unsupported') =>
    filterMappings(plan, { collection: 'all', query: '', outcome }).map((m) => m.id);

  it('filters by outcome, and "all" (or no outcome) keeps everything', () => {
    expect(ids('all')).toEqual(['map_1', 'map_2', 'map_3']);
    expect(filterMappings(plan, { collection: 'all', query: '' })).toHaveLength(3);
    expect(ids('lossy')).toEqual(['map_1']);
    expect(ids('supported')).toEqual(['map_2']);
    expect(ids('transformed')).toEqual(['map_3']);
    expect(ids('unsupported')).toEqual([]);
  });

  it('combines the outcome with the collection filter and the search', () => {
    expect(
      filterMappings(plan, {
        collection: 'notion:data_source:aaaaaaaa',
        query: '',
        outcome: 'transformed',
      }),
    ).toEqual([]);
    expect(
      filterMappings(plan, { collection: 'all', query: 'status', outcome: 'lossy' }).map(
        (m) => m.id,
      ),
    ).toEqual(['map_1']);
  });

  it('finds an outcome by the words people see as well as by the data value', () => {
    const find = (query: string) =>
      filterMappings(plan, { collection: 'all', query }).map((m) => m.id);
    expect(find('requires review')).toEqual(['map_1']);
    expect(find('loses detail')).toEqual(['map_1']);
    expect(find('preserved')).toEqual(['map_2']);
    expect(find('changes shape')).toEqual(['map_3']);
    expect(find('lossy')).toEqual(['map_1']);
  });

  it('counts per outcome given the collection and search, ignoring the outcome filter', () => {
    expect(mappingOutcomeCounts(plan, { collection: 'all', query: '' })).toEqual({
      all: 3,
      supported: 1,
      transformed: 1,
      lossy: 1,
      unsupported: 0,
      skipped: 0,
      failed: 0,
    });
    expect(
      mappingOutcomeCounts(plan, { collection: 'notion:data_source:aaaaaaaa', query: '' }),
    ).toMatchObject({ all: 2, supported: 1, lossy: 1, transformed: 0 });
    expect(mappingOutcomeCounts(plan, { collection: 'all', query: 'zzz' }).all).toBe(0);
  });

  it('shows the four headline chips always and the others only when they occur or are selected', () => {
    const counts = mappingOutcomeCounts(plan, { collection: 'all', query: '' });
    expect(chipOutcomes(counts, 'all')).toEqual([
      'supported',
      'transformed',
      'lossy',
      'unsupported',
    ]);
    expect(chipOutcomes({ ...counts, skipped: 2 }, 'all')).toContain('skipped');
    expect(chipOutcomes(counts, 'failed')).toContain('failed');
  });
});

describe('paging', () => {
  it('uses pages of 25', () => {
    expect(PAGE_SIZE).toBe(25);
  });

  it('keeps "Showing X of Y" honest', () => {
    expect(describeRowCount({ shown: 25, matching: 25, total: 25 })).toBe(
      'Showing 25 of 25 mappings',
    );
    expect(describeRowCount({ shown: 1, matching: 1, total: 1 })).toBe('Showing 1 of 1 mapping');
    // paged but not filtered: the first 25 of all 80
    expect(describeRowCount({ shown: 25, matching: 80, total: 80 })).toBe(
      'Showing 25 of 80 mappings',
    );
    expect(describeRowCount({ shown: 12, matching: 12, total: 80 })).toBe(
      'Showing 12 of 80 mappings (filtered)',
    );
    expect(describeRowCount({ shown: 25, matching: 40, total: 80 })).toBe(
      'Showing 25 of 80 mappings (40 match the filters)',
    );
    expect(describeRowCount({ shown: 0, matching: 0, total: 80 })).toBe(
      'Showing 0 of 80 mappings (filtered)',
    );
  });

  it('caps a group and reports what is hidden', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(capGroup(items, GROUP_CAP)).toEqual({ visible: items.slice(0, 8), hidden: 12 });
    expect(capGroup(items, 20)).toEqual({ visible: items, hidden: 0 });
    expect(capGroup(items, 99)).toEqual({ visible: items, hidden: 0 });
    expect(capGroup([], 8)).toEqual({ visible: [], hidden: 0 });
  });
});

describe('what happens to one task', () => {
  it('opens the groups that need a person and collapses the rest', () => {
    expect(isGroupOpenByDefault('unsupported')).toBe(true);
    expect(isGroupOpenByDefault('lossy')).toBe(true);
    expect(isGroupOpenByDefault('failed')).toBe(true);
    expect(isGroupOpenByDefault('transformed')).toBe(false);
    expect(isGroupOpenByDefault('supported')).toBe(false);
    expect(isGroupOpenByDefault('skipped')).toBe(false);
  });

  it('counts parts that move as-is from the collection mappings and the rest from the findings', () => {
    const rich = taskActions(plan)[1]!;
    expect(taskOutcomeSummary(rich, plan)).toEqual({
      collections: ['Product Roadmap'],
      preserved: 1,
      transformed: 1,
      lossy: 0,
      unsupported: 0,
    });
    expect(describeTaskSummary(taskOutcomeSummary(rich, plan))).toBe(
      '1 part moves as-is, 1 changes shape',
    );
  });

  it('sums finding occurrences by outcome (count, or 1 when absent)', () => {
    const task = {
      ...taskActions(plan)[0]!,
      findings: [
        finding({ outcome: 'unsupported', collection: 'notion:data_source:bbbbbbbb' }),
        finding({ outcome: 'unsupported' }),
        finding({ outcome: 'lossy', count: 4 }),
        finding({ outcome: 'transformed', count: 3 }),
        finding({ outcome: 'transformed' }),
      ],
    };
    const summary = taskOutcomeSummary(task, plan);
    expect(summary).toMatchObject({ transformed: 4, lossy: 4, unsupported: 2 });
    // the finding names the Bug Tracker; the task's list is the Roadmap list: both collections count
    expect(summary.collections.sort()).toEqual(['Bug Tracker', 'Product Roadmap']);
    expect(describeTaskSummary(summary)).toBe(
      '1 part moves as-is, 4 change shape, 4 lose detail, 2 cannot move',
    );
  });

  it('words the one-line summary like "12 parts move as-is, 3 change shape, ..."', () => {
    expect(
      describeTaskSummary({
        collections: [],
        preserved: 12,
        transformed: 3,
        lossy: 5,
        unsupported: 2,
      }),
    ).toBe('12 parts move as-is, 3 change shape, 5 lose detail, 2 cannot move');
    expect(
      describeTaskSummary({
        collections: [],
        preserved: 1,
        transformed: 1,
        lossy: 1,
        unsupported: 1,
      }),
    ).toBe('1 part moves as-is, 1 changes shape, 1 loses detail, 1 cannot move');
  });

  it('puts the noun on the first part that is present and drops zero counts', () => {
    expect(
      describeTaskSummary({
        collections: [],
        preserved: 0,
        transformed: 0,
        lossy: 7,
        unsupported: 2,
      }),
    ).toBe('7 parts lose detail, 2 cannot move');
    expect(
      describeTaskSummary({
        collections: [],
        preserved: null,
        transformed: 3,
        lossy: 0,
        unsupported: 0,
      }),
    ).toBe('3 parts change shape');
  });

  it('is empty when nothing at all is recorded, and copes with a task of unknown collection', () => {
    const bare = {
      findings: [],
      payload: { body: { name: 'x' } },
    };
    const summary = taskOutcomeSummary(bare, plan);
    expect(summary).toEqual({
      collections: [],
      preserved: null,
      transformed: 0,
      lossy: 0,
      unsupported: 0,
    });
    expect(describeTaskSummary(summary)).toBe('');
  });

  it("groups a task's findings by outcome, unsupported first, with counts per group", () => {
    const groups = groupFindingsByOutcome([
      finding({ outcome: 'transformed' }),
      finding({ outcome: 'lossy' }),
      finding({ outcome: 'unsupported' }),
      finding({ outcome: 'lossy', code: 'OTHER' }),
    ]);
    expect(groups.map((g) => [g.outcome, g.findings.length])).toEqual([
      ['unsupported', 1],
      ['lossy', 2],
      ['transformed', 1],
    ]);
  });
});
