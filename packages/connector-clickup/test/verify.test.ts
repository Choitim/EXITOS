import { describe, expect, it } from 'vitest';
import { adaObj, block, notionFixture, rowId, uid, world } from './harness.js';

const applied = async (
  n = 4,
  rows?: Parameters<typeof notionFixture>[0],
  blocks?: Parameters<typeof notionFixture>[1],
) => {
  const w = world({
    notion: notionFixture(
      rows ??
        Array.from({ length: n }, (_, i) => ({
          n: i + 1,
          status: 'In progress',
          priority: 'High',
          tags: ['frontend'],
          points: i + 1,
          owner: [adaObj()],
        })),
      blocks,
    ),
  });
  const plan = await w.plan();
  const run = w.approve(plan);
  await w.run(plan, run.runId);
  return { w, plan, run };
};

describe('verification', () => {
  it('passes when ClickUp matches the plan, and only then is the run "verified"', async () => {
    const { w, plan, run } = await applied();
    expect(w.store.getRun(run.runId)?.status).toBe('applied');
    expect(w.report(plan, run.runId).state).toBe('applied_unverified');
    const v = await w.verify(plan, run.runId);
    expect(v.status).toBe('passed');
    expect(v.counts).toEqual({ verified: 4, mismatched: 0, missing: 0, unverified: 0 });
    expect(v.scope).toMatch(/NOT verified: comments, attachments/);
    expect(w.store.getRun(run.runId)?.status).toBe('verified');
    const report = w.report(plan, run.runId);
    expect(report.state).toBe('verified');
    expect(report.headline).toMatch(/^VERIFIED/);
  });

  it('classifies a changed task as MISMATCHED, naming the field', async () => {
    const { w, plan, run } = await applied();
    const task = w.clickup.state.tasks[1]!;
    task.name = 'Renamed behind our back';
    task.status = 'complete';
    task.assignees = [];
    const v = await w.verify(plan, run.runId);
    expect(v.status).toBe('failed');
    const item = v.items.find((i) => i.destinationId === task.id)!;
    expect(item.status).toBe('mismatched');
    expect(
      item.checks
        .filter((c) => c.status === 'mismatched')
        .map((c) => c.field)
        .sort(),
    ).toEqual(['assignees', 'name', 'status']);
    expect(v.counts).toMatchObject({ verified: 3, mismatched: 1, missing: 0 });
    expect(w.store.getRun(run.runId)?.status).toBe('verification_failed');
    expect(w.report(plan, run.runId).headline).toMatch(/VERIFICATION FAILED.*NOT complete/);
  });

  it('classifies a deleted task as MISSING', async () => {
    const { w, plan, run } = await applied();
    w.clickup.state.tasks.splice(2, 1);
    const v = await w.verify(plan, run.runId);
    expect(v.counts).toMatchObject({ verified: 3, missing: 1, mismatched: 0 });
    expect(v.items.find((i) => i.status === 'missing')?.checks[0]?.field).toBe('existence');
    expect(v.targets[0]).toMatchObject({ expected: 4, found: 3 });
  });

  it('detects description edits (full text comparison)', async () => {
    const { w, plan, run } = await applied(2, [{ n: 1, notes: 'original' }, { n: 2 }], {
      [rowId(1)]: [block.paragraph(uid('p'), rowId(1), [])],
    });
    w.clickup.state.tasks[0]!.markdown_description += '\n\nSomeone added a line';
    const v = await w.verify(plan, run.runId);
    const d = v.items
      .flatMap((i) => i.checks)
      .find((c) => c.field === 'description' && c.status === 'mismatched');
    expect(d).toBeDefined();
    expect(d?.actual).toContain('Someone added a line');
    expect(d?.expected).toContain('end of text');
  });

  it('tolerates cosmetic whitespace differences but not content differences', async () => {
    const { w, plan, run } = await applied(1);
    const t = w.clickup.state.tasks[0]!;
    t.markdown_description = t.markdown_description.replace(/\n/g, '  \r\n') + '\n\n\n';
    expect((await w.verify(plan, run.runId)).status).toBe('passed');
  });

  it('a link that is gone is a mismatch', async () => {
    const { w, plan, run } = await applied(2, [{ n: 1 }, { n: 2, deps: [1] }]);
    for (const t of w.clickup.state.tasks) t.links = [];
    const v = await w.verify(plan, run.runId);
    expect(v.items.find((i) => i.checks.some((c) => c.field === 'link'))?.status).toBe(
      'mismatched',
    );
    expect(v.status).toBe('failed');
  });

  it('date-only values are compared as calendar days in the configured zone', async () => {
    const { w, plan, run } = await applied(1, [{ n: 1, due: ['2026-09-15', null, null] }]);
    const t = w.clickup.state.tasks[0]!;
    t.due_date = String(Number(t.due_date) + 3 * 3_600_000); // re-based by a few hours, same day
    expect((await w.verify(plan, run.runId)).status).toBe('passed');
    t.due_date = String(Number(t.due_date) + 48 * 3_600_000); // different day
    expect(
      (await w.verify(plan, run.runId)).items[0]?.checks.find((c) => c.field === 'due_date')
        ?.status,
    ).toBe('mismatched');
  });

  it('reports "unverified" (never "verified") when ClickUp does not return what is needed to check', async () => {
    const { w, plan, run } = await applied(2);
    w.clickup.behavior.omitDescriptions = true;
    const v = await w.verify(plan, run.runId);
    expect(v.counts).toMatchObject({ verified: 0, unverified: 2, mismatched: 0, missing: 0 });
    expect(v.status).toBe('incomplete');
    expect(w.store.getRun(run.runId)?.status).toBe('applied'); // not "verified"
    const report = w.report(plan, run.runId);
    expect(report.state).toBe('applied_unverified');
    expect(report.headline).toMatch(/NOT VERIFIED/);
  });

  it('verifying an interrupted run reports what is missing and leaves the run status alone', async () => {
    const w = world({ notion: notionFixture(Array.from({ length: 6 }, (_, i) => ({ n: i + 1 }))) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await w.run(plan, run.runId, { concurrency: 1, interruptAfter: 2 }).catch(() => undefined);
    const v = await w.verify(plan, run.runId);
    expect(v.counts.missing).toBe(4);
    expect(v.counts.verified).toBe(2);
    expect(w.store.getRun(run.runId)?.status).toBe('applying');
    expect(w.report(plan, run.runId).state).toBe('in_progress');
  });

  it('keeps counts honest when some items were skipped as already present', async () => {
    const { w } = await applied(3);
    const again = await w.plan();
    const run = w.approve(again);
    await w.run(again, run.runId);
    const v = await w.verify(again, run.runId);
    expect(v.status).toBe('passed');
    expect(v.counts.verified).toBe(3);
  });
});
