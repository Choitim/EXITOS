import { describe, expect, it } from 'vitest';
import { describeSample } from '../src/lib/sample';
import {
  INITIAL_TOUR,
  LAST_STEP,
  TOUR_PANEL_ID,
  TOUR_STEPS,
  canGoBack,
  canGoNext,
  highlightedSection,
  tourReducer,
  type TourAction,
  type TourState,
} from '../src/lib/tour';
import { makePlan } from './fixtures';

const run = (actions: TourAction[], from: TourState = INITIAL_TOUR): TourState =>
  actions.reduce(tourReducer, from);

describe('tour steps', () => {
  it('are exactly the six the demo promises, in order', () => {
    expect(TOUR_STEPS.map((s) => s.title)).toEqual([
      'Select a sample Notion workspace',
      'Inspect the source',
      'Preview compatibility',
      'View the migration mapping',
      'Simulate the migration',
      'Review the verification report',
    ]);
    expect(TOUR_STEPS).toHaveLength(6);
    expect(LAST_STEP).toBe(5);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(6);
  });

  it('point at the dashboard sections the brief names (or at the tour panel itself)', () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual([
      TOUR_PANEL_ID,
      'source-destination',
      'compatibility',
      'mapping',
      TOUR_PANEL_ID,
      'verification',
    ]);
  });

  it('only highlight a section for the steps that point at one', () => {
    expect(TOUR_STEPS.map((_s, i) => highlightedSection(i))).toEqual([
      null,
      'source-destination',
      'compatibility',
      'mapping',
      null,
      'verification',
    ]);
    expect(highlightedSection(-1)).toBeNull();
    expect(highlightedSection(99)).toBeNull();
  });

  it('every step has a one-line hint', () => {
    for (const step of TOUR_STEPS) expect(step.hint.length).toBeGreaterThan(10);
  });
});

describe('tour state machine', () => {
  it('starts on step one, nothing opened', () => {
    expect(INITIAL_TOUR).toEqual({ step: 0, workspaceOpened: false });
    expect(canGoBack(INITIAL_TOUR)).toBe(false);
    expect(canGoNext(INITIAL_TOUR)).toBe(true);
  });

  it('walks forward and back one step at a time', () => {
    let state = INITIAL_TOUR;
    const visited = [state.step];
    for (let i = 0; i < LAST_STEP; i += 1) {
      state = tourReducer(state, { type: 'next' });
      visited.push(state.step);
    }
    expect(visited).toEqual([0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < LAST_STEP; i += 1) {
      state = tourReducer(state, { type: 'back' });
      visited.push(state.step);
    }
    expect(visited.slice(6)).toEqual([4, 3, 2, 1, 0]);
  });

  it('stops at both ends', () => {
    expect(run([{ type: 'back' }]).step).toBe(0);
    expect(run([{ type: 'back' }, { type: 'back' }])).toEqual(INITIAL_TOUR);
    const end = run(Array.from({ length: 20 }, (): TourAction => ({ type: 'next' })));
    expect(end.step).toBe(LAST_STEP);
    expect(canGoNext(end)).toBe(false);
    expect(canGoBack(end)).toBe(true);
    expect(tourReducer(end, { type: 'next' })).toBe(end);
  });

  it('opening the one sample workspace marks it opened and moves on to step two', () => {
    expect(tourReducer(INITIAL_TOUR, { type: 'open-workspace' })).toEqual({
      step: 1,
      workspaceOpened: true,
    });
  });

  it('moving on from step one counts as choosing the only sample', () => {
    expect(tourReducer(INITIAL_TOUR, { type: 'next' })).toEqual({ step: 1, workspaceOpened: true });
  });

  it('opening the sample again later does not move the tour backwards', () => {
    const state = run([{ type: 'goto', step: 3 }, { type: 'open-workspace' }]);
    expect(state.step).toBe(3);
    expect(state.workspaceOpened).toBe(true);
  });

  it('jumps to a step from the list, and ignores steps that do not exist', () => {
    expect(run([{ type: 'goto', step: 4 }]).step).toBe(4);
    for (const bad of [-1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tourReducer(INITIAL_TOUR, { type: 'goto', step: bad })).toBe(INITIAL_TOUR);
    }
    const same = run([{ type: 'goto', step: 2 }]);
    expect(tourReducer(same, { type: 'goto', step: 2 })).toBe(same);
  });

  it('restarts from the beginning', () => {
    expect(run([{ type: 'goto', step: 5 }, { type: 'restart' }])).toEqual(INITIAL_TOUR);
  });

  it('is a pure function: it never changes the state it is given', () => {
    const frozen = Object.freeze({ step: 2, workspaceOpened: true });
    expect(tourReducer(frozen, { type: 'next' })).toEqual({ step: 3, workspaceOpened: true });
    expect(frozen).toEqual({ step: 2, workspaceOpened: true });
  });
});

describe('describeSample', () => {
  it('reads the sample from the plan and adds nothing', () => {
    const plan = makePlan();
    const sample = describeSample(plan);
    expect(sample.name).toBe('Acme (synthetic)');
    expect(sample.systemLabel).toBe('Notion');
    expect(sample.connector).toBe('notion@0.1.0');
    expect(sample.collections).toEqual([
      { name: 'Product Roadmap', rows: 28 },
      { name: 'Bug Tracker', rows: 130 },
    ]);
    expect(sample.totalRows).toBe(158);
    expect(sample.pages).toEqual([]);
    expect(sample.experimentalDocs).toBe(true);
  });

  it('lists the selected pages and ignores malformed entries', () => {
    const plan = makePlan();
    plan.source.selection = {
      type: 'notion',
      pages: [
        { id: 'a', name: 'Engineering Handbook', includeChildPages: true },
        { id: 'b', name: 'Flat page' },
        { id: 'c' },
        'oops',
        null,
      ],
    };
    expect(describeSample(plan).pages).toEqual([
      { name: 'Engineering Handbook', withChildPages: true },
      { name: 'Flat page', withChildPages: false },
    ]);
    plan.source.selection = { type: 'notion', pages: 'not a list' };
    expect(describeSample(plan).pages).toEqual([]);
  });
});
