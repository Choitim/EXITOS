import { z } from 'zod';
import { FieldKindSchema, WorkspaceSchema } from './data.js';
import { EntityKeySchema } from './ids.js';
import { IsoInstantSchema, JsonObjectSchema } from './json.js';
import { FindingSchema, OutcomeSchema } from './outcome.js';

export const ActionIdSchema = z.string().regex(/^act_[0-9a-f]{12}$/);

/** Where a source field's value goes. `dropped` is an explicit, reported decision. */
export const MappingTargetSchema = z.object({
  kind: z.enum([
    'name',
    'description',
    'status',
    'priority',
    'due_date',
    'start_date',
    'assignees',
    'tags',
    'custom_field',
    'link',
    'provenance',
    'description_table',
    'dropped',
  ]),
  /** Destination custom field, when `kind` is `custom_field`. */
  customField: z
    .object({ id: z.string().max(100), name: z.string().max(300), type: z.string().max(60) })
    .optional(),
});
export type MappingTarget = z.infer<typeof MappingTargetSchema>;

export const MappingRuleSchema = z.object({
  id: z.string().max(100),
  collection: EntityKeySchema,
  source: z.object({
    fieldId: z.string().max(200),
    name: z.string().max(500),
    kind: FieldKindSchema,
    sourceType: z.string().max(80),
  }),
  target: MappingTargetSchema,
  transform: z.enum([
    'direct',
    'value_map',
    'epoch_ms',
    'markdown',
    'user_map',
    'name_match',
    'snapshot',
    'text',
    'none',
  ]),
  /** Source value → destination value, when the transform is `value_map`. */
  valueMap: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** Source option values that have no destination equivalent. */
  unmappedValues: z.array(z.string().max(500)).optional(),
  outcome: OutcomeSchema,
  reason: z.string().max(500),
  /** True when the user wrote this mapping in the config rather than ExitOS inferring it. */
  explicit: z.boolean(),
});
export type MappingRule = z.infer<typeof MappingRuleSchema>;

export const ActionDispositionSchema = z.enum(['execute', 'skip']);

export const MigrationActionSchema = z.object({
  id: ActionIdSchema,
  /** Connector-qualified action kind, e.g. `clickup.create_task`. */
  kind: z.string().regex(/^[a-z0-9-]+\.[a-z0-9_]+$/),
  label: z.string().max(500),
  source: EntityKeySchema.nullable(),
  /**
   * Stable key for the item this action creates. Written into the provenance marker and used as
   * the id_map key, so retries and re-plans never create it twice.
   */
  idempotencyKey: z.string().max(220),
  /** Destination scope the mapping is valid in, e.g. `clickup:list:901234`. */
  scope: z.string().max(120),
  dependsOn: z.array(ActionIdSchema),
  disposition: ActionDispositionSchema,
  skipReason: z.enum(['already_migrated', 'adopted_existing', 'excluded']).optional(),
  existingDestinationId: z.string().max(100).optional(),
  outcome: OutcomeSchema,
  findings: z.array(FindingSchema),
  estimatedRequests: z.number().int().nonnegative(),
  /** Destination-shaped request data. Validated by the destination connector at apply time. */
  payload: JsonObjectSchema,
});
export type MigrationAction = z.infer<typeof MigrationActionSchema>;

export const OutcomeCountsSchema = z.object({
  supported: z.number().int().nonnegative(),
  transformed: z.number().int().nonnegative(),
  lossy: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const PlanSummarySchema = z.object({
  actions: z.object({
    total: z.number().int().nonnegative(),
    toExecute: z.number().int().nonnegative(),
    toSkip: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
  }),
  /** Fidelity of each action (item) after combining all its field outcomes. */
  items: OutcomeCountsSchema,
  /** Fidelity of every mapped source field (per collection). */
  fields: OutcomeCountsSchema,
  /** Source items that are intentionally not migrated or cannot be (never silently omitted). */
  notPreserved: z.object({
    unsupported: z.number().int().nonnegative(),
    lossy: z.number().int().nonnegative(),
  }),
  /** Findings with severity `error` stop `apply`. */
  blockingErrors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});
export type PlanSummary = z.infer<typeof PlanSummarySchema>;

export const PlanUsersSchema = z.object({
  mapped: z.array(
    z.object({
      source: EntityKeySchema,
      name: z.string().max(300).optional(),
      destinationId: z.string().max(40),
      via: z.enum(['explicit', 'email']),
    }),
  ),
  unmapped: z.array(z.object({ source: EntityKeySchema, name: z.string().max(300).optional() })),
  /** Number of task assignments that will notify a person in the destination. */
  assignmentsThatNotify: z.number().int().nonnegative(),
});

export type PlanUsers = z.infer<typeof PlanUsersSchema>;

export const PlanTargetSchema = z.object({
  kind: z.string().max(30),
  id: z.string().max(100),
  name: z.string().max(500),
  path: z.string().max(1000).optional(),
});
export type PlanTarget = z.infer<typeof PlanTargetSchema>;

export const PlanCollectionSchema = z.object({
  key: EntityKeySchema,
  name: z.string().max(500),
  recordCount: z.number().int().nonnegative(),
  target: PlanTargetSchema.nullable(),
  incomplete: z.boolean().optional(),
});

export type PlanCollection = z.infer<typeof PlanCollectionSchema>;

export const ConnectorRefSchema = z.object({
  id: z.string().max(60),
  version: z.string().max(30),
});

export const PlanBodySchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(['demo', 'live']),
  source: z.object({
    connector: ConnectorRefSchema,
    workspace: WorkspaceSchema,
    selection: JsonObjectSchema,
  }),
  destination: z.object({
    connector: ConnectorRefSchema,
    workspace: WorkspaceSchema,
    targets: z.array(PlanTargetSchema),
    /**
     * The minimal, credential-free destination config needed to APPLY and VERIFY this plan without
     * the original config file (e.g. workspace id, rate budget). Supplied by the destination.
     */
    config: JsonObjectSchema,
  }),
  /** Sanitised echo of the effective options (never contains credentials). */
  options: JsonObjectSchema,
  collections: z.array(PlanCollectionSchema),
  mappings: z.array(MappingRuleSchema),
  actions: z.array(MigrationActionSchema),
  users: PlanUsersSchema,
  /**
   * Plan-level findings that are not tied to one action (destination checks, user mapping, scope).
   * Any with severity `error` blocks `apply`.
   */
  findings: z.array(FindingSchema),
  /** Aggregated inventory of everything that is not a clean "supported", across all findings. */
  inventory: z.array(FindingSchema),
  summary: PlanSummarySchema,
  estimate: z.object({
    readRequests: z.number().int().nonnegative(),
    writeRequests: z.number().int().nonnegative(),
    requestsPerMinute: z.number().int().positive(),
    minutesAtRateLimit: z.number().nonnegative(),
  }),
  /** Static catalogue of source features this connector pair never migrates. */
  knownLimits: z.array(z.string().max(500)),
});
export type PlanBody = z.infer<typeof PlanBodySchema>;

export const MigrationPlanSchema = PlanBodySchema.extend({
  /** `plan_` + first 12 hex chars of `hash`. This is what the user types to approve. */
  planId: z.string().regex(/^plan_[0-9a-f]{12}$/),
  /** sha256 over the canonical JSON of the body (everything except these four fields). */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  generatedAt: IsoInstantSchema,
  exitosVersion: z.string().max(30),
});
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;
