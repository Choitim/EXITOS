/**
 * Pure derivations over the dashboard state: filters, groupings and the task preview. Nothing here
 * touches the DOM, so everything is unit-tested in Node.
 */
import type {
  Finding,
  MappingRule,
  MappingTarget,
  MigrationAction,
  MigrationPlan,
  Outcome,
  VerificationResult,
  ItemVerification,
  FieldCheck,
} from '@exitos/core/schema';
import { formatNumber, isoFromEpochMs, pluralize } from './format';
import { OUTCOME_ORDER, outcomeMeta } from './outcomes';

// ---- search ------------------------------------------------------------------------------------

/** Lower-case whitespace-separated terms; every term must occur (AND). Empty query matches all. */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '');
}

export function matchesTerms(haystack: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const text = haystack.toLowerCase();
  return terms.every((term) => text.includes(term));
}

// ---- collections -------------------------------------------------------------------------------

export function collectionNames(plan: Pick<MigrationPlan, 'collections'>): Map<string, string> {
  return new Map(plan.collections.map((c) => [c.key, c.name]));
}

// ---- mappings ----------------------------------------------------------------------------------

const TARGET_LABELS: Record<MappingTarget['kind'], string> = {
  name: 'Task name',
  description: 'Task description',
  status: 'Status',
  priority: 'Priority',
  due_date: 'Due date',
  start_date: 'Start date',
  assignees: 'Assignees',
  tags: 'Tags',
  custom_field: 'Custom field',
  link: 'Linked task',
  provenance: 'Provenance footer',
  description_table: 'Description table',
  dropped: 'Dropped (not migrated)',
};

export function targetLabel(target: MappingTarget): string {
  const base = (TARGET_LABELS as Record<string, string | undefined>)[target.kind] ?? target.kind;
  if (target.kind === 'custom_field' && target.customField) {
    return `${base}: ${target.customField.name} (${target.customField.type})`;
  }
  return base;
}

const TRANSFORM_LABELS: Record<MappingRule['transform'], string> = {
  direct: 'Direct copy',
  value_map: 'Value map',
  epoch_ms: 'Date to epoch ms',
  markdown: 'Markdown',
  user_map: 'User map',
  name_match: 'Match by name',
  snapshot: 'Snapshot of value',
  text: 'As text',
  none: 'None',
};

export function transformLabel(transform: string): string {
  return (TRANSFORM_LABELS as Record<string, string | undefined>)[transform] ?? transform;
}

/** The data value plus the words people see ("lossy requires review loses detail"), so both find it. */
function outcomeWords(outcome: string): string {
  const meta = outcomeMeta(outcome);
  return `${outcome} ${meta.label} ${meta.plain}`;
}

export function mappingSearchText(mapping: MappingRule, collectionName: string): string {
  return [
    collectionName,
    mapping.source.name,
    mapping.source.sourceType,
    mapping.source.kind,
    targetLabel(mapping.target),
    mapping.target.kind,
    transformLabel(mapping.transform),
    mapping.transform,
    outcomeWords(mapping.outcome),
    mapping.reason,
    mapping.explicit ? 'explicit config' : 'inferred',
    ...(mapping.unmappedValues ?? []),
    ...Object.keys(mapping.valueMap ?? {}),
  ].join(' \n ');
}

export interface MappingFilter {
  /** An entity key, or `all`. */
  collection: string;
  query: string;
  /** One outcome, or `all` (the default). */
  outcome?: OutcomeFilter;
}

/** Rows matching the collection and the search, ignoring the outcome (what the chip counts show). */
function matchingCollectionAndQuery(
  plan: Pick<MigrationPlan, 'mappings' | 'collections'>,
  filter: Pick<MappingFilter, 'collection' | 'query'>,
): MappingRule[] {
  const names = collectionNames(plan);
  const terms = queryTerms(filter.query);
  return plan.mappings.filter((m) => {
    if (filter.collection !== 'all' && m.collection !== filter.collection) return false;
    return matchesTerms(mappingSearchText(m, names.get(m.collection) ?? m.collection), terms);
  });
}

export function filterMappings(
  plan: Pick<MigrationPlan, 'mappings' | 'collections'>,
  filter: MappingFilter,
): MappingRule[] {
  const rows = matchingCollectionAndQuery(plan, filter);
  const outcome = filter.outcome ?? 'all';
  return outcome === 'all' ? rows : rows.filter((m) => m.outcome === outcome);
}

