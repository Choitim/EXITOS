import { useCallback, useEffect, useState } from 'react';
import { loadStaticDemoStateOnce } from '../lib/static-state';
import type { DashboardStore } from './useDashboardState';

/**
 * The online demo's counterpart of `useDashboardState`: it loads the recorded state ONCE and keeps
 * it. It never polls, never listens for visibility changes and never talks to an API. `refresh`
 * exists only so the error screen's Retry button works after a failed load.
 */
export function useStaticDemoState(): DashboardStore {
  const [store, setStore] = useState<Pick<DashboardStore, 'status' | 'state' | 'error'>>({
    status: 'loading',
    state: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadStaticDemoStateOnce((input, init) => fetch(input, init)).then((result) => {
      if (cancelled) return;
      setRetrying(false);
      setStore(
        result.ok
          ? { status: 'ready', state: result.state, error: null }
          : { status: 'error', state: null, error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const refresh = useCallback(() => {
    setRetrying(true);
    setAttempt((n) => n + 1);
  }, []);

  return {
    ...store,
    lastUpdated: null,
    refreshing: retrying,
    pollMs: null,
    refresh,
  };
}
