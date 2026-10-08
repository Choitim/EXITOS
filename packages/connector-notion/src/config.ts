import { z } from 'zod';
import { parseNotionId } from './ids.js';
import { NOTION_API_VERSION } from './network.js';

const NotionIdSchema = z.string().transform((value, ctx) => {
  try {
    return parseNotionId(value);
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid Notion id',
    });
    return z.NEVER;
  }
});

export const NotionSourceConfigSchema = z.strictObject({
  type: z.literal('notion'),
  /** Notion-Version header. Both response shapes (archived / in_trash) are accepted. */
  notionVersion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default(NOTION_API_VERSION),
  /** Sustained request budget. Notion allows ~180/min (3/s) on most plans, 600/min on Business+. */
  requestsPerMinute: z.number().int().min(10).max(600).default(150),
  /**
   * Data sources (or databases — all of a database's data sources are used) to migrate as tasks.
   * Accepts ids or pasted Notion URLs.
   */
  dataSources: z
    .array(
      z.strictObject({
        id: NotionIdSchema,
        /** Informational label for the config file; never trusted. */
        name: z.string().max(200).optional(),
        /** Read each row's page body (blocks) so it can become the task description. */
        bodies: z.boolean().default(true),
      }),
    )
    .default([]),
  /** Standalone pages to migrate as Docs (experimental). */
  pages: z
    .array(
      z.strictObject({
        id: NotionIdSchema,
        name: z.string().max(200).optional(),
        includeChildPages: z.boolean().default(true),
      }),
    )
    .default([]),
  limits: z
    .strictObject({
      maxBlockDepth: z.number().int().min(1).max(20).default(8),
      maxBlocksPerPage: z.number().int().min(10).max(50_000).default(5000),
      maxRecordsPerDataSource: z.number().int().min(1).max(500_000).default(50_000),
      maxPages: z.number().int().min(1).max(10_000).default(2000),
    })
    .prefault({}),
});
export type NotionSourceConfig = z.infer<typeof NotionSourceConfigSchema>;
