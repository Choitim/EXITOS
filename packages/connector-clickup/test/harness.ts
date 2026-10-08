import {
  SqliteStateStore,
  approveAndCreateRun,
  buildPlan,
  buildReport,
  createConnectorContext,
  executePlan,
  parseMigrationConfig,
  verifyRun,
  type DestinationConnector,
  type ExecuteOptions,
  type MigrationPlan,
  type SourceConnector,
} from '@exitos/core';
import { RequestRecorder, VirtualClock, createMemoryLogger } from '@exitos/shared';
import {
  block,
  createFakeNotionApi,
  dataSourceObj,
  databaseObj,
  pageObj,
  richTexts,
  rowParent,
  rt,
  schema,
  uid,
  userObj,
  value,
  type FakeNotionApi,
  type NotionFixture,
  type Obj,
} from '@exitos/connector-notion/testing';
import { notionSource } from '@exitos/connector-notion';
import { clickupDestination } from '../src/index.js';
import {
  basicClickUpState,
  createFakeClickUpApi,
  type FakeClickUpApi,
  type FakeClickUpState,
} from '../src/testing/index.js';

export const NOTION_TOKEN = 'ntn_harnesstokenharnesstoken123456';
export const CLICKUP_TOKEN = 'pk_12345678_HARNESSTOKENHARNESSTOKEN';

export const DB = uid('h:db');
export const DS = uid('h:ds');
export const ADA = uid('h:ada');
export const GRACE = uid('h:grace');
export const LINUS = uid('h:linus');

export const adaObj = (): Obj => userObj(ADA, 'Ada Lovelace', 'ada@example.com');
export const graceObj = (): Obj => userObj(GRACE, 'Grace Hopper', 'grace@example.com');
export const linusObj = (): Obj => userObj(LINUS, 'Linus T.', 'linus@example.com');

export function roadmapSchema(): Obj[] {
  return [
    schema.title(),
    schema.status('st', 'Status', {
      'To-do': ['Not started'],
      'In progress': ['In progress', 'In review'],
      Complete: ['Done'],
      Other: ['Blocked'],
    }),
    schema.select('pri', 'Priority', ['Urgent', 'High', 'Medium', 'Low', 'Someday']),
    schema.simple('due', 'Due', 'date'),
    schema.simple('own', 'Owner', 'people'),
    schema.multiSelect('tag', 'Tags', ['frontend', 'backend', 'research']),
    schema.number('pts', 'Points'),
    schema.select('epic', 'Epic', ['Platform', 'Mobile', 'Growth']),
    schema.simple('url', 'Spec', 'url'),
    schema.simple('rev', 'Needs review', 'checkbox'),
    schema.relation('dep', 'Depends on', DS),
    schema.richText('notes', 'Notes'),
  ];
}

export interface RowSpec {
  n: number;
  title?: string;
  status?: string;
  priority?: string;
  due?: [string, string | null, string | null] | null;
  owner?: Obj[];
  tags?: string[];
  points?: number;
  epic?: string;
  spec?: string;
  review?: boolean;
  deps?: number[];
  notes?: string;
  created?: string;
}

export function row(spec: RowSpec): Obj {
  const props: Record<string, Obj> = {
    Name: value.title('title', spec.title ?? `Task ${spec.n}`),
    Status: value.status('st', spec.status ?? 'Not started'),
    Priority: value.select('pri', spec.priority ?? null),
    Due:
      spec.due === null
        ? value.date('due', null)
        : spec.due
          ? value.date('due', spec.due[0], spec.due[1], spec.due[2])
          : value.date('due', '2026-09-15'),
    Owner: value.people('own', spec.owner ?? []),
    Tags: value.multiSelect('tag', spec.tags ?? []),
    Points: value.number('pts', spec.points ?? null),
    Epic: value.select('epic', spec.epic ?? null),
    Spec: value.url('url', spec.spec ?? null),
    'Needs review': value.checkbox('rev', spec.review ?? false),
    'Depends on': value.relation(
      'dep',
      (spec.deps ?? []).map((d) => uid(`h:row:${d}`)),
    ),
    Notes: value.richText('notes', spec.notes ?? ''),
  };
  return pageObj({
    id: uid(`h:row:${spec.n}`),
    parent: rowParent(DS, DB),
    created: spec.created ?? new Date(Date.UTC(2026, 0, 1, 0, 0, spec.n)).toISOString(),
    createdBy: adaObj(),
    properties: props,
  });
}

export function notionFixture(rows: RowSpec[], blocks: Record<string, Obj[]> = {}): NotionFixture {
  return {
    workspace: { id: uid('h:ws'), name: 'Harness Notion', botId: uid('h:bot') },
    userInfoCapability: true,
    users: [adaObj(), graceObj(), linusObj()],
    databases: [
      databaseObj({ id: DB, title: 'Roadmap', dataSources: [{ id: DS, name: 'Roadmap' }] }),
    ],
    dataSources: [
      dataSourceObj({ id: DS, databaseId: DB, title: 'Roadmap', properties: roadmapSchema() }),
    ],
    pages: rows.map(row),
    blocks,
  };
}

