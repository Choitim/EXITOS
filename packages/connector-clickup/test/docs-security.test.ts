import { SimulatedInterruptError, VirtualClock } from '@exitos/shared';
import {
  approveAndCreateRun,
  createConnectorContext,
  redactReport,
  renderReportMarkdown,
  sealPlan,
  splitPlan,
} from '@exitos/core';
import { clickupDestination } from '../src/index.js';
import { createFakeClickUpApi, basicClickUpState } from '../src/testing/index.js';
import {
  block,
  dataSourceObj,
  pageObj,
  richTexts,
  rt,
  uid,
  value,
  workspaceParent,
  type NotionFixture,
  type Obj,
} from '@exitos/connector-notion/testing';
import { describe, expect, it } from 'vitest';
import { CLICKUP_TOKEN, NOTION_TOKEN, adaObj, notionFixture, rowId, world } from './harness.js';

const root = uid('doc:root');
const child = uid('doc:child');
const grand = uid('doc:grand');
const sibling = uid('doc:sibling');
const page = (id: string, title: string, parent: Obj): Obj =>
  pageObj({
    id,
    parent,
    created: '2026-01-01T00:00:00.000Z',
    properties: { title: value.title('title', title) },
  });

function docsFixture(): NotionFixture {
  const base = notionFixture([]);
  return {
    ...base,
    dataSources: [
      dataSourceObj({
        id: uid('unused:ds'),
        databaseId: uid('unused:db'),
        title: 'Unused',
        properties: [],
      }),
    ],
    databases: [],
    pages: [
      page(root, 'Engineering Handbook', workspaceParent()),
      page(child, 'Onboarding', { type: 'page_id', page_id: root }),
      page(sibling, 'Runbooks', { type: 'page_id', page_id: root }),
      page(grand, 'Day one', { type: 'page_id', page_id: child }),
    ],
    blocks: {
      [root]: [
        block.heading(uid('r1'), root, 1, 'Welcome'),
        block.paragraph(uid('r2'), root, [rt('Read '), rt('this', { bold: true }), rt(' first.')]),
        block.childPage(sibling, root, 'Runbooks'), // listed BEFORE Onboarding → order must follow the content
        block.childPage(child, root, 'Onboarding'),
        block.toggle(uid('r3'), root, 'FAQ'),
      ],
      [uid('r3')]: [block.paragraph(uid('r4'), uid('r3'), richTexts('Nothing here'))],
      [child]: [block.childPage(grand, child, 'Day one'), block.table(uid('t'), child, 2)],
      [uid('t')]: [
        block.tableRow(uid('tr1'), uid('t'), ['A', 'B']),
        block.tableRow(uid('tr2'), uid('t'), ['1', '2']),
      ],
      [sibling]: [block.code(uid('c'), sibling, 'echo "hi"', 'shell')],
      [grand]: [block.paragraph(uid('g'), grand, richTexts('Deep content 🚀'))],
    },
  };
}

const docsConfig = (experimental: boolean, extra = ''): string => `
version: 1
source:
  type: notion
  pages: [{ id: "${root}" }]
destination:
  type: clickup
  workspaceId: "9000001"
  docs: { parent: { type: space, id: "90010" } }
${extra}
options:
  experimental: { docs: ${experimental} }
`;

