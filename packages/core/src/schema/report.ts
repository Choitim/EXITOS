import { z } from 'zod';
import { EntityKeySchema } from './ids.js';
import { FindingSchema, OutcomeSchema } from './outcome.js';
import { PlanSummarySchema, ActionIdSchema } from './plan.js';
import { ActionStatusSchema, IdMappingSchema, RunSummarySchema } from './run.js';

export const VerificationStatusSchema = z.enum(['verified', 'mismatched', 'missing', 'unverified']);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const FieldCheckSchema = z.object({
  field: z.string().max(200),
  status: VerificationStatusSchema,
  /** Short, truncated renderings. May contain private content; removed by `--redact`. */
  expected: z.string().max(240).optional(),
  actual: z.string().max(240).optional(),
  note: z.string().max(300).optional(),
});
export type FieldCheck = z.infer<typeof FieldCheckSchema>;

export const ItemVerificationSchema = z.object({
  actionId: ActionIdSchema,
  source: EntityKeySchema.nullable(),
  destinationId: z.string().max(100).optional(),
  status: VerificationStatusSchema,
  checks: z.array(FieldCheckSchema),
});
export type ItemVerification = z.infer<typeof ItemVerificationSchema>;

export const VerificationCountsSchema = z.object({
  verified: z.number().int().nonnegative(),
  mismatched: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  unverified: z.number().int().nonnegative(),
});

export const VerificationResultSchema = z.object({
  runId: z.string(),
  planId: z.string(),
  verifiedAt: z.string(),
  /**
   * `passed` only when every planned item verified. `failed` when anything is mismatched or
   * missing. `incomplete` when nothing is wrong but some items could not be checked.
   */
  status: z.enum(['passed', 'failed', 'incomplete']),
  counts: VerificationCountsSchema,
  /** Per destination target: how many items the plan intended vs. how many were found. */
  targets: z.array(
    z.object({
      target: z.string().max(200),
      expected: z.number().int().nonnegative(),
      found: z.number().int().nonnegative(),
    }),
  ),
  items: z.array(ItemVerificationSchema),
  /** Plain-language statement of what was and was not checked. */
  scope: z.string().max(1000),
  notes: z.array(z.string().max(500)),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const ReportStateSchema = z.enum([
  'planned_only',
  'in_progress',
  'partial',
  'failed',
  'applied_unverified',
  'verification_failed',
  'verified',
]);
export type ReportState = z.infer<typeof ReportStateSchema>;

export const ReportItemSchema = z.object({
  actionId: ActionIdSchema,
  label: z.string().max(500),
  source: EntityKeySchema.nullable(),
  status: ActionStatusSchema,
  outcome: OutcomeSchema,
  destinationId: z.string().max(100).optional(),
  destinationUrl: z.string().max(2000).optional(),
  error: z.string().max(500).optional(),
  findings: z.array(FindingSchema),
});
export type ReportItem = z.infer<typeof ReportItemSchema>;

export const MigrationReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  exitosVersion: z.string(),
  mode: z.enum(['demo', 'live']),
  /** True when content (titles, descriptions, names) has been replaced by hashes. */
  redacted: z.boolean(),
  state: ReportStateSchema,
  headline: z.string().max(500),
  plan: z.object({
    planId: z.string(),
    hash: z.string(),
    source: z.object({ system: z.string(), workspace: z.string() }),
    destination: z.object({ system: z.string(), workspace: z.string() }),
    summary: PlanSummarySchema,
  }),
  run: RunSummarySchema.nullable(),
  items: z.array(ReportItemSchema),
  /** Everything lossy or unsupported, aggregated. The core promise of the product. */
  notPreserved: z.array(FindingSchema),
  verification: VerificationResultSchema.nullable(),
  mappings: z.array(IdMappingSchema),
  requests: z
    .object({
      reads: z.number().int().nonnegative(),
      writes: z.number().int().nonnegative(),
      retries: z.number().int().nonnegative(),
      rateLimited: z.number().int().nonnegative(),
    })
    .nullable(),
  /** Standing caveats printed on every report. */
  disclaimers: z.array(z.string().max(500)),
});
export type MigrationReport = z.infer<typeof MigrationReportSchema>;
