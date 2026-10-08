/**
 * A small, PURE Markdown parser for the task descriptions the migration engine writes
 * (headings, lists, quotes, fenced code, tables, emphasis, links). It never produces HTML: the
 * result is a plain data tree that `SafeMarkdown` turns into React elements, so React's text
 * escaping is the only thing that ever puts characters on the page.
 *
 * Everything that is not in the supported subset (raw HTML, autolinks, footnotes, entities,
 * setext headings, indented code, ...) is deliberately kept as literal text.
 *
 * Link and image URLs are checked against the allow-list in `url.ts` while parsing, so an unsafe
 * URL is never even present in the tree (`href` is `null`).
 */
import { sanitizeUrl } from './url';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'del'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'br' }
  /** `href` is `null` when the URL failed the allow-list; render the label as plain text. */
  | { type: 'link'; href: string | null; children: InlineNode[] }
  | { type: 'image'; href: string | null; alt: string };

export interface ListItemNode {
  /** `true`/`false` for `[x]`/`[ ]` task items, `null` for ordinary items. */
  checked: boolean | null;
  children: BlockNode[];
}

export type TableAlign = 'left' | 'center' | 'right' | null;

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItemNode[] }
  | { type: 'code_block'; lang: string; text: string }
  | { type: 'hr' }
  | { type: 'table'; align: TableAlign[]; head: InlineNode[][]; rows: InlineNode[][][] };

export type MarkdownNode = BlockNode;

/** Input beyond this many UTF-16 units is cut (and the cut is announced in the output). */
export const MAX_MARKDOWN_LENGTH = 300_000;
/** Nesting of lists and quotes beyond this depth is flattened to text. */
const MAX_BLOCK_DEPTH = 8;
/** Link labels nest at most this deep. */
const MAX_INLINE_DEPTH = 4;
/** More delimiter runs than this in one paragraph are not matched (keeps the work linear-ish). */
const MAX_DELIMITERS = 600;

// ---- helpers -------------------------------------------------------------------------------

const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
}

/** Tabs in the leading whitespace become spaces (tab stops of 4); the rest of the line is untouched. */
function expandLeadingTabs(line: string): string {
  if (!line.startsWith('\t') && !/^ +\t/.test(line)) return line;
  let column = 0;
  let i = 0;
  for (; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === ' ') column += 1;
    else if (ch === '\t') column += 4 - (column % 4);
    else break;
  }
  return ' '.repeat(column) + line.slice(i);
}

function splitLines(src: string): string[] {
  return src.replace(/\r\n?/g, '\n').split('\0').join('\ufffd').split('\n').map(expandLeadingTabs);
}

// ---- block level -------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST_MARKER = /^( *)([-+*]|\d{1,9}[.)])(?:( +)(.*))?$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

interface Marker {
  indent: number;
  ordered: boolean;
  number: number;
  content: string;
}

function matchMarker(line: string): Marker | null {
  if (HR.test(line)) return null;
  const m = LIST_MARKER.exec(line);
  if (!m) return null;
  const indent = (m[1] ?? '').length;
  const marker = m[2] ?? '';
  const ordered = /\d/.test(marker);
  return {
    indent,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : 0,
    content: m[4] ?? '',
  };
}

function matchFence(line: string): { char: string; length: number; lang: string } | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  const fence = m[1] ?? '';
  const info = m[2] ?? '';
  if (fence.startsWith('`') && info.includes('`')) return null;
  const word = info.trim().split(/\s+/)[0] ?? '';
  return {
    char: fence.charAt(0),
    length: fence.length,
    lang: /^[\w+.#-]{1,30}$/.test(word) ? word : '',
  };
}

function matchHeading(line: string): { level: 1 | 2 | 3 | 4; text: string } | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  const hashes = (m[1] ?? '').length;
  // Only levels 1-4 are headings; "#####" and deeper stay literal text.
  if (hashes < 1 || hashes > 4) return null;
  const text = (m[2] ?? '').trim().replace(/(?:^|[ \t]+)#+[ \t]*$/, '');
  return { level: hashes as 1 | 2 | 3 | 4, text: text.trim() };
}

