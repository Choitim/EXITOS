import type { DashboardState, MigrationPlan } from '@exitos/core/schema';
import { useMemo, type ReactNode } from 'react';
import { summarizeApproval } from '../lib/approval';
import { approveCommand, formatNumber, pluralize } from '../lib/format';
import { OUTCOME_ORDER, outcomeMeta } from '../lib/outcomes';
import { OutcomeLegend } from './OutcomeLegend';
import { Callout, Chip, CommandLine, CopyButton, Icon, OutcomeChip } from './ui';

function Point({
  tone,
  children,
  testId,
}: {
  tone: 'ok' | 'warn' | 'bad';
  children: ReactNode;
  testId?: string;
}) {
  const icon = tone === 'ok' ? 'check' : tone === 'warn' ? 'warning' : 'cross';
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-bad';
  return (
    <li className="flex gap-2" data-testid={testId}>
      <Icon name={icon} className={`mt-1 size-4 ${color}`} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * "If you approve this plan": what would be written, and what would not happen, all read off the
 * plan. The dashboard cannot approve anything; it shows the command the person runs themselves.
 */
export function ApprovalPanel({
  state,
  plan,
}: {
  state: Pick<DashboardState, 'run'>;
  plan: MigrationPlan;
}) {
  const summary = useMemo(() => summarizeApproval(plan), [plan]);
  const command = approveCommand(plan.planId);
  const hasRun = state.run !== null;
  const items = plan.summary.items;
  const itemTotal = OUTCOME_ORDER.reduce((sum, o) => sum + items[o], 0);
  const destination = plan.destination.workspace.name;

  return (
    <div
      className="card space-y-5"
      role="group"
      aria-labelledby="approval-heading"
      data-testid="approval-panel"
      data-has-run={hasRun ? 'true' : 'false'}
    >
      <header>
        <h3 id="approval-heading" className="card-title text-lg">
          {hasRun ? 'What this plan writes' : 'If you approve this plan'}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {hasRun
            ? 'This plan already has a run. These are the counts it was approved with.'
            : 'Nothing has been written yet. This is exactly what would happen, counted from the plan.'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 font-semibold">
            {hasRun ? 'Written to' : 'Would be created in'} {destination}
          </h4>
          {summary.creates.length === 0 ? (
            <p className="text-muted" data-testid="approval-creates-empty">
              The plan contains no action that writes anything.
            </p>
          ) : (
            <ul className="space-y-1.5" data-testid="approval-creates">
              {summary.creates.map((row) => (
                <li
                  key={`${row.kind}-${row.target ?? ''}`}
                  className="flex flex-wrap items-baseline gap-x-2"
                  data-testid="approval-create-row"
                >
                  <span className="w-12 text-right font-semibold tabular-nums">
                    {formatNumber(row.count)}
                  </span>
                  <span>
                    {row.noun}
                    {row.target ? (
                      <>
                        {' '}
                        in <strong className="font-semibold">{row.target}</strong>
                      </>
                    ) : null}
                  </span>
                  {row.experimental ? (
                    <Chip tone="warn" icon="warning" title="Docs migration is experimental.">
                      experimental
                    </Chip>
                  ) : null}
                  {row.unrecognised ? <code className="text-xs text-muted">{row.kind}</code> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted" data-testid="approval-totals">
            {pluralize(summary.toWrite, 'action')} to write
            {summary.toSkip > 0
              ? `, ${pluralize(summary.toSkip, 'action')} skipped because the destination already has ${summary.toSkip === 1 ? 'it' : 'them'}`
              : ''}
            .
          </p>
          {itemTotal > 0 ? (
            <div className="mt-4" data-testid="approval-fidelity">
              <p className="mb-1.5 text-sm font-medium">
                How the {pluralize(itemTotal, 'item')} arrive
              </p>
              <ul className="flex flex-wrap gap-2">
                {OUTCOME_ORDER.filter((o) => items[o] > 0).map((outcome) => (
                  <li key={outcome} className="inline-flex items-center gap-1.5 text-sm">
                    <OutcomeChip outcome={outcome} />
                    <span className="font-semibold tabular-nums">
                      {formatNumber(items[outcome])}
                    </span>
                    <span className="sr-only">{outcomeMeta(outcome).plain}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div>
          <h4 className="mb-2 font-semibold">What would not happen</h4>
          <ul className="space-y-2" data-testid="approval-guarantees">
            <Point tone="ok" testId="approval-source-untouched">
              Your source ({plan.source.workspace.system}, {plan.source.workspace.name}) is never
              modified. It is only read.
            </Point>
            {summary.unrecognisedKinds.length === 0 ? (
              <Point tone="ok" testId="approval-no-delete">
                Nothing in the destination is deleted or overwritten. Every action creates a new
                item or adds a link between items.
              </Point>
            ) : (
              <Point tone="warn" testId="approval-unknown-kinds">
                This plan has action kinds this dashboard cannot describe (
                {summary.unrecognisedKinds.join(', ')}). Read the plan file before approving.
              </Point>
            )}
            {summary.notified > 0 ? (
              <Point tone="warn" testId="approval-notify">
                {pluralize(summary.notified, 'assignment')} would notify{' '}
                {summary.notified === 1 ? 'a person' : 'people'} in the destination, because it
                notifies assignees of tasks created through its API.
              </Point>
            ) : (
              <Point tone="ok" testId="approval-notify">
                No assignment would notify anyone in the destination.
              </Point>
            )}
            {summary.blockingErrors > 0 ? (
              <Point tone="bad" testId="approval-blocking">
                <strong>{pluralize(summary.blockingErrors, 'blocking error')}:</strong> apply will
                refuse this plan until {summary.blockingErrors === 1 ? 'it is' : 'they are'} fixed.
                See <a href="#unsupported">Unsupported content</a>.
              </Point>
            ) : (
              <Point tone="ok" testId="approval-blocking">
                No blocking errors.
              </Point>
            )}
          </ul>
        </div>
      </div>

      <OutcomeLegend
        variant="compact"
        testId="overview-legend"
        label="What the outcome words mean"
      />

      <Callout
        tone="info"
        title="This dashboard cannot approve anything"
        testId="approval-readonly"
      >
        <p className="text-sm">
          It is read-only: there is no button here that starts, stops or approves a run. To approve
          this plan, review it, then run this command yourself in a terminal.{' '}
          {hasRun ? 'This plan already has a run, so the command is shown for reference.' : ''}
        </p>
        <div className="pt-1">
          <CommandLine command={command} />
          <CopyButton text={command} label="Copy approve command" testId="copy-approve" />
        </div>
      </Callout>
    </div>
  );
}
