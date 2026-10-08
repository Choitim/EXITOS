import { z } from 'zod';
import { ActionIdSchema } from './plan.js';

export const ActionStatusSchema = z.enum([
  'pending',
  'in_flight',
  'succeeded',
  'failed',
  /** Outcome of the write is unknown and could not be reconciled yet. */
  'ambiguous',
  /** A dependency failed, so this action was not attempted. */
  'blocked',
  'skipped',
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/**
 * Run lifecycle. Only `verified` is presented as "complete" (principle 5):
 *
 *   approved → applying → applied → verifying → verified | verification_failed
 *                       ↘ stopped | failed
 */
export const RunStatusSchema = z.enum([
  'approved',
  'applying',
  'stopped',
  'failed',
  'applied',
  'verifying',
  'verified',
  'verification_failed',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StoredErrorSchema = z.object({
  code: z.string().max(60),
  message: z.string().max(500),
});

/** Per-action execution record (the checkpoint). */
export const MigrationCheckpointSchema = z.object({
  runId: z.string(),
  actionId: ActionIdSchema,
  status: ActionStatusSchema,
  attempts: z.number().int().nonnegative(),
  destinationId: z.string().max(100).optional(),
  destinationUrl: z.string().max(2000).optional(),
  lastError: StoredErrorSchema.optional(),
  /** Set when the write was started; used to bound reconciliation searches. */
  inFlightSince: z.string().optional(),
  updatedAt: z.string(),
});
export type MigrationCheckpoint = z.infer<typeof MigrationCheckpointSchema>;

export const RunSummarySchema = z.object({
  runId: z.string(),
  planId: z.string(),
  planHash: z.string(),
  mode: z.enum(['demo', 'live']),
  status: RunStatusSchema,
  approvedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  updatedAt: z.string(),
  counts: z.object({
    pending: z.number().int().nonnegative(),
    in_flight: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    ambiguous: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  stopReason: z.string().max(500).optional(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunEventSchema = z.object({
  id: z.number().int(),
  runId: z.string(),
  ts: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  type: z.string().max(60),
  message: z.string().max(1000),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const IdMappingSchema = z.object({
  sourceKey: z.string(),
  scope: z.string(),
  destinationId: z.string(),
  destinationUrl: z.string().optional(),
  runId: z.string(),
  createdAt: z.string(),
});
export type IdMapping = z.infer<typeof IdMappingSchema>;
