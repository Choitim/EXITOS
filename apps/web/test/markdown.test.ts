import { describe, expect, it } from 'vitest';
import {
  MAX_MARKDOWN_LENGTH,
  parseInline,
  parseMarkdown,
  plainText,
  type BlockNode,
  type InlineNode,
} from '../src/lib/markdown';

const text = (value: string): InlineNode => ({ type: 'text', text: value });

function first(src: string): BlockNode {
  const node = parseMarkdown(src)[0];
  if (node === undefined) throw new Error(`no block parsed from ${JSON.stringify(src)}`);
  return node;
}

function para(src: string): InlineNode[] {
  const node = first(src);
  if (node.type !== 'paragraph') throw new Error(`expected a paragraph, got ${node.type}`);
  return node.children;
}

/** Every link/image href anywhere in a tree. */
function hrefs(nodes: readonly (BlockNode | InlineNode)[]): Array<string | null> {
  const out: Array<string | null> = [];
  const visit = (node: BlockNode | InlineNode): void => {
    if (node.type === 'link' || node.type === 'image') out.push(node.href);
    if ('children' in node) node.children.forEach(visit);
    if (node.type === 'list') node.items.forEach((item) => item.children.forEach(visit));
    if (node.type === 'table') {
      for (const cell of [...node.head, ...node.rows.flat()]) cell.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return out;
}

describe('blocks', () => {
  it('parses headings 1-4 and leaves deeper ones as text', () => {
    expect(first('# One')).toEqual({ type: 'heading', level: 1, children: [text('One')] });
    expect(first('## Two')).toEqual({ type: 'heading', level: 2, children: [text('Two')] });
    expect(first('### Three')).toEqual({ type: 'heading', level: 3, children: [text('Three')] });
    expect(first('#### Four')).toEqual({ type: 'heading', level: 4, children: [text('Four')] });
    expect(first('##### Five')).toEqual({ type: 'paragraph', children: [text('##### Five')] });
    expect(first('#NoSpace')).toEqual({ type: 'paragraph', children: [text('#NoSpace')] });
  });

  it('strips closing hashes from headings', () => {
    expect(first('## Title ##')).toEqual({ type: 'heading', level: 2, children: [text('Title')] });
  });

  it('parses paragraphs separated by blank lines, with line breaks inside', () => {
    const nodes = parseMarkdown('first line\nsecond line\n\nnext paragraph');
    expect(nodes).toEqual([
      { type: 'paragraph', children: [text('first line'), { type: 'br' }, text('second line')] },
      { type: 'paragraph', children: [text('next paragraph')] },
    ]);
  });

  it('treats a trailing backslash as a hard break', () => {
    expect(para('a\\\nb')).toEqual([text('a'), { type: 'br' }, text('b')]);
  });

  it('parses bullet and numbered lists', () => {
    expect(first('- a\n- b\n* c')).toMatchObject({
      type: 'list',
      ordered: false,
      items: [
        { children: [{ type: 'paragraph' }] },
        { children: [{ type: 'paragraph' }] },
        { children: [{ type: 'paragraph' }] },
      ],
    });
    expect(first('1. a\n2. b')).toMatchObject({ type: 'list', ordered: true, start: 1 });
    expect(first('3) c\n4) d')).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('nests lists by indentation, the way the engine writes them (4 spaces)', () => {
    const md = [
      '- Mechanical',
      '    - Fingertip stiffness',
      '        - Shore 30A silicone',
      '        - Printed lattice',
      '    - Actuation stroke',
      '- Electrical',
    ].join('\n');
    const list = first(md);
    expect(list.type).toBe('list');
    if (list.type !== 'list') return;
    expect(list.items).toHaveLength(2);
    const mechanical = list.items[0];
    expect(mechanical?.children[0]).toEqual({ type: 'paragraph', children: [text('Mechanical')] });
    const level2 = mechanical?.children[1];
    expect(level2?.type).toBe('list');
    if (level2?.type !== 'list') return;
    expect(level2.items).toHaveLength(2);
    const level3 = level2.items[0]?.children[1];
    expect(level3?.type).toBe('list');
    if (level3?.type !== 'list') return;
    expect(
      level3.items.map((i) =>
        plainText(i.children[0]?.type === 'paragraph' ? i.children[0].children : []),
      ),
    ).toEqual(['Shore 30A silicone', 'Printed lattice']);
    expect(list.items[1]?.children[0]).toEqual({
      type: 'paragraph',
      children: [text('Electrical')],
    });
  });

  it('nests with 2-space indentation and under numbered items', () => {
    const list = first('1. Prototype\n  - Cast\n2. Test');
    expect(list).toMatchObject({ type: 'list', ordered: true });
    if (list.type !== 'list') return;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.children[1]).toMatchObject({ type: 'list', ordered: false });
  });

  it('keeps a list going across a blank line between items', () => {
    const list = first('- a\n\n- b');
    expect(list.type === 'list' && list.items.length).toBe(2);
  });

  it('starts a new list when the list type changes', () => {
    const nodes = parseMarkdown('- a\n1. b');
    expect(nodes.map((n) => n.type)).toEqual(['list', 'list']);
  });

  it('recognises task list items', () => {
    const list = first('- [x] done\n- [ ] todo\n- plain');
    expect(list.type === 'list' && list.items.map((i) => i.checked)).toEqual([true, false, null]);
  });

  it('parses blockquotes (and nested content inside them)', () => {
    expect(first('> quoted\n> more')).toEqual({
      type: 'blockquote',
      children: [{ type: 'paragraph', children: [text('quoted'), { type: 'br' }, text('more')] }],
    });
    const quote = first('> - item\n> - item two');
    expect(quote.type === 'blockquote' && quote.children[0]?.type).toBe('list');
  });

  it('parses fenced code blocks verbatim, with and without a language', () => {
    expect(first('```ts\nconst a = *b*;\n# not a heading\n```')).toEqual({
      type: 'code_block',
      lang: 'ts',
      text: 'const a = *b*;\n# not a heading',
    });
    expect(first('~~~\n<script>alert(1)</script>\n~~~')).toEqual({
      type: 'code_block',
      lang: '',
      text: '<script>alert(1)</script>',
    });
  });

  it('closes a fence only with a fence at least as long, and runs to the end if unclosed', () => {
    expect(first('````\n```\ninner\n```\n````')).toMatchObject({
      type: 'code_block',
      text: '```\ninner\n```',
    });
    expect(first('```\nunclosed\nstill code')).toMatchObject({
      type: 'code_block',
      text: 'unclosed\nstill code',
    });
  });

  it('parses horizontal rules', () => {
    for (const rule of ['---', '***', '___', '- - -', '  ----']) {
      expect(first(rule)).toEqual({ type: 'hr' });
    }
  });

  it('parses GFM tables with alignment and padded rows', () => {
    const md = [
      '| Property | Value | N |',
      '| :--- | :---: | ---: |',
      '| a | b | 1 |',
      '| c |',
    ].join('\n');
    const table = first(md);
    expect(table.type).toBe('table');
    if (table.type !== 'table') return;
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.head.map((c) => plainText(c))).toEqual(['Property', 'Value', 'N']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.map((c) => plainText(c))).toEqual(['c', '', '']);
  });

  it('parses the engine "Properties from Notion" table, with escaped pipes and inline formatting', () => {
    const md =
      '**Properties from Notion**\n\n| Property | Value |\n| --- | --- |\n| Reporter | Ada \\| Grace |\n| Notes | **bold** and `code` |';
    const [title, table] = parseMarkdown(md);
    expect(title).toEqual({
      type: 'paragraph',
      children: [{ type: 'strong', children: [text('Properties from Notion')] }],
    });
    expect(table?.type).toBe('table');
    if (table?.type !== 'table') return;
    expect(plainText(table.rows[0]?.[1] ?? [])).toBe('Ada | Grace');
    expect(table.rows[1]?.[1]).toEqual([
      { type: 'strong', children: [text('bold')] },
      text(' and '),
      { type: 'code', text: 'code' },
    ]);
  });

  it('does not mistake a pipe in a paragraph for a table', () => {
    expect(first('a | b\nplain')).toMatchObject({ type: 'paragraph' });
    expect(first('a | b\n--- | ---')).toMatchObject({ type: 'table' });
  });

  it('ends a table at the first blank line', () => {
    const nodes = parseMarkdown('| a |\n| - |\n| 1 |\n\nafter');
    expect(nodes.map((n) => n.type)).toEqual(['table', 'paragraph']);
  });

  it('parses the footer the engine appends', () => {
    const md =
      '---\n\n_Migrated from Notion with ExitOS · created in Notion 2026-08-01T08:00:11.000Z._ [Original Notion page](https://www.notion.so/26418939445640ceaf57af494e8b26fd)\n\n`exitos-key:notion:page:26418939445640ceaf57af494e8b26fd`';
    const nodes = parseMarkdown(md);
    expect(nodes.map((n) => n.type)).toEqual(['hr', 'paragraph', 'paragraph']);
    const footer = nodes[1];
    expect(footer?.type === 'paragraph' && footer.children[0]).toEqual({
      type: 'em',
      children: [
        text('Migrated from Notion with ExitOS · created in Notion 2026-08-01T08:00:11.000Z.'),
      ],
    });
    expect(hrefs(nodes)).toEqual(['https://www.notion.so/26418939445640ceaf57af494e8b26fd']);
    const key = nodes[2];
    expect(key).toEqual({
      type: 'paragraph',
      children: [{ type: 'code', text: 'exitos-key:notion:page:26418939445640ceaf57af494e8b26fd' }],
    });
  });

  it('returns nothing for empty or non-string input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
    expect(parseMarkdown(undefined as unknown as string)).toEqual([]);
  });

  it('normalises CRLF and tabs', () => {
    expect(parseMarkdown('a\r\nb')).toEqual(parseMarkdown('a\nb'));
    const list = first('- a\n\t- b');
    expect(list.type === 'list' && list.items[0]?.children[1]?.type).toBe('list');
  });
});

describe('inline', () => {
  it('parses bold, italic, strikethrough and code', () => {
    expect(parseInline('**b** *i* _u_ ~~s~~ `c`')).toEqual([
      { type: 'strong', children: [text('b')] },
      text(' '),
      { type: 'em', children: [text('i')] },
      text(' '),
      { type: 'em', children: [text('u')] },
      text(' '),
      { type: 'del', children: [text('s')] },
      text(' '),
      { type: 'code', text: 'c' },
    ]);
  });

  it('nests emphasis', () => {
    expect(parseInline('**bold *and italic* text**')).toEqual([
      {
        type: 'strong',
        children: [text('bold '), { type: 'em', children: [text('and italic')] }, text(' text')],
      },
    ]);
    expect(parseInline('***both***')).toEqual([
      { type: 'em', children: [{ type: 'strong', children: [text('both')] }] },
    ]);
  });

  it('does not emphasise snake_case or arithmetic', () => {
    expect(plainText(parseInline('snake_case_name'))).toBe('snake_case_name');
    expect(parseInline('snake_case_name')).toEqual([text('snake_case_name')]);
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
  });

  it('leaves unmatched delimiters as text', () => {
    expect(parseInline('**not closed')).toEqual([text('**not closed')]);
    expect(parseInline('a ~ b ~~ c')).toEqual([text('a ~ b ~~ c')]);
    expect(parseInline('1 ~~~ 2')).toEqual([text('1 ~~~ 2')]);
  });

  it('renders backslash escapes as literal characters', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([text('*not italic*')]);
    expect(parseInline('\\[not a link\\](https://example.com)')).toEqual([
      text('[not a link](https://example.com)'),
    ]);
    expect(parseInline('a \\\\ b \\` c \\_ d \\< e \\> f \\# g \\| h')).toEqual([
      text('a \\ b ` c _ d < e > f # g | h'),
    ]);
    expect(parseInline('keeps \\a backslash')).toEqual([text('keeps \\a backslash')]);
  });

  it('handles the escapes the engine writes (escapeMarkdown)', () => {
    const escaped = 'Revenue \\*Q3\\* \\[draft\\] a\\_b \\<tag\\> \\`tick\\` back\\\\slash';
    expect(parseInline(escaped)).toEqual([
      text('Revenue *Q3* [draft] a_b <tag> `tick` back\\slash'),
    ]);
    expect(parseMarkdown('\\# Not a heading')).toEqual([
      { type: 'paragraph', children: [text('# Not a heading')] },
    ]);
    expect(parseMarkdown('\\- not a list')).toEqual([
      { type: 'paragraph', children: [text('- not a list')] },
    ]);
    expect(parseMarkdown('1\\. not a list')).toEqual([
      { type: 'paragraph', children: [text('1. not a list')] },
    ]);
  });

  it('handles inline code with backticks and padding', () => {
    expect(parseInline('`` a`b ``')).toEqual([{ type: 'code', text: 'a`b' }]);
    expect(parseInline('`*not bold*`')).toEqual([{ type: 'code', text: '*not bold*' }]);
    expect(parseInline('`unclosed')).toEqual([text('`unclosed')]);
  });

  it('parses links, with nested emphasis in the label', () => {
    expect(parseInline('[a **b**](https://example.com/x "title")')).toEqual([
      {
        type: 'link',
        href: 'https://example.com/x',
        children: [text('a '), { type: 'strong', children: [text('b')] }],
      },
    ]);
    expect(parseInline('[plain](mailto:a@b.co)')).toEqual([
      { type: 'link', href: 'mailto:a@b.co', children: [text('plain')] },
    ]);
    expect(parseInline('[paren](https://example.com/a_(b))')).toEqual([
      { type: 'link', href: 'https://example.com/a_(b)', children: [text('paren')] },
    ]);
    expect(parseInline('[angle](<https://example.com/a b>)')).toEqual([
      { type: 'link', href: null, children: [text('angle')] },
    ]);
  });

  it('does not nest links and keeps broken link syntax as text', () => {
    const nodes = parseInline('[outer [inner](https://a.example)](https://b.example)');
    expect(hrefs(nodes)).toEqual(['https://b.example/']);
    expect(parseInline('[no url]')).toEqual([text('[no url]')]);
    expect(parseInline('[a](b')).toEqual([text('[a](b')]);
    expect(parseInline('[a]()')).toEqual([{ type: 'link', href: null, children: [text('a')] }]);
  });

  it('turns images into data nodes with sanitised URLs (never an <img>)', () => {
    expect(parseInline('![alt text](https://example.com/p.png)')).toEqual([
      { type: 'image', href: 'https://example.com/p.png', alt: 'alt text' },
    ]);
    expect(parseInline('![x](javascript:alert(1))')).toEqual([
      { type: 'image', href: null, alt: 'x' },
    ]);
  });

  it('turns a space-encoded engine URL back into a link', () => {
    expect(hrefs(parseInline('[doc](https://example.com/a%20b%28c%29)'))).toEqual([
      'https://example.com/a%20b%28c%29',
    ]);
  });

  it('keeps raw HTML and entities as literal text', () => {
    expect(parseInline('<b>bold</b> &amp; <script>alert(1)</script>')).toEqual([
      text('<b>bold</b> &amp; <script>alert(1)</script>'),
    ]);
    expect(parseInline('<https://example.com>')).toEqual([text('<https://example.com>')]);
  });

  it('supports Unicode: CJK, emoji, RTL, combining marks', () => {
    expect(parseInline('**日本語**のテキスト')).toEqual([
      { type: 'strong', children: [text('日本語')] },
      text('のテキスト'),
    ]);
    expect(parseInline('*中文* 和 ~~한국어~~')).toEqual([
      { type: 'em', children: [text('中文')] },
      text(' 和 '),
      { type: 'del', children: [text('한국어')] },
    ]);
    expect(parseInline('🚀 **launch 🎉** ✅')).toEqual([
      text('🚀 '),
      { type: 'strong', children: [text('launch 🎉')] },
      text(' ✅'),
    ]);
    expect(parseInline('👨‍👩‍👧‍👦 *family*')).toEqual([
      text('👨‍👩‍👧‍👦 '),
      { type: 'em', children: [text('family')] },
    ]);
    expect(parseInline('שלום **עולם**')).toEqual([
      text('שלום '),
      { type: 'strong', children: [text('עולם')] },
    ]);
    expect(parseInline('é *é*')).toEqual([text('é '), { type: 'em', children: [text('é')] }]);
    expect(first('# 見出し 🎌')).toEqual({
      type: 'heading',
      level: 1,
      children: [text('見出し 🎌')],
    });
    expect(first('- 項目一\n- 項目二')).toMatchObject({ type: 'list', items: [{}, {}] });
    expect(parseMarkdown('| 名前 | 値 |\n| --- | --- |\n| 😀 | 日本 |')[0]).toMatchObject({
      type: 'table',
    });
  });

  it('plainText strips formatting', () => {
    expect(
      plainText(parseInline('**a** *b* [c](https://d.example) `e` ![f](https://g.example/h.png)')),
    ).toBe('a b c e f');
  });
});

