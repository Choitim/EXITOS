import type { MappingRule, MigrationAction, MigrationPlan } from '@exitos/core/schema';
import { useId, useMemo, useState } from 'react';
import { OutcomeFilterChips } from '../components/OutcomeFilterChips';
import { SafeMarkdown } from '../components/SafeMarkdown';
import {
  Button,
  Card,
  Chip,
  Empty,
  Facts,
  Icon,
  OutcomeChip,
  SectionShell,
  TableWrap,
} from '../components/ui';
import {
  GROUP_CAP,
  PAGE_SIZE,
  capGroup,
  collectionNames,
  defaultTaskId,
  describeRowCount,
  describeTaskSummary,
  filterMappings,
  groupFindingsByOutcome,
  isGroupOpenByDefault,
  mappingOutcomeCounts,
  matchesTerms,
  queryTerms,
  targetLabel,
  taskActions,
  taskOutcomeSummary,
  taskPreview,
  transformLabel,
  type FindingGroup,
  type OutcomeFilter,
} from '../lib/derive';
import { formatNumber, pluralize, priorityLabel } from '../lib/format';
import { outcomeMeta } from '../lib/outcomes';

function MappingRow({ mapping, collectionName }: { mapping: MappingRule; collectionName: string }) {
  const valueMap = Object.entries(mapping.valueMap ?? {});
  const unmapped = mapping.unmappedValues ?? [];
  return (
    <tr data-testid="mapping-row">
      <td>{collectionName}</td>
      <th scope="row">
        {mapping.source.name}
        <span className="block text-xs font-normal text-muted">
          Notion type <code>{mapping.source.sourceType}</code>
        </span>
      </th>
      <td>
        <span aria-hidden="true">→ </span>
        <span className="sr-only">maps to </span>
        {targetLabel(mapping.target)}
      </td>
      <td>
        <span title={mapping.transform}>{transformLabel(mapping.transform)}</span>
        <span className="block text-xs text-muted">
          {mapping.explicit ? 'set in your config' : 'inferred by ExitOS'}
        </span>
      </td>
      <td>
        <OutcomeChip outcome={mapping.outcome} />
      </td>
      <td className="min-w-64">
        {mapping.reason}
        {valueMap.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-medium">
              Value map ({valueMap.length})
            </summary>
            <ul className="mt-1 text-xs">
              {valueMap.map(([from, to]) => (
                <li key={from}>
                  <code>{from}</code> → <code>{String(to)}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </td>
      <td>
        {unmapped.length === 0 ? (
          <span className="text-muted">none</span>
        ) : (
          <ul className="space-y-1">
            {unmapped.map((value) => (
              <li key={value}>
                <Chip tone="warn" icon="warning">
                  {value}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function MappingTable({ plan }: { plan: MigrationPlan }) {
  const [collection, setCollection] = useState('all');
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const collectionId = useId();
  const queryId = useId();
  const names = useMemo(() => collectionNames(plan), [plan]);
  const counts = useMemo(
    () => mappingOutcomeCounts(plan, { collection, query }),
    [plan, collection, query],
  );
  const rows = useMemo(
    () => filterMappings(plan, { collection, query, outcome }),
    [plan, collection, query, outcome],
  );
  const shown = rows.slice(0, limit);
  const filtered = collection !== 'all' || query.trim() !== '' || outcome !== 'all';

  // Any change of filter starts again at the first page.
  const changeCollection = (value: string): void => {
    setCollection(value);
    setLimit(PAGE_SIZE);
  };
  const changeQuery = (value: string): void => {
    setQuery(value);
    setLimit(PAGE_SIZE);
  };
  const changeOutcome = (value: OutcomeFilter): void => {
    setOutcome(value);
    setLimit(PAGE_SIZE);
  };

  if (plan.mappings.length === 0) {
    return (
      <Empty title="This plan maps no source properties" testId="mapping-empty">
        There are no property mappings to show. Items can still be created, but none of their
        properties has a destination in this plan.
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor={collectionId} className="field-label">
            Collection
          </label>
          <select
            id={collectionId}
            className="control"
            value={collection}
            onChange={(e) => {
              changeCollection(e.target.value);
            }}
          >
            <option value="all">All collections ({plan.mappings.length})</option>
            {plan.collections.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name} ({plan.mappings.filter((m) => m.collection === c.key).length})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={queryId} className="field-label">
            Search mappings
          </label>
          <input
            id={queryId}
            type="search"
            className="control"
            placeholder="Property, type, target, outcome, reason…"
            value={query}
            autoComplete="off"
            onChange={(e) => {
              changeQuery(e.target.value);
            }}
          />
        </div>
        <Button
          disabled={!filtered}
          onClick={() => {
            setCollection('all');
            setQuery('');
            setOutcome('all');
            setLimit(PAGE_SIZE);
          }}
        >
          Clear filters
        </Button>
      </div>
      <OutcomeFilterChips
        counts={counts}
        value={outcome}
        onChange={changeOutcome}
        label="Filter mappings by outcome"
        testIdPrefix="mapping-chip"
      />
      <p
        className="text-sm text-muted"
        role="status"
        aria-live="polite"
        data-testid="mapping-count"
      >
        {describeRowCount({
          shown: shown.length,
          matching: rows.length,
          total: plan.mappings.length,
        })}
      </p>
      {rows.length === 0 ? (
        <Empty>No mapping matches these filters.</Empty>
      ) : (
        <TableWrap label="Property mappings">
          <table className="data-table">
            <caption className="sr-only">
              How each source property is mapped to the destination
            </caption>
            <thead>
              <tr>
                <th scope="col">Collection</th>
                <th scope="col">Source property</th>
                <th scope="col">Destination</th>
                <th scope="col">Transform</th>
                <th scope="col">Outcome</th>
                <th scope="col">Reason</th>
                <th scope="col">Unmapped values</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  collectionName={names.get(mapping.collection) ?? mapping.collection}
                />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {rows.length > shown.length ? (
        <Button
          onClick={() => {
            setLimit((n) => n + PAGE_SIZE);
          }}
          testId="mapping-show-more"
        >
          Show {formatNumber(Math.min(PAGE_SIZE, rows.length - shown.length))} more (
          {formatNumber(rows.length - shown.length)} not shown)
        </Button>
      ) : null}
    </div>
  );
}

const GROUP_BORDER = {
  ok: 'border-l-ok-bar',
  info: 'border-l-info-bar',
  warn: 'border-l-warn-bar',
  bad: 'border-l-bad-bar',
  neutral: 'border-l-neutral-bar',
} as const;

/** One line that says what happens to this task, then where those numbers come from. */
function TaskSummary({ action, plan }: { action: MigrationAction; plan: MigrationPlan }) {
  const summary = useMemo(() => taskOutcomeSummary(action, plan), [action, plan]);
  const line = describeTaskSummary(summary);
  return (
    <div className="rounded-lg border border-line bg-sunken px-4 py-3" data-testid="task-summary">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm text-muted">What happens to this task:</span>
        <OutcomeChip outcome={action.outcome} withPlain />
      </p>
      <p className="mt-1 text-base font-semibold" data-testid="task-summary-line">
        {line === '' ? 'No findings are recorded for this task.' : `${line}.`}
      </p>
      <p className="mt-1 text-xs text-muted">
        {summary.preserved === null
          ? 'Counted from the findings recorded for this task.'
          : `Parts that move as-is are counted from the property mappings of ${summary.collections.join(', ')}; the rest are the findings recorded for this task.`}
      </p>
    </div>
  );
}

/** Findings of one outcome as a collapsible group; long groups show the first few and "Show N more". */
function TaskFindingGroup({ group }: { group: FindingGroup }) {
  const [shown, setShown] = useState(GROUP_CAP);
  const meta = outcomeMeta(group.outcome);
  const { visible, hidden } = capGroup(group.findings, shown);
  return (
    <details
      className={`rounded-lg border border-line border-l-4 bg-surface px-4 py-2 ${GROUP_BORDER[meta.tone]}`}
      open={isGroupOpenByDefault(group.outcome)}
      data-testid={`task-group-${group.outcome}`}
    >
      <summary className="disclosure" data-testid={`task-group-${group.outcome}-summary`}>
        <Icon name="chevron" className="disclosure-icon" />
        <OutcomeChip outcome={group.outcome} withPlain />
        <span className="ml-auto text-sm font-normal text-muted">
          <strong className="font-semibold tabular-nums text-fg">
            {formatNumber(group.findings.length)}
          </strong>{' '}
          {group.findings.length === 1 ? 'finding' : 'findings'}
          {group.occurrences !== group.findings.length
            ? `, ${pluralize(group.occurrences, 'occurrence')}`
            : ''}
        </span>
      </summary>
      <ul className="mt-2 space-y-2 border-t border-line pt-2 text-sm">
        {visible.map((f, i) => (
          <li
            key={`${f.code}-${f.field ?? ''}-${i}`}
            className="min-w-0"
            data-testid="task-finding"
          >
            {f.field ? <strong>{f.field}: </strong> : null}
            {f.message} <code className="text-xs text-muted">{f.code}</code>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <div className="mt-2">
          <Button
            onClick={() => {
              setShown(group.findings.length);
            }}
            testId={`task-group-${group.outcome}-more`}
          >
            Show {formatNumber(hidden)} more
          </Button>
        </div>
      ) : null}
    </details>
  );
}

/** What the plan says about each part of this task, grouped by outcome. */
function TaskFindings({
  findings,
  actionId,
}: {
  findings: MigrationAction['findings'];
  actionId: string;
}) {
  const groups = useMemo(() => groupFindingsByOutcome(findings), [findings]);
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="task-findings-empty">
        No findings are recorded for this task: nothing was reported as needing review, transformed
        or unsupported.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="task-findings">
      <h4 className="card-title">Findings for this task, by outcome</h4>
      {groups.map((group) => (
        <TaskFindingGroup key={`${actionId}-${group.outcome}`} group={group} />
      ))}
    </div>
  );
}

type DescriptionView = 'rendered' | 'raw';

function TaskPreviewPanel({ plan }: { plan: MigrationPlan }) {
  const tasks = useMemo(() => taskActions(plan), [plan]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<DescriptionView>('rendered');
  const selectId = useId();
  const filterId = useId();

  const options = useMemo(() => {
    const terms = queryTerms(filter);
    return tasks
      .map((action) => ({ action, preview: taskPreview(action, plan) }))
      .filter(({ preview }) => matchesTerms(`${preview.name} ${preview.listName ?? ''}`, terms));
  }, [tasks, plan, filter]);

  const initial = useMemo(
    () => defaultTaskId(tasks.map((a) => taskPreview(a, plan))),
    [tasks, plan],
  );
  const current =
    options.find((o) => o.action.id === selected) ??
    options.find((o) => o.action.id === initial) ??
    options[0] ??
    null;
  const preview = current?.preview ?? null;
  const action = current?.action ?? null;

  if (tasks.length === 0) {
    return (
      <Card title="Task preview">
        <Empty>
          This plan has no task-creating actions (<code>clickup.create_task</code>) to preview.
        </Empty>
      </Card>
    );
  }

  return (
    <Card title="Task preview" className="space-y-4">
      <p className="text-sm text-muted">
        Exactly what ExitOS would send to ClickUp for one task. Nothing here has been written yet
        unless the run says so.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor={filterId} className="field-label">
            Filter tasks
          </label>
          <input
            id={filterId}
            type="search"
            className="control"
            placeholder="Name or list…"
            value={filter}
            autoComplete="off"
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor={selectId} className="field-label">
            Task ({formatNumber(options.length)} of {formatNumber(tasks.length)})
          </label>
          <select
            id={selectId}
            className="control"
            value={current?.action.id ?? ''}
            onChange={(e) => {
              setSelected(e.target.value);
            }}
            data-testid="task-select"
          >
            {options.map(({ action: a, preview: p }) => (
              <option key={a.id} value={a.id}>
                {p.name}
                {p.listName ? ` (${p.listName})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {preview === null || action === null ? (
        <Empty>No task matches this filter.</Empty>
      ) : (
        <div className="space-y-5" data-testid="task-preview">
          <div className="space-y-3">
            <h4 className="card-title text-lg" data-testid="task-name">
              {preview.name}
            </h4>
            <TaskSummary action={action} plan={plan} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="space-y-3">
              <Facts
                rows={[
                  [
                    'List',
                    preview.listName ??
                      (preview.listId ? <code key="l">{preview.listId}</code> : 'unknown'),
                  ],
                  [
                    'Status',
                    preview.status ?? (
                      <span key="s" className="text-muted">
                        none (list default)
                      </span>
                    ),
                  ],
                  [
                    'Priority',
                    preview.priority === null ? (
                      <span key="p" className="text-muted">
                        none
                      </span>
                    ) : (
                      priorityLabel(preview.priority)
                    ),
                  ],
                  [
                    'Due date',
                    preview.dueDate === null ? (
                      <span key="d" className="text-muted">
                        none
                      </span>
                    ) : (
                      <span key="d">
                        <code className="whitespace-nowrap">
                          {preview.dueDate.iso ?? 'invalid date'}
                        </code>
                        {preview.dueDate.hasTime === false ? (
                          <span className="block text-xs text-muted">
                            date only; ClickUp stores 04:00 local
                          </span>
                        ) : null}
                      </span>
                    ),
                  ],
                  ...(preview.startDate === null
                    ? []
                    : ([
                        [
                          'Start date',
                          <code key="sd">{preview.startDate.iso ?? 'invalid date'}</code>,
                        ],
                      ] as const)),
                  [
                    'Assignees',
                    <span key="a">
                      {preview.assignees.length}
                      {preview.assignees.length > 0 ? (
                        <span className="block text-xs text-muted">
                          {preview.assignees.map((a) => a.name ?? `user ${a.id}`).join(', ')}
                        </span>
                      ) : null}
                    </span>,
                  ],
                  [
                    'Tags',
                    preview.tags.length === 0 ? (
                      <span key="t" className="text-muted">
                        none
                      </span>
                    ) : (
                      <span key="t" className="flex flex-wrap gap-1">
                        {preview.tags.map((tag) => (
                          <Chip key={tag} tone="neutral">
                            {tag}
                          </Chip>
                        ))}
                      </span>
                    ),
                  ],
                  [
                    'Custom fields',
                    preview.customFields.length === 0 ? (
                      <span key="c" className="text-muted">
                        none
                      </span>
                    ) : (
                      <ul key="c" className="space-y-1">
                        {preview.customFields.map((f) => (
                          <li key={f.id}>
                            {f.name ?? <code>{f.id}</code>}: <code>{f.value}</code>
                          </li>
                        ))}
                      </ul>
                    ),
                  ],
                  ['Outcome', <OutcomeChip key="o" outcome={action.outcome} withPlain />],
                  ['Action id', <code key="id">{action.id}</code>],
                ]}
              />
            </div>

            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="card-title" id={`${selectId}-md`}>
                  Description (<code>markdown_content</code>)
                </h4>
                <div role="group" aria-label="Description view" className="inline-flex gap-1">
                  <Button
                    ariaPressed={view === 'rendered'}
                    onClick={() => {
                      setView('rendered');
                    }}
                    testId="view-rendered"
                  >
                    Rendered
                  </Button>
                  <Button
                    ariaPressed={view === 'raw'}
                    onClick={() => {
                      setView('raw');
                    }}
                    testId="view-raw"
                  >
                    Raw
                  </Button>
                </div>
              </div>
              <div
                className="relative max-h-[32rem] overflow-auto rounded-md border border-line bg-surface p-3"
                role="region"
                aria-labelledby={`${selectId}-md`}
                tabIndex={0}
                data-testid="task-description"
              >
                {preview.markdown === '' ? (
                  <p className="text-muted">This task has no description.</p>
                ) : view === 'rendered' ? (
                  <SafeMarkdown source={preview.markdown} />
                ) : (
                  <pre
                    className="whitespace-pre-wrap break-words"
                    data-testid="task-description-raw"
                  >
                    {preview.markdown}
                  </pre>
                )}
              </div>
            </div>
          </div>
          <TaskFindings findings={action.findings} actionId={action.id} />
        </div>
      )}
    </Card>
  );
}

export function MappingPreview({ plan }: { plan: MigrationPlan }) {
  return (
    <SectionShell
      id="mapping"
      number={4}
      title="Mapping preview"
      intro="Every source property, where it goes, how it is converted and what that costs. Then a task, exactly as it would be sent."
    >
      <MappingTable plan={plan} />
      <TaskPreviewPanel plan={plan} />
    </SectionShell>
  );
}
