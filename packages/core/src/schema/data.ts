import { z } from 'zod';
import { RichTextSpanSchema, DocumentSchema } from './content.js';
import { EntityKeySchema } from './ids.js';
import { FindingSchema } from './outcome.js';

/** Identity of a system instance (a Notion workspace, a ClickUp Workspace). */
export const WorkspaceSchema = z.object({
  system: z.string().min(1).max(40),
  id: z.string().min(1).max(100),
  name: z.string().max(300),
  url: z.string().max(2000).optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const UserReferenceSchema = z.object({
  key: EntityKeySchema,
  id: z.string().max(100),
  name: z.string().max(300).optional(),
  /** Only present when the source credential is allowed to read e-mail addresses. */
  email: z.string().max(320).optional(),
  type: z.enum(['person', 'bot', 'unknown']).default('unknown'),
});
export type UserReference = z.infer<typeof UserReferenceSchema>;

/**
 * Attachments are references only (ADR 0009). `url` is set solely for external, validated https
 * links; Notion-hosted signed URLs are deliberately never stored.
 */
export const AttachmentReferenceSchema = z.object({
  key: EntityKeySchema,
  name: z.string().max(500),
  hosting: z.enum(['internal', 'external', 'upload']),
  url: z.string().max(4000).optional(),
  mimeType: z.string().max(200).optional(),
  owner: EntityKeySchema,
  field: z.string().max(300).optional(),
  /** When a Notion-hosted URL would have expired (informational). */
  expiresAt: z.string().optional(),
});
export type AttachmentReference = z.infer<typeof AttachmentReferenceSchema>;

export const FieldKindSchema = z.enum([
  'title',
  'text',
  'number',
  'select',
  'multiSelect',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'relation',
  'files',
  'computed',
  'timestamp',
  'userStamp',
  'uniqueId',
  'unsupported',
]);
export type FieldKind = z.infer<typeof FieldKindSchema>;

export const FieldOptionSchema = z.object({
  id: z.string().max(100).optional(),
  name: z.string().max(500),
  color: z.string().max(40).optional(),
  /** Status group (Notion `To-do` / `In progress` / `Complete`). */
  group: z.string().max(100).optional(),
});
export type FieldOption = z.infer<typeof FieldOptionSchema>;

export const FieldDefinitionSchema = z.object({
  /** Stable source identifier (Notion property id). */
  id: z.string().min(1).max(200),
  name: z.string().max(500),
  kind: FieldKindSchema,
  /** The original type name, e.g. `rollup`. Always kept, even when `kind` is `unsupported`. */
  sourceType: z.string().max(80),
  options: z.array(FieldOptionSchema).optional(),
  readOnly: z.boolean().optional(),
  relation: z
    .object({
      targetCollection: EntityKeySchema.optional(),
      targetInScope: z.boolean(),
      dual: z.boolean().optional(),
    })
    .optional(),
  computed: z.object({ type: z.enum(['formula', 'rollup']) }).optional(),
  uniqueIdPrefix: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const DateValueSchema = z.object({
  /** ISO 8601 date or datetime exactly as the source supplied it. */
  start: z.string().max(60),
  end: z.string().max(60).nullable().optional(),
  timeZone: z.string().max(80).nullable().optional(),
});
export type DateValue = z.infer<typeof DateValueSchema>;

export const RelationTargetSchema = z.object({
  key: EntityKeySchema,
  /** Title of the target when it was part of the extraction. */
  title: z.string().max(2000).optional(),
});

export const FieldValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('title'),
    text: z.string(),
    spans: z.array(RichTextSpanSchema).optional(),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    spans: z.array(RichTextSpanSchema).optional(),
  }),
  z.object({ kind: z.literal('number'), value: z.number().nullable() }),
  z.object({ kind: z.literal('select'), name: z.string().nullable(), id: z.string().optional() }),
  z.object({
    kind: z.literal('status'),
    name: z.string().nullable(),
    id: z.string().optional(),
    group: z.string().optional(),
  }),
  z.object({ kind: z.literal('multiSelect'), names: z.array(z.string()) }),
  z.object({ kind: z.literal('date'), value: DateValueSchema.nullable() }),
  z.object({ kind: z.literal('checkbox'), value: z.boolean() }),
  z.object({ kind: z.literal('url'), value: z.string().nullable() }),
  z.object({ kind: z.literal('email'), value: z.string().nullable() }),
  z.object({ kind: z.literal('phone'), value: z.string().nullable() }),
  z.object({ kind: z.literal('person'), users: z.array(UserReferenceSchema) }),
  z.object({
    kind: z.literal('relation'),
    targets: z.array(RelationTargetSchema),
    /** True if the source indicated more relations than could be read. */
    truncated: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('files'), attachments: z.array(AttachmentReferenceSchema) }),
  z.object({
    kind: z.literal('computed'),
    computedType: z.enum(['formula', 'rollup']),
    /** Human-readable snapshot of the last computed value, or null if unavailable. */
    display: z.string().nullable(),
    complete: z.boolean(),
  }),
  z.object({ kind: z.literal('timestamp'), iso: z.string().nullable() }),
  z.object({ kind: z.literal('userStamp'), user: UserReferenceSchema.nullable() }),
  z.object({
    kind: z.literal('uniqueId'),
    prefix: z.string().nullable(),
    number: z.number().int().nullable(),
    display: z.string().nullable(),
  }),
  z.object({ kind: z.literal('unsupported'), sourceType: z.string() }),
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const CollectionSchema = z.object({
  key: EntityKeySchema,
  system: z.string(),
  id: z.string(),
  name: z.string().max(500),
  description: z.string().max(5000).optional(),
  url: z.string().max(2000).optional(),
  fields: z.array(FieldDefinitionSchema),
  recordCount: z.number().int().nonnegative(),
  /** True when the extractor could not read every record (e.g. a documented API cap). */
  incomplete: z.boolean().optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

/**
 * One row. Named `DataRecord` in code because `Record<K, V>` is a TypeScript built-in; it is the
 * "Record" entity of the domain model.
 */
export const DataRecordSchema = z.object({
  key: EntityKeySchema,
  collection: EntityKeySchema,
  title: z.string().max(2000),
  url: z.string().max(2000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archived: z.boolean(),
  /** Keyed by `FieldDefinition.id`. */
  values: z.record(z.string(), FieldValueSchema),
  /** Page body, when extracted. */
  body: EntityKeySchema.optional(),
});
export type DataRecord = z.infer<typeof DataRecordSchema>;

export const RelationshipSchema = z.object({
  field: z.string().max(200),
  fieldName: z.string().max(500),
  from: EntityKeySchema,
  to: EntityKeySchema,
  toTitle: z.string().max(2000).optional(),
  /** The target record is part of this extraction. */
  resolved: z.boolean(),
  /** The target's collection is selected for migration. */
  inScope: z.boolean(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const SourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  source: WorkspaceSchema,
  extractedAt: z.string(),
  collections: z.array(CollectionSchema),
  records: z.array(DataRecordSchema),
  documents: z.array(DocumentSchema),
  relationships: z.array(RelationshipSchema),
  attachments: z.array(AttachmentReferenceSchema),
  users: z.array(UserReferenceSchema),
  findings: z.array(FindingSchema),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