describe('security', () => {
  it('replaces every unsafe link target by null', () => {
    const md = [
      '[a](javascript:alert(1))',
      '[b](JaVaScRiPt:alert(1))',
      '[d](data:text/html;base64,PHNjcmlwdD4=)',
      '[e](vbscript:msgbox(1))',
      '[f](//evil.example)',
      '[g](file:///etc/passwd)',
      '[h]( javascript:alert(1))',
      '[i](<javascript:alert(1)>)',
      '[j](&#106;avascript:alert(1))',
      '[ok](https://example.com)',
    ].join('\n\n');
    const nodes = parseMarkdown(md);
    expect(hrefs(nodes)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      'https://example.com/',
    ]);
  });

  it('does not even form a link when the destination contains whitespace', () => {
    const nodes = parseInline('[c](java\tscript:alert(1))');
    expect(hrefs(nodes)).toEqual([]);
    expect(plainText(nodes)).toBe('[c](java\tscript:alert(1))');
  });

  it('finds no links inside code spans, code blocks or escaped brackets', () => {
    expect(hrefs(parseMarkdown('`[a](https://x.example)` and \\[b\\](https://y.example)'))).toEqual(
      [],
    );
    expect(hrefs(parseMarkdown('```\n[a](https://x.example)\n```'))).toEqual([]);
  });

  it('keeps hostile HTML as text nodes only', () => {
    const nodes = parseMarkdown(
      '<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">x</a>',
    );
    expect(nodes).toEqual([
      { type: 'paragraph', children: [text('<img src=x onerror=alert(1)>')] },
      { type: 'paragraph', children: [text('<a href="javascript:alert(1)">x</a>')] },
    ]);
    expect(hrefs(nodes)).toEqual([]);
  });

  it('only ever emits the documented node types', () => {
    const allowed = new Set([
      'heading',
      'paragraph',
      'blockquote',
      'list',
      'code_block',
      'hr',
      'table',
      'text',
      'strong',
      'em',
      'del',
      'code',
      'br',
      'link',
      'image',
    ]);
    const seen = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record.type === 'string') seen.add(record.type);
        Object.values(record).forEach(visit);
      }
    };
    visit(
      parseMarkdown(
        '# h\n\ntext **b** *i* ~~s~~ `c` [l](https://x.example) ![i](https://x.example/i.png)\\\nbreak\n\n> q\n\n- a\n  - b\n\n1. n\n\n```\ncode\n```\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |',
      ),
    );
    for (const type of seen) expect(allowed.has(type)).toBe(true);
    expect(seen.size).toBe(allowed.size);
  });
});

