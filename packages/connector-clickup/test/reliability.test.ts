import { SimulatedInterruptError } from '@exitos/shared';
import { SqliteStateStore } from '@exitos/core';
import { describe, expect, it } from 'vitest';
import { basicClickUpState } from '../src/testing/index.js';
import { defaultConfigYaml, notionFixture, world, type World } from './harness.js';

const rows = (n: number, extra: Partial<Parameters<typeof notionFixture>[0][number]> = {}) =>
  Array.from({ length: n }, (_, i) => ({ n: i + 1, status: 'In progress', ...extra }));

const isCreate = (r: { method: string; path: string }): boolean =>
  r.method === 'POST' && /\/list\/\d+\/task$/.test(r.path);
const created = (w: World): number => w.clickup.requests.filter(isCreate).length;

describe('dry run makes zero write requests (proved with request spies)', () => {
  it('plan: no write to Notion, none to ClickUp, none even attempted', async () => {
    const w = world({ notion: notionFixture(rows(40)) });
    await w.plan();
    expect(w.sourceRecorder.writes).toHaveLength(0);
    expect(w.sourceRecorder.blocked).toHaveLength(0);
    expect(w.readRecorder.writes).toHaveLength(0);
    expect(w.readRecorder.blocked).toHaveLength(0);
    expect(
      w.notion.requests.every(
        (r) => r.method === 'GET' || r.path === '/v1/search' || r.path.endsWith('/query'),
      ),
    ).toBe(true);
    expect(w.clickup.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(w.clickup.state.tasks).toHaveLength(0);
    expect(w.clickup.requests.length).toBeGreaterThan(0); // it DID read the destination metadata
  });

  it('verify and report are also read-only', async () => {
    const w = world({ notion: notionFixture(rows(5)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await w.run(plan, run.runId);
    w.readRecorder.clear();
    const before = w.clickup.requests.length;
    await w.verify(plan, run.runId);
    w.report(plan, run.runId);
    expect(w.readRecorder.writes).toHaveLength(0);
    expect(w.clickup.requests.slice(before).every((r) => r.method === 'GET')).toBe(true);
  });

  it('the read-only destination connection cannot be coerced into writing', async () => {
    const w = world({ notion: notionFixture(rows(2)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    // Deliberately run apply with the READ-ONLY destination: every write must be refused.
    const result = await w.run(plan, run.runId, {
      destination: w.destRO,
      maxConsecutiveFailures: 1,
    });
    expect(result.status).not.toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(0);
    expect(w.readRecorder.blocked.length).toBeGreaterThan(0);
  });
});

describe('apply', () => {
  it('creates every task once, links them, and records the id mapping', async () => {
    const w = world({
      notion: notionFixture([{ n: 1 }, { n: 2, deps: [1] }, { n: 3, deps: [1, 2] }]),
    });
    const plan = await w.plan();
    const run = w.approve(plan);
    expect((await w.run(plan, run.runId)).status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(3);
    const [t1, t2, t3] = w.clickup.state.tasks;
    expect(new Set(t1?.links)).toEqual(new Set([t2?.id, t3?.id]));
    expect(w.store.listMappings().filter((m) => m.scope === 'clickup:list:901001')).toHaveLength(3);
    expect(w.writeRecorder.writes.every((r) => r.class === 'write')).toBe(true);
  });

  it('never deletes, updates or moves anything', async () => {
    const w = world({ notion: notionFixture(rows(6, { deps: [] })) });
    const plan = await w.plan();
    await w.run(plan, w.approve(plan).runId);
    const methods = new Set(
      w.clickup.requests.filter((r) => r.method !== 'GET').map((r) => r.method),
    );
    expect([...methods]).toEqual(['POST']);
    expect(w.notion.requests.some((r) => ['PATCH', 'PUT', 'DELETE'].includes(r.method))).toBe(
      false,
    );
  });

  it('is rejected without approval, and never starts', async () => {
    const w = world({ notion: notionFixture(rows(2)) });
    const plan = await w.plan();
    expect(() => w.approve({ ...plan, planId: 'plan_000000000000' })).toThrow();
    expect(created(w)).toBe(0);
  });
});

describe('rate limits (ClickUp: 100/min per token)', () => {
  it('pacing keeps a 130-task migration under the limit with zero 429s', async () => {
    const w = world({ notion: notionFixture(rows(130)), rateLimitPerMinute: 100 });
    const plan = await w.plan();
    const result = await w.run(plan, w.approve(plan).runId, { concurrency: 4 });
    expect(result.status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(130);
    expect(w.clickup.requests.filter((r) => r.method === 'POST')).toHaveLength(130);
    expect(w.logger.lines.filter((l) => /429|rate/i.test(l.message))).toHaveLength(0);
    expect(w.clock.slept).toBeGreaterThan(0); // pacing happened (virtual time)
  });

  it('recovers from 429 responses using X-RateLimit-Reset, without duplicating anything', async () => {
    const w = world({ notion: notionFixture(rows(10)) });
    const plan = await w.plan();
    w.clickup.rateLimit(3, isCreate);
    const result = await w.run(plan, w.approve(plan).runId, { concurrency: 2 });
    expect(result.status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(10);
    expect(created(w)).toBe(13); // 3 rejected (never executed) + 10 real
    expect(new Set(w.clickup.state.tasks.map((t) => t.name)).size).toBe(10);
    expect(w.clock.slept).toBeGreaterThanOrEqual(5000);
  });

  it('stops safely (and resumably) when throttling never ends', async () => {
    const w = world({ notion: notionFixture(rows(6)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.rateLimit(10_000, isCreate);
    const result = await w.run(plan, run.runId, { concurrency: 1 });
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toMatch(/rate limiting/);
    expect(w.clickup.state.tasks).toHaveLength(0);
    expect(w.store.getRun(run.runId)?.counts.pending).toBe(5);
  });
});

describe('partial failure and resume', () => {
  it('an item the API rejects fails alone; the rest complete; resume fixes only that item', async () => {
    const w = world({ notion: notionFixture(rows(5)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: (r) => isCreate(r) && String((r.body as { name?: string }).name) === 'Task 3',
      respond: () =>
        new Response(JSON.stringify({ err: 'Name rejected', ECODE: 'ITEM_003' }), { status: 400 }),
    });
    const first = await w.run(plan, run.runId, { concurrency: 1 });
    expect(first.status).toBe('failed');
    expect(w.clickup.state.tasks).toHaveLength(4);
    const report = w.report(plan, run.runId);
    expect(report.state).toBe('failed');
    expect(report.headline).toMatch(/NOT complete/i);
    expect(report.items.find((i) => i.label.includes('Task 3'))?.status).toBe('failed');

    const second = await w.run(plan, run.runId, { concurrency: 1 });
    expect(second.status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(5);
    expect(new Set(w.clickup.state.tasks.map((t) => t.name)).size).toBe(5); // no duplicates
  });

  it('survives a hard interruption mid-run: resume completes without duplicates', async () => {
    const w = world({ notion: notionFixture(rows(12)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await expect(
      w.run(plan, run.runId, { concurrency: 1, interruptAfter: 5 }),
    ).rejects.toBeInstanceOf(SimulatedInterruptError);
    expect(w.clickup.state.tasks).toHaveLength(5);
    expect(w.store.getRun(run.runId)?.status).toBe('applying');
    const resumed = await w.run(plan, run.runId, { concurrency: 3 });
    expect(resumed.status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(12);
    expect(new Set(w.clickup.state.tasks.map((t) => t.name)).size).toBe(12);
  });

  it('stops on an invalid token and says how to continue', async () => {
    const w = world({ notion: notionFixture(rows(4)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: isCreate,
      times: 100,
      respond: () =>
        new Response(JSON.stringify({ err: 'Token invalid', ECODE: 'OAUTH_025' }), { status: 401 }),
    });
    const result = await w.run(plan, run.runId, { concurrency: 1 });
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toMatch(/credential/);
  });
});

describe('ambiguous writes and duplicate prevention (ADR 0007)', () => {
  it('the task WAS created but the response was lost: found via its marker, not re-sent', async () => {
    const w = world({ notion: notionFixture(rows(4)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: (r) => isCreate(r) && String((r.body as { name?: string }).name) === 'Task 2',
      failAfterCommit: () => new TypeError('fetch failed: socket hang up'),
    });
    const result = await w.run(plan, run.runId, { concurrency: 1 });
    expect(result.status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(4);
    expect(
      w.clickup.requests.filter(
        (r) => isCreate(r) && (r.body as { name?: string }).name === 'Task 2',
      ),
    ).toHaveLength(1);
    expect(w.store.listMappings()).toHaveLength(4);
  });

  it('a 502 after commit is reconciled the same way', async () => {
    const w = world({ notion: notionFixture(rows(3)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: (r) => isCreate(r) && String((r.body as { name?: string }).name) === 'Task 1',
      failAfterCommit: () => new Response('{"err":"bad gateway"}', { status: 502 }),
    });
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(3);
  });

  it('the write did NOT happen and the response was lost: re-sent exactly once', async () => {
    const w = world({ notion: notionFixture(rows(3)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: (r) => isCreate(r) && String((r.body as { name?: string }).name) === 'Task 2',
      throw: () => new TypeError('fetch failed'),
    });
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(3);
    expect(
      w.clickup.requests.filter(
        (r) => isCreate(r) && (r.body as { name?: string }).name === 'Task 2',
      ),
    ).toHaveLength(2);
  });

  it('crash AFTER ClickUp committed but BEFORE the checkpoint: resume adopts the task (the hardest case)', async () => {
    const w = world({ notion: notionFixture(rows(5)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await expect(
      w.run(plan, run.runId, {
        concurrency: 1,
        afterWrite: (a) => {
          if (a.label.includes('Task 3')) throw new SimulatedInterruptError(2);
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedInterruptError);
    expect(w.clickup.state.tasks).toHaveLength(3); // Task 3 exists remotely …
    expect(w.store.listMappings()).toHaveLength(2); // … but is not recorded locally

    const resumed = await w.run(plan, run.runId, { concurrency: 1 });
    expect(resumed.status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(5);
    expect(new Set(w.clickup.state.tasks.map((t) => t.name)).size).toBe(5);
  });

  it('re-planning after a complete run skips everything (no duplicates)', async () => {
    const w = world({ notion: notionFixture(rows(6)) });
    const first = await w.plan();
    await w.run(first, w.approve(first).runId);
    const again = await w.plan();
    expect(again.summary.actions.toExecute).toBe(0);
    expect(again.summary.actions.toSkip).toBe(6);
    expect(again.actions.every((a) => a.skipReason === 'already_migrated')).toBe(true);
  });

  it('losing the local database does not cause duplicates: items are adopted via their marker', async () => {
    const fixture = notionFixture(rows(6));
    const w1 = world({ notion: fixture });
    const p1 = await w1.plan();
    await w1.run(p1, w1.approve(p1).runId);

    // New machine / deleted .exitos folder: fresh store, same ClickUp contents.
    const w2 = world({
      notion: fixture,
      clickup: w1.clickup.exportState(),
      store: SqliteStateStore.open(':memory:'),
    });
    const p2 = await w2.plan();
    expect(p2.actions.every((a) => a.skipReason === 'adopted_existing')).toBe(true);
    expect(
      p2.inventory.find((f) => f.code === 'ALREADY_PRESENT') ??
        p2.findings.find((f) => f.code === 'ALREADY_PRESENT'),
    ).toBeDefined();
    const run = w2.approve(p2);
    expect((await w2.run(p2, run.runId)).status).toBe('applied');
    expect(w2.clickup.requests.filter(isCreate)).toHaveLength(0);
    expect(w2.clickup.state.tasks).toHaveLength(6);
    expect((await w2.verify(p2, run.runId)).status).toBe('passed');
  });

  it('warns when planned names collide with unrelated existing tasks (never overwrites)', async () => {
    const state = basicClickUpState();
    state.tasks.push({
      id: '86fexisting',
      name: 'Task 1',
      markdown_description: 'someone else’s task',
      status: 'to do',
      priority: null,
      due_date: null,
      start_date: null,
      assignees: [],
      tags: [],
      customValues: {},
      listId: '901001',
      date_created: 1,
      links: [],
      archived: false,
    });
    const w = world({ notion: notionFixture(rows(2)), clickup: state });
    const plan = await w.plan();
    expect(plan.findings.find((f) => f.code === 'DEST_NAME_COLLISION')).toMatchObject({
      severity: 'warning',
      count: 1,
    });
    await w.run(plan, w.approve(plan).runId);
    expect(w.clickup.state.tasks.find((t) => t.id === '86fexisting')?.markdown_description).toBe(
      'someone else’s task',
    ); // untouched
    expect(w.clickup.state.tasks).toHaveLength(3);
  });

  it('without a marker (provenance: none) a lost reply is still reconciled by name when unambiguous', async () => {
    const w = world({
      notion: notionFixture(rows(3)),
      config: defaultConfigYaml('options:\n  provenance: none'),
    });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: (r) => isCreate(r) && String((r.body as { name?: string }).name) === 'Task 2',
      failAfterCommit: () => new TypeError('fetch failed'),
    });
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    expect(w.clickup.state.tasks).toHaveLength(3);
  });

  it('stops and asks the operator when two tasks match and nothing can tell them apart', async () => {
    const w = world({
      notion: notionFixture([{ n: 1, title: 'Same' }]),
      config: defaultConfigYaml('options:\n  provenance: none'),
    });
    const plan = await w.plan();
    const run = w.approve(plan);
    // Simulate: the write committed, the reply was lost, AND an identical task appeared meanwhile.
    w.clickup.fault({
      match: isCreate,
      failAfterCommit: () => {
        const dup = {
          ...(w.clickup.state.tasks[0] as object),
        } as (typeof w.clickup.state.tasks)[number];
        w.clickup.state.tasks.push({ ...dup, id: '86fclone' });
        return new TypeError('fetch failed');
      },
    });
    const result = await w.run(plan, run.runId, { concurrency: 1 });
    expect(result.status).toBe('stopped');
    expect(result.stopReason).toContain('--assume-not-created');
  });
});

describe('scale', () => {
  it('handles >100 tasks in a list during validation and verification (pagination)', async () => {
    const w = world({ notion: notionFixture(rows(230)) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await w.run(plan, run.runId, { concurrency: 4 });
    expect(w.clickup.state.tasks).toHaveLength(230);
    const v = await w.verify(plan, run.runId);
    const gets = w.clickup.requests.filter(
      (r) => r.method === 'GET' && /\/list\/901001\/task$/.test(r.path),
    );
    expect(gets.some((g) => g.query.page?.[0] === '2')).toBe(true); // paged through all 230
    expect(v.status).toBe('passed');
    expect(v.counts.verified).toBe(230);
    expect(v.targets[0]).toMatchObject({ expected: 230, found: 230 });
  });
});
