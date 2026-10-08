import { z } from 'zod';

const ClickUpId = z
  .union([z.string(), z.number().int()])
  .transform((v) => String(v).trim())
  .pipe(
    z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Expected a ClickUp id (letters, digits, - or _)'),
  );

/** How one source field maps to ClickUp. Anything omitted is inferred and shown in the plan. */
export const FieldMappingSchema = z.strictObject({
  to: z.enum([
    'status',
    'priority',
    'due_date',
    'start_date',
    'assignees',
    'tags',
    'description',
    'custom_field',
    'skip',
  ]),
  /** Source option value → ClickUp status name (status) or priority 1–4 / name (priority). */
  valueMap: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** Existing ClickUp Custom Field, by name or id (`to: custom_field`). ClickUp's API cannot create fields. */
  field: z.string().min(1).max(200).optional(),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const ListMappingSchema = z.strictObject({
  /** The Notion data source: its id (dashes optional) or its exact title. */
  source: z.string().min(1).max(200),
  listId: ClickUpId,
  fields: z.record(z.string(), FieldMappingSchema).default({}),
  /** `link`: Notion relations become ClickUp linked tasks (symmetric). `skip`: report only. */
  relations: z.enum(['link', 'skip']).default('link'),
});
export type ListMapping = z.infer<typeof ListMappingSchema>;

export const ClickUpDestinationConfigSchema = z.strictObject({
  type: z.literal('clickup'),
  /** ClickUp "team" id (called a Workspace in the UI). */
  workspaceId: ClickUpId,
  /** Sustained request budget. ClickUp allows 100/min on Free/Unlimited/Business; 1000 on Business Plus. */
  requestsPerMinute: z.number().int().min(10).max(10_000).default(90),
  lists: z.array(ListMappingSchema).default([]),
  /** Where Notion pages become ClickUp Docs (experimental). Defaults to the Workspace level. */
  docs: z
    .strictObject({
      parent: z
        .strictObject({
          type: z.enum(['space', 'folder', 'list', 'everything', 'workspace']),
          id: ClickUpId,
        })
        .optional(),
      visibility: z.enum(['PRIVATE', 'PUBLIC', 'PERSONAL', 'HIDDEN']).default('PRIVATE'),
    })
    .prefault({}),
});
export type ClickUpDestinationConfig = z.infer<typeof ClickUpDestinationConfigSchema>;

/** ClickUp's numeric Doc parent types (docs: "Create a Doc"). */
export const DOC_PARENT_TYPE = {
  space: 4,
  folder: 5,
  list: 6,
  everything: 7,
  workspace: 12,
} as const;
