import { sha256Hex } from '@exitos/shared';
import {
  entityKey,
  type AttachmentReference,
  type EntityKey,
  type RichTextSpan,
} from '@exitos/core/sdk';
import { normalizeNotionId } from './ids.js';
import type { FileRaw, RichTextRaw } from './raw.js';

export const notionPageKey = (id: string): EntityKey =>
  entityKey('notion', 'page', normalizeNotionId(id));
export const notionUserKey = (id: string): EntityKey =>
  entityKey('notion', 'user', normalizeNotionId(id));
export const notionDataSourceKey = (id: string): EntityKey =>
  entityKey('notion', 'data_source', normalizeNotionId(id));
export const notionPageUrl = (id: string): string =>
  `https://www.notion.so/${normalizeNotionId(id)}`;

/** Only plain http(s) URLs without embedded credentials are ever carried forward. */
export function validExternalUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    if (url.toString().length > 2000) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function linkOf(item: RichTextRaw): string | undefined {
  const href = item.href ?? item.text?.link?.url ?? undefined;
  if (!href) return undefined;
  if (/^mailto:/i.test(href)) return href;
  return validExternalUrl(href);
}

/** Notion rich text → normalized spans, keeping every annotation so loss can be reported later. */
export function normalizeRichText(items: readonly RichTextRaw[]): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  for (const item of items) {
    const span: RichTextSpan = { text: item.plain_text };
    const a = item.annotations;
    if (a?.bold === true) span.bold = true;
    if (a?.italic === true) span.italic = true;
    if (a?.strikethrough === true) span.strikethrough = true;
    if (a?.underline === true) span.underline = true;
    if (a?.code === true) span.code = true;
    if (a?.color !== undefined && a.color !== 'default') span.color = a.color;

    if (item.type === 'equation' && item.equation) {
      span.equation = item.equation.expression;
    } else if (item.type === 'mention' && item.mention) {
      const m = item.mention;
      if (m.type === 'user' && m.user) {
        span.mention = { kind: 'user', target: notionUserKey(m.user.id) };
      } else if (m.type === 'page' && m.page) {
        span.mention = { kind: 'page', target: notionPageKey(m.page.id) };
        const href = validExternalUrl(item.href) ?? notionPageUrl(m.page.id);
        span.href = href;
      } else if (m.type === 'database' && m.database) {
        span.mention = { kind: 'database' };
      } else if (m.type === 'date') {
        span.mention = { kind: 'date' };
      } else if (m.type === 'link_preview' && m.link_preview) {
        span.mention = { kind: 'link_preview' };
        const href = validExternalUrl(m.link_preview.url);
        if (href) span.href = href;
      } else {
        span.mention = { kind: m.type === 'template_mention' ? 'template' : 'other' };
      }
    }
    const link = span.href ?? linkOf(item);
    if (link !== undefined) span.href = link;
    out.push(span);
  }
  return out;
}

export const plainText = (items: readonly RichTextRaw[] | undefined): string =>
  (items ?? []).map((i) => i.plain_text).join('');

/** Stable attachment key that does not depend on the (expiring, signed) URL. */
function attachmentKey(owner: string, field: string, index: number, name: string): EntityKey {
  return entityKey('notion', 'file', sha256Hex(`${owner}|${field}|${index}|${name}`).slice(0, 24));
}

/**
 * A Notion `files` property entry → reference. Signed Notion-hosted URLs are NEVER stored: they are
 * bearer-style credentials that expire after an hour (ADR 0009).
 */
export function normalizeFile(
  file: FileRaw,
  owner: EntityKey,
  field: string,
  index: number,
): AttachmentReference {
  const name = (file.name ?? '').trim() || `file-${index + 1}`;
  const key = attachmentKey(owner, field, index, name);
  if (file.type === 'external' && file.external) {
    const url = validExternalUrl(file.external.url);
    return {
      key,
      name,
      hosting: 'external',
      ...(url === undefined ? {} : { url }),
      owner,
      field,
    };
  }
  if (file.type === 'file_upload') {
    return { key, name, hosting: 'upload', owner, field };
  }
  return {
    key,
    name,
    hosting: 'internal',
    owner,
    field,
    ...(file.file?.expiry_time === undefined ? {} : { expiresAt: file.file.expiry_time }),
  };
}

/** Safe stringification of a scalar API value (never "[object Object]"). */
export function scalarToString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Join the `plain_text` of a rich-text-like array whose elements have not been validated. */
export function titleOf(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return items
    .map((item) => {
      const text =
        item !== null && typeof item === 'object'
          ? (item as Record<string, unknown>).plain_text
          : undefined;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .trim();
}
