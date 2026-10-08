import type { DashboardState } from '@exitos/core/schema';
import { Button, Callout, Card, CommandLine, CopyButton } from './ui';

export function LoadingScreen() {
  return (
    <div className="card" role="status" aria-live="polite" data-testid="loading">
      <p className="font-semibold">Loading the dashboard state…</p>
      <p className="text-sm text-muted">Reading from the local ExitOS server.</p>
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
    <div className="space-y-5" data-testid="empty-state">
      <Callout tone="info" title="There is no plan or run to show yet">
        <p>
          This state directory is empty. The dashboard shows only real data from your plans and
          runs, so there is nothing here until you create one.
          {state.runs.length > 0
            ? ` (${state.runs.length} run(s) exist but have no stored plan.)`
            : ''}
        </p>
      </Callout>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Try it with no account">
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
        <Card title="Plan your own migration">
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
