import type { RunEvent, VerificationResult } from '@exitos/core/schema';
import { memo, useEffect, useRef } from 'react';
import { Callout, Chip, Empty, Icon, TONE_TEXT } from '../components/ui';
import type { ReplayControls } from '../hooks/useReplay';
import { describeEvent, eventLevelChip } from '../lib/events';
import { describeVerification, formatNumber, formatTime, pluralize } from '../lib/format';
import type { ReplayTimeline } from '../lib/replay';
import { DemoButton } from './DemoButton';

/**
 * One replayed event, with the same wording as a row of the real event log: the recorded time, what
 * kind of event it is, and the engine's own message. A list item rather than a table row, so it
 * wraps on a phone instead of scrolling sideways.
 */
const ReplayRow = memo(function ReplayRow({ event }: { event: RunEvent }) {
  const info = describeEvent(event);
  const chip = eventLevelChip(event.level);
  return (
    <li
      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-line px-3 py-2 text-sm first:border-t-0"
      data-testid="replay-row"
      data-event-type={event.type}
    >
      <time
        className="whitespace-nowrap tabular-nums text-muted"
        dateTime={event.ts}
        title={`Recorded at ${event.ts}`}
      >
        {formatTime(event.ts)}
      </time>
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium"
        title={`Event type: ${event.type}`}
      >
        <Icon name={info.icon} className={TONE_TEXT[info.tone]} />
        {info.label}
        {chip ? (
          <Chip tone={chip.tone} icon={chip.icon}>
            {chip.label}
          </Chip>
        ) : null}
      </span>
      <span className="min-w-0 basis-full break-words sm:basis-0 sm:flex-1">{event.message}</span>
    </li>
  );
});

/**
 * Step 5: replays the recorded run. The progress bar, the counts and the event list all come from
 * `frameAt` over the recorded events (see lib/replay.ts); this component only draws them.
 */
export function ReplayPanel({
  timeline,
  replay,
  verification,
}: {
  timeline: ReplayTimeline | null;
  replay: ReplayControls;
  verification: VerificationResult | null;
}) {
  const { mode, frame } = replay;
  const logRef = useRef<HTMLDivElement>(null);
  const revealed = frame?.revealed ?? 0;

  // Keep the newest event in view inside the log box (the page itself is not scrolled).
  useEffect(() => {
    const box = logRef.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [revealed]);

  if (timeline === null || frame === null) {
    return (
      <Empty title="Nothing to replay" testId="replay-empty">
        This recording contains no run events, so there is no run to replay.
      </Empty>
    );
  }

  const verdict = verification ? describeVerification(verification) : null;
  const milestone = frame.milestone === null ? null : describeEvent(frame.milestone);
  const shown = timeline.events.slice(0, frame.revealed);
  const seconds = Math.round(timeline.durationMs / 1000);
  const progressText = `${formatNumber(frame.done)} of ${formatNumber(frame.total)} actions written or skipped (${frame.percent}%)`;

  return (
    <div className="space-y-4" data-testid="replay-panel" data-mode={mode}>
      <p>
        <Chip tone="warn" icon="info" className="whitespace-normal">
          <span data-testid="replay-label">
            Replay of a recorded offline run, not a live migration
          </span>
        </Chip>
      </p>
      <p className="text-sm text-muted">
        ExitOS recorded {pluralize(timeline.events.length, 'event')} when it ran its offline demo.
        Start shows them one after another in about {seconds} seconds, with their own messages and
        recorded times. The counts below are counted from those events and end at the recorded
        totals. Nothing is sent anywhere.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <DemoButton
          primary
          unavailable={mode === 'running'}
          onClick={replay.start}
          testId="replay-start"
        >
          <Icon name="play" />
          {mode === 'idle'
            ? 'Start simulation'
            : mode === 'running'
              ? 'Replaying…'
              : 'Replay again'}
        </DemoButton>
        <DemoButton unavailable={mode !== 'running'} onClick={replay.skip} testId="replay-skip">
          Skip to the end
        </DemoButton>
        <DemoButton unavailable={mode === 'idle'} onClick={replay.reset} testId="replay-reset">
          Reset
        </DemoButton>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="font-medium" data-testid="replay-count">
            {formatNumber(frame.done)} of {formatNumber(frame.total)} actions written or skipped
          </span>
          <span className="text-lg font-semibold tabular-nums" data-testid="replay-percent">
            {frame.percent}%
          </span>
        </div>
        <div
          className="bar"
          role="progressbar"
          aria-label="Replay progress"
          aria-valuemin={0}
          aria-valuemax={frame.total}
          aria-valuenow={frame.done}
          aria-valuetext={progressText}
          data-testid="replay-progress"
        >
          <div
            className="bar-fill min-w-0 rounded-md"
            style={{ flexGrow: frame.done, flexBasis: 0 }}
          />
          <div style={{ flexGrow: Math.max(0, frame.total - frame.done), flexBasis: 0 }} />
        </div>
        <p className="mt-1 text-sm text-muted" data-testid="replay-stage">
          {milestone === null ? 'Not started.' : `Latest stage: ${milestone.label}.`}{' '}
          {formatNumber(frame.revealed)} of {formatNumber(timeline.events.length)} recorded events
          shown.
        </p>
        {timeline.unexplainedDone > 0 ? (
          <p className="mt-1 text-sm text-muted" data-testid="replay-unexplained">
            {pluralize(timeline.unexplainedDone, 'action')} counted as done before the first
            recorded event shown here (skipped, or older than the events this recording keeps).
          </p>
        ) : null}
      </div>

      {frame.counts !== null ? (
        <Callout
          tone={verdict?.tone ?? 'neutral'}
          title="Replay finished at the recorded totals"
          testId="replay-result"
        >
          <p>
            <span data-testid="replay-final">
              {formatNumber(frame.done)} of {formatNumber(frame.total)}
            </span>{' '}
            actions written or skipped, exactly as recorded
            {verdict ? (
              <>
                . Recorded verification: <strong>{verdict.label}</strong>, {verdict.summary}
              </>
            ) : (
              '. The recording has no verification result.'
            )}
          </p>
        </Callout>
      ) : null}

      <div>
        <h4 className="mb-1 font-semibold">Replayed events</h4>
        <div
          ref={logRef}
          className="relative max-h-72 overflow-auto rounded-md border border-line"
          role="log"
          aria-live="off"
          aria-label="Replayed run events, newest last"
          tabIndex={0}
          data-testid="replay-log"
        >
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted" data-testid="replay-log-empty">
              No events yet. Press Start simulation.
            </p>
          ) : (
            <ol aria-label="Replayed run events, oldest first">
              {shown.map((event) => (
                <ReplayRow key={event.id} event={event} />
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Announced once when the replay starts and once when it ends, not for each of the events. */}
      <p role="status" className="sr-only" data-testid="replay-status">
        {mode === 'running'
          ? 'Replay running.'
          : mode === 'done'
            ? `Replay finished. ${progressText}.${verdict ? ` Recorded verification: ${verdict.label}.` : ''}`
            : ''}
      </p>
    </div>
  );
}
