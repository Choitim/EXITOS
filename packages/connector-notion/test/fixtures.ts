import { MigrationConfigSchema, createConnectorContext } from '@exitos/core/sdk';
import { RequestRecorder, VirtualClock, createMemoryLogger } from '@exitos/shared';
import { notionSource, type NotionRaw } from '../src/index.js';
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
  workspaceParent,
  type FakeNotionApi,
  type NotionFixture,
  type Obj,
} from '../src/testing/index.js';

export const DB = uid('db:roadmap');
export const DS = uid('ds:roadmap');
export const ADA = uid('user:ada');
export const GRACE = uid('user:grace');
export const TOKEN = 'ntn_testtokentesttokentesttoken1234';

export const roadmapProperties = (): Obj[] => [
  schema.title(),
  schema.status('st', 'Status', {
    'To-do': ['Not started'],
    'In progress': ['In progress', 'In review'],
    Complete: ['Done'],
  }),
  schema.select('pri', 'Priority', ['Urgent', 'High', 'Medium', 'Low']),
  schema.simple('due', 'Due', 'date'),
  schema.simple('own', 'Owner', 'people'),
  schema.multiSelect('tag', 'Tags', ['frontend', 'backend']),
  schema.number('pts', 'Points'),
  schema.relation('dep', 'Depends on', DS),
];

export function roadmapRow(
  i: number,
  over: Partial<{ created: string; props: Record<string, Obj>; trashed: boolean }> = {},
): Obj {
  const id = uid(`row:${i}`);
  const created = over.created ?? new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
  return pageObj({
    id,
    parent: rowParent(DS, DB),
    created,
    createdBy: userObj(ADA, 'Ada Lovelace', 'ada@example.com'),
    trashed: over.trashed ?? false,
    properties: {
      Name: value.title('title', `Task ${i}`),
      Status: value.status('st', i % 2 === 0 ? 'In progress' : 'Not started'),
      Priority: value.select('pri', 'High'),
      Due: value.date('due', '2026-09-15'),
      Owner: value.people('own', [userObj(ADA, 'Ada Lovelace', 'ada@example.com')]),
      Tags: value.multiSelect('tag', ['frontend']),
      Points: value.number('pts', i),
      'Depends on': value.relation('dep', []),
      ...over.props,
    },
  });
}

export function roadmapFixture(
  rowCount: number,
  extra: Partial<NotionFixture> = {},
): NotionFixture {
  const pages = Array.from({ length: rowCount }, (_, i) => roadmapRow(i + 1));
  return {
    workspace: { id: uid('ws'), name: 'Test Workspace', botId: uid('bot') },
    userInfoCapability: true,
    users: [
      userObj(ADA, 'Ada Lovelace', 'ada@example.com'),
      userObj(GRACE, 'Grace Hopper', 'grace@example.com'),
    ],
    databases: [
      databaseObj({ id: DB, title: 'Roadmap', dataSources: [{ id: DS, name: 'Roadmap' }] }),
    ],
    dataSources: [
      dataSourceObj({ id: DS, databaseId: DB, title: 'Roadmap', properties: roadmapProperties() }),
    ],
    pages,
    blocks: {},
    ...extra,
  };
}

export interface Harness {
  fake: FakeNotionApi;
  recorder: RequestRecorder;
  clock: VirtualClock;
  logger: ReturnType<typeof createMemoryLogger>;
  source: ReturnType<typeof notionSource.create>;
}

export function connect(
  fixture: NotionFixture,
  options: {
    source?: Record<string, unknown>;
    cap?: number;
    token?: string;
    mode?: 'read-only' | 'read-write';
  } = {},
): Harness {
  const fake = createFakeNotionApi(
    fixture,
    options.cap === undefined ? {} : { queryResultCap: options.cap },
  );
  const recorder = new RequestRecorder();
  const clock = new VirtualClock();
  const logger = createMemoryLogger();
  const context = createConnectorContext(notionSource, options.mode ?? 'read-only', {
    transport: fake.fetch,
    mode: 'live',
    env: { NOTION_TOKEN: options.token ?? TOKEN },
    clock,
    logger,
    recorder,
    concurrency: 4,
  });
  const migration = MigrationConfigSchema.parse({
    version: 1,
    source: { type: 'notion' },
    destination: { type: 'clickup' },
  });
  const config = notionSource.configSchema.parse({
    type: 'notion',
    dataSources: [{ id: DS }],
    ...options.source,
  });
  return { fake, recorder, clock, logger, source: notionSource.create(context, config, migration) };
}

export async function extractAll(harness: Harness): Promise<NotionRaw> {
  return await harness.source.extract();
}

export { block, richTexts, rt, value, schema, uid, userObj, pageObj, rowParent, workspaceParent };