export type OutcomeCounts = Record<OutcomeFilter, number>;

/**
 * Counts for the outcome chips: how many mappings each outcome would show given the collection
 * filter and the search (the outcome filter itself is left out, so every chip stays meaningful).
 */
export function mappingOutcomeCounts(
  plan: Pick<MigrationPlan, 'mappings' | 'collections'>,
  filter: Pick<MappingFilter, 'collection' | 'query'>,
): OutcomeCounts {
  const counts: OutcomeCounts = {
    all: 0,
    supported: 0,
    transformed: 0,
    lossy: 0,
    unsupported: 0,
    skipped: 0,
    failed: 0,
  };
  for (const m of matchingCollectionAndQuery(plan, filter)) {
    counts.all += 1;
    counts[m.outcome] += 1;
  }
  return counts;
}

/** Outcomes that get a chip: the four headline outcomes always, the others only when they occur. */
export function chipOutcomes(counts: OutcomeCounts, selected: OutcomeFilter): Outcome[] {
  return OUTCOME_ORDER.filter(
    (o) =>
      o === 'supported' ||
      o === 'transformed' ||
      o === 'lossy' ||
      o === 'unsupported' ||
      counts[o] > 0 ||
      selected === o,
  );
}

// ---- paging -------------------------------------------------------------------------------------

/** How many table rows are shown before "Show more". */
export const PAGE_SIZE = 25;

export function describeRowCount(counts: {
  shown: number;
  matching: number;
  total: number;
}): string {
  const { shown, matching, total } = counts;
  const base = `Showing ${formatNumber(shown)} of ${pluralize(total, 'mapping')}`;
  if (matching === total) return base;
  return shown < matching
    ? `${base} (${formatNumber(matching)} match the filters)`
    : `${base} (filtered)`;
}

// ---- findings ----------------------------------------------------------------------------------

export function findingKey(f: Finding): string {
  return [f.code, f.outcome, f.severity, f.collection ?? '', f.field ?? '', f.message].join(
    '\u0001',
  );
}

/**
 * The not-preserved picture is `plan.inventory` (everything that is not a clean "supported") plus
 * the report's `notPreserved` list. The report list is a subset of the inventory in practice, so
 * identical findings are de-duplicated rather than counted twice.
 */
export function mergeFindings(...lists: ReadonlyArray<readonly Finding[]>): Finding[] {
  const seen = new Set<string>();
  const merged: Finding[] = [];
  for (const list of lists) {
    for (const f of list) {
      const key = findingKey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(f);
    }
  }
  return merged;
}

export type OutcomeFilter = 'all' | Outcome;

export interface FindingFilter {
  outcome: OutcomeFilter;
  query: string;
}

export function findingSearchText(f: Finding, collectionName: string | undefined): string {
  return [
    f.code,
    outcomeWords(f.outcome),
    f.severity,
    f.category,
    f.message,
    f.field ?? '',
    collectionName ?? '',
  ].join(' \n ');
}

export function filterFindings(
  findings: readonly Finding[],
  filter: FindingFilter,
  names: ReadonlyMap<string, string>,
): Finding[] {
  const terms = queryTerms(filter.query);
  return findings.filter((f) => {
    if (filter.outcome !== 'all' && f.outcome !== filter.outcome) return false;
    return matchesTerms(
      findingSearchText(f, f.collection ? names.get(f.collection) : undefined),
      terms,
    );
  });
}

/** Display order of the groups: what cannot move first. */
export const FINDING_GROUP_ORDER: readonly Outcome[] = [
  'unsupported',
  'lossy',
  'transformed',
  'failed',
  'skipped',
  'supported',
];

export interface FindingGroup {
  outcome: Outcome;
  findings: Finding[];
  /** Number of distinct findings. */
  kinds: number;
  /** Sum of `count` (1 when absent). */
  occurrences: number;
}

export function groupFindingsByOutcome(findings: readonly Finding[]): FindingGroup[] {
  const groups = new Map<Outcome, Finding[]>();
  for (const f of findings) {
    const list = groups.get(f.outcome);
    if (list) list.push(f);
    else groups.set(f.outcome, [f]);
  }
  const ordered = [
    ...FINDING_GROUP_ORDER.filter((o) => groups.has(o)),
    ...[...groups.keys()].filter((o) => !FINDING_GROUP_ORDER.includes(o)),
  ];
  return ordered.map((outcome) => {
    const list = groups.get(outcome) ?? [];
    return {
      outcome,
      findings: list,
      kinds: list.length,
      occurrences: list.reduce((sum, f) => sum + (f.count ?? 1), 0),
    };
  });
}

