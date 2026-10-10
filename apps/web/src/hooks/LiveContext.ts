import { createContext, useContext } from 'react';

/** The words the Progress section uses for a recording instead of a live run. */
export interface RecordingWording {
  cardTitle: string;
  intro: string;
  note: string;
}

/** What the Progress section needs to know about polling, without re-rendering every section. */
export interface LiveInfo {
  lastUpdated: Date | null;
  refreshing: boolean;
  /** `null` while polling is paused because the tab is hidden. */
  pollMs: number | null;
  refresh: () => void;
  /**
   * Set when the state is a recording read once from a file (the online demo) instead of a server:
   * the Progress section then shows these words and no refresh controls.
   */
  recording?: RecordingWording;
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
