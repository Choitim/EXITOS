import { ActionIdSchema, JsonValueSchema } from '@exitos/core';
import { z } from 'zod';

/**
 * Action payloads are part of the plan file, which a user can edit. They are validated strictly
 * (unknown keys rejected) before anything is sent, so a tampered plan cannot smuggle extra ClickUp
 * request fields (e.g. `archived`, `parent`, `links_to`) or path segments.
 */
const SafeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const CreateTaskPayloadSchema = z.strictObject({
  listId: SafeId,
  /** The provenance marker written into the description, or null when provenance is disabled. */
  marker: z.string().max(300).nullable(),
  body: z.strictObject({
    name: z.string().min(1).max(5000),
    markdown_content: z.string().max(2_000_000),
    status: z.string().max(200).optional(),
    priority: z.number().int().min(1).max(4).optional(),
    due_date: z.number().int().optional(),
    due_date_time: z.boolean().optional(),
    start_date: z.number().int().optional(),
    start_date_time: z.boolean().optional(),
    assignees: z.array(z.number().int().positive()).max(50).optional(),
    tags: z.array(z.string().max(200)).max(100).optional(),
    custom_fields: z
      .array(
        z.strictObject({
          id: z.string().max(100),
          value: JsonValueSchema,
          value_options: z.strictObject({ time: z.boolean() }).optional(),
        }),
      )
      .max(100)
      .optional(),
    /** Always false: creating tasks must not notify the token owner (ClickUp notifies assignees regardless). */
    notify_all: z.literal(false),
  }),
});
export type CreateTaskPayload = z.infer<typeof CreateTaskPayloadSchema>;

export const LinkPayloadSchema = z.strictObject({
  fromAction: ActionIdSchema,
  toAction: ActionIdSchema,
});
export type LinkPayload = z.infer<typeof LinkPayloadSchema>;

export const CreateDocPayloadSchema = z.strictObject({
  workspaceId: SafeId,
  name: z.string().max(2000),
  parent: z.strictObject({ id: SafeId, type: z.number().int().min(1).max(20) }),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'PERSONAL', 'HIDDEN']),
});
export type CreateDocPayload = z.infer<typeof CreateDocPayloadSchema>;

export const CreatePagePayloadSchema = z.strictObject({
  workspaceId: SafeId,
  docAction: ActionIdSchema,
  parentPageAction: ActionIdSchema.optional(),
  name: z.string().max(2000),
  content: z.string().max(2_000_000),
  marker: z.string().max(300).nullable(),
});
export type CreatePagePayload = z.infer<typeof CreatePagePayloadSchema>;

export const ACTION_KINDS = {
  createTask: 'clickup.create_task',
  linkTasks: 'clickup.link_tasks',
  createDoc: 'clickup.create_doc',
  createDocPage: 'clickup.create_doc_page',
} as const;
