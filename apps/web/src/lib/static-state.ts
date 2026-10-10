/**
 * Data loading of the static online demo. The page reads ONE file, `demo-state.json`, that sits
 * next to index.html: the dashboard state that the real ExitOS engine recorded during its offline
 * demo. There is no server, no polling and no `/api` request.
 *
 * The URL is relative so the demo works from any folder or sub-path (https://<user>.github.io/EXITOS/).
 */
import type { DashboardState } from '@exitos/core/schema';
import { parseDashboardState } from './state';

/** Relative to the page, never to the site root. */
export const DEMO_STATE_URL = './demo-state.json';

export type StaticLoadResult = { ok: true; state: DashboardState } | { ok: false; error: string };

/** The subset of `fetch` this needs; lets tests pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetches and checks the recorded state. Refuses anything that is not a demo recording with a plan:
 * the online demo must never display a document that claims to be live data.
 */
export async function loadStaticDemoState(
  fetchImpl: FetchLike,
  url: string = DEMO_STATE_URL,
): Promise<StaticLoadResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      // Revalidate, so a new deployment never pairs new code with an old recording.
      cache: 'no-cache',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return {
      ok: false,
      error: 'The recorded demo data (demo-state.json) could not be loaded.',
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `The recorded demo data (demo-state.json) answered with HTTP ${response.status}.`,
    };
  }
  const parsed = parseDashboardState(await response.text());
  if (!parsed.ok) {
    return { ok: false, error: `The recorded demo data cannot be read: ${parsed.error}` };
  }
  if (parsed.state.mode !== 'demo' || parsed.state.plan === null) {
    return {
      ok: false,
      error: 'The recorded data is not a demo recording, so this page refuses to show it.',
    };
  }
  return parsed;
}

let pending: Promise<StaticLoadResult> | null = null;

/**
 * The same as `loadStaticDemoState`, but at most one request per page load, even when React mounts
 * the component twice (StrictMode in development). A failure is forgotten so Retry asks again.
 */
export function loadStaticDemoStateOnce(fetchImpl: FetchLike): Promise<StaticLoadResult> {
  if (pending === null) {
    const request = loadStaticDemoState(fetchImpl);
    pending = request;
    void request.then((result) => {
      if (!result.ok && pending === request) pending = null;
    });
  }
  return pending;
}
