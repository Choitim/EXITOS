import type { DocumentBlock, EntityKey, Finding, Outcome, RichTextSpan } from '../schema/index.js';
import type { FindingCategory } from '../schema/index.js';

/**
 * What the destination's Markdown can express. The renderer consults the policy to decide how to
 * write each block AND how to classify the result (supported / transformed / lossy / unsupported).
 */
export interface RenderPolicy {
  /** Deepest heading level the destination keeps. Deeper headings are flattened (lossy). */
  maxHeadingLevel: 3 | 4;
  supportsUnderline: boolean;
  supportsColor: boolean;
  /** Emit `- [ ]` task items. When false they become plain bullets. */
  taskLists: boolean;
  /** Classify task items as lossy (the destination shows them as text, not real checkboxes). */
  taskListsLossy: boolean;
  /** Tables arrive but lose formatting. Reported once per render as `transformed`. */
  tablesLossy: boolean;
  /** Code blocks arrive but lose formatting/highlighting. Reported once per render. */
  codeBlocksLossy: boolean;
  /** `link`: emit a link to the child page. `omit`: it is migrated separately (Docs sub-pages). */
  childPages: 'link' | 'omit';
  unsupportedBlocks: 'placeholder' | 'omit';
}

export const DEFAULT_RENDER_POLICY: RenderPolicy = {
  maxHeadingLevel: 3,
  supportsUnderline: false,
  supportsColor: false,
  taskLists: true,
  taskListsLossy: false,
  tablesLossy: false,
  codeBlocksLossy: false,
  childPages: 'link',
  unsupportedBlocks: 'placeholder',
};

export interface RenderContext {
  entity: EntityKey;
  collection?: EntityKey;
}

export interface RenderResult {
  markdown: string;
  /** Deduplicated per (code, field): `count` says how many blocks shared it. */
  findings: Finding[];
  blockCount: number;
}

const LIST_KINDS = new Set(['bulletedListItem', 'numberedListItem', 'toDo']);