export const rowId = (n: number): string => uid(`h:row:${n}`);

export const defaultConfigYaml = (extra = ''): string => `
version: 1
source:
  type: notion
  dataSources: [{ id: "${DS}" }]
destination:
  type: clickup
  workspaceId: "9000001"
  lists:
    - source: Roadmap
      listId: "901001"
      fields:
        Points: { to: custom_field, field: Story points }
        Epic: { to: custom_field, field: Epic }
        Spec: { to: custom_field, field: Spec link }
        "Needs review": { to: custom_field, field: Needs review }
users:
  map:
    "${ADA}": 1001
${extra}
`;

export interface World {
  notion: FakeNotionApi;
  clickup: FakeClickUpApi;
  clock: VirtualClock;
  store: SqliteStateStore;
  sourceRecorder: RequestRecorder;
  readRecorder: RequestRecorder;
  writeRecorder: RequestRecorder;
  logger: ReturnType<typeof createMemoryLogger>;
  source: SourceConnector;
  /** Read-only destination: used for planning, validation and verification. */
  destRO: DestinationConnector;
  /** Read-write destination: used for apply/reconcile only. */
  destRW: DestinationConnector;
  config: ReturnType<typeof parseMigrationConfig>;
  plan(): Promise<MigrationPlan>;
  approve(plan: MigrationPlan): ReturnType<typeof approveAndCreateRun>;
  run(
    plan: MigrationPlan,
    runId: string,
    extra?: Partial<ExecuteOptions>,
  ): ReturnType<typeof executePlan>;
  verify(plan: MigrationPlan, runId: string): ReturnType<typeof verifyRun>;
  report(plan: MigrationPlan, runId: string | null): ReturnType<typeof buildReport>;
}

export function world(options: {
  notion: NotionFixture;
  clickup?: FakeClickUpState;
  config?: string;
  store?: SqliteStateStore;
  rateLimitPerMinute?: number;
}): World {
  const clock = new VirtualClock(Date.UTC(2026, 5, 1));
  const notion = createFakeNotionApi(options.notion);
  const clickup = createFakeClickUpApi(options.clickup ?? basicClickUpState(), {
    now: () => clock.now(),
    rateLimitPerMinute: options.rateLimitPerMinute ?? 0,
  });
  const logger = createMemoryLogger();
  const sourceRecorder = new RequestRecorder();
  const readRecorder = new RequestRecorder();
  const writeRecorder = new RequestRecorder();
  const config = parseMigrationConfig(options.config ?? defaultConfigYaml());
  const store =
    options.store ??
    SqliteStateStore.open(':memory:', { now: () => new Date(clock.now()).toISOString() });

  const env = { NOTION_TOKEN, CLICKUP_API_TOKEN: CLICKUP_TOKEN };
  const common = { mode: 'live' as const, env, clock, logger, concurrency: 4 };

  const sourceCtx = createConnectorContext(notionSource, 'read-only', {
    ...common,
    transport: notion.fetch,
    recorder: sourceRecorder,
  });
  const roCtx = createConnectorContext(clickupDestination, 'read-only', {
    ...common,
    transport: clickup.fetch,
    recorder: readRecorder,
  });
  const rwCtx = createConnectorContext(clickupDestination, 'read-write', {
    ...common,
    transport: clickup.fetch,
    recorder: writeRecorder,
  });

  const source = notionSource.create(
    sourceCtx,
    notionSource.configSchema.parse(config.source),
    config,
  ) as SourceConnector;
  const destConfig = clickupDestination.configSchema.parse(config.destination);
  const destRO = clickupDestination.create(roCtx, destConfig, config);
  const destRW = clickupDestination.create(rwCtx, destConfig, config);
  const now = (): Date => new Date(clock.now());

  return {
    notion,
    clickup,
    clock,
    store,
    sourceRecorder,
    readRecorder,
    writeRecorder,
    logger,
    source,
    destRO,
    destRW,
    config,
    async plan() {
      const out = await buildPlan({
        source,
        destination: destRO,
        config,
        mode: 'live',
        store,
        now,
        recorders: [sourceRecorder, readRecorder],
      });
      return out.plan;
    },
    approve: (plan) =>
      approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: now() }),
    run: (plan, runId, extra = {}) =>
      executePlan({
        plan,
        destination: destRW,
        store,
        runId,
        concurrency: 3,
        clock,
        logger,
        ...extra,
      }),
    verify: (plan, runId) => verifyRun({ plan, destination: destRO, store, runId, clock }),
    report: (plan, runId) => {
      const run = runId === null ? null : (store.getRun(runId) ?? null);
      return buildReport({
        plan,
        run,
        checkpoints: runId === null ? [] : store.listCheckpoints(runId),
        verification: runId === null ? null : (store.getVerification(runId) ?? null),
        mappings: store.listMappings(),
        now: now(),
      });
    },
  };
}

export { block, richTexts, rt, uid, value, schema };