/** Split a table row into cells. `\|` is an escaped pipe and becomes a literal `|` in the cell. */
function splitCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const next = text.charAt(i + 1);
    if (ch === '\\' && next === '|') {
      current += '|';
      i += 1;
    } else if (ch === '\\' && next === '\\') {
      current += '\\\\';
      i += 1;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  // A trailing pipe closes the last cell; text after the last pipe is one more cell.
  if (current.trim() !== '' || !text.trimEnd().endsWith('|')) cells.push(current.trim());
  return cells;
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.includes('|') || !delimiter.includes('|') || !TABLE_DELIMITER.test(delimiter)) {
    return false;
  }
  return splitCells(header).length === splitCells(delimiter).length;
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/** True if this line begins a new block and therefore ends a running paragraph. */
function interruptsParagraph(lines: readonly string[], i: number): boolean {
  const line = lines[i];
  if (line === undefined) return true;
  if (isBlank(line)) return true;
  if (matchFence(line) !== null || HR.test(line) || matchHeading(line) !== null) return true;
  if (QUOTE.test(line)) return true;
  const marker = matchMarker(line);
  if (marker !== null && marker.content.trim() !== '' && (!marker.ordered || marker.number === 1)) {
    return true;
  }
  return isTableStart(lines, i);
}

function parseBlocks(lines: readonly string[], depth: number): BlockNode[] {
  const out: BlockNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    // fenced code
    const fence = matchFence(line);
    if (fence !== null) {
      const fenceIndent = indentOf(line);
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const candidate = lines[i] ?? '';
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(candidate);
        if (
          close &&
          (close[1] ?? '').startsWith(fence.char) &&
          (close[1] ?? '').length >= fence.length
        ) {
          i += 1;
          break;
        }
        body.push(candidate.slice(Math.min(fenceIndent, indentOf(candidate))));
        i += 1;
      }
      out.push({ type: 'code_block', lang: fence.lang, text: body.join('\n') });
      continue;
    }

    if (HR.test(line)) {
      out.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const heading = matchHeading(line);
    if (heading !== null) {
      out.push({ type: 'heading', level: heading.level, children: parseInline(heading.text) });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] ?? '');
        if (!q) break;
        inner.push(q[1] ?? '');
        i += 1;
      }
      out.push({ type: 'blockquote', children: nested(inner, depth) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitCells(line);
      const align = splitCells(lines[i + 1] ?? '').map(alignOf);
      const rows: InlineNode[][][] = [];
      i += 2;
      while (i < lines.length) {
        const row = lines[i] ?? '';
        if (isBlank(row) || !row.includes('|')) break;
        const cells = splitCells(row);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? '')));
        i += 1;
      }
      out.push({ type: 'table', align, head: head.map((c) => parseInline(c)), rows });
      continue;
    }

    if (matchMarker(line) !== null) {
      const parsed = parseList(lines, i, depth);
      out.push(parsed.node);
      i = parsed.next;
      continue;
    }

    // paragraph
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !interruptsParagraph(lines, i)) {
      para.push((lines[i] ?? '').trim());
      i += 1;
    }
    out.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
  }
  return out;
}

/** Parse the content of a quote or list item one level deeper (flattened to text when too deep). */
function nested(lines: readonly string[], depth: number): BlockNode[] {
  if (depth + 1 >= MAX_BLOCK_DEPTH) {
    const text = lines.join('\n').trim();
    return text === '' ? [] : [{ type: 'paragraph', children: [{ type: 'text', text }] }];
  }
  return parseBlocks(lines, depth + 1);
}

