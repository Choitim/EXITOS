import { createContext, useContext } from 'react';

/** The dashboard section the guided tour is pointing at, and the words for its flag. */
export interface TourHighlight {
  sectionId: string;
  label: string;
}

/** `null` outside the online demo and whenever the tour points at no section. */
export const TourHighlightContext = createContext<TourHighlight | null>(null);

export function useTourHighlight(): TourHighlight | null {
  return useContext(TourHighlightContext);
}
