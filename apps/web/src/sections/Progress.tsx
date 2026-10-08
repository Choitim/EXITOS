import type { DashboardState, MigrationPlan, RunEvent } from '@exitos/core/schema';
import { memo, useEffect, useId, useRef, useState } from 'react';
import { useLive } from '../hooks/LiveContext';
import {
  Button,
  Callout,
  Card,
  Chip,
  Empty,
  Icon,
  SectionShell,
  TONE_TEXT,
  TableWrap,
} from '../components/ui';
import {
  describeRunStatus,
  formatDateTime,
  formatNumber,
  formatTime,
  isRunActive,
  runProgress,
  timeZoneLabel,
  type RunCounts,
  type Tone,
} from '../lib/format';
import type { IconName } from '../lib/outcomes';

const STATUS_ROWS: ReadonlyArray<{
  key: keyof RunCounts;
  label: string;
  tone: Tone;
  icon: IconName;
  meaning: string;
}> = [
  {
    key: 'succeeded',
    label: 'Succeeded',
    tone: 'ok',
    icon: 'check',
    meaning: 'written to the destination',
  },
  {
    key: 'skipped',
    label: 'Skipped',
    tone: 'neutral',
    icon: 'minus',
    meaning: 'already present or excluded',
  },
  { key: 'pending', label: 'Pending', tone: 'neutral', icon: 'info', meaning: 'not attempted yet' },
  {
    key: 'in_flight',
    label: 'In flight',
    tone: 'info',
    icon: 'transform',
    meaning: 'being written right now',
  },
  {
    key: 'ambiguous',
    label: 'Ambiguous',
    tone: 'warn',
    icon: 'warning',
    meaning: 'the outcome of the write is unknown',
  },
  {
    key: 'blocked',
    label: 'Blocked',
    tone: 'warn',
    icon: 'warning',
    meaning: 'a dependency failed, so not attempted',
  },
  { key: 'failed', label: 'Failed', tone: 'bad', icon: 'cross', meaning: 'the write failed' },
];

const LEVEL: Record<RunEvent['level'], { label: string; tone: Tone; icon: IconName }> = {
  info: { label: 'info', tone: 'neutral', icon: 'info' },
  warn: { label: 'warn', tone: 'warn', icon: 'warning' },
  error: { label: 'error', tone: 'bad', icon: 'cross' },
};