function parseList(
  lines: readonly string[],
  start: number,
  depth: number,
): { node: BlockNode; next: number } {
  const first = matchMarker(lines[start] ?? '');
  if (first === null) throw new Error('parseList called on a non-list line');
  const base = first.indent;
  const ordered = first.ordered;
  const items: ListItemNode[] = [];
  let i = start;

  while (i < lines.length) {
    const marker = matchMarker(lines[i] ?? '');
    if (
      marker === null ||
      marker.ordered !== ordered ||
      marker.indent < base ||
      marker.indent >= base + 2
    ) {
      break;
    }
    let content = marker.content;
    let checked: boolean | null = null;
    const task = /^\[([ xX])\](?:[ \t]+|$)/.exec(content);
    if (task) {
      checked = task[1] !== ' ';
      content = content.slice(task[0].length);
    }
    const itemLines: string[] = [content];
    i += 1;

    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (isBlank(next)) {
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j] ?? '')) j += 1;
        if (j < lines.length && indentOf(lines[j] ?? '') >= base + 2) {
          for (let k = i; k < j; k += 1) itemLines.push('');
          i = j;
          continue;
        }
        break;
      }
      const indent = indentOf(next);
      if (indent >= base + 2) {
        itemLines.push(next.slice(base + 2));
        i += 1;
        continue;
      }
      if (matchMarker(next) !== null) break;
      // Lazy continuation of the item's running paragraph text.
      const previous = itemLines[itemLines.length - 1] ?? '';
      if (previous.trim() !== '' && !interruptsParagraph(lines, i)) {
        itemLines.push(next.trim());
        i += 1;
        continue;
      }
      break;
    }

    items.push({ checked, children: nested(itemLines, depth) });

    // Blank lines between items do not end the list when another item of the same list follows.
    let j = i;
    while (j < lines.length && isBlank(lines[j] ?? '')) j += 1;
    if (j > i) {
      const following = j < lines.length ? matchMarker(lines[j] ?? '') : null;
      if (
        following !== null &&
        following.ordered === ordered &&
        following.indent >= base &&
        following.indent < base + 2
      ) {
        i = j;
      } else {
        i = j;
        break;
      }
    }
  }

  return {
    node: { type: 'list', ordered, start: ordered ? first.number : 1, items },
    next: i,
  };
}

// ---- inline level ------------------------------------------------------------------------------

type Token =
  | { kind: 'node'; node: InlineNode }
  | {
      kind: 'delim';
      char: '*' | '_' | '~';
      count: number;
      original: number;
      canOpen: boolean;
      canClose: boolean;
    };

function previousChar(src: string, index: number): string {
  if (index <= 0) return '';
  const chars = Array.from(src.slice(Math.max(0, index - 2), index));
  return chars[chars.length - 1] ?? '';
}

