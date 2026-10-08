import type { DashboardState } from '@exitos/core/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { pollIntervalMs } from '../lib/format';
import { contentSignature, parseDashboardState } from '../lib/state';

export type LoadStatus =
  /** First request in flight. */
  | 'loading'
  /** Have a valid state (it may be stale if `error` is set). */
  | 'ready'
  /** No usable state: server unreachable or the document is not understood. */
  | 'error';

export interface DashboardStore {
  status: LoadStatus;
  state: DashboardState | null;
  /** Set when the latest request failed. `state` then still holds the last good document. */
  error: string | null;
  /** Wall-clock time of the last successful response. */
  lastUpdated: Date | null;
  refreshing: boolean;
  /** `null` while polling is paused because the tab is hidden. */
  pollMs: number | null;
  refresh: () => void;
}

const STATE_URL = '/api/state';

type FetchOutcome =
  { kind: 'ok'; text: string; state: DashboardState } | { kind: 'error'; message: string };

async function fetchState(signal: AbortSignal): Promise<FetchOutcome> {
  let response: Response;
  try {
    response = await fetch(STATE_URL, {
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      kind: 'error',
      message: 'The ExitOS server could not be reached. Is `exitos ui` still running?',
    };
  }
  if (!response.ok) {
    return {
      kind: 'error',
      message: `The server answered with HTTP ${response.status} for ${STATE_URL}.`,
    };
  }
  const text = await response.text();
  const parsed = parseDashboardState(text);
  if (!parsed.ok) {
    return {
      kind: 'error',
      message: `The server sent data this dashboard cannot read: ${parsed.error}`,
    };
  }
  return { kind: 'ok', text, state: parsed.state };
}

/**
 * Loads `GET /api/state` and keeps it fresh: every 2 s while a run is approved/applying/verifying,
 * every 10 s otherwise, and not at all while the tab is hidden (it refreshes as soon as it is shown).
 */
export function useDashboardState(): DashboardStore {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const [nonce, setNonce] = useState(0);

  const signature = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);
    try {
      const outcome = await fetchState(controller.signal);
      if (controller.signal.aborted) return;
      if (outcome.kind === 'error') {
        setError(outcome.message);
        setStatus((previous) => (previous === 'ready' ? 'ready' : 'error'));
      } else {
        const next = contentSignature(outcome.text);
        if (next !== signature.current) {
          signature.current = next;
          setState(outcome.state);
        }
        setError(null);
        setStatus('ready');
        setLastUpdated(new Date());
      }
    } catch {
      // Aborted by a newer request or by unmounting: nothing to report.
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  // Pause while hidden.
  useEffect(() => {
    const onVisibility = (): void => {
      setHidden(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const interval = hidden ? null : pollIntervalMs(state?.run?.status);

  // Fetch right away: on mount, on a manual refresh, and as soon as a hidden tab is shown again.
  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, nonce, load]);

  // Then keep fetching on the interval (none while the tab is hidden). A change of interval, for
  // example when a run starts or ends, only re-arms the timer; it does not cause an extra request.
  useEffect(() => {
    if (interval === null) return;
    const timer = window.setInterval(() => {
      void load();
    }, interval);
    return () => {
      window.clearInterval(timer);
    };
  }, [interval, load]);

  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { status, state, error, lastUpdated, refreshing, pollMs: interval, refresh };
}
