import { stableId } from '@exitos/shared';
import {
  sealPlan,
  summarizePlan,
  buildInventory,
  type Finding,
  type MappingRule,
  type MigrationAction,
  type MigrationPlan,
  type Outcome,
  type PlanBody,
} from '../src/index.js';
import { SqliteStateStore } from '../src/index.js';

export function makeAction(
  n: number,
  options: {
    deps?: string[];
    outcome?: Outcome;
    findings?: Finding[];
    kind?: string;
    disposition?: 'execute' | 'skip';
    existing?: string;
  } = {},
): MigrationAction {
  const key = `test:item:${n}`;
  return {
    id: stableId('act', key, options.kind ?? 'test.create'),
    kind: options.kind ?? 'test.create_item',
    label: `Create item ${n}`,
    source: key,
    idempotencyKey: key,
    scope: 'test:scope',
    dependsOn: options.deps ?? [],
    disposition: options.disposition ?? 'execute',
    ...(options.existing === undefined
      ? {}
      : { skipReason: 'adopted_existing' as const, existingDestinationId: options.existing }),
    outcome: options.outcome ?? 'supported',
    findings: options.findings ?? [],
    estimatedRequests: 1,
    payload: { n },
  };
}

export function makePlan(
  actions: MigrationAction[],
  extra: { findings?: Finding[]; mappings?: MappingRule[]; mode?: 'demo' | 'live' } = {},
): MigrationPlan {
  const findings = extra.findings ?? [];
  const mappings = extra.mappings ?? [];
  const inventory = buildInventory([...findings, ...actions.flatMap((a) => a.findings)]);
  const body: PlanBody = {
    schemaVersion: 1,
    mode: extra.mode ?? 'live',
    source: {
      connector: { id: 'test-src', version: '0.0.0' },
      workspace: { system: 'test', id: 'ws1', name: 'Test source' },
      selection: {},
    },
    destination: {
      connector: { id: 'memory', version: '0.0.0' },
      workspace: { system: 'memory', id: 'mem', name: 'Memory' },
      targets: [],
      config: {},
    },
    options: {},
    collections: [],
    mappings,
    actions,
    users: { mapped: [], unmapped: [], assignmentsThatNotify: 0 },
    findings,
    inventory,
    summary: summarizePlan({
      actions,
      mappings,
      findings: [...findings, ...actions.flatMap((a) => a.findings)],
      inventory,
    }),
    estimate: {
      readRequests: 0,
      writeRequests: actions.length,
      requestsPerMinute: 100,
      minutesAtRateLimit: 0,
    },
    knownLimits: [],
  };
  return sealPlan(body, '2026-01-01T00:00:00.000Z', '0.0.0-test');
}

let tick = 0;
export function memoryStore(): SqliteStateStore {
  tick = 0;
  return SqliteStateStore.open(':memory:', {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
}

export const finding = (over: Partial<Finding> & Pick<Finding, 'code' | 'outcome'>): Finding => ({
  severity: over.outcome === 'supported' || over.outcome === 'transformed' ? 'info' : 'warning',
  category: 'field_type',
  message: `${over.code} message`,
  ...over,
});
