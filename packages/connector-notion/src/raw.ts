import { z } from 'zod';

/**
 * Zod schemas for the parts of the Notion API we read. Everything coming from the network is
 * parsed with these (a trust boundary) — the SDK's compile-time types are not trusted at runtime.
 * Objects are `loose` so new fields Notion adds never break extraction.
 */

const Id = z.string().min(1).max(100);
const OptionalNullableString = z.string().nullish();

export const UserRawSchema = z.looseObject({
  object: z.literal('user').optional(),
  id: Id,
  type: z.enum(['person', 'bot']).optional(),
  name: OptionalNullableString,
  avatar_url: OptionalNullableString,
  person: z.looseObject({ email: OptionalNullableString }).nullish(),
});
export type UserRaw = z.infer<typeof UserRawSchema>;

export const AnnotationsSchema = z
  .looseObject({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    underline: z.boolean().optional(),
    code: z.boolean().optional(),
    color: z.string().optional(),
  })
  .optional();

export const RichTextRawSchema = z.looseObject({
  type: z.string(),
  plain_text: z.string().default(''),
  href: OptionalNullableString,
  annotations: AnnotationsSchema,
  text: z
    .looseObject({
      content: z.string().default(''),
      link: z.looseObject({ url: z.string() }).nullish(),
    })
    .optional(),
  mention: z
    .looseObject({
      type: z.string(),
      user: z.looseObject({ id: Id }).optional(),
      page: z.looseObject({ id: Id }).optional(),
      database: z.looseObject({ id: Id }).optional(),
      date: z
        .looseObject({
          start: z.string(),
          end: OptionalNullableString,
          time_zone: OptionalNullableString,
        })
        .optional(),
      link_preview: z.looseObject({ url: z.string() }).optional(),
    })
    .optional(),
  equation: z.looseObject({ expression: z.string() }).optional(),
});
export type RichTextRaw = z.infer<typeof RichTextRawSchema>;

export const RichTextArraySchema = z.array(RichTextRawSchema);

export const FileRawSchema = z.looseObject({
  name: z.string().optional(),
  type: z.string(),
  file: z
    .looseObject({ url: z.string().optional(), expiry_time: z.string().optional() })
    .optional(),
  external: z.looseObject({ url: z.string() }).optional(),
  file_upload: z.looseObject({ id: Id }).optional(),
});
export type FileRaw = z.infer<typeof FileRawSchema>;

export const ParentSchema = z.looseObject({
  type: z.string(),
  page_id: Id.optional(),
  database_id: Id.optional(),
  data_source_id: Id.optional(),
  block_id: Id.optional(),
  workspace: z.boolean().optional(),
});

/** A single property VALUE on a page. `type` selects which sibling key holds the payload. */
export const PropertyValueRawSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
});
export type PropertyValueRaw = z.infer<typeof PropertyValueRawSchema> & Record<string, unknown>;

const TrashFlags = {
  in_trash: z.boolean().optional(),
  archived: z.boolean().optional(),
  is_archived: z.boolean().optional(),
};

export const PageRawSchema = z.looseObject({
  object: z.literal('page'),
  id: Id,
  created_time: z.string(),
  last_edited_time: z.string(),
  created_by: UserRawSchema.optional(),
  last_edited_by: UserRawSchema.optional(),
  icon: z.unknown().optional(),
  cover: z.unknown().optional(),
  parent: ParentSchema,
  url: z.string().optional(),
  properties: z.record(z.string(), PropertyValueRawSchema),
  ...TrashFlags,
});
export type PageRaw = z.infer<typeof PageRawSchema>;

/** Property schema entry on a data source. */
export const PropertySchemaRawSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: OptionalNullableString,
});
export type PropertySchemaRaw = z.infer<typeof PropertySchemaRawSchema> & Record<string, unknown>;

export const DataSourceRawSchema = z.looseObject({
  object: z.literal('data_source'),
  id: Id,
  title: RichTextArraySchema.default([]),
  description: RichTextArraySchema.optional(),
  parent: ParentSchema.optional(),
  database_parent: ParentSchema.optional(),
  url: z.string().optional(),
  properties: z.record(z.string(), PropertySchemaRawSchema),
  ...TrashFlags,
});
export type DataSourceRaw = z.infer<typeof DataSourceRawSchema>;

export const DatabaseRawSchema = z.looseObject({
  object: z.literal('database'),
  id: Id,
  title: RichTextArraySchema.default([]),
  url: z.string().optional(),
  is_inline: z.boolean().optional(),
  data_sources: z.array(z.looseObject({ id: Id, name: z.string().default('') })).default([]),
  ...TrashFlags,
});
export type DatabaseRaw = z.infer<typeof DatabaseRawSchema>;

export const BlockRawSchema = z.looseObject({
  object: z.literal('block'),
  id: Id,
  type: z.string(),
  has_children: z.boolean().default(false),
  created_time: z.string().optional(),
  last_edited_time: z.string().optional(),
  ...TrashFlags,
});
export type BlockRaw = z.infer<typeof BlockRawSchema> & Record<string, unknown>;

export const RequestStatusSchema = z
  .looseObject({ type: z.string(), incomplete_reason: z.string().optional() })
  .optional();

/** Generic list envelope; `results` are parsed item by item so one odd object cannot sink a page. */
export const ListEnvelopeSchema = z.looseObject({
  object: z.literal('list').optional(),
  results: z.array(z.unknown()),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
  request_status: RequestStatusSchema,
});
export type ListEnvelope = z.infer<typeof ListEnvelopeSchema>;

/** One entry of `GET /pages/{id}/properties/{property_id}` (paginated properties). */
export const PropertyItemRawSchema = z.looseObject({
  object: z.literal('property_item').optional(),
  type: z.string(),
  relation: z.looseObject({ id: Id }).optional(),
  people: UserRawSchema.optional(),
  title: RichTextRawSchema.optional(),
  rich_text: RichTextRawSchema.optional(),
});
export type PropertyItemRaw = z.infer<typeof PropertyItemRawSchema>;

export const BotUserRawSchema = UserRawSchema.extend({
  bot: z
    .looseObject({
      workspace_name: OptionalNullableString,
      workspace_id: z.string().optional(),
      owner: z.looseObject({ type: z.string().optional() }).optional(),
    })
    .nullish(),
});

export function isTrashed(x: {
  in_trash?: boolean | undefined;
  archived?: boolean | undefined;
  is_archived?: boolean | undefined;
}): boolean {
  return x.in_trash === true || x.archived === true || x.is_archived === true;
}