/** Escape Markdown-significant characters in plain text. */
export function escapeMarkdown(text: string): string {
  const escaped = text.replace(/([\\`*_[\]<>])/g, '\\$1');
  return escaped
    .split('\n')
    .map((line) =>
      line
        // Line-start constructs that would turn text into headings or lists.
        .replace(/^(\s*)(#{1,6})(\s)/, '$1\\$2$3')
        .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
        .replace(/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4'),
    )
    .join('\n');
}

function inlineCode(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function safeUrl(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Only these schemes are ever turned into clickable links in output. */
export function isAllowedLinkUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim());
}

function sameStyle(a: RichTextSpan, b: RichTextSpan): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.strikethrough === !!b.strikethrough &&
    !!a.underline === !!b.underline &&
    !!a.code === !!b.code &&
    a.href === b.href &&
    a.color === b.color &&
    a.equation === undefined &&
    b.equation === undefined &&
    a.mention === undefined &&
    b.mention === undefined
  );
}

function mergeSpans(spans: readonly RichTextSpan[]): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, span)) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

class Collector {
  readonly #map = new Map<string, Finding>();
  constructor(readonly ctx: RenderContext) {}

  note(
    code: string,
    outcome: Outcome,
    category: FindingCategory,
    message: string,
    field?: string,
  ): void {
    const key = `${code}|${field ?? ''}`;
    const existing = this.#map.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      return;
    }
    this.#map.set(key, {
      code,
      outcome,
      severity: outcome === 'supported' || outcome === 'transformed' ? 'info' : 'warning',
      category,
      message,
      entity: this.ctx.entity,
      ...(this.ctx.collection === undefined ? {} : { collection: this.ctx.collection }),
      ...(field === undefined ? {} : { field }),
      count: 1,
    });
  }

  get findings(): Finding[] {
    return [...this.#map.values()];
  }
}

class Renderer {
  blockCount = 0;
  constructor(
    readonly policy: RenderPolicy,
    readonly out: Collector,
  ) {}

  // ---- inline -------------------------------------------------------------------------------

  spans(input: readonly RichTextSpan[], inTable = false): string {
    const pieces: string[] = [];
    for (const span of mergeSpans(input)) pieces.push(this.span(span, inTable));
    return pieces.join('');
  }

  private span(span: RichTextSpan, inTable: boolean): string {
    if (span.equation !== undefined) {
      this.out.note(
        'INLINE_EQUATION_AS_CODE',
        'lossy',
        'formatting',
        'Inline equations are written as code with the LaTeX source; they are not rendered as math.',
      );
      return inlineCode(span.equation);
    }
    if (span.underline === true && !this.policy.supportsUnderline) {
      this.out.note(
        'FORMAT_UNDERLINE_DROPPED',
        'lossy',
        'formatting',
        'Underline is not supported by the destination and was dropped (text kept).',
      );
    }
    if (span.color !== undefined && !this.policy.supportsColor) {
      this.out.note(
        'FORMAT_COLOR_DROPPED',
        'lossy',
        'formatting',
        'Text and background colours are not supported by the destination and were dropped.',
      );
    }
    if (span.mention?.kind === 'user') {
      this.out.note(
        'MENTION_USER_AS_TEXT',
        'transformed',
        'user_mapping',
        'User mentions are kept as plain text; the person is not notified or linked.',
      );
    }

    let text = span.text;
    if (inTable) text = text.replace(/\r?\n/g, ' ');
    let body: string;
    if (span.code === true) {
      body = inlineCode(text);
    } else {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? ['', '', text, ''];
      const lead = m[1] ?? '';
      const core = m[2] ?? '';
      const trail = m[3] ?? '';
      let wrapped = escapeMarkdown(core);
      if (wrapped !== '') {
        if (span.bold === true) wrapped = `**${wrapped}**`;
        if (span.italic === true) wrapped = `*${wrapped}*`;
        if (span.strikethrough === true) wrapped = `~~${wrapped}~~`;
      }
      body = `${lead}${wrapped}${trail}`;
    }
    body = body.replace(/\r?\n/g, '  \n');
    if (inTable) body = body.replace(/\|/g, '\\|');
    if (span.href !== undefined && isAllowedLinkUrl(span.href) && body.trim() !== '') {
      return `[${body.trim()}](${safeUrl(span.href)})`;
    }
    return body;
  }

  // ---- blocks -------------------------------------------------------------------------------

  blocks(blocks: readonly DocumentBlock[]): string {
    const parts: Array<{ kind: string; text: string }> = [];
    let numbered = 0;
    for (const block of blocks) {
      numbered = block.kind === 'numberedListItem' ? numbered + 1 : 0;
      const text = this.block(block, numbered);
      if (text === undefined || text === '') continue;
      parts.push({ kind: block.kind, text });
    }
    let out = '';
    parts.forEach((part, i) => {
      if (i > 0) {
        const prev = parts[i - 1];
        const tight =
          prev !== undefined &&
          LIST_KINDS.has(prev.kind) &&
          LIST_KINDS.has(part.kind) &&
          prev.kind === part.kind;
        out += tight ? '\n' : '\n\n';
      }
      out += part.text;
    });
    return out;
  }

  private indentChildren(children: readonly DocumentBlock[]): string {
    const rendered = this.blocks(children);
    if (rendered === '') return '';
    return rendered
      .split('\n')
      .map((line) => (line === '' ? '' : `    ${line}`))
      .join('\n');
  }

  private captionLine(spans: readonly RichTextSpan[]): string {
    const caption = this.spans(spans).trim();
    return caption === '' ? '' : `\n\n*${caption}*`;
  }

  private placeholder(text: string): string {
    return this.policy.unsupportedBlocks === 'placeholder' ? `*[${text}]*` : '';
  }

  private block(block: DocumentBlock, numberedIndex: number): string | undefined {
    this.blockCount += 1;
    switch (block.kind) {
      case 'paragraph': {
        const inline = this.spans(block.text);
        const children = this.flattenedChildren(block);
        return [inline, children].filter((s) => s !== '').join('\n\n');
      }
      case 'heading': {
        const wanted = block.level ?? 1;
        const level = Math.min(wanted, this.policy.maxHeadingLevel);
        if (wanted > this.policy.maxHeadingLevel) {
          this.out.note(
            'BLOCK_HEADING_LEVEL_FLATTENED',
            'lossy',
            'block_type',
            `Heading level ${wanted} is not supported by the destination; it was written as level ${level}.`,
            block.sourceType,
          );
        }
        const heading = `${'#'.repeat(level)} ${this.spans(block.text).replace(/\s*\n\s*/g, ' ')}`;
        const children = this.flattenedChildren(block);
        return [heading, children].filter((s) => s !== '').join('\n\n');
      }
      case 'bulletedListItem':
        return this.listItem('- ', block);
      case 'numberedListItem':
        return this.listItem(`${numberedIndex}. `, block);
      case 'toDo': {
        if (this.policy.taskListsLossy) {
          this.out.note(
            'BLOCK_TODO_AS_TEXT',
            'lossy',
            'block_type',
            'To-do items arrive as text with a checkbox marker; the destination shows no interactive checkbox.',
            block.sourceType,
          );
        }
        const marker = this.policy.taskLists
          ? block.checked === true
            ? '- [x] '
            : '- [ ] '
          : '- ';
        return this.listItem(marker, block);
      }
      case 'toggle': {
        this.out.note(
          'BLOCK_TOGGLE_FLATTENED',
          'lossy',
          'block_type',
          'Toggles are not supported by the destination: the title is bold and the content is always visible.',
          block.sourceType,
        );
        const title = this.spans(block.text).trim();
        const children = this.blocks(block.children);
        return [title === '' ? '' : `**${title}**`, children].filter((s) => s !== '').join('\n\n');
      }
      case 'quote': {
        const body = [this.spans(block.text), this.blocks(block.children)]
          .filter((s) => s !== '')
          .join('\n\n');
        return quote(body);
      }
      case 'callout': {
        this.out.note(
          'BLOCK_CALLOUT_AS_QUOTE',
          'lossy',
          'block_type',
          'Callouts are written as block quotes; the background colour and callout styling are lost.',
          block.sourceType,
        );
        const icon = block.icon === undefined ? '' : `${block.icon} `;
        const first = `${icon}${this.spans(block.text)}`;
        const body = [first.trim(), this.blocks(block.children)]
          .filter((s) => s !== '')
          .join('\n\n');
        return quote(body);
      }
      case 'code': {
        if (this.policy.codeBlocksLossy) {
          this.out.note(
            'BLOCK_CODE_FORMATTING',
            'transformed',
            'block_type',
            'Code blocks arrive as fenced code; syntax highlighting is not preserved by the destination.',
            block.sourceType,
          );
        }
        const code = block.text.map((s) => s.text).join('');
        const fence = '`'.repeat(
          Math.max(3, ...(code.match(/`+/g) ?? []).map((m) => m.length + 1)),
        );
        const rawLang = (block.language ?? '').trim().toLowerCase();
        const lang = rawLang === 'plain text' ? '' : rawLang.replace(/[^a-z0-9_+#.-]/g, '');
        const caption = block.title ? `\n\n*${escapeMarkdown(block.title)}*` : '';
        return `${fence}${lang}\n${code}\n${fence}${caption}`;
      }
      case 'divider':
        return '---';
      case 'table':
        return this.table(block);
      case 'tableRow':
        return undefined; // rendered by `table`
      case 'image':
      case 'file':
        return this.media(block);
      case 'bookmark':
      case 'embed': {
        if (block.url === undefined || !isAllowedLinkUrl(block.url)) {
          this.out.note(
            'BLOCK_EMBED_NO_URL',
            'unsupported',
            'block_type',
            'An embed or bookmark without a usable https URL could not be migrated.',
            block.sourceType,
          );
          return this.placeholder(`Unsupported Notion ${block.sourceType}`);
        }
        this.out.note(
          'BLOCK_EMBED_AS_LINK',
          'transformed',
          'block_type',
          'Bookmarks, embeds and link previews are written as plain links; the live preview or embed is not preserved.',
          block.sourceType,
        );
        const label = block.title?.trim() || block.url;
        return `[${escapeMarkdown(label)}](${safeUrl(block.url)})${this.captionLine(block.text)}`;
      }
      case 'equation': {
        this.out.note(
          'BLOCK_EQUATION_AS_CODE',
          'lossy',
          'block_type',
          'Equations are written as a LaTeX code block; they are not rendered as math.',
          block.sourceType,
        );
        return `\`\`\`latex\n${block.expression ?? ''}\n\`\`\``;
      }
      case 'childPage': {
        if (this.policy.childPages === 'omit') return undefined;
        const title = block.title?.trim() || 'Untitled';
        this.out.note(
          'BLOCK_CHILD_PAGE_AS_LINK',
          'transformed',
          'block_type',
          'A nested page is written as a link back to the original Notion page; its content is not inlined.',
          block.sourceType,
        );
        return block.url !== undefined && isAllowedLinkUrl(block.url)
          ? `[${escapeMarkdown(title)}](${safeUrl(block.url)})`
          : escapeMarkdown(title);
      }
      case 'childDatabase': {
        this.out.note(
          'BLOCK_CHILD_DATABASE_NOT_INLINED',
          'unsupported',
          'scope',
          'An inline database inside a page body is not migrated here; select it as its own data source to migrate its rows.',
          block.sourceType,
        );
        return this.placeholder(`Inline database "${block.title ?? 'Untitled'}" not migrated`);
      }
      case 'linkToPage': {
        const title = block.title?.trim() || 'Linked page';
        return block.url !== undefined && isAllowedLinkUrl(block.url)
          ? `[${escapeMarkdown(title)}](${safeUrl(block.url)})`
          : escapeMarkdown(title);
      }
      case 'columnList':
      case 'column': {
        if (block.kind === 'columnList') {
          this.out.note(
            'BLOCK_COLUMNS_FLATTENED',
            'lossy',
            'block_type',
            'Column layouts are not supported by the destination; columns are written one after another.',
            block.sourceType,
          );
        }
        return this.blocks(block.children);
      }
      case 'syncedBlock': {
        if (block.reason !== undefined) {
          this.out.note(
            'BLOCK_SYNCED_UNAVAILABLE',
            'unsupported',
            'permission',
            'A synced block whose original is not accessible to the integration could not be copied.',
            block.sourceType,
          );
          return this.placeholder('Synced block content not accessible');
        }
        this.out.note(
          'BLOCK_SYNCED_COPIED',
          'lossy',
          'block_type',
          'Synced blocks are copied as ordinary content; edits no longer propagate between copies.',
          block.sourceType,
        );
        return this.blocks(block.children);
      }
      case 'tableOfContents':
      case 'breadcrumb':
        this.out.note(
          'BLOCK_AUTO_GENERATED_OMITTED',
          'lossy',
          'block_type',
          'Auto-generated blocks (table of contents, breadcrumb) were omitted; the destination builds its own outline.',
          block.sourceType,
        );
        return undefined;
      case 'unsupported':
      default: {
        this.out.note(
          'BLOCK_UNSUPPORTED',
          'unsupported',
          'block_type',
          `Blocks of type "${block.sourceType}" cannot be migrated.`,
          block.sourceType,
        );
        return this.placeholder(`Unsupported Notion block: ${block.sourceType}`);
      }
    }
  }

  private flattenedChildren(block: DocumentBlock): string {
    if (block.children.length === 0) return '';
    this.out.note(
      'BLOCK_NESTING_FLATTENED',
      'lossy',
      'formatting',
      'Indented child content under a paragraph or heading is written at the same level.',
      block.sourceType,
    );
    return this.blocks(block.children);
  }

  private listItem(marker: string, block: DocumentBlock): string {
    const inline = this.spans(block.text).replace(/\n/g, `\n    `);
    const children = this.indentChildren(block.children);
    return children === '' ? `${marker}${inline}` : `${marker}${inline}\n${children}`;
  }

  private media(block: DocumentBlock): string {
    const name = block.fileName ?? block.title ?? 'file';
    if (block.hosting === 'internal') {
      this.out.note(
        'ATTACHMENT_HOSTED_NOT_MIGRATED',
        'unsupported',
        'attachment',
        'Files hosted by Notion are not downloaded or re-uploaded in this version; a placeholder is left in their place.',
        block.sourceType,
      );
      return this.placeholder(
        `${block.fileKind === 'image' ? 'Image' : 'File'} not migrated: "${name}" (hosted by Notion)`,
      );
    }
    if (block.url === undefined) {
      this.out.note(
        'ATTACHMENT_URL_REJECTED',
        'unsupported',
        'attachment',
        'A file with a missing or unusable URL could not be carried over.',
        block.sourceType,
      );
      return this.placeholder(`File not migrated: "${name}" (URL unavailable)`);
    }
    if (!isAllowedLinkUrl(block.url)) {
      this.out.note(
        'ATTACHMENT_URL_REJECTED',
        'unsupported',
        'attachment',
        'A file URL that is not http(s) was rejected and not written.',
        block.sourceType,
      );
      return this.placeholder(`File not migrated: "${name}" (URL not allowed)`);
    }
    this.out.note(
      'ATTACHMENT_EXTERNAL_AS_LINK',
      'transformed',
      'attachment',
      'Externally hosted files are kept as links; the file itself is not copied.',
      block.sourceType,
    );
    const caption = this.captionLine(block.text);
    if (block.fileKind === 'image') {
      return `![${escapeMarkdown(name)}](${safeUrl(block.url)})${caption}`;
    }
    return `[${escapeMarkdown(name)}](${safeUrl(block.url)})${caption}`;
  }

  private table(block: DocumentBlock): string {
    if (this.policy.tablesLossy) {
      this.out.note(
        'BLOCK_TABLE_FORMATTING',
        'transformed',
        'block_type',
        'Tables arrive as plain Markdown tables; the destination does not preserve column widths or cell formatting.',
        block.sourceType,
      );
    }
    const rows = block.children.filter((c) => c.kind === 'tableRow');
    if (rows.length === 0) return '';
    const width = Math.max(1, ...rows.map((r) => r.cells?.length ?? 0));
    const cell = (spans: readonly RichTextSpan[] | undefined, bold: boolean): string => {
      const text = this.spans(spans ?? [], true).trim();
      return bold && text !== '' ? `**${text}**` : text;
    };
    const line = (cells: string[]): string =>
      `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const toLine = (row: DocumentBlock): string =>
      line((row.cells ?? []).map((c, i) => cell(c, block.hasRowHeader === true && i === 0)));

    const lines: string[] = [];
    const [first, ...rest] = rows;
    if (first === undefined) return '';
    if (block.hasColumnHeader === true) {
      lines.push(toLine(first));
      lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
      for (const r of rest) lines.push(toLine(r));
    } else {
      lines.push(line([]));
      lines.push(`| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
      for (const r of rows) lines.push(toLine(r));
    }
    return lines.join('\n');
  }
}

function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

export function renderBlocksToMarkdown(
  blocks: readonly DocumentBlock[],
  policy: RenderPolicy,
  ctx: RenderContext,
): RenderResult {
  const collector = new Collector(ctx);
  const renderer = new Renderer(policy, collector);
  const markdown = renderer.blocks(blocks).trim();
  return { markdown, findings: collector.findings, blockCount: renderer.blockCount };
}

/** Render a single run of rich text (e.g. a property value) with the same rules. */
export function renderSpansToMarkdown(
  spans: readonly RichTextSpan[],
  policy: RenderPolicy,
  ctx: RenderContext,
): { markdown: string; findings: Finding[] } {
  const collector = new Collector(ctx);
  const markdown = new Renderer(policy, collector).spans(spans).trim();
  return { markdown, findings: collector.findings };
}