describe('Notion pages → ClickUp Docs (experimental)', () => {
  it('is off by default: the pages are read, reported, and NOT migrated', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(false) });
    const plan = await w.plan();
    expect(plan.actions).toHaveLength(0);
    expect(plan.findings.find((f) => f.code === 'DOCS_EXPERIMENTAL_DISABLED')).toMatchObject({
      outcome: 'skipped',
      severity: 'warning',
    });
    expect(plan.findings.find((f) => f.code === 'DOCS_EXPERIMENTAL_DISABLED')?.message).toMatch(
      /4 Notion page/,
    );
  });

  it('plans one Doc with a nested page tree in the order the pages appear in their parent', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(true) });
    const plan = await w.plan();
    const kinds = plan.actions.map(
      (a) => `${a.kind.split('.')[1]}:${a.label.match(/"([^"]+)"/)?.[1]}`,
    );
    expect(kinds).toEqual([
      'create_doc:Engineering Handbook',
      'create_doc_page:Engineering Handbook',
      'create_doc_page:Runbooks',
      'create_doc_page:Onboarding',
      'create_doc_page:Day one',
    ]);
    const byLabel = (needle: string) => plan.actions.find((a) => a.label.includes(needle))!;
    expect(byLabel('Day one').dependsOn).toEqual([
      byLabel('Create Doc').id,
      byLabel('"Onboarding"').id,
    ]);
    expect(plan.destination.targets.some((t) => t.kind === 'docs-parent')).toBe(true);
  });

  it('migrates Markdown content and does not duplicate sub-pages as links', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(true) });
    const plan = await w.plan();
    const rootPage = plan.actions.find((a) => a.label === 'Create page "Engineering Handbook"')!
      .payload as { content: string };
    expect(rootPage.content).toContain('# Welcome');
    expect(rootPage.content).toContain('Read **this** first.');
    expect(rootPage.content).toContain('**FAQ**'); // toggle flattened (reported lossy)
    // Sub-pages that are migrated as Doc pages must not ALSO appear as links in the parent page.
    expect(rootPage.content).not.toContain('[Onboarding]');
    expect(rootPage.content).not.toContain('[Runbooks]');
    expect(plan.inventory.map((f) => f.code)).toContain('BLOCK_TOGGLE_FLATTENED');
  });

  it('applies: creates the Doc without an empty first page, then the pages with correct parents', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(true) });
    const plan = await w.plan();
    const run = w.approve(plan);
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    const docCreate = w.clickup.requests.find(
      (r) => r.method === 'POST' && /\/docs$/.test(r.path),
    )!;
    expect((docCreate.body as { create_page: boolean }).create_page).toBe(false);
    expect(w.clickup.state.docs).toHaveLength(1);
    const pages = w.clickup.state.pages;
    expect(pages.map((p) => p.name)).toEqual([
      'Engineering Handbook',
      'Runbooks',
      'Onboarding',
      'Day one',
    ]);
    const id = (name: string) => pages.find((p) => p.name === name)!.id;
    expect(pages.find((p) => p.name === 'Engineering Handbook')!.parentPageId).toBeNull();
    expect(pages.find((p) => p.name === 'Onboarding')!.parentPageId).toBe(
      id('Engineering Handbook'),
    );
    expect(pages.find((p) => p.name === 'Day one')!.parentPageId).toBe(id('Onboarding'));
    expect(pages.find((p) => p.name === 'Day one')!.content).toContain('Deep content 🚀');
  });

  it('verifies names, hierarchy and content', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(true) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await w.run(plan, run.runId);
    const v = await w.verify(plan, run.runId);
    expect(v.status).toBe('passed');
    expect(v.counts.verified).toBe(5); // 1 Doc + 4 pages
    expect(v.notes.join(' ')).toMatch(/experimental/);

    w.clickup.state.pages.find((p) => p.name === 'Day one')!.parentPageId = null;
    w.clickup.state.pages.find((p) => p.name === 'Runbooks')!.content = 'replaced';
    const broken = await w.verify(plan, run.runId);
    expect(broken.status).toBe('failed');
    expect(broken.items.filter((i) => i.status === 'mismatched')).toHaveLength(2);
  });

  it('recovers a Doc page whose reply was lost (found by its marker, not duplicated)', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(true) });
    const plan = await w.plan();
    const run = w.approve(plan);
    w.clickup.fault({
      match: (r) =>
        r.method === 'POST' &&
        /\/pages$/.test(r.path) &&
        (r.body as { name?: string }).name === 'Onboarding',
      failAfterCommit: () => new TypeError('fetch failed'),
    });
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    expect(w.clickup.state.pages.filter((p) => p.name === 'Onboarding')).toHaveLength(1);
  });

  it('survives a crash between creating the Doc and its pages', async () => {
    const w = world({ notion: docsFixture(), config: docsConfig(true) });
    const plan = await w.plan();
    const run = w.approve(plan);
    await expect(
      w.run(plan, run.runId, { concurrency: 1, interruptAfter: 1 }),
    ).rejects.toBeInstanceOf(SimulatedInterruptError);
    expect(w.clickup.state.docs).toHaveLength(1);
    expect((await w.run(plan, run.runId, { concurrency: 1 })).status).toBe('applied');
    expect(w.clickup.state.docs).toHaveLength(1); // the Doc is not created twice
    expect(w.clickup.state.pages).toHaveLength(4);
  });
});