describe('robustness', () => {
  it('never throws on adversarial input and stays fast', () => {
    const inputs = [
      '*'.repeat(50_000),
      '_'.repeat(50_000),
      '~~'.repeat(20_000),
      '['.repeat(20_000),
      '[a]('.repeat(5_000),
      '`'.repeat(30_000),
      '> '.repeat(5_000) + 'deep',
      '- '.repeat(5_000) + 'deep',
      Array.from({ length: 200 }, (_, i) => `${'    '.repeat(i)}- level ${i}`).join('\n'),
      '| a |\n| - |\n' + '| x |\n'.repeat(5_000),
      '\u0000�\ud800 lone surrogate \udc00',
      '**a *b ~~c `d` e~~ f* g**'.repeat(2_000),
      'a\n'.repeat(50_000),
    ];
    const started = performance.now();
    for (const input of inputs) {
      expect(() => parseMarkdown(input)).not.toThrow();
    }
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('flattens absurdly deep nesting instead of recursing without bound', () => {
    const deep = Array.from({ length: 100 }, (_, i) => `${' '.repeat(i * 2)}- item ${i}`).join(
      '\n',
    );
    const nodes = parseMarkdown(deep);
    let depth = 0;
    let current: BlockNode | undefined = nodes[0];
    while (current?.type === 'list') {
      depth += 1;
      current = current.items[0]?.children.find((c) => c.type === 'list');
    }
    expect(depth).toBeGreaterThan(3);
    expect(depth).toBeLessThanOrEqual(9);
  });

  it('truncates huge documents and says so', () => {
    const nodes = parseMarkdown('a'.repeat(MAX_MARKDOWN_LENGTH + 10));
    const last = nodes[nodes.length - 1];
    expect(last?.type === 'paragraph' && plainText(last.children)).toContain('Preview truncated');
  });
});