/** Groups opened by default in the task panel: what needs a person's attention. */
export function isGroupOpenByDefault(outcome: Outcome): boolean {
  return outcome === 'unsupported' || outcome === 'lossy' || outcome === 'failed';
}

/** Findings shown per group before "Show N more". */
export const GROUP_CAP = 8;

export function capGroup<T>(items: readonly T[], shown: number): { visible: T[]; hidden: number } {
  const visible = items.slice(0, shown);
  return { visible, hidden: items.length - visible.length };
}

export interface PlanIssues {
  errors: Finding[];
  warnings: Finding[];
  infos: Finding[];
}

/** Plan-level findings by severity. Errors block `exitos apply`. */
export function planIssues(findings: readonly Finding[]): PlanIssues {
  return {
    errors: findings.filter((f) => f.severity === 'error'),
    warnings: findings.filter((f) => f.severity === 'warning'),
    infos: findings.filter((f) => f.severity !== 'error' && f.severity !== 'warning'),
  };
}

// ---- task preview ------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const TASK_ACTION_KIND = 'clickup.create_task';

export function taskActions(plan: Pick<MigrationPlan, 'actions'>): MigrationAction[] {
  return plan.actions.filter((a) => a.kind === TASK_ACTION_KIND);
}

export interface TaskPreview {
  actionId: string;
  name: string;
  listId: string | null;
  listName: string | null;
  status: string | null;
  priority: number | null;
  dueDate: { iso: string | null; hasTime: boolean | null } | null;
  startDate: { iso: string | null; hasTime: boolean | null } | null;
  assignees: Array<{ id: string; name: string | null }>;
  tags: string[];
  customFields: Array<{ id: string; name: string | null; value: string }>;
  markdown: string;
}

function dateField(
  body: Record<string, unknown>,
  key: 'due_date' | 'start_date',
): { iso: string | null; hasTime: boolean | null } | null {
  const raw = body[key];
  if (raw === undefined || raw === null) return null;
  const flag = body[`${key}_time`];
  return { iso: isoFromEpochMs(raw), hasTime: typeof flag === 'boolean' ? flag : null };
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value) ?? '';
}

/** Extract what ClickUp would receive for a `clickup.create_task` action. Tolerates odd payloads. */
export function taskPreview(
  action: MigrationAction,
  plan: Pick<MigrationPlan, 'destination' | 'users' | 'mappings'>,
): TaskPreview {
  const payload: Record<string, unknown> = action.payload;
  const bodyValue = payload.body;
  const body: Record<string, unknown> = isRecord(bodyValue) ? bodyValue : {};

  const listId = typeof payload.listId === 'string' ? payload.listId : null;
  const list = listId === null ? undefined : plan.destination.targets.find((t) => t.id === listId);

  const assignees = (Array.isArray(body.assignees) ? (body.assignees as unknown[]) : [])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map((v) => {
      const id = String(v);
      return { id, name: plan.users.mapped.find((u) => u.destinationId === id)?.name ?? null };
    });

  const customFields = (Array.isArray(body.custom_fields) ? (body.custom_fields as unknown[]) : [])
    .filter(isRecord)
    .map((field) => {
      const id = typeof field.id === 'string' ? field.id : String(field.id);
      return {
        id,
        name:
          plan.mappings.find((m) => m.target.customField?.id === id)?.target.customField?.name ??
          null,
        value: displayValue(field.value),
      };
    });

  return {
    actionId: action.id,
    name: typeof body.name === 'string' ? body.name : action.label,
    listId,
    listName: list?.name ?? null,
    status: typeof body.status === 'string' ? body.status : null,
    priority: typeof body.priority === 'number' ? body.priority : null,
    dueDate: dateField(body, 'due_date'),
    startDate: dateField(body, 'start_date'),
    assignees,
    tags: (Array.isArray(body.tags) ? (body.tags as unknown[]) : []).filter(
      (t): t is string => typeof t === 'string',
    ),
    customFields,
    markdown: typeof body.markdown_content === 'string' ? body.markdown_content : '',
  };
}

