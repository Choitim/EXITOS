import { describe, expect, it } from 'vitest';
import { deriveStages, type StageId } from '../src/lib/stages';
import { counts, makePlan, makeRun, makeVerification } from './fixtures';

const plan = makePlan();
const cleanPlan = { ...plan, summary: { ...plan.summary, blockingErrors: 0 } };

const statuses = (t: ReturnType<typeof deriveStages>): Record<StageId, string> =>
  Object.fromEntries(t.stages.map((s) => [s.id, s.status])) as Record<StageId, string>;

describe('stage tracker', () => {
  it('always lists the five stages in order, with exactly one current', () => {
    const cases = [
      deriveStages({ plan: cleanPlan, run: null, verification: null }),
      deriveStages({ plan: cleanPlan, run: makeRun({ status: 'applying' }), verification: null }),
      deriveStages({ plan: cleanPlan, run: makeRun({ status: 'verified' }), verification: null }),
      deriveStages({ plan: cleanPlan, run: makeRun({ status: 'failed' }), verification: null }),
    ];
    for (const tracker of cases) {
      expect(tracker.stages.map((s) => s.id)).toEqual([
        'inspect',
        'plan',
        'approve',
        'apply',
        'verify',
      ]);
      expect(tracker.stages.map((s) => s.label)).toEqual([
        'Inspect',
        'Plan',
        'Approve',
        'Apply',
        'Verify',
      ]);
      expect(tracker.stages.filter((s) => s.status === 'current')).toHaveLength(1);
      expect(tracker.current.status).toBe('current');
      // done stages are always a prefix: nothing after the current stage is done
      const order = tracker.stages.map((s) => s.status);
      const firstNotDone = order.findIndex((s) => s !== 'done');
      expect(order.slice(firstNotDone).every((s) => s !== 'done')).toBe(true);
    }
  });

  it('plan only: waiting for approval, honestly', () => {
    const t = deriveStages({ plan: cleanPlan, run: null, verification: null });
    expect(t.phase).toBe('planned');
    expect(statuses(t)).toEqual({
      inspect: 'done',
      plan: 'done',
      approve: 'current',
      apply: 'upcoming',
      verify: 'upcoming',
    });
    expect(t.current).toMatchObject({ id: 'approve', result: 'waiting' });
    expect(t.current.headline).toBe('Waiting for approval');
    expect(t.current.detail).toContain('no run');
    expect(t.summary).toBe('Current stage: Approve. Waiting for approval.');
  });

  it('plan with blocking errors: the approve stage is blocked and says why', () => {
    const t = deriveStages({ plan, run: null, verification: null });
    expect(t.phase).toBe('blocked');
    expect(t.current).toMatchObject({ id: 'approve', result: 'attention' });
    expect(t.current.detail).toContain('1 blocking error');
  });

  it('inspect and plan details come from the plan', () => {
    const t = deriveStages({ plan: cleanPlan, run: null, verification: null });
    expect(t.stages[0]?.detail).toBe('2 collections and 158 rows read from the source.');
    expect(t.stages[1]?.detail).toBe('4 actions planned.');
  });

  it('approved: apply is the current stage but nothing has started', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'approved', counts: counts({ pending: 4 }) }),
      verification: null,
    });
    expect(t.phase).toBe('approved');
    expect(statuses(t)).toMatchObject({ approve: 'done', apply: 'current', verify: 'upcoming' });
    expect(t.current).toMatchObject({ id: 'apply', result: 'waiting' });
    expect(t.current.detail).toBe('0 of 4 actions written or skipped.');
  });

  it('applying: shows real progress, and flags trouble without calling the run failed', () => {
    const run = makeRun({ status: 'applying', counts: counts({ pending: 1, succeeded: 3 }) });
    const t = deriveStages({ plan: cleanPlan, run, verification: null });
    expect(t.phase).toBe('applying');
    expect(t.current).toMatchObject({ id: 'apply', result: 'active', headline: 'Applying' });
    expect(t.current.detail).toBe('3 of 4 actions written or skipped.');

    const troubled = deriveStages({
      plan: cleanPlan,
      run: makeRun({
        status: 'applying',
        counts: counts({ pending: 1, succeeded: 1, failed: 1, blocked: 1 }),
      }),
      verification: null,
    });
    expect(troubled.current.result).toBe('attention');
    expect(troubled.current.detail).toBe('1 of 4 actions written or skipped; 1 failed, 1 blocked.');
  });

  it('applied: waiting for verification, not verified', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'applied', counts: counts({ succeeded: 4 }) }),
      verification: null,
    });
    expect(t.phase).toBe('applied');
    expect(statuses(t)).toMatchObject({ apply: 'done', verify: 'current' });
    expect(t.current).toMatchObject({ id: 'verify', result: 'waiting' });
    expect(t.current.headline).toBe('Waiting for verification');
    expect(t.stages[3]?.detail).toBe('4 written.');
  });

  it('applied with an incomplete verification: needs attention, still not verified', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'applied' }),
      verification: makeVerification({
        status: 'incomplete',
        counts: { verified: 3, mismatched: 0, missing: 0, unverified: 1 },
      }),
    });
    expect(t.phase).toBe('verification_incomplete');
    expect(t.current).toMatchObject({ id: 'verify', result: 'attention' });
    expect(t.current.detail).toBe('1 item could not be checked.');
  });

  it('verifying: verify is active', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'verifying' }),
      verification: null,
    });
    expect(t.phase).toBe('verifying');
    expect(t.current).toMatchObject({ id: 'verify', result: 'active' });
  });

  it('verified: all earlier stages are done and the last one carries the Verified result', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'verified', counts: counts({ succeeded: 4 }) }),
      verification: makeVerification({
        status: 'passed',
        counts: { verified: 4, mismatched: 0, missing: 0, unverified: 0 },
      }),
    });
    expect(t.phase).toBe('verified');
    expect(statuses(t)).toEqual({
      inspect: 'done',
      plan: 'done',
      approve: 'done',
      apply: 'done',
      verify: 'current',
    });
    expect(t.current).toMatchObject({ id: 'verify', result: 'verified', headline: 'Verified' });
    expect(t.current.detail).toBe('4 items matched the plan, within the declared scope.');
    expect(t.summary).toContain('All five stages are done');
    expect(t.summary).not.toMatch(/\bcomplete(d)?\b/i);
  });

  it('failed run: apply is where it stopped and it is marked Failed, verify has not started', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({
        status: 'failed',
        counts: counts({ succeeded: 2, failed: 1, blocked: 1 }),
        stopReason: 'Stopped after 5 consecutive failures.',
      }),
      verification: null,
    });
    expect(t.phase).toBe('failed');
    expect(statuses(t)).toMatchObject({ apply: 'current', verify: 'upcoming' });
    expect(t.current).toMatchObject({ id: 'apply', result: 'failed', headline: 'Failed' });
    expect(t.current.detail).toContain('2 of 4 actions written or skipped; 1 failed, 1 blocked.');
    expect(t.current.detail).toContain('Stopped after 5 consecutive failures.');
  });

  it('stopped run: needs attention rather than Failed', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'stopped', counts: counts({ succeeded: 2, pending: 2 }) }),
      verification: null,
    });
    expect(t.phase).toBe('stopped');
    expect(t.current).toMatchObject({
      id: 'apply',
      result: 'attention',
      headline: 'Stopped early',
    });
  });

  it('verification failed: apply is done, verify is Failed with the counts from the verification', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'verification_failed' }),
      verification: makeVerification(),
    });
    expect(t.phase).toBe('verification_failed');
    expect(statuses(t)).toMatchObject({ apply: 'done', verify: 'current' });
    expect(t.current).toMatchObject({ id: 'verify', result: 'failed' });
    expect(t.current.detail).toBe(
      '1 item differs from the plan and 1 item is missing in the destination.',
    );
  });

  it('verification failed without a stored verification still says so', () => {
    const t = deriveStages({
      plan: cleanPlan,
      run: makeRun({ status: 'verification_failed' }),
      verification: null,
    });
    expect(t.current.result).toBe('failed');
  });
});
