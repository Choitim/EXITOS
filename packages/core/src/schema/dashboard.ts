import { z } from 'zod';
import { MigrationPlanSchema } from './plan.js';
import { MigrationReportSchema, VerificationResultSchema } from './report.js';
import { RunEventSchema, RunSummarySchema } from './run.js';

/**
 * Everything the local dashboard shows, in one JSON document served by `exitos ui`. It is built
 * from the state database by the local server; the browser never talks to Notion or ClickUp and
 * never sees a credential (none is ever stored in state).
 */
export const DashboardStateSchema = z.object({
  schemaVersion: z.literal(1),
  /** `empty` when the state directory holds no plan or run yet. */
  mode: z.enum(['demo', 'live', 'empty']),
  generatedAt: z.string(),
  exitosVersion: z.string(),
  plan: MigrationPlanSchema.nullable(),
  run: RunSummarySchema.nullable(),
  runs: z.array(RunSummarySchema),
  events: z.array(RunEventSchema),
  verification: VerificationResultSchema.nullable(),
  report: MigrationReportSchema.nullable(),
});
export type DashboardState = z.infer<typeof DashboardStateSchema>;