describe('security: a plan file is untrusted input', () => {
  const tamper = async (mutate: (payload: Record<string, unknown>) => void) => {
    const w = world({ notion: notionFixture([{ n: 1 }, { n: 2 }]) });
    const plan = await w.plan();
    const { body } = splitPlan(plan);
    const evil = structuredClone(body);
    mutate(evil.actions[0]!.payload);
    const resealed = sealPlan(evil, '2026-01-01T00:00:00.000Z'); // a careful attacker recomputes the hash
    const run = approveAndCreateRun({
      plan: resealed,
      store: w.store,
      approvedPlanId: resealed.planId,
      now: new Date(),
    });
    const result = await w.run(resealed, run.runId, { concurrency: 1 });
    return { w, result, run, resealed };
  };

  it('rejects smuggled ClickUp request fields (strict payload schema) before sending anything for that item', async () => {
    const { w, run, resealed } = await tamper((p) => {
      (p.body as Record<string, unknown>).archived = true;
      (p.body as Record<string, unknown>).parent = '86fvictim';
    });
    const cp = w.store.getCheckpoint(run.runId, resealed.actions[0]!.id);
    expect(cp?.status).toBe('failed');
    expect(cp?.lastError?.message).toMatch(/invalid payload.*body/);
    expect(
      w.clickup.requests.filter(
        (r) => r.method === 'POST' && (r.body as { name?: string }).name === 'Task 1',
      ),
    ).toHaveLength(0);
  });

  it('rejects path traversal in ids', async () => {
    const { w, run, resealed } = await tamper((p) => {
      p.listId = '../../team/9000001/task';
    });
    expect(w.store.getCheckpoint(run.runId, resealed.actions[0]!.id)?.status).toBe('failed');
    expect(w.clickup.requests.some((r) => r.path.includes('..'))).toBe(false);
  });

  it('rejects a payload that tries to turn notifications back on', async () => {
    const { w, run, resealed } = await tamper((p) => {
      (p.body as Record<string, unknown>).notify_all = true;
    });
    expect(w.store.getCheckpoint(run.runId, resealed.actions[0]!.id)?.status).toBe('failed');
  });

  it('an edited plan whose hash was NOT recomputed is refused outright', async () => {
    const w = world({ notion: notionFixture([{ n: 1 }]) });
    const plan = await w.plan();
    const edited = structuredClone(plan);
    (edited.actions[0]!.payload as { body: { name: string } }).body.name = 'Totally different';
    expect(() => w.approve(edited)).toThrow(/hash|edited|corrupt/i);
    expect(w.store.listRuns()).toHaveLength(0);
  });

  it('refuses an API base URL override that is not loopback or the official host', () => {
    const ok = () =>
      createConnectorContext(clickupDestination, 'read-only', {
        transport: createFakeClickUpApi(basicClickUpState()).fetch,
        mode: 'live',
        env: { CLICKUP_API_TOKEN: CLICKUP_TOKEN },
        clock: new VirtualClock(),
        baseUrlOverride: 'http://127.0.0.1:4011/api',
      });
    expect(ok().baseUrl).toBe('http://127.0.0.1:4011/api');
    for (const bad of [
      'https://evil.example.net/api',
      'http://api.clickup.com.evil.net/api',
      'https://user:pw@api.clickup.com/api',
    ]) {
      expect(() =>
        createConnectorContext(clickupDestination, 'read-only', {
          transport: createFakeClickUpApi(basicClickUpState()).fetch,
          mode: 'live',
          env: { CLICKUP_API_TOKEN: CLICKUP_TOKEN },
          clock: new VirtualClock(),
          baseUrlOverride: bad,
        }),
      ).toThrow();
    }
  });

  it('refuses to start a live run without the credential, naming the variable but never a value', () => {
    expect(() =>
      createConnectorContext(clickupDestination, 'read-only', {
        transport: createFakeClickUpApi(basicClickUpState()).fetch,
        mode: 'live',
        env: {},
        clock: new VirtualClock(),
      }),
    ).toThrow(/CLICKUP_API_TOKEN/);
  });
});

describe('security: secrets never reach disk, logs, plans or reports', () => {
  it('no token appears in any artefact of a complete run', async () => {
    const w = world({
      notion: notionFixture(
        [
          { n: 1, owner: [adaObj()] },
          { n: 2, deps: [1] },
        ],
        { [rowId(1)]: [block.imageHosted(uid('i'), rowId(1), 'x.png')] },
      ),
    });
    // Make some errors happen too, since error paths are where secrets usually leak.
    w.clickup.fault({
      match: (r) => r.method === 'POST' && /\/task$/.test(r.path),
      failAfterCommit: () => new TypeError(`fetch failed (Authorization: ${CLICKUP_TOKEN})`),
    });
    const plan = await w.plan();
    const run = w.approve(plan);
    await w.run(plan, run.runId, { concurrency: 1 });
    const v = await w.verify(plan, run.runId);
    const report = w.report(plan, run.runId);

    const everything = JSON.stringify({
      plan,
      v,
      report,
      markdown: renderReportMarkdown(report),
      redacted: redactReport(report),
      events: w.store.listEvents(run.runId, 0, 10_000),
      checkpoints: w.store.listCheckpoints(run.runId),
      mappings: w.store.listMappings(),
      logs: w.logger.lines,
      requests: [w.notion.requests, w.clickup.requests].flatMap((r) =>
        r.map((x) => ({ m: x.method, p: x.path })),
      ),
    });
    for (const secret of [NOTION_TOKEN, CLICKUP_TOKEN, 'HARNESSTOKEN', 'harnesstoken']) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(/X-Amz|FIXTURE_SIGNATURE/);
  });

  it('the shareable (redacted) report contains no task titles or user names', async () => {
    const w = world({
      notion: notionFixture([{ n: 1, title: 'Acquire Globex (confidential)', owner: [adaObj()] }]),
    });
    const plan = await w.plan();
    const run = w.approve(plan);
    await w.run(plan, run.runId);
    await w.verify(plan, run.runId);
    const text =
      JSON.stringify(redactReport(w.report(plan, run.runId))) +
      renderReportMarkdown(redactReport(w.report(plan, run.runId)));
    expect(text).not.toContain('Globex');
    expect(text).not.toContain('Ada Lovelace');
    expect(text).not.toContain('app.clickup.com');
  });
});
