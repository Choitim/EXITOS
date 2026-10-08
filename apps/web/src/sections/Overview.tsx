import type { DashboardState, MigrationPlan } from '@exitos/core/schema';
import {
  Callout,
  Card,
  Chip,
  CommandLine,
  CopyButton,
  Facts,
  SectionShell,
  Stat,
} from '../components/ui';
import {
  approveCommand,
  describeReportState,
  describeRunStatus,
  formatDateTime,
  formatNumber,
  pluralize,
  runProgress,
  timeZoneLabel,
  type RunCounts,
  type Tone,
} from '../lib/format';
import type { IconName } from '../lib/outcomes';

function Time({ iso }: { iso: string | undefined }) {
  if (iso === undefined) return <span className="text-muted">not yet</span>;
  return (
    <time dateTime={iso} title={`${iso} (UTC)`}>
      {formatDateTime(iso)} <span className="text-muted">{timeZoneLabel()}</span>
    </time>
  );
}

const RUN_COUNT_ROWS: ReadonlyArray<{
  key: keyof RunCounts;
  label: string;
  tone: Tone;
  icon: IconName;
}> = [
  { key: 'succeeded', label: 'succeeded', tone: 'ok', icon: 'check' },
  { key: 'skipped', label: 'skipped', tone: 'neutral', icon: 'minus' },
  { key: 'pending', label: 'pending', tone: 'neutral', icon: 'info' },
  { key: 'in_flight', label: 'in flight', tone: 'info', icon: 'transform' },
  { key: 'ambiguous', label: 'ambiguous', tone: 'warn', icon: 'warning' },
  { key: 'blocked', label: 'blocked', tone: 'warn', icon: 'warning' },
  { key: 'failed', label: 'failed', tone: 'bad', icon: 'cross' },
];

export function Overview({ state, plan }: { state: DashboardState; plan: MigrationPlan }) {
  const { report, run } = state;
  const wording = report ? describeReportState(report.state) : null;
  const progress = run ? runProgress(run.counts) : null;
  const summary = plan.summary;
  const command = approveCommand(plan.planId);

  return (
    <SectionShell
      id="overview"
      number={1}
      title="Migration overview"
      intro="Where this migration stands, said as plainly as possible. Only a verified run is described as a success."
    >
      {wording && report ? (
        <Callout
          tone={wording.tone}
          title={<span data-testid="state-title">{wording.title}</span>}
          testId="status-banner"
        >
          <p className="font-medium" data-testid="report-headline">
            {report.headline}
          </p>
          <p className="text-sm">{wording.detail}</p>
        </Callout>
      ) : (
        <Callout tone="neutral" title="No report is available for this plan yet.">
          <p className="text-sm">
            The server did not include a report, so no overall state can be shown.
          </p>
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Plan">
          <Facts
            rows={[
              [
                'Plan id',
                <code key="id" data-testid="plan-id">
                  {plan.planId}
                </code>,
              ],
              [
                'Hash',
                <code key="h" className="break-all" title={plan.hash}>
                  {plan.hash.slice(0, 16)}…
                </code>,
              ],
              ['Generated', <Time key="t" iso={plan.generatedAt} />],
              ['ExitOS version', plan.exitosVersion],
              [
                'Blocking errors',
                summary.blockingErrors > 0 ? (
                  <Chip key="b" tone="bad" icon="cross">
                    {pluralize(summary.blockingErrors, 'error')}: apply will refuse this plan
                  </Chip>
                ) : (
                  <span key="b">None</span>
                ),
              ],
              ['Warnings', formatNumber(summary.warnings)],
            ]}
          />
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            <p className="font-medium">Approve this plan</p>
            <p className="text-sm text-muted">
              This dashboard is read-only and cannot approve or apply anything. Review the plan
              first, then run this command yourself. It writes to the destination.
            </p>
            <CommandLine command={command} />
            <CopyButton text={command} label="Copy approve command" testId="copy-approve" />
          </div>
        </Card>

        <Card title="Run">
          {run ? (
            <>
              <Facts
                rows={[
                  [
                    'Run id',
                    <code key="r" data-testid="run-id">
                      {run.runId}
                    </code>,
                  ],
                  [
                    'Status',
                    <Chip key="s" tone={describeRunStatus(run.status).tone} title={run.status}>
                      {describeRunStatus(run.status).label}
                    </Chip>,
                  ],
                  ['Approved', <Time key="a" iso={run.approvedAt} />],
                  ['Started', <Time key="st" iso={run.startedAt} />],
                  ['Finished', <Time key="f" iso={run.finishedAt} />],
                  ['Last update', <Time key="u" iso={run.updatedAt} />],
                  [
                    'Actions',
                    <span key="c" className="flex flex-wrap gap-1.5" data-testid="run-counts">
                      {RUN_COUNT_ROWS.filter((row) => run.counts[row.key] > 0).map((row) => (
                        <Chip key={row.key} tone={row.tone} icon={row.icon}>
                          {formatNumber(run.counts[row.key])} {row.label}
                        </Chip>
                      ))}
                    </span>,
                  ],
                  ...(run.stopReason ? ([['Stop reason', run.stopReason]] as const) : []),
                ]}
              />
              {progress ? (
                <p className="mt-3 text-sm text-muted">
                  {formatNumber(progress.done)} of {formatNumber(progress.total)} actions written or
                  skipped ({progress.percent}%). See Migration progress below.
                </p>
              ) : null}
            </>
          ) : (
            <p>
              <Chip tone="info" icon="info">
                No run yet
              </Chip>{' '}
              This plan has not been approved, so nothing has been written to the destination.
            </p>
          )}
        </Card>
      </div>

      <Card title="Counts from the plan">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Planned actions"
            value={formatNumber(summary.actions.total)}
            testId="count-actions-total"
          />
          <Stat
            label="To execute"
            value={formatNumber(summary.actions.toExecute)}
            testId="count-actions-execute"
          />
          <Stat
            label="Already present (skip)"
            value={formatNumber(summary.actions.toSkip)}
            testId="count-actions-skip"
          />
          <Stat
            label="Estimated writes"
            value={formatNumber(plan.estimate.writeRequests)}
            hint={`about ${plan.estimate.minutesAtRateLimit} min at ${plan.estimate.requestsPerMinute} requests/min`}
          />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Actions by kind">
          {Object.entries(summary.actions.byKind).map(([kind, count]) => (
            <Chip key={kind} tone="neutral">
              <code>{kind}</code>: {formatNumber(count)}
            </Chip>
          ))}
        </div>
      </Card>

      {report && report.disclaimers.length > 0 ? (
        <Card title="Read this first">
          <ul className="list-disc space-y-1 pl-5">
            {report.disclaimers.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </SectionShell>
  );
}
