import type { DashboardState, MigrationPlan } from '@exitos/core/schema';
import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { Callout, Chip, Facts, OutcomeChip, Stat } from '../components/ui';
import { useReplay } from '../hooks/useReplay';
import { scrollToElement } from '../lib/browser';
import { describeVerification, formatNumber, pluralize } from '../lib/format';
import { OUTCOME_ORDER } from '../lib/outcomes';
import { buildReplay } from '../lib/replay';
import { describeSample } from '../lib/sample';
import {
  TOUR_PANEL_ID,
  TOUR_STEPS,
  canGoBack,
  canGoNext,
  type TourAction,
  type TourState,
} from '../lib/tour';
import { DemoButton } from './DemoButton';
import { ReplayPanel } from './ReplayPanel';

interface TourProps {
  state: DashboardState;
  plan: MigrationPlan;
  tour: TourState;
  dispatch: Dispatch<TourAction>;
}

function SectionLink({ id, children }: { id: string; children: string }) {
  return (
    <p>
      <a href={`#${id}`}>{children}</a>
    </p>
  );
}

// ---- the six step bodies ------------------------------------------------------------------------

function WorkspaceStep({ plan, tour, dispatch }: TourProps) {
  const sample = useMemo(() => describeSample(plan), [plan]);
  return (
    <div className="space-y-4">
      <p>
        <strong data-testid="sample-count">1 sample workspace available.</strong> This demo contains
        exactly one synthetic Notion workspace; there are no others to choose from.
      </p>
      <div className="card space-y-3" data-testid="sample-card" aria-label="Sample workspace">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="card-title">{sample.name}</h4>
          <Chip tone="warn" icon="info">
            synthetic
          </Chip>
          {tour.workspaceOpened ? (
            <Chip tone="ok" icon="check">
              opened
            </Chip>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          A {sample.systemLabel} workspace, read through the <code>{sample.connector}</code>{' '}
          connector.
        </p>
        <div>
          <p className="mb-1 text-sm font-semibold">
            Collections ({formatNumber(sample.collections.length)})
          </p>
          <ul className="space-y-0.5" data-testid="sample-collections">
            {sample.collections.map((collection) => (
              <li key={collection.name}>
                {collection.name}:{' '}
                <span className="font-semibold tabular-nums">{formatNumber(collection.rows)}</span>{' '}
                {collection.rows === 1 ? 'row' : 'rows'}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Pages ({formatNumber(sample.pages.length)})</p>
          {sample.pages.length === 0 ? (
            <p className="text-sm text-muted">No pages are selected in this sample.</p>
          ) : (
            <ul className="space-y-0.5" data-testid="sample-pages">
              {sample.pages.map((page) => (
                <li key={page.name}>
                  {page.name}
                  {page.withChildPages ? ' (with its child pages)' : ''}
                </li>
              ))}
            </ul>
          )}
          {sample.pages.length > 0 && sample.experimentalDocs ? (
            <p className="mt-1">
              <Chip
                tone="warn"
                icon="warning"
                className="chip-wrap"
                title="Moving pages to ClickUp Docs is experimental."
              >
                experimental: pages become ClickUp Docs
              </Chip>
            </p>
          ) : null}
        </div>
        <DemoButton
          primary
          onClick={() => {
            dispatch({ type: 'open-workspace' });
          }}
          testId="tour-open-sample"
        >
          Open this sample workspace
        </DemoButton>
      </div>
    </div>
  );
}

function SourceStep({ plan }: TourProps) {
  const sample = useMemo(() => describeSample(plan), [plan]);
  const { users, destination } = plan;
  return (
    <div className="space-y-3">
      <p>
        Read the <strong>Source and destination</strong> section: what ExitOS reads from Notion
        (only ever read), the ClickUp targets it would write to, and how people are matched.
      </p>
      <Facts
        rows={[
          ['Source', `${sample.name} (${sample.systemLabel}, read-only)`],
          ['Destination', `${destination.workspace.name} (ClickUp)`],
          [
            'Collections',
            `${pluralize(sample.collections.length, 'collection')}, ${pluralize(sample.totalRows, 'row')} in total`,
          ],
          [
            'People',
            `${formatNumber(users.mapped.length)} mapped, ${formatNumber(users.unmapped.length)} not mapped`,
          ],
        ]}
      />
      <SectionLink id="source-destination">Go to Source and destination</SectionLink>
    </div>
  );
}

function CompatibilityStep({ plan }: TourProps) {
  const { items } = plan.summary;
  return (
    <div className="space-y-3">
      <p>
        Before anything is written, every item is sorted by what happens to it. Nothing is silently
        dropped: what changes shape, needs review or cannot move is listed.
      </p>
      <ul className="flex flex-wrap gap-3" data-testid="tour-outcomes">
        {OUTCOME_ORDER.map((outcome) => (
          <li key={outcome} className="inline-flex items-center gap-1.5 text-sm">
            <OutcomeChip outcome={outcome} />
            <span className="font-semibold tabular-nums">{formatNumber(items[outcome])}</span>
          </li>
        ))}
      </ul>
      <SectionLink id="compatibility">Go to Compatibility</SectionLink>
    </div>
  );
}

function MappingStep({ plan }: TourProps) {
  const { fields } = plan.summary;
  return (
    <div className="space-y-3">
      <p>
        The <strong>Mapping preview</strong> shows, collection by collection, where each Notion
        property would go in ClickUp and how faithfully.
      </p>
      <p data-testid="tour-mapping-facts">
        {pluralize(plan.mappings.length, 'field mapping')} across{' '}
        {pluralize(plan.collections.length, 'collection')}: {formatNumber(fields.supported)}{' '}
        preserved, {formatNumber(fields.transformed)} transformed, {formatNumber(fields.lossy)}{' '}
        require review, {formatNumber(fields.unsupported)} unsupported.
      </p>
      <SectionLink id="mapping">Go to Mapping preview</SectionLink>
    </div>
  );
}

function VerificationStep({ state }: TourProps) {
  const { verification } = state;
  if (verification === null) {
    return (
      <div className="space-y-3">
        <p>
          The recording has no verification result, so there is nothing to review. Without a passed
          verification a migration is not described as verified.
        </p>
        <SectionLink id="verification">Go to Verification</SectionLink>
      </div>
    );
  }
  const verdict = describeVerification(verification);
  const { counts } = verification;
  return (
    <div className="space-y-3">
      <p>
        Verification compares what the destination holds with the plan. This is the result that was
        recorded for the run you replayed:
      </p>
      <div data-testid="tour-verification-result" data-status={verification.status}>
        <Callout tone={verdict.tone} title={`Recorded result: ${verdict.label}`}>
          <p>{verdict.summary}</p>
          <dl className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
            <Stat label="Verified" value={formatNumber(counts.verified)} />
            <Stat label="Mismatched" value={formatNumber(counts.mismatched)} />
            <Stat label="Missing" value={formatNumber(counts.missing)} />
            <Stat label="Not verified" value={formatNumber(counts.unverified)} />
          </dl>
        </Callout>
      </div>
      <p className="text-sm text-muted">
        Verified means: within the declared scope below, the destination matched the plan. It is not
        a claim that nothing was lost; what did not move is listed under Unsupported.
      </p>
      <SectionLink id="verification">Go to Verification</SectionLink>
    </div>
  );
}

// ---- the tour ---------------------------------------------------------------------------------

/**
 * The guided tour: a panel (step list and the current step's content) followed by a control bar.
 * The bar is sticky at the top AND the bottom of the viewport, so Back and Next stay on screen
 * while the tour scrolls the real dashboard sections into view. It is rendered as a fragment so
 * the bar's containing block is the whole page body.
 */
export function GuidedTour(props: TourProps) {
  const { state, tour, dispatch } = props;
  const headingId = useId();
  const stepHeadingId = useId();
  const step = TOUR_STEPS[tour.step] ?? TOUR_STEPS[0];
  const timeline = useMemo(() => buildReplay(state), [state]);
  const replay = useReplay(timeline);
  const barRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const previousStep = useRef(tour.step);
  const [announcement, setAnnouncement] = useState('');

  // When the step changes (not on first render): announce it and move the page to what it is about.
  useEffect(() => {
    if (previousStep.current === tour.step) return;
    previousStep.current = tour.step;
    if (step === undefined) return;
    setAnnouncement(`Step ${tour.step + 1} of ${TOUR_STEPS.length}: ${step.title}. ${step.hint}`);
    scrollToElement(step.target, { belowTourBar: step.target !== TOUR_PANEL_ID });
    // A button inside the step (Open this sample workspace) disappears with the step and takes the
    // keyboard focus with it: hand the focus to Next, which is on screen and is what comes next.
    const active = document.activeElement;
    if (active === null || active === document.body)
      nextRef.current?.focus({ preventScroll: true });
  }, [tour.step, step]);

  // Publish the bar's height so scroll targets stop below it (like --header-h for the header).
  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) return;
    const root = document.documentElement;
    const publish = (): void => {
      root.style.setProperty('--tour-h', `${bar.offsetHeight}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--tour-h');
    };
  }, []);

  if (step === undefined) return null;
  const position = `Step ${tour.step + 1} of ${TOUR_STEPS.length}`;
  const body = ((): ReactNode => {
    switch (step.id) {
      case 'workspace':
        return <WorkspaceStep {...props} />;
      case 'source':
        return <SourceStep {...props} />;
      case 'compatibility':
        return <CompatibilityStep {...props} />;
      case 'mapping':
        return <MappingStep {...props} />;
      case 'simulate':
        return (
          <ReplayPanel timeline={timeline} replay={replay} verification={state.verification} />
        );
      case 'verification':
        return <VerificationStep {...props} />;
    }
  })();

  return (
    <>
      <section
        id={TOUR_PANEL_ID}
        aria-labelledby={headingId}
        className="tour-panel card"
        data-testid="tour"
        data-step={step.id}
      >
        <header className="mb-4">
          <p className="mb-1">
            <Chip tone="info" icon="flag">
              Guided tour · {TOUR_STEPS.length} steps
            </Chip>
          </p>
          <h2 id={headingId} className="text-xl font-bold tracking-tight sm:text-2xl">
            Take the guided tour
          </h2>
          <p className="mt-1 max-w-3xl text-muted">
            Six steps through the real dashboard below, in the order ExitOS works: inspect, plan,
            approve, apply, verify. The tour only scrolls to and highlights the sections; they stay
            on the page, and you can read them in any order.
          </p>
        </header>

        <ol className="tour-steps" aria-label="Tour steps" data-testid="tour-steps">
          {TOUR_STEPS.map((item, index) => (
            <li
              key={item.id}
              className="tour-step"
              aria-current={index === tour.step ? 'step' : undefined}
              data-testid="tour-step"
            >
              <button
                type="button"
                className="tour-step-button"
                onClick={() => {
                  dispatch({ type: 'goto', step: index });
                }}
              >
                <span className="tour-step-marker" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  {item.title}
                  {index === tour.step ? <span className="sr-only"> (current step)</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div
          className="tour-step-body"
          role="group"
          aria-labelledby={stepHeadingId}
          data-testid="tour-step-body"
        >
          <h3
            id={stepHeadingId}
            className="mb-3 text-lg font-semibold"
            data-testid="tour-step-title"
          >
            {position}: {step.title}
          </h3>
          {body}
        </div>
      </section>

      <div
        ref={barRef}
        className="tour-bar"
        role="group"
        aria-label="Tour controls"
        data-testid="tour-bar"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug" data-testid="tour-position">
            {position} · {step.title}
          </p>
          <p className="hidden text-xs text-muted sm:block">{step.hint}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <DemoButton
            unavailable={!canGoBack(tour)}
            onClick={() => {
              dispatch({ type: 'back' });
            }}
            testId="tour-back"
          >
            Back
          </DemoButton>
          <DemoButton
            primary
            buttonRef={nextRef}
            unavailable={!canGoNext(tour)}
            onClick={() => {
              dispatch({ type: 'next' });
            }}
            testId="tour-next"
          >
            Next
          </DemoButton>
        </div>
        {/* Announces each step change; the visible text above is not a live region. */}
        <p role="status" className="sr-only" data-testid="tour-announcer">
          {announcement}
        </p>
      </div>
    </>
  );
}