const EventLog = memo(function EventLog({ events }: { events: RunEvent[] }) {
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const toggleId = useId();
  const last = events[events.length - 1]?.id;

  useEffect(() => {
    const box = boxRef.current;
    if (autoScroll && box) box.scrollTop = box.scrollHeight;
  }, [autoScroll, last, events.length]);

  return (
    <Card
      title={`Event log (${formatNumber(events.length)}${events.length >= 250 ? ', latest 250' : ''})`}
      actions={
        <label htmlFor={toggleId} className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            id={toggleId}
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={autoScroll}
            onChange={(e) => {
              setAutoScroll(e.target.checked);
            }}
            data-testid="autoscroll"
          />
          Auto-scroll to newest
        </label>
      }
    >
      {events.length === 0 ? (
        <Empty>No events yet.</Empty>
      ) : (
        <div
          ref={boxRef}
          className="max-h-96 overflow-auto rounded-md border border-line"
          role="log"
          aria-label="Run events, newest last"
          tabIndex={0}
          data-testid="event-log"
        >
          <table className="data-table">
            <caption className="sr-only">Run events, oldest first, newest last</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Level</th>
                <th scope="col">Type</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const level = LEVEL[event.level] as (typeof LEVEL)[RunEvent['level']] | undefined;
                return (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      <time dateTime={event.ts} title={event.ts}>
                        {formatTime(event.ts)}
                      </time>
                    </td>
                    <td>
                      <Chip tone={level?.tone ?? 'neutral'} icon={level?.icon ?? 'info'}>
                        {level?.label ?? event.level}
                      </Chip>
                    </td>
                    <td>
                      <code>{event.type}</code>
                    </td>
                    <td className="min-w-64">{event.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
});

function pollingText(pollMs: number | null, runStatus: string | undefined): string {
  if (pollMs === null) return 'Updates are paused while this tab is hidden.';
  const seconds = pollMs / 1000;
  return `Checks the server every ${seconds} s${isRunActive(runStatus) ? ' while the run is active' : ''}; pauses while the tab is hidden.`;
}

export function Progress({ state, plan }: { state: DashboardState; plan: MigrationPlan }) {
  const store = useLive();
  const { run, events, runs } = state;
  const progress = run ? runProgress(run.counts) : null;
  const status = run ? describeRunStatus(run.status) : null;

  return (
    <SectionShell
      id="progress"
      number={6}
      title="Migration progress"
      intro="Live view of the run. Updates itself; nothing on this page can start, stop or change a run."
    >
      <Card
        title="Live status"
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span data-testid="last-updated">
              Last updated:{' '}
              {store.lastUpdated ? (
                <time dateTime={store.lastUpdated.toISOString()}>
                  {formatTime(store.lastUpdated.toISOString())} {timeZoneLabel()}
                </time>
              ) : (
                'never'
              )}
            </span>
            <Button onClick={store.refresh} disabled={store.refreshing} testId="refresh">
              {store.refreshing ? 'Refreshing…' : 'Refresh now'}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-muted" data-testid="polling-text">
          {pollingText(store.pollMs, run?.status)}
        </p>
        {run === null || progress === null || status === null ? (
          <Callout tone="info" title="No run yet">
            <p className="text-sm">
              Plan <code>{plan.planId}</code> has not been approved, so there is no progress to
              show. Approve it with the command in the overview.
            </p>
          </Callout>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={status.tone} title={run.status}>
                {status.label}
              </Chip>
              <span className="text-sm text-muted">
                Run <code>{run.runId}</code>
              </span>
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {formatNumber(progress.done)} of {formatNumber(progress.total)} actions written or
                  skipped
                </span>
                <span className="text-lg font-semibold tabular-nums" data-testid="progress-percent">
                  {progress.percent}%
                </span>
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-label="Run progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                aria-valuetext={`${progress.done} of ${progress.total} actions written or skipped (${progress.percent}%)`}
                data-testid="progress-bar"
              >
                <div
                  className="bar-fill min-w-0 rounded-md"
                  style={{ flexGrow: progress.done, flexBasis: 0 }}
                />
                <div
                  style={{ flexGrow: Math.max(0, progress.total - progress.done), flexBasis: 0 }}
                />
              </div>
              <p className="mt-1 text-xs text-muted">
                Succeeded plus skipped, out of every action in the run. Not the same as verified.
              </p>
            </div>
            {run.stopReason ? (
              <Callout tone="warn" title="Stop reason" testId="stop-reason">
                <p>{run.stopReason}</p>
              </Callout>
            ) : null}
            <TableWrap label="Actions by status">
              <table className="data-table">
                <caption>Actions by status</caption>
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Meaning</th>
                    <th scope="col" className="num">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {STATUS_ROWS.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">
                        <span className={`inline-flex items-center gap-1.5 ${TONE_TEXT[row.tone]}`}>
                          <Icon name={row.icon} />
                          <span className="text-fg">{row.label}</span>
                        </span>
                      </th>
                      <td>{row.meaning}</td>
                      <td className="num" data-testid={`count-${row.key}`}>
                        {formatNumber(run.counts[row.key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}
      </Card>

      <EventLog events={events} />

      {runs.length > 1 ? (
        <details className="card">
          <summary className="cursor-pointer font-medium">
            All runs in this state directory ({runs.length})
          </summary>
          <div className="mt-3">
            <TableWrap label="All runs">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.runId}>
                      <th scope="row">
                        <code>{r.runId}</code>
                      </th>
                      <td>
                        <code>{r.planId}</code>
                      </td>
                      <td>{describeRunStatus(r.status).label}</td>
                      <td>{formatDateTime(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </details>
      ) : null}
    </SectionShell>
  );
}
