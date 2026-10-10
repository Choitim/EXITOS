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
  RunStatusChip,
  SectionShell,
  TONE_TEXT,
  TableWrap,
} from '../components/ui';
import { describeEvent, eventLevelChip } from '../lib/events';
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

/**
 * `attention` decides how a row looks when its count is above zero: `bad` is the Failed style,
 * `warn` is the Requires-attention style. At zero every row is quiet.
 */
const STATUS_ROWS: ReadonlyArray<{
  key: keyof RunCounts;
  label: string;
  tone: Tone;
  icon: IconName;
  meaning: string;
  attention?: 'bad' | 'warn';
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
    attention: 'warn',
  },
  {
    key: 'blocked',
    label: 'Blocked',
    tone: 'warn',
    icon: 'warning',
    meaning: 'a dependency failed, so not attempted',
    attention: 'warn',
  },
  {
    key: 'failed',
    label: 'Failed',
    tone: 'bad',
    icon: 'failed',
    meaning: 'the write failed',
    attention: 'bad',
  },
];

function StatusRow({ row, count }: { row: (typeof STATUS_ROWS)[number]; count: number }) {
  const attention = row.attention !== undefined && count > 0 ? row.attention : null;
  const quiet = row.attention !== undefined && count === 0;
  return (
    <tr
      className={
        attention === 'bad'
          ? 'row-attn-bad'
          : attention === 'warn'
            ? 'row-attn-warn'
            : quiet
              ? 'row-quiet'
              : undefined
      }
      data-testid={`status-row-${row.key}`}
      data-attention={attention ?? 'none'}
    >
      <th scope="row">
        {attention === 'bad' ? (
          <Chip tone="bad" icon="failed" solid>
            Failed
          </Chip>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Icon name={row.icon} className={quiet ? '' : TONE_TEXT[row.tone]} />
            <span className={attention ? '' : quiet ? 'font-medium' : 'text-fg'}>{row.label}</span>
          </span>
        )}
        {attention !== null ? <span className="sr-only"> (needs attention)</span> : null}
      </th>
      <td>{row.meaning}</td>
      <td className={`num ${attention ? 'font-bold' : ''}`} data-testid={`count-${row.key}`}>
        {formatNumber(count)}
      </td>
    </tr>
  );
}

const EventLog = memo(function EventLog({ events }: { events: RunEvent[] }) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [technical, setTechnical] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const toggleId = useId();
  const technicalId = useId();
  const last = events[events.length - 1]?.id;

  useEffect(() => {
    const box = boxRef.current;
    if (autoScroll && box) box.scrollTop = box.scrollHeight;
  }, [autoScroll, last, events.length]);

  return (
    <Card
      title={`Event log (${formatNumber(events.length)}${events.length >= 250 ? ', latest 250' : ''})`}
      actions={
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <label
            htmlFor={technicalId}
            className="inline-flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              id={technicalId}
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={technical}
              onChange={(e) => {
                setTechnical(e.target.checked);
              }}
              data-testid="event-technical"
            />
            Show technical details
          </label>
          <label
            htmlFor={toggleId}
            className="inline-flex cursor-pointer items-center gap-2 text-sm"
          >
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
        </div>
      }
    >
      {events.length === 0 ? (
        <Empty title="No events yet" testId="events-empty">
          Events appear here as soon as a run is approved: each write, each recovery after a lost
          reply and the verification result.
        </Empty>
      ) : (
        <div
          ref={boxRef}
          className="relative max-h-96 overflow-auto rounded-md border border-line"
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
                <th scope="col">Event</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const info = describeEvent(event);
                const chip = eventLevelChip(event.level);
                return (
                  <tr key={event.id} data-testid="event-row" data-event-type={event.type}>
                    <td className="whitespace-nowrap tabular-nums">
                      <time dateTime={event.ts} title={event.ts}>
                        {formatTime(event.ts)}
                      </time>
                    </td>
                    <td>
                      <span
                        className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
                        title={`Event type: ${event.type}`}
                      >
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Icon name={info.icon} className={TONE_TEXT[info.tone]} />
                          <span data-testid="event-label">{info.label}</span>
                        </span>
                        {chip ? (
                          <Chip tone={chip.tone} icon={chip.icon}>
                            {chip.label}
                          </Chip>
                        ) : null}
                      </span>
                      {technical ? (
                        <code className="mt-0.5 block text-xs text-muted" data-testid="event-type">
                          {event.type}
                        </code>
                      ) : null}
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
  const recording = store.recording;
  const { run, events, runs } = state;
  const progress = run ? runProgress(run.counts) : null;
  const status = run ? describeRunStatus(run.status) : null;

  return (
    <SectionShell
      id="progress"
      number={6}
      title="Migration progress"
      intro={
        recording?.intro ??
        'Live view of the run. Updates itself; nothing on this page can start, stop or change a run.'
      }
    >
      <Card
        title={recording?.cardTitle ?? 'Live status'}
        actions={
          recording ? undefined : (
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
          )
        }
      >
        <p className="mb-3 text-sm text-muted" data-testid="polling-text">
          {recording?.note ?? pollingText(store.pollMs, run?.status)}
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
              <RunStatusChip status={run.status} label={status.label} tone={status.tone} />
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
                    <StatusRow key={row.key} row={row} count={run.counts[row.key]} />
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