// ---- what happens to one task ------------------------------------------------------------------

export interface TaskOutcomeSummary {
  /** Names of the source collection(s) this task comes from. */
  collections: string[];
  /**
   * Properties of those collections whose mapping is Preserved (moves as-is). `null` when the
   * plan does not say which collection the task belongs to.
   */
  preserved: number | null;
  /** Occurrences of the findings recorded for this task, by outcome (`count`, or 1 when absent). */
  transformed: number;
  lossy: number;
  unsupported: number;
}

/**
 * Condenses what the plan says will happen to one task. The parts that move as-is have no
 * findings (nothing is wrong), so they are counted from the property mappings of the task's
 * collection; the other three are counted from the findings recorded for the task itself.
 */
export function taskOutcomeSummary(
  action: Pick<MigrationAction, 'findings' | 'payload'>,
  plan: Pick<MigrationPlan, 'collections' | 'mappings'>,
): TaskOutcomeSummary {
  const keys = new Set<string>();
  for (const f of action.findings) if (f.collection) keys.add(f.collection);
  const listId = typeof action.payload.listId === 'string' ? action.payload.listId : null;
  if (listId !== null) {
    for (const c of plan.collections) if (c.target?.id === listId) keys.add(c.key);
  }
  const names = collectionNames(plan);
  const occurrences = (outcome: Outcome): number =>
    action.findings
      .filter((f) => f.outcome === outcome)
      .reduce((sum, f) => sum + (f.count ?? 1), 0);
  return {
    collections: [...keys].map((key) => names.get(key) ?? key),
    preserved:
      keys.size === 0
        ? null
        : plan.mappings.filter((m) => keys.has(m.collection) && m.outcome === 'supported').length,
    transformed: occurrences('transformed'),
    lossy: occurrences('lossy'),
    unsupported: occurrences('unsupported'),
  };
}

/**
 * "12 parts move as-is, 3 change shape, 5 lose detail, 2 cannot move": only the non-zero parts,
 * the first one carrying the noun. Empty when nothing is recorded at all.
 */
export function describeTaskSummary(summary: TaskOutcomeSummary): string {
  const rows: Array<[number, string, string]> = [
    [summary.preserved ?? 0, 'moves as-is', 'move as-is'],
    [summary.transformed, 'changes shape', 'change shape'],
    [summary.lossy, 'loses detail', 'lose detail'],
    [summary.unsupported, 'cannot move', 'cannot move'],
  ];
  return rows
    .filter(([n]) => n > 0)
    .map(([n, one, many], index) => {
      const noun = index === 0 ? ` ${n === 1 ? 'part' : 'parts'}` : '';
      return `${formatNumber(n)}${noun} ${n === 1 ? one : many}`;
    })
    .join(', ');
}

// ---- verification ------------------------------------------------------------------------------

export interface NonVerifiedRow {
  item: ItemVerification;
  label: string;
  /** Checks that did not verify (all checks when the item has none that failed). */
  failing: FieldCheck[];
}

/** Items that are not `verified`, with the checks that explain why. */
export function nonVerifiedItems(
  verification: Pick<VerificationResult, 'items'>,
  plan: Pick<MigrationPlan, 'actions'> | null,
): NonVerifiedRow[] {
  const labels = new Map((plan?.actions ?? []).map((a) => [a.id, a.label]));
  return verification.items
    .filter((item) => item.status !== 'verified')
    .map((item) => ({
      item,
      label: labels.get(item.actionId) ?? item.actionId,
      failing: item.checks.filter((c) => c.status !== 'verified'),
    }));
}

/**
 * Which task to show first: the one with the most going on (description length, assignees, tags,
 * custom fields), so the preview is informative from the start. Ties keep plan order.
 */
export function defaultTaskId(tasks: readonly TaskPreview[]): string | null {
  let best: TaskPreview | null = null;
  let bestScore = -1;
  for (const task of tasks) {
    const score =
      Math.min(task.markdown.length, 3000) / 100 +
      task.assignees.length * 5 +
      task.tags.length * 5 +
      task.customFields.length * 5 +
      (task.dueDate === null ? 0 : 3) +
      (task.startDate === null ? 0 : 3);
    if (score > bestScore) {
      best = task;
      bestScore = score;
    }
  }
  return best?.actionId ?? null;
}
