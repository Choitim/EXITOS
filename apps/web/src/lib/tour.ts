/**
 * The guided tour of the online demo as a small state machine. It knows the six steps, which part
 * of the page each one points at, and how Back/Next/jump behave at the ends. It holds no browser
 * state: the tour lives in component memory only (nothing is written to storage or the URL).
 */

export type TourStepId =
  'workspace' | 'source' | 'compatibility' | 'mapping' | 'simulate' | 'verification';

export interface TourStep {
  id: TourStepId;
  /** Short title shown in the step list. */
  title: string;
  /** One line shown next to the Back/Next buttons, so the step stays explained while scrolled away. */
  hint: string;
  /**
   * What the step points at: the id of a dashboard section, or `tour` for the tour panel itself
   * (steps 1 and 5 do their work inside the panel).
   */
  target: string;
  /** The dashboard section the step highlights, if it points at one. */
  sectionId: string | null;
}

/** The id of the tour panel (a scroll target). */
export const TOUR_PANEL_ID = 'tour';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'workspace',
    title: 'Select a sample Notion workspace',
    hint: 'Open the one sample workspace this demo contains.',
    target: TOUR_PANEL_ID,
    sectionId: null,
  },
  {
    id: 'source',
    title: 'Inspect the source',
    hint: 'What is read from Notion (read-only) and where it would be written.',
    target: 'source-destination',
    sectionId: 'source-destination',
  },
  {
    id: 'compatibility',
    title: 'Preview compatibility',
    hint: 'What moves as-is, changes shape, needs review or cannot move.',
    target: 'compatibility',
    sectionId: 'compatibility',
  },
  {
    id: 'mapping',
    title: 'View the migration mapping',
    hint: 'How each Notion property would become a ClickUp field.',
    target: 'mapping',
    sectionId: 'mapping',
  },
  {
    id: 'simulate',
    title: 'Simulate the migration',
    hint: 'Replay the recorded run. This is not a live migration.',
    target: TOUR_PANEL_ID,
    sectionId: null,
  },
  {
    id: 'verification',
    title: 'Review the verification report',
    hint: 'What the destination held afterwards, compared with the plan.',
    target: 'verification',
    sectionId: 'verification',
  },
];

export const LAST_STEP = TOUR_STEPS.length - 1;

export interface TourState {
  /** Index into `TOUR_STEPS`. */
  step: number;
  /** True once the sample workspace has been opened (step 1). */
  workspaceOpened: boolean;
}

export type TourAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; step: number }
  | { type: 'open-workspace' }
  | { type: 'restart' };

export const INITIAL_TOUR: TourState = { step: 0, workspaceOpened: false };

export function canGoBack(state: TourState): boolean {
  return state.step > 0;
}

export function canGoNext(state: TourState): boolean {
  return state.step < LAST_STEP;
}

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'next':
      if (!canGoNext(state)) return state;
      // There is exactly one sample workspace, so moving on from step 1 means choosing it.
      return { step: state.step + 1, workspaceOpened: state.workspaceOpened || state.step === 0 };
    case 'back':
      return canGoBack(state) ? { ...state, step: state.step - 1 } : state;
    case 'goto': {
      if (!Number.isInteger(action.step) || action.step < 0 || action.step > LAST_STEP)
        return state;
      if (action.step === state.step) return state;
      return {
        step: action.step,
        workspaceOpened: state.workspaceOpened || action.step > 0,
      };
    }
    case 'open-workspace':
      return { step: Math.max(state.step, 1), workspaceOpened: true };
    case 'restart':
      return INITIAL_TOUR;
  }
}

/** The section to highlight while the tour is on `step`, or `null`. */
export function highlightedSection(step: number): string | null {
  return TOUR_STEPS[step]?.sectionId ?? null;
}
