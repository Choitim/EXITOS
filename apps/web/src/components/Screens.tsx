import type { DashboardState } from '@exitos/core/schema';
import { Button, Callout, Card, CommandLine, CopyButton, Skeleton } from './ui';

/**
 * Placeholders in the shape of the overview (banner, five stages, two cards) while the first
 * response is on its way. The words are for screen readers and for people who look away from the
 * grey blocks; the blocks themselves are decorative.
 */
export function LoadingScreen() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loading"
    >
      <div>
        <p className="font-semibold">Loading the dashboard state…</p>
        <p className="text-sm text-muted">Reading from the local ExitOS server.</p>
      </div>
      <div className="space-y-3" data-testid="loading-skeleton">
        <Skeleton className="h-8 w-2/3 sm:w-1/3" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_unused, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}

export function ErrorScreen({
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
      <Callout tone="bad" role="alert" title="The dashboard cannot show anything yet">
        <p>{message}</p>
      </Callout>
      <Card title="What to try">
        <ul className="mb-4 list-disc space-y-1 pl-5">
          <li>
            Make sure <code>exitos ui</code> is still running in your terminal, then retry.
          </li>
          <li>
            If you started it with <code>--demo</code> or <code>--state-dir</code>, keep the same
            options.
          </li>
          <li>Nothing is lost: this page only reads from the local server.</li>
        </ul>
        <Button variant="primary" onClick={onRetry} disabled={busy} testId="retry">
          {busy ? 'Retrying…' : 'Retry'}
        </Button>
      </Card>
    </div>
  );
}

/** Shown on top of the data when a later refresh fails; the last good data stays visible. */
export function StaleBanner({
  message,
  onRetry,
  busy,
}: {
  message: string;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <div className="mb-5">
      <Callout
        tone="warn"
        role="alert"
        title="Showing the last data received"
        testId="stale-banner"
      >
        <p className="text-sm">{message}</p>
        <div className="pt-1">
          <Button onClick={onRetry} disabled={busy} testId="retry">
            {busy ? 'Retrying…' : 'Retry now'}
          </Button>
        </div>
      </Callout>
    </div>
  );
}

export function EmptyState({ state }: { state: DashboardState }) {
  return (
    <div className="space-y-6" data-testid="empty-state">
      <Callout tone="info" title="There is no plan or run to show yet">
        <p>
          This state directory is empty. The dashboard shows only real data from your plans and
          runs, so there is nothing here until you create one.
          {state.runs.length > 0
            ? ` (${state.runs.length} run(s) exist but have no stored plan.)`
            : ''}
        </p>
      </Callout>
      <div>
        <h2 className="text-xl font-bold tracking-tight">Two ways to get started</h2>
        <p className="mt-1 text-muted">
          Run one of these in a terminal. Neither writes to Notion or ClickUp.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="1. Try it with no account" headingLevel={3}>
          <p className="mb-3">
            Run the offline demo. It plans, applies and verifies a synthetic Notion to ClickUp
            migration against fake APIs, with no network.
          </p>
          <CommandLine command="exitos demo" />
          <CopyButton text="exitos demo" label="Copy" testId="copy-demo" />
          <p className="mb-3 mt-4">Then open it here:</p>
          <CommandLine command="exitos ui --demo" />
          <CopyButton text="exitos ui --demo" label="Copy" testId="copy-ui-demo" />
        </Card>
        <Card title="2. Plan your own migration" headingLevel={3}>
          <p className="mb-3">
            Create a read-only plan from a config file. Nothing is written to either system when you
            plan.
          </p>
          <CommandLine command="exitos plan notion clickup --config migration.yaml" />
          <CopyButton
            text="exitos plan notion clickup --config migration.yaml"
            label="Copy"
            testId="copy-plan"
          />
          <p className="mb-3 mt-4">
            Then reload this page, or start the dashboard on that state directory:
          </p>
          <CommandLine command="exitos ui" />
          <CopyButton text="exitos ui" label="Copy" testId="copy-ui" />
        </Card>
      </div>
    </div>
  );
}