function nextChar(src: string, index: number): string {
  if (index >= src.length) return '';
  const cp = src.codePointAt(index);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

const isSpace = (ch: string): boolean => ch === '' || /^\s$/u.test(ch);
const isPunctuation = (ch: string): boolean => ch !== '' && /^[\p{P}\p{S}]$/u.test(ch);

function delimiterFlags(
  char: '*' | '_' | '~',
  before: string,
  after: string,
): { canOpen: boolean; canClose: boolean } {
  const leftFlanking =
    !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
  const rightFlanking =
    !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
  if (char === '_') {
    return {
      canOpen: leftFlanking && (!rightFlanking || isPunctuation(before)),
      canClose: rightFlanking && (!leftFlanking || isPunctuation(after)),
    };
  }
  return { canOpen: leftFlanking, canClose: rightFlanking };
}

function unescapeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    const next = text.charAt(i + 1);
    if (ch === '\\' && next !== '' && ASCII_PUNCTUATION.includes(next)) {
      out += next;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

interface LinkMatch {
  label: string;
  destination: string;
  end: number;
}

/** Find the `]` that closes the `[` at `open`, skipping escapes, code spans and nested brackets. */
function findClosingBracket(src: string, open: number): number {
  let depth = 1;
  for (let j = open + 1; j < src.length; j += 1) {
    const ch = src.charAt(j);
    if (ch === '\\') {
      j += 1;
    } else if (ch === '`') {
      let k = j;
      while (src.charAt(k) === '`') k += 1;
      const ticks = k - j;
      const closing = findBacktickRun(src, k, ticks);
      if (closing >= 0) j = closing + ticks - 1;
      else j = k - 1;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Index of the next run of EXACTLY `ticks` backticks at or after `from`, or -1. */
function findBacktickRun(src: string, from: number, ticks: number): number {
  let i = from;
  while (i < src.length) {
    if (src.charAt(i) === '`') {
      let k = i;
      while (src.charAt(k) === '`') k += 1;
      if (k - i === ticks) return i;
      i = k;
    } else {
      i += 1;
    }
  }
  return -1;
}

function matchLink(src: string, open: number): LinkMatch | null {
  const close = findClosingBracket(src, open);
  if (close < 0 || src.charAt(close + 1) !== '(') return null;
  const label = src.slice(open + 1, close);
  let k = close + 2;
  while (/[ \t\n]/.test(src.charAt(k))) k += 1;

  let destination: string;
  if (src.charAt(k) === '<') {
    const end = src.indexOf('>', k + 1);
    if (end < 0) return null;
    destination = src.slice(k + 1, end);
    if (/[\n<]/.test(destination)) return null;
    k = end + 1;
  } else {
    let parens = 0;
    let raw = '';
    while (k < src.length) {
      const ch = src.charAt(k);
      if (ch === '\\' && k + 1 < src.length && ASCII_PUNCTUATION.includes(src.charAt(k + 1))) {
        raw += ch + src.charAt(k + 1); // unescaped later, together with the angle-bracket form
        k += 2;
        continue;
      }
      if (/\s/u.test(ch)) break;
      if (ch === '(') parens += 1;
      if (ch === ')') {
        if (parens === 0) break;
        parens -= 1;
      }
      raw += ch;
      k += 1;
    }
    destination = raw;
  }

  while (/[ \t\n]/.test(src.charAt(k))) k += 1;
  const quote = src.charAt(k);
  if (quote === '"' || quote === "'" || quote === '(') {
    const closer = quote === '(' ? ')' : quote;
    let t = k + 1;
    while (t < src.length && src.charAt(t) !== closer) t += src.charAt(t) === '\\' ? 2 : 1;
    if (t >= src.length) return null;
    k = t + 1;
    while (/[ \t\n]/.test(src.charAt(k))) k += 1;
  }
  if (src.charAt(k) !== ')') return null;
  return { label, destination, end: k + 1 };
}

function tokenize(src: string, depth: number, inLink: boolean): Token[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') {
      tokens.push({ kind: 'node', node: { type: 'text', text } });
      text = '';
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);

    if (ch === '\\') {
      const next = src.charAt(i + 1);
      if (next === '\n') {
        flush();
        tokens.push({ kind: 'node', node: { type: 'br' } });
        i += 2;
      } else if (next !== '' && ASCII_PUNCTUATION.includes(next)) {
        text += next;
        i += 2;
      } else {
        text += '\\';
        i += 1;
      }
      continue;
    }

    if (ch === '`') {
      let k = i;
      while (src.charAt(k) === '`') k += 1;
      const ticks = k - i;
      const closing = findBacktickRun(src, k, ticks);
      if (closing < 0) {
        text += '`'.repeat(ticks);
        i = k;
        continue;
      }
      let code = src.slice(k, closing).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
        code = code.slice(1, -1);
      }
      flush();
      tokens.push({ kind: 'node', node: { type: 'code', text: code } });
      i = closing + ticks;
      continue;
    }

    if (ch === '\n') {
      text = text.replace(/ +$/, '');
      flush();
      tokens.push({ kind: 'node', node: { type: 'br' } });
      i += 1;
      continue;
    }

    if (ch === '[' || (ch === '!' && src.charAt(i + 1) === '[')) {
      const image = ch === '!';
      const open = image ? i + 1 : i;
      const allowed = image || (!inLink && depth < MAX_INLINE_DEPTH);
      const match = allowed ? matchLink(src, open) : null;
      if (match === null) {
        text += src.slice(i, open + 1);
        i = open + 1;
        continue;
      }
      flush();
      const href = sanitizeUrl(unescapeText(match.destination));
      if (image) {
        tokens.push({
          kind: 'node',
          node: {
            type: 'image',
            href,
            alt: plainText(parseInlineAt(match.label, depth + 1, true)),
          },
        });
      } else {
        tokens.push({
          kind: 'node',
          node: { type: 'link', href, children: parseInlineAt(match.label, depth + 1, true) },
        });
      }
      i = match.end;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      let k = i;
      while (src.charAt(k) === ch) k += 1;
      const count = k - i;
      if (ch === '~' && count !== 2) {
        text += ch.repeat(count);
        i = k;
        continue;
      }
      const flags = delimiterFlags(ch, previousChar(src, i), nextChar(src, k));
      flush();
      tokens.push({ kind: 'delim', char: ch, count, original: count, ...flags });
      i = k;
      continue;
    }

    // Plain run: jump to the next character that might start something.
    let k = i + 1;
    while (k < src.length && !'\\`\n[!*_~'.includes(src.charAt(k))) k += 1;
    text += src.slice(i, k);
    i = k;
  }
  flush();
  return tokens;
}

function tokensToNodes(tokens: readonly Token[]): InlineNode[] {
  const out: InlineNode[] = [];
  const push = (node: InlineNode): void => {
    const last = out[out.length - 1];
    if (node.type === 'text' && last?.type === 'text') last.text += node.text;
    else out.push(node);
  };
  for (const token of tokens) {
    if (token.kind === 'node') push(token.node);
    else if (token.count > 0) push({ type: 'text', text: token.char.repeat(token.count) });
  }
  return out;
}

/** CommonMark's "process emphasis", reduced to `*`, `_` and `~~`. */
function processEmphasis(tokens: Token[]): void {
  let delimiters = 0;
  for (const t of tokens) if (t.kind === 'delim') delimiters += 1;
  if (delimiters > MAX_DELIMITERS) return;

  let ci = 0;
  while (ci < tokens.length) {
    const closer = tokens[ci];
    if (closer?.kind !== 'delim' || !closer.canClose || closer.count === 0) {
      ci += 1;
      continue;
    }
    let found = -1;
    for (let oi = ci - 1; oi >= 0; oi -= 1) {
      const opener = tokens[oi];
      if (
        opener?.kind !== 'delim' ||
        opener.char !== closer.char ||
        !opener.canOpen ||
        opener.count === 0
      ) {
        continue;
      }
      if (closer.char === '~' && (opener.count < 2 || closer.count < 2)) continue;
      // "Rule of 3": a delimiter that can both open and close only matches if the sums allow it.
      const bothSided = closer.canOpen || opener.canClose;
      if (
        closer.char !== '~' &&
        bothSided &&
        (opener.original + closer.original) % 3 === 0 &&
        !(opener.original % 3 === 0 && closer.original % 3 === 0)
      ) {
        continue;
      }
      found = oi;
      break;
    }
    if (found < 0) {
      ci += 1;
      continue;
    }
    const opener = tokens[found];
    if (opener?.kind !== 'delim' || ci === found + 1) {
      ci += 1;
      continue;
    }
    const use = closer.char === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const children = tokensToNodes(tokens.slice(found + 1, ci));
    const node: InlineNode =
      closer.char === '~'
        ? { type: 'del', children }
        : use === 2
          ? { type: 'strong', children }
          : { type: 'em', children };
    opener.count -= use;
    closer.count -= use;
    tokens.splice(found + 1, ci - found - 1, { kind: 'node', node });
    let closerIndex = found + 2;
    if (closer.count === 0) tokens.splice(closerIndex, 1);
    if (opener.count === 0) {
      tokens.splice(found, 1);
      closerIndex -= 1;
    }
    ci = closerIndex;
  }
}

function parseInlineAt(src: string, depth: number, inLink: boolean): InlineNode[] {
  if (src === '') return [];
  const tokens = tokenize(src, depth, inLink);
  processEmphasis(tokens);
  return tokensToNodes(tokens);
}

/** Parse inline Markdown (emphasis, code, links, line breaks) into a tree. */
export function parseInline(src: string): InlineNode[] {
  return parseInlineAt(src, 0, false);
}

/** The text of an inline tree with all formatting removed. */
export function plainText(nodes: readonly InlineNode[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        out += node.text;
        break;
      case 'br':
        out += '\n';
        break;
      case 'image':
        out += node.alt;
        break;
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        out += plainText(node.children);
        break;
    }
  }
  return out;
}

/** Parse a Markdown document into a tree of blocks. Never throws on any string input. */
export function parseMarkdown(src: string): MarkdownNode[] {
  if (typeof src !== 'string' || src === '') return [];
  const truncated = src.length > MAX_MARKDOWN_LENGTH;
  const nodes = parseBlocks(splitLines(truncated ? src.slice(0, MAX_MARKDOWN_LENGTH) : src), 0);
  if (truncated) {
    nodes.push({
      type: 'paragraph',
      children: [
        {
          type: 'text',
          text: `[Preview truncated: ${(src.length - MAX_MARKDOWN_LENGTH).toLocaleString('en-US')} more characters not shown.]`,
        },
      ],
    });
  }
  return nodes;
}
