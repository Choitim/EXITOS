import { describe, expect, it } from 'vitest';
import { nounFor, summarizeApproval } from '../src/lib/approval';
import { action, makePlan } from './fixtures';

describe('approval summary', () => {
  const plan = makePlan();

  it('counts what would be created per action kind and destination target', () => {
    const summary = summarizeApproval(plan);
    // The fixture's two Roadmap tasks merge into one row; the link fixture keeps the default scope.
    expect(summary.creates.map((r) => [r.noun, r.count, r.target])).toEqual([
      ['tasks', 2, 'Roadmap'],
      ['task', 1, 'Bugs'],
      ['link between tasks', 1, 'Roadmap'],
    ]);
    expect(summary.toWrite).toBe(4);
    expect(summary.toSkip).toBe(0);
  });

  it('merges actions of the same kind and target into one row', () => {
    const merged = summarizeApproval({
      ...plan,
      actions: [
        action('act_000000000001', { name: 'a' }),
        action('act_000000000002', { name: 'b' }),
        action('act_000000000003', { name: 'c' }),
      ].map((a) => ({ ...a, scope: 'clickup:list:901001' })),
    });
    expect(merged.creates).toHaveLength(1);
    expect(merged.creates[0]).toMatchObject({ count: 3, noun: 'tasks', target: 'Roadmap' });
  });

  it('counts skipped actions separately and does not count them as created', () => {
    const summary = summarizeApproval({
      ...plan,
      actions: [
        ...plan.actions,
        { ...action('act_000000000009', { name: 'present' }), disposition: 'skip' as const },
      ],
    });
    expect(summary.toWrite).toBe(4);
    expect(summary.toSkip).toBe(1);
  });

  it('reports the people who would be notified and the blocking errors, from the plan', () => {
    const summary = summarizeApproval(plan);
    expect(summary.notified).toBe(2);
    expect(summary.blockingErrors).toBe(1);
  });

  it('labels Docs as experimental', () => {
    const summary = summarizeApproval({
      ...plan,
      actions: [
        { ...action('act_000000000001', {}), kind: 'clickup.create_doc', scope: 'clickup:docs:1' },
        {
          ...action('act_000000000002', {}),
          kind: 'clickup.create_doc_page',
          scope: 'clickup:docs:1',
        },
      ],
    });
    expect(summary.creates.map((r) => [r.noun, r.experimental])).toEqual([
      ['Doc', true],
      ['Doc page', true],
    ]);
    expect(summary.unrecognisedKinds).toEqual([]);
  });

  it('withholds the "nothing is overwritten" claim for a kind it cannot describe', () => {
    const summary = summarizeApproval({
      ...plan,
      actions: [{ ...action('act_000000000001', {}), kind: 'clickup.update_task' }],
    });
    expect(summary.unrecognisedKinds).toEqual(['clickup.update_task']);
    expect(summary.creates[0]).toMatchObject({ noun: 'clickup.update_task', unrecognised: true });
  });

  it('pluralises nouns', () => {
    expect(nounFor('clickup.create_task', 1)).toBe('task');
    expect(nounFor('clickup.create_task', 2)).toBe('tasks');
    expect(nounFor('clickup.create_doc_page', 5)).toBe('Doc pages');
    expect(nounFor('mystery', 5)).toBe('mystery');
  });
});
