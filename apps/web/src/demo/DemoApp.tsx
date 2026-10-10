import { useMemo, useReducer } from 'react';
import { DashboardView, type DemoFrame } from '../App';
import { InertLinksContext } from '../hooks/InertLinks';
import { TourHighlightContext, type TourHighlight } from '../hooks/TourContext';
import { useStaticDemoState } from '../hooks/useStaticDemoState';
import { INITIAL_TOUR, TOUR_STEPS, highlightedSection, tourReducer } from '../lib/tour';
import { DemoBanner } from './DemoBanner';
import { DemoError, DemoLoading, RECORDING_WORDING, StaticDemoBadge } from './DemoStatus';
import { GuidedTour } from './GuidedTour';
import { RunItForReal } from './RunItForReal';

/**
 * The static online demo: the normal dashboard, fed by one recorded file instead of a local
 * server, with the DEMO notice, the guided tour and the "Run it for real" panel around it.
 * It never talks to Notion, ClickUp or any API.
 */
export function DemoApp() {
  const store = useStaticDemoState();
  const { state } = store;
  const plan = state?.plan ?? null;
  const [tour, dispatch] = useReducer(tourReducer, INITIAL_TOUR);

  const highlight = useMemo<TourHighlight | null>(() => {
    const sectionId = highlightedSection(tour.step);
    return sectionId === null
      ? null
      : { sectionId, label: `Guided tour · step ${tour.step + 1} of ${TOUR_STEPS.length}` };
  }, [tour.step]);

  const demo = useMemo<DemoFrame>(
    () => ({
      badge: <StaticDemoBadge />,
      subtitle: 'online demo',
      loading: <DemoLoading />,
      error: (message, onRetry, busy) => (
        <DemoError message={message} onRetry={onRetry} busy={busy} />
      ),
      recording: RECORDING_WORDING,
      before: (
        <>
          <DemoBanner />
          {state !== null && plan !== null ? (
            <GuidedTour state={state} plan={plan} tour={tour} dispatch={dispatch} />
          ) : null}
        </>
      ),
      after: <RunItForReal />,
      footer: (
        <>
          ExitOS online demo · static page, read-only · it replays one recorded file
          (demo-state.json) and never contacts Notion, ClickUp or any other service.
          {state ? <> Recorded with ExitOS {state.exitosVersion}.</> : null}
        </>
      ),
    }),
    [state, plan, tour],
  );

  return (
    <InertLinksContext.Provider value={true}>
      <TourHighlightContext.Provider value={highlight}>
        <DashboardView store={store} demo={demo} />
      </TourHighlightContext.Provider>
    </InertLinksContext.Provider>
  );
}
