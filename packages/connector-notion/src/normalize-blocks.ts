import type { DocumentBlock, EntityKey, Finding } from '@exitos/core/sdk';
import { z } from 'zod';
import type { BlockNode } from './model.js';
import { normalizeNotionId } from './ids.js';
import {
  normalizeRichText,
  notionPageKey,
  notionPageUrl,
  plainText,
  validExternalUrl,
} from './normalize-text.js';
import { RichTextArraySchema, isTrashed, type RichTextRaw } from './raw.js';

export interface BlockContext {
  /** The page whose content is being normalised; findings are attached to it. */
  page: EntityKey;
  collection?: EntityKey;
  findings: Finding[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function richText(payload: Record<string, unknown>, key = 'rich_text'): RichTextRaw[] {
  const parsed = RichTextArraySchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : [];
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

function note(ctx: BlockContext, finding: Omit<Finding, 'entity' | 'collection'>): void {
  ctx.findings.push({
    ...finding,
    entity: ctx.page,
    ...(ctx.collection === undefined ? {} : { collection: ctx.collection }),
  });
}

function basename(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last === undefined ? undefined : decodeURIComponent(last);
  } catch {
    return undefined;
  }
}

const FILE_TYPES = new Set(['image', 'file', 'pdf', 'video', 'audio']);

export function normalizeBlocks(nodes: readonly BlockNode[], ctx: BlockContext): DocumentBlock[] {
  const out: DocumentBlock[] = [];
  for (const node of nodes) {
    const block = normalizeNode(node, ctx);
    if (block !== undefined) out.push(block);
  }
  return out;
}

function normalizeNode(node: BlockNode, ctx: BlockContext): DocumentBlock | undefined {
  const raw = node.block;
  if (isTrashed(raw)) return undefined;
  const type = raw.type;
  const payload = asRecord(raw[type]);

  if (
    node.status === 'inaccessible' &&
    !(type === 'synced_block' && node.syncedFrom !== undefined)
  ) {
    // (A synced block whose original is unreadable is reported once, by the renderer.)
    note(ctx, {
      code: 'BLOCK_CHILDREN_INACCESSIBLE',
      outcome: 'unsupported',
      severity: 'warning',
      category: 'permission',
      message:
        'Nested content under a block could not be read: it is not shared with the integration.',
      field: type,
    });
  } else if (node.status === 'depth_limit') {
    note(ctx, {
      code: 'BLOCK_DEPTH_LIMIT',
      outcome: 'lossy',
      severity: 'warning',
      category: 'source_feature',
      message:
        'Nested content below the configured maximum depth was not read (raise limits.maxBlockDepth).',
      field: type,
    });
  } else if (node.status === 'budget') {
    note(ctx, {
      code: 'PAGE_BLOCK_BUDGET',
      outcome: 'lossy',
      severity: 'warning',
      category: 'source_feature',
      message:
        'This page has more blocks than limits.maxBlocksPerPage; the remainder was not read.',
      field: type,
    });
  }

  const base: DocumentBlock = {
    id: normalizeNotionId(raw.id),
    kind: 'unsupported',
    sourceType: type,
    text: [],
    children: [],
  };
  const kids = (): DocumentBlock[] => normalizeBlocks(node.children, ctx);
  const text = (): DocumentBlock['text'] => normalizeRichText(richText(payload));

  switch (type) {
    case 'paragraph':
      return { ...base, kind: 'paragraph', text: text(), children: kids() };

    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'heading_4':
      return {
        ...base,
        kind: 'heading',
        level: Number(type.slice(-1)),
        text: text(),
        children: kids(),
      };

    case 'bulleted_list_item':
      return { ...base, kind: 'bulletedListItem', text: text(), children: kids() };
    case 'numbered_list_item':
      return { ...base, kind: 'numberedListItem', text: text(), children: kids() };
    case 'to_do':
      return {
        ...base,
        kind: 'toDo',
        text: text(),
        checked: bool(payload.checked) === true,
        children: kids(),
      };
    case 'toggle':
      return { ...base, kind: 'toggle', text: text(), children: kids() };
    case 'quote':
      return { ...base, kind: 'quote', text: text(), children: kids() };

    case 'callout': {
      const icon = asRecord(payload.icon);
      const emoji = icon.type === 'emoji' ? str(icon.emoji) : undefined;
      return {
        ...base,
        kind: 'callout',
        text: text(),
        children: kids(),
        ...(emoji === undefined ? {} : { icon: emoji }),
      };
    }

    case 'code': {
      const caption = plainText(richText(payload, 'caption'));
      return {
        ...base,
        kind: 'code',
        text: normalizeRichText(richText(payload)),
        language: str(payload.language) ?? 'plain text',
        ...(caption === '' ? {} : { title: caption }),
      };
    }

    case 'divider':
      return { ...base, kind: 'divider' };

    case 'table':
      return {
        ...base,
        kind: 'table',
        hasColumnHeader: bool(payload.has_column_header) === true,
        hasRowHeader: bool(payload.has_row_header) === true,
        children: kids(),
      };
    case 'table_row': {
      const cells = z.array(RichTextArraySchema).safeParse(payload.cells);
      return {
        ...base,
        kind: 'tableRow',
        cells: cells.success ? cells.data.map((c) => normalizeRichText(c)) : [],
      };
    }

    case 'image':
    case 'file':
    case 'pdf':
    case 'video':
    case 'audio':
      return normalizeFileBlock(type, payload, base);

    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      const url = validExternalUrl(str(payload.url));
      const caption = normalizeRichText(richText(payload, 'caption'));
      return {
        ...base,
        kind: type === 'embed' ? 'embed' : 'bookmark',
        text: caption,
        ...(url === undefined ? {} : { url, title: url }),
      };
    }

    case 'equation':
      return { ...base, kind: 'equation', expression: str(payload.expression) ?? '' };

    case 'child_page': {
      const title = str(payload.title) ?? 'Untitled';
      return {
        ...base,
        kind: 'childPage',
        title,
        target: notionPageKey(raw.id),
        url: notionPageUrl(raw.id),
      };
    }
    case 'child_database':
      return { ...base, kind: 'childDatabase', title: str(payload.title) ?? 'Untitled' };

    case 'column_list':
      return { ...base, kind: 'columnList', children: kids() };
    case 'column':
      return { ...base, kind: 'column', children: kids() };

    case 'synced_block': {
      if (node.status === 'inaccessible' && node.syncedFrom !== undefined) {
        return {
          ...base,
          kind: 'syncedBlock',
          reason: 'original block is not shared with the integration',
        };
      }
      return { ...base, kind: 'syncedBlock', children: kids() };
    }

    case 'link_to_page': {
      const linkType = str(payload.type);
      const pageId = linkType === 'page_id' ? str(payload.page_id) : undefined;
      if (pageId !== undefined) {
        return {
          ...base,
          kind: 'linkToPage',
          target: notionPageKey(pageId),
          url: notionPageUrl(pageId),
          title: 'Linked page',
        };
      }
      return {
        ...base,
        kind: 'linkToPage',
        title: linkType === 'database_id' ? 'Linked database' : 'Link',
      };
    }

    case 'table_of_contents':
      return { ...base, kind: 'tableOfContents' };
    case 'breadcrumb':
      return { ...base, kind: 'breadcrumb' };

    case 'unsupported':
      return {
        ...base,
        kind: 'unsupported',
        sourceType: str(payload.block_type) ?? 'unsupported',
        reason: 'type not exposed by the Notion API',
      };

    default:
      // template, meeting_notes / transcription, tab, and any type added by Notion later.
      return { ...base, kind: 'unsupported', reason: 'block type not supported by ExitOS' };
  }
}

function normalizeFileBlock(
  type: string,
  payload: Record<string, unknown>,
  base: DocumentBlock,
): DocumentBlock {
  const fileKind = (FILE_TYPES.has(type) ? type : 'file') as NonNullable<DocumentBlock['fileKind']>;
  const caption = normalizeRichText(richText(payload, 'caption'));
  const source = str(payload.type);
  const external = asRecord(payload.external);
  const url = source === 'external' ? validExternalUrl(str(external.url)) : undefined;
  const name =
    str(payload.name)?.trim() ||
    plainText(richText(payload, 'caption')).trim() ||
    (url === undefined ? undefined : basename(url)) ||
    type;
  return {
    ...base,
    kind: type === 'image' ? 'image' : 'file',
    fileKind,
    fileName: name,
    text: caption,
    // Notion-hosted and uploaded files are 'internal' (their signed URLs are never kept).
    hosting: source === 'external' ? 'external' : 'internal',
    ...(url === undefined ? {} : { url }),
  };
}
