import type {
  DashboardState,
  Finding,
  JsonObject,
  MappingRule,
  MigrationAction,
  MigrationPlan,
  RunSummary,
  VerificationResult,
} from '@exitos/core/schema';

const ROADMAP = 'notion:data_source:aaaaaaaa';
const BUGS = 'notion:data_source:bbbbbbbb';

export const finding = (overrides: Partial<Finding> = {}): Finding => ({
  code: 'SOME_FINDING',
  outcome: 'lossy',
  severity: 'warning',
  category: 'field_type',
  message: 'Something is lost.',
  ...overrides,
});

export const mapping = (overrides: Partial<MappingRule> = {}): MappingRule => ({
  id: 'map_1',
  collection: ROADMAP,
  source: { fieldId: 'f1', name: 'Status', kind: 'status', sourceType: 'status' },
  target: { kind: 'status' },
  transform: 'value_map',
  outcome: 'lossy',
  reason: 'One option has no matching status.',
  explicit: true,
  ...overrides,
});

export const action = (
  id: string,
  body: JsonObject,
  overrides: Partial<MigrationAction> = {},
): MigrationAction => ({
  id,
  kind: 'clickup.create_task',
  label: `Create task ${typeof body.name === 'string' ? body.name : id}`,
  source: null,
  idempotencyKey: `key-${id}`,
  scope: 'clickup:list:901001',
  dependsOn: [],
  disposition: 'execute',
  outcome: 'transformed',
  findings: [],
  estimatedRequests: 1,
  payload: { listId: '901001', marker: `exitos-key:${id}`, body },
  ...overrides,
});

export const counts = (overrides: Partial<RunSummary['counts']> = {}): RunSummary['counts'] => ({
  pending: 0,
  in_flight: 0,
  succeeded: 0,
  failed: 0,
  ambiguous: 0,
  blocked: 0,
  skipped: 0,
  ...overrides,
});

export const outcomeCounts = (
  o: Partial<
    Record<'supported' | 'transformed' | 'lossy' | 'unsupported' | 'skipped' | 'failed', number>
  > = {},
) => ({
  supported: 0,
  transformed: 0,
  lossy: 0,
  unsupported: 0,
  skipped: 0,
  failed: 0,
  ...o,
});

