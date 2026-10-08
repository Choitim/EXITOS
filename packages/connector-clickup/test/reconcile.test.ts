import type {
  MigrationAction,
  MigrationPlan,
  ReconcileRequest,
  ReconcileResult,
} from '@exitos/core';
import { describe, expect, it } from 'vitest';
import { markerText } from '../src/markdown.js';
import type { FakeTask } from '../src/testing/index.js';
import { defaultConfigYaml, notionFixture, world, type World } from './harness.js';

/**
 * `reconcile` decides what happens after a write whose outcome is unknown: adopt what ClickUp already
 * holds, send it again, or stop and ask a person. A wrong "not found" duplicates a task; a wrong
 * "found" loses one. These tests pin every branch, especially the ones that must refuse to guess.
 */

const SINCE = new Date(Date.UTC(2026, 5, 1)).toISOString();

const rows = (n: number, extra: { deps?: number[] } = {}) =>
  Array.from({ length: n }, (_, i) => ({ n: i + 1, status: 'In progress', ...extra }));

interface TaskPayload {
  listId: string;
  marker: string | null;
  body: { name: string };
}

const request = (
  resolve: ReconcileRequest['resolveDependency'] = () => undefined,
): ReconcileRequest => ({ since: SINCE, attempt: 1, resolveDependency: resolve });

const fakeTask = (
  over: Partial<FakeTask> & Pick<FakeTask, 'id' | 'name' | 'listId'>,
): FakeTask => ({
  markdown_description: '',
  status: 'to do',
  priority: null,
  due_date: null,
  start_date: null,
  assignees: [],
  tags: [],
  customValues: {},
  date_created: Date.UTC(2026, 5, 1, 0, 5),
  links: [],
  archived: false,
  ...over,
});

async function firstTaskAction(config?: string): Promise<{
  w: World;
  plan: MigrationPlan;
  action: MigrationAction;
  payload: TaskPayload;
}> {
  const w = world({
    notion: notionFixture(rows(2)),
    ...(config === undefined ? {} : { config }),
  });
  const plan = await w.plan();
  const action = plan.actions.find((a) => a.kind === 'clickup.create_task');
  if (action === undefined) throw new Error('the plan has no create_task action');
  // Plan payloads are opaque JSON to the engine; this test knows the connector's own shape.
  return { w, plan, action, payload: action.payload as unknown as TaskPayload };
}

const reconcile = async (
  w: World,
  action: MigrationAction,
  req: ReconcileRequest = request(),
): Promise<ReconcileResult> => {
  if (w.destRW.reconcile === undefined) throw new Error('the connector must implement reconcile');
  return w.destRW.reconcile(action, req);
};

describe('reconcile: create_task with a provenance marker', () => {
  it('adopts the single task that carries the marker', async () => {
    const { w, action, payload } = await firstTaskAction();
    w.clickup.state.tasks.push(
      fakeTask({
        id: 'T-ADOPT',
        name: payload.body.name,
        listId: payload.listId,
        markdown_description: `body\n\n\`${markerText(action.idempotencyKey)}\``,
      }),
    );
    const result = await reconcile(w, action);
    expect(result).toMatchObject({ status: 'found', destinationId: 'T-ADOPT' });
  });

  it('REFUSES to guess when two tasks carry the same marker', async () => {
    const { w, action, payload } = await firstTaskAction();
    for (const id of ['T-A', 'T-B']) {
      w.clickup.state.tasks.push(
        fakeTask({
          id,
          name: payload.body.name,
          listId: payload.listId,
          markdown_description: `\`${markerText(action.idempotencyKey)}\``,
        }),
      );
    }
    const result = await reconcile(w, action);
    expect(result.status).toBe('undecidable');
    expect(result.status === 'undecidable' && result.reason).toMatch(/2 tasks carry the marker/);
  });

  it('says "not found, confident" when nothing carries the marker and the whole list was read', async () => {
    const { w, action, payload } = await firstTaskAction();
    // A task with the same NAME but a different marker must not be adopted.
    w.clickup.state.tasks.push(
      fakeTask({
        id: 'T-OTHER',
        name: payload.body.name,
        listId: payload.listId,
        markdown_description: '`exitos-key:some-other-action`',
      }),
    );
    expect(await reconcile(w, action)).toEqual({ status: 'not_found', confident: true });
  });

  it('ignores tasks created long before the attempt (outside the search window)', async () => {
    const { w, action, payload } = await firstTaskAction();
    w.clickup.state.tasks.push(
      fakeTask({
        id: 'T-OLD',
        name: payload.body.name,
        listId: payload.listId,
        date_created: Date.UTC(2026, 4, 1),
        markdown_description: `\`${markerText(action.idempotencyKey)}\``,
      }),
    );
    expect(await reconcile(w, action)).toEqual({ status: 'not_found', confident: true });
  });
});

