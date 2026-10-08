import type { DashboardState, Finding, MigrationPlan, Outcome } from '@exitos/core/schema';
import { useId, useMemo, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Chip,
  Empty,
  Icon,
  OutcomeChip,
  SectionShell,
  TONE_TEXT,
  TableWrap,
} from '../components/ui';
import {
  collectionNames,
  filterFindings,
  groupFindingsByOutcome,
  mergeFindings,
  planIssues,
  type OutcomeFilter,
} from '../lib/derive';
import { formatNumber, pluralize } from '../lib/format';
import { outcomeMeta, severityMeta } from '../lib/outcomes';

function SeverityChip({ severity }: { severity: string }) {
  const meta = severityMeta(severity);
  return (
    <Chip tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Chip>
  );
}

function PlanIssueList({ findings, tone }: { findings: Finding[]; tone: 'bad' | 'warn' }) {
  return (
    <ul className="space-y-2">
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`} className="text-sm">
          <code className="font-semibold">{f.code}</code>
          {f.count && f.count > 1 ? ` (${formatNumber(f.count)}×)` : ''}: {f.message}
          {f.field ? <span className="text-xs"> Field: {f.field}.</span> : null}
          <span className="sr-only"> ({tone === 'bad' ? 'error' : 'warning'})</span>
        </li>
      ))}
    </ul>
  );
}

const FILTER_OPTIONS: ReadonlyArray<{ value: OutcomeFilter; label: string }> = [
  { value: 'all', label: 'All outcomes' },
  { value: 'unsupported', label: 'Unsupported (cannot move)' },
  { value: 'lossy', label: 'Lossy (loses detail)' },
  { value: 'transformed', label: 'Transformed (changes shape)' },
];

export function Unsupported({ state, plan }: { state: DashboardState; plan: MigrationPlan }) {
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [query, setQuery] = useState('');
  const outcomeId = useId();
  const queryId = useId();

  const names = useMemo(() => collectionNames(plan), [plan]);
  const all = useMemo(
    () => mergeFindings(plan.inventory, state.report?.notPreserved ?? []),
    [plan.inventory, state.report],
  );
  const shown = useMemo(
    () => filterFindings(all, { outcome, query }, names),
    [all, outcome, query, names],
  );
  const groups = useMemo(() => groupFindingsByOutcome(shown), [shown]);
  const issues = useMemo(() => planIssues(plan.findings), [plan.findings]);
  const outcomesPresent = useMemo(() => new Set<Outcome>(all.map((f) => f.outcome)), [all]);

  return (
    <SectionShell
      id="unsupported"
      number={5}
      title="Unsupported content"
      intro="Everything that cannot move, loses detail or changes shape. Nothing is dropped silently: each entry is a recorded finding."
    >
      {issues.errors.length > 0 ? (
        <Callout
          tone="bad"
          role="alert"
          title={`${pluralize(issues.errors.length, 'blocking error')} in this plan: apply will refuse it until fixed`}
          testId="plan-errors"
        >
          <PlanIssueList findings={issues.errors} tone="bad" />
        </Callout>
      ) : null}
      {issues.warnings.length > 0 ? (
        <Callout
          tone="warn"
          title={`${pluralize(issues.warnings.length, 'plan-level warning')} to review before approving`}
          testId="plan-warnings"
        >
          <PlanIssueList findings={issues.warnings} tone="warn" />
        </Callout>
      ) : null}
      {issues.errors.length === 0 && issues.warnings.length === 0 ? (
        <Callout tone="ok" title="No plan-level errors or warnings.">
          <p className="text-sm">Item-level findings are listed below.</p>
        </Callout>
      ) : null}
      {issues.infos.length > 0 ? (
        <details className="card">
          <summary className="cursor-pointer font-medium">
            Plan-level notes ({issues.infos.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {issues.infos.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <code>{f.code}</code>: {f.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Card title="What does not fully move">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label htmlFor={outcomeId} className="field-label">
              Outcome
            </label>
            <select
              id={outcomeId}
              className="control"
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value as OutcomeFilter);
              }}
              data-testid="outcome-filter"
            >
              {FILTER_OPTIONS.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  disabled={o.value !== 'all' && !outcomesPresent.has(o.value)}
                >
                  {o.label}
                  {o.value !== 'all' && !outcomesPresent.has(o.value) ? ' (none)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={queryId} className="field-label">
              Search findings
            </label>
            <input
              id={queryId}
              type="search"
              className="control"
              placeholder="Code, field, message, collection…"
              value={query}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              data-testid="finding-search"
            />
          </div>
          <Button
            disabled={outcome === 'all' && query.trim() === ''}
            onClick={() => {
              setOutcome('all');
              setQuery('');
            }}
          >
            Clear filters
          </Button>
        </div>
        <p
          className="mt-3 text-sm text-muted"
          role="status"
          aria-live="polite"
          data-testid="finding-count"
        >
          Showing {pluralize(shown.length, 'finding')} of {formatNumber(all.length)}
          {shown.length > 0
            ? `, ${pluralize(
                shown.reduce((sum, f) => sum + (f.count ?? 1), 0),
                'occurrence',
              )}`
            : ''}
        </p>
      </Card>

      {groups.length === 0 ? (
        <Empty>
          {all.length === 0
            ? 'The plan recorded no findings.'
            : 'No finding matches these filters.'}
        </Empty>
      ) : (
        groups.map((group) => {
          const meta = outcomeMeta(group.outcome);
          const headingId = `findings-${group.outcome}`;
          return (
            <div
              key={group.outcome}
              className="space-y-2"
              data-testid={`finding-group-${group.outcome}`}
            >
              <h3
                id={headingId}
                className="flex flex-wrap items-center gap-2 text-lg font-semibold"
              >
                <Icon name={meta.icon} className={`size-5 ${TONE_TEXT[meta.tone]}`} />
                {meta.label}
                <span className="text-sm font-normal text-muted">
                  {meta.plain}: {pluralize(group.kinds, 'kind')},{' '}
                  {pluralize(group.occurrences, 'occurrence')}
                </span>
              </h3>
              <TableWrap label={`${meta.label} findings`}>
                <table className="data-table" aria-labelledby={headingId}>
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col" className="num">
                        Count
                      </th>
                      <th scope="col">Field</th>
                      <th scope="col">Collection</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.findings.map((f, i) => (
                      <tr
                        key={`${f.code}-${f.field ?? ''}-${f.collection ?? ''}-${i}`}
                        data-testid="finding-row"
                      >
                        <th scope="row">
                          <code className="break-all">{f.code}</code>
                          <span className="mt-1 block">
                            <OutcomeChip outcome={f.outcome} />
                          </span>
                        </th>
                        <td className="num">{formatNumber(f.count ?? 1)}</td>
                        <td>{f.field ?? <span className="text-muted">–</span>}</td>
                        <td>
                          {f.collection ? (
                            (names.get(f.collection) ?? f.collection)
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </td>
                        <td>
                          <SeverityChip severity={f.severity} />
                        </td>
                        <td className="min-w-64">{f.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          );
        })
      )}

      <Card title="Never migrated by this version">
        <p className="mb-3 text-sm text-muted">
          These source features are outside what ExitOS moves. They are not findings of this plan:
          they are the standing limits of this connector pair, printed for every run.
        </p>
        {plan.knownLimits.length === 0 ? (
          <p className="text-muted">The plan lists no standing limits.</p>
        ) : (
          <ul className="space-y-2" data-testid="known-limits">
            {plan.knownLimits.map((limit) => (
              <li key={limit} className="flex gap-2">
                <Icon name="cross" className="mt-1 size-4 text-bad" />
                <span>{limit}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </SectionShell>
  );
}