export function makePlan(): MigrationPlan {
  const actions = [
    action('act_000000000001', { name: 'Plain task', markdown_content: 'short' }),
    action(
      'act_000000000002',
      {
        name: 'Rich task',
        markdown_content: '# Title\n\n' + 'word '.repeat(100),
        status: 'in progress',
        priority: 2,
        due_date: 1_788_314_400_000,
        due_date_time: false,
        start_date: 1_788_000_000_000,
        start_date_time: true,
        assignees: [1001, 4242],
        tags: ['design', 'research'],
        custom_fields: [
          { id: 'cf-points', value: 8 },
          { id: 'cf-unknown', value: { nested: true } },
        ],
      },
      {
        findings: [
          finding({ outcome: 'transformed', severity: 'info', code: 'FIELD_PRESERVED_AS_TEXT' }),
        ],
      },
    ),
    action(
      'act_000000000003',
      { name: 'Bug in bugs list' },
      {
        scope: 'clickup:list:901002',
        payload: { listId: '901002', body: { name: 'Bug in bugs list' } },
      },
    ),
    {
      ...action('act_000000000004', {}),
      kind: 'clickup.link_tasks',
      label: 'Link A and B',
      payload: { fromAction: 'act_000000000001', toAction: 'act_000000000002' },
    },
  ];
  return {
    schemaVersion: 1,
    mode: 'demo',
    source: {
      connector: { id: 'notion', version: '0.1.0' },
      workspace: { system: 'notion', id: 'ws-notion', name: 'Acme (synthetic)' },
      selection: { type: 'notion' },
    },
    destination: {
      connector: { id: 'clickup', version: '0.1.0' },
      workspace: { system: 'clickup', id: '9000001', name: 'Acme (synthetic)' },
      targets: [
        { kind: 'list', id: '901001', name: 'Roadmap', path: 'Acme / Eng / Roadmap' },
        { kind: 'list', id: '901002', name: 'Bugs' },
      ],
      config: { type: 'clickup' },
    },
    options: { timezone: 'Europe/Berlin', experimentalDocs: true },
    collections: [
      {
        key: ROADMAP,
        name: 'Product Roadmap',
        recordCount: 28,
        target: { kind: 'list', id: '901001', name: 'Roadmap' },
      },
      {
        key: BUGS,
        name: 'Bug Tracker',
        recordCount: 130,
        target: { kind: 'list', id: '901002', name: 'Bugs' },
        incomplete: true,
      },
    ],
    mappings: [
      mapping(),
      mapping({
        id: 'map_2',
        collection: ROADMAP,
        source: { fieldId: 'f2', name: 'Story points', kind: 'number', sourceType: 'number' },
        target: {
          kind: 'custom_field',
          customField: { id: 'cf-points', name: 'Story points', type: 'number' },
        },
        transform: 'direct',
        outcome: 'supported',
        reason: 'Stored in the existing number Custom Field.',
        explicit: false,
        unmappedValues: undefined,
      }),
      mapping({
        id: 'map_3',
        collection: BUGS,
        source: { fieldId: 'f3', name: 'Severity', kind: 'select', sourceType: 'select' },
        target: { kind: 'priority' },
        transform: 'value_map',
        valueMap: { Critical: 1, Minor: 4 },
        unmappedValues: ['Cosmetic'],
        outcome: 'transformed',
        reason: 'Mapped to ClickUp priorities.',
        explicit: true,
      }),
    ],
    actions,
    users: {
      mapped: [
        { source: 'notion:user:ada', name: 'Ada Lovelace', destinationId: '1001', via: 'explicit' },
      ],
      unmapped: [{ source: 'notion:user:linus', name: 'Linus' }],
      assignmentsThatNotify: 2,
    },
    findings: [
      finding({
        code: 'PLAN_ERROR',
        outcome: 'unsupported',
        severity: 'error',
        message: 'Blocked.',
      }),
      finding({
        code: 'PLAN_WARN',
        outcome: 'supported',
        severity: 'warning',
        message: 'Careful.',
      }),
      finding({ code: 'PLAN_INFO', outcome: 'supported', severity: 'info', message: 'FYI.' }),
    ],
    inventory: [
      finding({
        code: 'ATTACHMENT_HOSTED_NOT_MIGRATED',
        outcome: 'unsupported',
        field: 'Attachments',
        collection: ROADMAP,
        count: 2,
        message: 'Files hosted by Notion are not downloaded.',
      }),
      finding({
        code: 'FORMULA_SNAPSHOT',
        outcome: 'lossy',
        field: 'Days until due',
        collection: ROADMAP,
        count: 28,
        message: 'Formula logic is not preserved.',
      }),
      finding({
        code: 'FIELD_PRESERVED_AS_TEXT',
        outcome: 'transformed',
        severity: 'info',
        field: 'Reporter',
        collection: BUGS,
        count: 130,
        message: 'Kept as text in the description.',
      }),
    ],
    summary: {
      actions: {
        total: 4,
        toExecute: 4,
        toSkip: 0,
        byKind: { 'clickup.create_task': 3, 'clickup.link_tasks': 1 },
      },
      items: outcomeCounts({ supported: 1, transformed: 2, lossy: 1 }),
      fields: outcomeCounts({ supported: 1, transformed: 1, lossy: 1 }),
      notPreserved: { unsupported: 2, lossy: 28 },
      blockingErrors: 1,
      warnings: 1,
    },
    estimate: {
      readRequests: 10,
      writeRequests: 4,
      requestsPerMinute: 90,
      minutesAtRateLimit: 0.1,
    },
    knownLimits: ['Comments are never migrated.', 'Views are never migrated.'],
    planId: 'plan_0123456789ab',
    hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    generatedAt: '2026-10-08T09:00:00.000Z',
    exitosVersion: '0.1.0',
  };
}

export function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run_20261008090000_abc123',
    planId: 'plan_0123456789ab',
    planHash: '0123456789abcdef',
    mode: 'demo',
    status: 'verified',
    approvedAt: '2026-10-08T09:00:00.000Z',
    startedAt: '2026-10-08T09:00:01.000Z',
    finishedAt: '2026-10-08T09:02:00.000Z',
    updatedAt: '2026-10-08T09:02:00.000Z',
    counts: counts({ succeeded: 4 }),
    ...overrides,
  };
}

export function makeVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    runId: 'run_20261008090000_abc123',
    planId: 'plan_0123456789ab',
    verifiedAt: '2026-10-08T09:02:00.000Z',
    status: 'failed',
    counts: { verified: 2, mismatched: 1, missing: 1, unverified: 0 },
    targets: [{ target: 'list 901001', expected: 3, found: 2 }],
    items: [
      {
        actionId: 'act_000000000001',
        source: null,
        destinationId: 'd1',
        status: 'verified',
        checks: [{ field: 'name', status: 'verified' }],
      },
      {
        actionId: 'act_000000000002',
        source: null,
        destinationId: 'd2',
        status: 'mismatched',
        checks: [
          { field: 'name', status: 'verified' },
          {
            field: 'status',
            status: 'mismatched',
            expected: 'in progress',
            actual: 'to do',
            note: 'differs',
          },
        ],
      },
      { actionId: 'act_000000000003', source: null, status: 'missing', checks: [] },
    ],
    scope: 'Names and statuses were compared. Comments were not.',
    notes: [],
    ...overrides,
  };
}

export function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  const plan = makePlan();
  const run = makeRun();
  return {
    schemaVersion: 1,
    mode: 'demo',
    generatedAt: '2026-10-08T09:03:00.000Z',
    exitosVersion: '0.1.0',
    plan,
    run,
    runs: [run],
    events: [
      {
        id: 1,
        runId: run.runId,
        ts: '2026-10-08T09:00:01.000Z',
        level: 'info',
        type: 'run_started',
        message: 'Run started.',
      },
    ],
    verification: null,
    report: null,
    ...overrides,
  };
}
