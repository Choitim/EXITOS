import { createContext, useContext } from 'react';

/** What the Progress section needs to know about polling, without re-rendering every section. */
export interface LiveInfo {
  lastUpdated: Date | null;
  refreshing: boolean;
  /** `null` while polling is paused because the tab is hidden. */
  pollMs: number | null;
  refresh: () => void;
}

const FALLBACK: LiveInfo = {
  lastUpdated: null,
  refreshing: false,
  pollMs: null,
  refresh: () => undefined,
};

export const LiveContext = createContext<LiveInfo>(FALLBACK);

export function useLive(): LiveInfo {
  return useContext(LiveContext);
}
