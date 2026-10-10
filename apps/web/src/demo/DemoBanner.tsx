import { Icon } from '../components/ui';

/**
 * The honest statement of what this page is. It is part of the page, not a dismissible popup:
 * together with the badge in the sticky header it keeps the DEMO label on screen at all times.
 */
export function DemoBanner() {
  return (
    <section
      aria-labelledby="demo-banner-heading"
      className="callout callout-warn mb-6"
      data-testid="demo-banner"
    >
      <Icon name="info" className="callout-icon" />
      <div className="min-w-0 space-y-2">
        <h2 id="demo-banner-heading" className="text-lg font-bold leading-snug">
          DEMO · Replay of a recorded run on synthetic data
        </h2>
        <p>
          <strong>This page cannot connect to Notion or ClickUp.</strong> It has no login, no
          credentials and no server. Everything here was produced by the real ExitOS engine running
          its offline demo against a synthetic workspace and fake APIs, then recorded to a file.
          This page replays that recording.
        </p>
        <p className="text-sm">
          ExitOS v0.1 is a pre-release and has not been validated against live Notion or ClickUp.{' '}
          <a href="#run-it-for-real">Run it for real on your own computer</a>.
        </p>
      </div>
    </section>
  );
}
