import {
  DEFAULT_RENDER_POLICY,
  isAllowedLinkUrl,
  type DocumentBlock,
  type RenderPolicy,
} from '@exitos/core';
import { PROVENANCE_KEY_PREFIX } from '@exitos/shared';

/**
 * What ClickUp can express, from "Docs API limitation" (developer.clickup.com): no underline or
 * colours, no toggles/checklists/banners/columns, tables and code lose formatting. Heading level 4
 * is not documented, so it is flattened rather than assumed.
 */
export const CLICKUP_TASK_POLICY: RenderPolicy = {
  ...DEFAULT_RENDER_POLICY,
  maxHeadingLevel: 3,
  supportsUnderline: false,
  supportsColor: false,
  taskLists: true,
  taskListsLossy: true,
  tablesLossy: true,
  codeBlocksLossy: true,
  childPages: 'link',
};

export const CLICKUP_DOC_POLICY: RenderPolicy = { ...CLICKUP_TASK_POLICY };

/** Escape a value for a Markdown table cell. */
export function tableCell(markdown: string): string {
  return markdown
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

export function propertiesTable(rows: ReadonlyArray<{ label: string; markdown: string }>): string {
  if (rows.length === 0) return '';
  return [
    '**Properties from Notion**',
    '',
    '| Property | Value |',
    '| --- | --- |',
    ...rows.map((r) => `| ${tableCell(r.label)} | ${tableCell(r.markdown)} |`),
  ].join('\n');
}

export interface FooterInput {
  system: string;
  /** Idempotency key written as the reconciliation marker. */
  key: string;
  sourceUrl?: string | undefined;
  createdAt?: string | undefined;
}

export function markerText(key: string): string {
  return `${PROVENANCE_KEY_PREFIX}${key}`;
}

/** The visible provenance footer. The marker lets a retry find what an ambiguous write created. */
export function provenanceFooter(input: FooterInput): string {
  const link =
    input.sourceUrl !== undefined && isAllowedLinkUrl(input.sourceUrl)
      ? ` [Original ${input.system} page](${input.sourceUrl.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
      : '';
  const created =
    input.createdAt === undefined ? '' : ` · created in ${input.system} ${input.createdAt}`;
  return `_Migrated from ${input.system} with ExitOS${created}._${link}\n\n\`${markerText(input.key)}\``;
}

export function composeMarkdown(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => p !== undefined && p.trim() !== '').join('\n\n---\n\n');
}

/**
 * Remove `child_page` blocks whose page is migrated separately as a Docs sub-page, so the parent
 * page does not also link to them. Child pages that are NOT migrated stay as links.
 */
export function pruneMigratedChildPages(
  blocks: readonly DocumentBlock[],
  migrated: ReadonlySet<string>,
): DocumentBlock[] {
  return blocks
    .filter((b) => !(b.kind === 'childPage' && b.target !== undefined && migrated.has(b.target)))
    .map((b) => ({ ...b, children: pruneMigratedChildPages(b.children, migrated) }));
}

/** Whitespace-insensitive form used when comparing intended and actual Markdown. */
export function normalizeMarkdownForCompare(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .normalize('NFC')
    .trim();
}
