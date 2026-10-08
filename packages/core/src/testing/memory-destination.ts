import { AmbiguousWriteError, ApiError } from '@exitos/shared';
import type {
  ApplyContext,
  ApplyResult,
  DestinationConnector,
  DestinationDiscovery,
  DestinationInspection,
  PlanFragment,
  PlanInput,
  ReconcileRequest,
  ReconcileResult,
  ValidationResult,
  VerifyInput,
  VerifyOutput,
} from '../sdk/types.js';
import type { MigrationAction, MigrationPlan } from '../schema/index.js';

/** What the next call to `apply` for a given idempotency key should do. */
export type Directive =
  | 'ok'
  /** Reject with an API error; nothing is created. */
  | { fail: number }
  /** The write HAPPENED but the response was lost. */
  | { ambiguous: 'created' }
  /** The write did NOT happen and the response was lost. */
  | { ambiguous: 'not_created' };

export interface StoredItem {
  destinationId: string;
  idempotencyKey: string;
  actionId: string;
  payload: unknown;
}

export interface MemoryDestination extends DestinationConnector {
  /** Everything that exists in the "destination", by idempotency key. */
  readonly items: Map<string, StoredItem>;
  /** Every apply call, in order (idempotency keys). Duplicate creation shows up here. */
  readonly applyCalls: string[];
  /** Keys that were created more than once. Must be empty in a correct engine. */
  readonly duplicates: string[];
  /** Queue directives for specific keys. */
  script(key: string, ...directives: Directive[]): void;
  /** If set, `reconcile` reports "not confident". */
  reconcileUndecidable: boolean;
  /** Make verify() report a mismatch for these keys. */
  corrupt: Set<string>;
  /** Delete an item to simulate it vanishing from the destination. */
  remove(key: string): void;
}

/**
 * An in-memory destination with fault injection, for engine tests and for connector authors who
 * want to test their source against the engine without a network.
 */
export function createMemoryDestination(
  options: { id?: string; plan?: (input: PlanInput) => PlanFragment } = {},
): MemoryDestination {
  const items = new Map<string, StoredItem>();
  const applyCalls: string[] = [];
  const duplicates: string[] = [];
  const scripts = new Map<string, Directive[]>();
  let counter = 0;
  const corrupt = new Set<string>();

  const store = (action: MigrationAction): StoredItem => {
    if (items.has(action.idempotencyKey)) duplicates.push(action.idempotencyKey);
    counter += 1;
    const item: StoredItem = {
      destinationId: `mem-${counter}`,
      idempotencyKey: action.idempotencyKey,
      actionId: action.id,
      payload: action.payload,
    };
    items.set(action.idempotencyKey, item);
    return item;
  };

  const dest: MemoryDestination = {
    manifest: {
      id: options.id ?? 'memory',
      name: 'In-memory test destination',
      version: '0.0.0',
      kind: 'destination',
      capabilities: ['test'],
    },
    items,
    applyCalls,
    duplicates,
    corrupt,
    reconcileUndecidable: false,
    script(key, ...directives) {
      scripts.set(key, [...(scripts.get(key) ?? []), ...directives]);
    },
    remove(key) {
      items.delete(key);
    },
    async discover(): Promise<DestinationDiscovery> {
      return { workspaces: [], containers: [], findings: [], notes: [] };
    },
    async inspect(): Promise<DestinationInspection> {
      return {
        workspace: { system: 'memory', id: 'mem', name: 'Memory' },
        targets: [],
        data: {},
        findings: [],
        requests: { reads: 0 },
      };
    },
    plan(input: PlanInput): PlanFragment {
      if (!options.plan) throw new Error('createMemoryDestination: no plan() supplied');
      return options.plan(input);
    },
    async validate(_plan: MigrationPlan): Promise<ValidationResult> {
      return { findings: [], adopted: [], readRequests: 0 };
    },
    async apply(action: MigrationAction, _context: ApplyContext): Promise<ApplyResult> {
      applyCalls.push(action.idempotencyKey);
      const directive = scripts.get(action.idempotencyKey)?.shift() ?? 'ok';
      if (directive === 'ok') {
        const item = store(action);
        return { destinationId: item.destinationId, destinationUrl: `mem://${item.destinationId}` };
      }
      if ('fail' in directive) {
        throw new ApiError('rejected by test destination', {
          system: 'memory',
          status: directive.fail,
          endpoint: 'POST /items',
        });
      }
      if (directive.ambiguous === 'created') store(action);
      throw new AmbiguousWriteError('connection reset after sending the request');
    },
    async reconcile(action: MigrationAction, _request: ReconcileRequest): Promise<ReconcileResult> {
      if (dest.reconcileUndecidable) {
        return { status: 'undecidable', reason: 'listing unavailable' };
      }
      const found = items.get(action.idempotencyKey);
      return found
        ? {
            status: 'found',
            destinationId: found.destinationId,
            destinationUrl: `mem://${found.destinationId}`,
          }
        : { status: 'not_found', confident: true };
    },
    async verify(input: VerifyInput): Promise<VerifyOutput> {
      const byKey = new Map(input.plan.actions.map((a) => [a.id, a]));
      const verifiedItems = input.mappings.map(({ actionId, destinationId }) => {
        const action = byKey.get(actionId) as MigrationAction;
        const present = items.get(action.idempotencyKey);
        const status: 'verified' | 'missing' | 'mismatched' =
          present === undefined || present.destinationId !== destinationId
            ? 'missing'
            : corrupt.has(action.idempotencyKey)
              ? 'mismatched'
              : 'verified';
        return {
          actionId,
          source: action.source,
          destinationId,
          status,
          checks: [{ field: 'existence', status }],
        };
      });
      return {
        items: verifiedItems,
        targets: [{ target: 'memory', expected: input.mappings.length, found: items.size }],
        scope: 'Existence of each planned item in the in-memory destination.',
        notes: [],
        readRequests: 0,
      };
    },
  };
  return dest;
}