describe('reconcile: create_task WITHOUT a marker (provenance: none)', () => {
  const noMarker = defaultConfigYaml('options:\n  provenance: none');

  it('falls back to the name when exactly one task matches', async () => {
    const { w, action, payload } = await firstTaskAction(noMarker);
    expect(payload.marker).toBeNull();
    w.clickup.state.tasks.push(
      fakeTask({ id: 'T-NAMED', name: payload.body.name, listId: payload.listId }),
    );
    expect(await reconcile(w, action)).toMatchObject({ status: 'found', destinationId: 'T-NAMED' });
  });

  it('REFUSES to guess when several tasks share the name and nothing tells them apart', async () => {
    const { w, action, payload } = await firstTaskAction(noMarker);
    for (const id of ['T-1', 'T-2']) {
      w.clickup.state.tasks.push(fakeTask({ id, name: payload.body.name, listId: payload.listId }));
    }
    const result = await reconcile(w, action);
    expect(result.status).toBe('undecidable');
    expect(result.status === 'undecidable' && result.reason).toMatch(
      /no marker to tell them apart/,
    );
  });

  it('reports "not found" when no task has that name', async () => {
    const { w, action } = await firstTaskAction(noMarker);
    expect(await reconcile(w, action)).toEqual({ status: 'not_found', confident: true });
  });
});

describe('reconcile: failures while checking are never turned into a guess', () => {
  it('a 404 (the list is gone) is "not found" but NOT confident', async () => {
    const { w, action } = await firstTaskAction();
    w.clickup.fault({
      match: (r) => r.method === 'GET' && /\/list\/\d+\/task$/.test(r.path),
      respond: () => new Response('{"err":"List not found","ECODE":"ITEM_015"}', { status: 404 }),
    });
    expect(await reconcile(w, action)).toEqual({ status: 'not_found', confident: false });
  });

  it('any other API error is thrown to the caller, not swallowed as a verdict', async () => {
    const { w, action } = await firstTaskAction();
    w.clickup.fault({
      match: (r) => r.method === 'GET' && /\/list\/\d+\/task$/.test(r.path),
      respond: () =>
        new Response('{"err":"Team not authorized","ECODE":"OAUTH_027"}', { status: 403 }),
    });
    await expect(reconcile(w, action)).rejects.toMatchObject({ status: 403 });
  });

  it('a tampered payload is "undecidable", with the validation reason', async () => {
    const { w, action } = await firstTaskAction();
    const tampered: MigrationAction = {
      ...action,
      payload: { listId: '../../etc', surprise: true },
    };
    const result = await reconcile(w, tampered);
    expect(result.status).toBe('undecidable');
  });

  it('an action kind it has never heard of is "undecidable"', async () => {
    const { w, action } = await firstTaskAction();
    const result = await reconcile(w, { ...action, kind: 'example.unknown' });
    expect(result).toMatchObject({ status: 'undecidable' });
    expect(result.status === 'undecidable' && result.reason).toContain(
      'No reconciliation exists for example.unknown',
    );
  });
});

describe('reconcile: link_tasks', () => {
  async function appliedWithLink(): Promise<{
    w: World;
    link: MigrationAction;
    resolve: ReconcileRequest['resolveDependency'];
    ids: { from: string; to: string };
  }> {
    const w = world({
      notion: notionFixture([
        { n: 1, status: 'In progress' },
        { n: 2, status: 'In progress', deps: [1] },
      ]),
    });
    const plan = await w.plan();
    const run = w.approve(plan);
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    const link = plan.actions.find((a) => a.kind === 'clickup.link_tasks');
    if (link === undefined) throw new Error('the plan has no link action');
    const destination = new Map(
      w.store
        .listCheckpoints(run.runId)
        .flatMap((c) =>
          c.destinationId === undefined ? [] : [[c.actionId, c.destinationId] as const],
        ),
    );
    const payload = link.payload as unknown as { fromAction: string; toAction: string };
    const resolve: ReconcileRequest['resolveDependency'] = (id) => {
      const destinationId = destination.get(id);
      return destinationId === undefined ? undefined : { destinationId };
    };
    return {
      w,
      link,
      resolve,
      ids: {
        from: destination.get(payload.fromAction) ?? '',
        to: destination.get(payload.toAction) ?? '',
      },
    };
  }

  it('finds a link that ClickUp already holds', async () => {
    const { w, link, resolve, ids } = await appliedWithLink();
    expect(ids.from).not.toBe('');
    const result = await reconcile(w, link, request(resolve));
    expect(result).toMatchObject({ status: 'found', destinationId: `${ids.from}->${ids.to}` });
  });

  it('reports "not found, confident" when the two tasks exist but are not linked', async () => {
    const { w, link, resolve, ids } = await appliedWithLink();
    const from = w.clickup.state.tasks.find((t) => t.id === ids.from);
    if (from === undefined) throw new Error('missing task');
    from.links = [];
    expect(await reconcile(w, link, request(resolve))).toEqual({
      status: 'not_found',
      confident: true,
    });
  });

  it('is "undecidable" while either task is not known yet', async () => {
    const { w, link } = await appliedWithLink();
    const result = await reconcile(
      w,
      link,
      request(() => undefined),
    );
    expect(result).toMatchObject({
      status: 'undecidable',
      reason: 'The tasks to link are not known yet.',
    });
  });
});
