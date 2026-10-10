import type { RecordingWording } from '../hooks/LiveContext';
import { Button, Callout, Card, Skeleton } from '../components/ui';

/**
 * The badge of the static online demo. It is always visible (the header is sticky) and never says
 * LIVE or connected: the page replays a recording and has nothing to connect to.
 */
export function StaticDemoBadge() {
  return (
    <div className="mode-badge mode-demo" data-testid="mode-badge" data-mode="static-demo">
      <span className="text-sm font-extrabold tracking-wider sm:text-base">DEMO</span>
      <span className="text-[0.6875rem] font-medium sm:text-xs">
        Replay of a recorded run on synthetic data
      </span>
    </div>
  );
}

export function DemoLoading() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading"
    >
      <div>
        <p className="font-semibold">Loading the recorded demo…</p>
        <p className="text-sm text-muted">Reading one file, demo-state.json, from this site.</p>
      </div>
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-8 w-2/3 sm:w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}

export function DemoError({
  message,
  onRetry,
  busy,
}: {
  message: string;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4" data-testid="error-screen">
      <Callout tone="bad" role="alert" title="The demo cannot show anything yet">
        <p>{message}</p>
      </Callout>
      <Card title="What to try">
        <ul className="mb-4 list-disc space-y-1 pl-5">
          <li>Check your connection, then retry.</li>
          <li>
            The demo is a static page: open it from a web address (or serve the folder with{' '}
            <code>pnpm preview:demo</code>), not as a file from disk.
          </li>
          <li>Nothing is lost: this page only reads one recorded file from this site.</li>
        </ul>
        <Button variant="primary" onClick={onRetry} disabled={busy} testId="retry">
          {busy ? 'Retrying…' : 'Retry'}
        </Button>
      </Card>
    </div>
  );
}

/** How the Progress section describes a recording (no server, no polling, no refresh). */
export const RECORDING_WORDING: RecordingWording = {
  cardTitle: 'Recorded status',
  intro:
    'The counts and events of the recorded run. Nothing on this page can start, stop or change a run, and nothing here updates.',
  note: 'This is a recording. It was read once from demo-state.json and is never refreshed; this page does not poll.',
};
