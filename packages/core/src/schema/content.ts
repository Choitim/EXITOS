import { z } from 'zod';
import { EntityKeySchema } from './ids.js';

/** A run of text with uniform formatting. Underline and colour are kept so loss can be reported. */
export const RichTextSpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  underline: z.boolean().optional(),
  code: z.boolean().optional(),
  /** Any non-default text or background colour (Notion `color`). */
  color: z.string().max(40).optional(),
  href: z.string().max(4000).optional(),
  mention: z
    .object({
      kind: z.enum(['user', 'page', 'database', 'date', 'link_preview', 'template', 'other']),
      target: EntityKeySchema.optional(),
    })
    .optional(),
  /** LaTeX source of an inline equation. */
  equation: z.string().max(10_000).optional(),
});
export type RichTextSpan = z.infer<typeof RichTextSpanSchema>;

export const BlockKindSchema = z.enum([
  'paragraph',
  'heading',
  'bulletedListItem',
  'numberedListItem',
  'toDo',
  'toggle',
  'quote',
  'callout',
  'code',
  'divider',
  'table',
  'tableRow',
  'image',
  'file',
  'bookmark',
  'embed',
  'equation',
  'childPage',
  'childDatabase',
  'columnList',
  'column',
  'syncedBlock',
  'linkToPage',
  'tableOfContents',
  'breadcrumb',
  'unsupported',
]);
export type BlockKind = z.infer<typeof BlockKindSchema>;

export const FileKindSchema = z.enum(['file', 'pdf', 'video', 'audio', 'image']);

/**
 * One block of page content. `sourceType` always preserves the original type name so a destination
 * (or a report) can say exactly what was in the source.
 */
export const DocumentBlockSchema = z.object({
  id: z.string().max(80),
  kind: BlockKindSchema,
  sourceType: z.string().max(80),
  text: z.array(RichTextSpanSchema),
  get children(): z.ZodArray<typeof DocumentBlockSchema> {
    return z.array(DocumentBlockSchema);
  },
  /** Heading level 1–4. */
  level: z.number().int().min(1).max(4).optional(),
  checked: z.boolean().optional(),
  language: z.string().max(60).optional(),
  /** Callout icon (emoji) when the icon is an emoji. */
  icon: z.string().max(20).optional(),
  /** External URL only. Notion-hosted file URLs are signed and expire, so they are never stored. */
  url: z.string().max(4000).optional(),
  hosting: z.enum(['external', 'internal']).optional(),
  fileKind: FileKindSchema.optional(),
  fileName: z.string().max(500).optional(),
  /** Table row cells (kind `tableRow`). */
  cells: z.array(z.array(RichTextSpanSchema)).optional(),
  hasColumnHeader: z.boolean().optional(),
  hasRowHeader: z.boolean().optional(),
  /** Target of `childPage` / `linkToPage` / `childDatabase`. */
  target: EntityKeySchema.optional(),
  title: z.string().max(2000).optional(),
  /** Block-level equation source. */
  expression: z.string().max(10_000).optional(),
  /** Why the block is a placeholder (kind `unsupported`). */
  reason: z.string().max(300).optional(),
});
export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;

export const DocumentSchema = z.object({
  key: EntityKeySchema,
  title: z.string().max(2000),
  url: z.string().max(2000).optional(),
  parent: EntityKeySchema.optional(),
  blocks: z.array(DocumentBlockSchema),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  /** Page icon/cover exist in the source but are not migrated in v0.1. */
  hasIcon: z.boolean().optional(),
  hasCover: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

export function spansToPlainText(spans: readonly RichTextSpan[]): string {
  return spans.map((s) => s.text).join('');
}
