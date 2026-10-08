import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_POLICY,
  escapeMarkdown,
  isAllowedLinkUrl,
  renderBlocksToMarkdown,
  type DocumentBlock,
  type RenderPolicy,
  type RichTextSpan,
} from '../src/index.js';

const ctx = { entity: 'notion:page:abc' } as const;
let n = 0;
const t = (text: string, over: Partial<RichTextSpan> = {}): RichTextSpan => ({ text, ...over });
const block = (kind: DocumentBlock['kind'], over: Partial<DocumentBlock> = {}): DocumentBlock => ({
  id: `b${n++}`,
  kind,
  sourceType: over.sourceType ?? kind,
  text: [],
  children: [],
  ...over,
});
const para = (...spans: RichTextSpan[]) =>
  block('paragraph', { text: spans, sourceType: 'paragraph' });
const render = (blocks: DocumentBlock[], policy: Partial<RenderPolicy> = {}) =>
  renderBlocksToMarkdown(blocks, { ...DEFAULT_RENDER_POLICY, ...policy }, ctx);
const codes = (r: ReturnType<typeof render>) => r.findings.map((f) => f.code).sort();

describe('inline formatting', () => {
  it('writes bold, italic, strikethrough and inline code', () => {
    const r = render([
      para(
        t('a', { bold: true }),
        t(' b ', {}),
        t('c', { italic: true }),
        t(' '),
        t('d', { strikethrough: true }),
        t(' '),
        t('e', { code: true }),
      ),
    ]);
    expect(r.markdown).toBe('**a** b *c* ~~d~~ `e`');
  });

  it('keeps emphasis markers hugging the text (whitespace moved outside)', () => {
    expect(render([para(t(' bold ', { bold: true }), t('x'))]).markdown).toBe('**bold** x');
  });

  it('merges adjacent spans that share formatting', () => {
    expect(render([para(t('he', { bold: true }), t('llo', { bold: true }))]).markdown).toBe(
      '**hello**',
    );
  });

  it('escapes Markdown control characters so content cannot change structure', () => {
    expect(escapeMarkdown('2 * 3 = _six_ [x] <b> `c`')).toBe(
      '2 \\* 3 = \\_six\\_ \\[x\\] \\<b\\> \\`c\\`',
    );
    expect(render([para(t('# not a heading'))]).markdown).toBe('\\# not a heading');
    expect(render([para(t('- not a list'))]).markdown).toBe('\\- not a list');
    expect(render([para(t('1. not numbered'))]).markdown).toBe(
      '1\\. not numbered'.replace('1\\.', '1\\.'),
    );
  });

  it('handles inline code containing backticks', () => {
    expect(render([para(t('a`b', { code: true }))]).markdown).toBe('``a`b``');
  });

  it('preserves Unicode: CJK, emoji, combining marks, RTL', () => {
    const text = '日本語のタスク 🚀 café naïve العربية שלום';
    expect(render([para(t(text))]).markdown).toBe(text);
    expect(render([para(t('é'))]).markdown).toBe('é');
  });

  it('turns soft line breaks into Markdown hard breaks', () => {
    expect(render([para(t('line1\nline2'))]).markdown).toBe('line1  \nline2');
  });

  it('reports dropped underline and colour exactly once per kind', () => {
    const r = render([
      para(
        t('a', { underline: true }),
        t('b', { underline: true, color: 'red' }),
        t('c', { color: 'blue_background' }),
      ),
    ]);
    expect(r.markdown).toBe('abc');
    expect(r.findings.find((f) => f.code === 'FORMAT_UNDERLINE_DROPPED')?.count).toBe(2);
    expect(r.findings.find((f) => f.code === 'FORMAT_COLOR_DROPPED')?.outcome).toBe('lossy');
  });

  it('does not report underline as lost when the destination supports it', () => {
    const r = render([para(t('a', { underline: true }))], { supportsUnderline: true });
    expect(codes(r)).toEqual([]);
  });
});

describe('links', () => {
  it('writes http(s) links and refuses dangerous schemes', () => {
    expect(render([para(t('docs', { href: 'https://example.com/a b(1)' }))]).markdown).toBe(
      '[docs](https://example.com/a%20b%281%29)',
    );
    const evil = render([para(t('click', { href: 'javascript:alert(1)' }))]);
    expect(evil.markdown).toBe('click');
    expect(isAllowedLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedLinkUrl('data:text/html,<script>')).toBe(false);
    expect(isAllowedLinkUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedLinkUrl('mailto:a@b.co')).toBe(true);
  });
});

describe('block structure', () => {
  it('renders headings and flattens level 4 when the destination stops at 3', () => {
    const r = render([
      block('heading', { level: 1, text: [t('One')] }),
      block('heading', { level: 3, text: [t('Three')] }),
      block('heading', { level: 4, text: [t('Four')] }),
    ]);
    expect(r.markdown).toBe('# One\n\n### Three\n\n### Four');
    expect(codes(r)).toEqual(['BLOCK_HEADING_LEVEL_FLATTENED']);
    expect(
      render([block('heading', { level: 4, text: [t('Four')] })], { maxHeadingLevel: 4 }).markdown,
    ).toBe('#### Four');
  });

  it('renders nested bullet and numbered lists with correct numbering', () => {
    const r = render([
      block('numberedListItem', {
        text: [t('first')],
        children: [
          block('bulletedListItem', { text: [t('a')] }),
          block('bulletedListItem', {
            text: [t('b')],
            children: [block('numberedListItem', { text: [t('deep')] })],
          }),
        ],
      }),
      block('numberedListItem', { text: [t('second')] }),
      para(t('break')),
      block('numberedListItem', { text: [t('restarts')] }),
    ]);
    expect(r.markdown).toBe(
      [
        '1. first',
        '    - a',
        '    - b',
        '        1. deep',
        '2. second',
        '',
        'break',
        '',
        '1. restarts',
      ].join('\n'),
    );
  });

  it('renders to-do items as task lists and reports them as lossy when the destination has no checklists', () => {
    const blocks = [
      block('toDo', { text: [t('open')], checked: false }),
      block('toDo', { text: [t('done')], checked: true }),
    ];
    expect(render(blocks).markdown).toBe('- [ ] open\n- [x] done');
    expect(codes(render(blocks))).toEqual([]);
    const lossy = render(blocks, { taskListsLossy: true });
    expect(lossy.findings.find((f) => f.code === 'BLOCK_TODO_AS_TEXT')?.count).toBe(2);
  });

  it('flattens toggles with a bold title and reports loss', () => {
    const r = render([block('toggle', { text: [t('More')], children: [para(t('hidden text'))] })]);
    expect(r.markdown).toBe('**More**\n\nhidden text');
    expect(codes(r)).toEqual(['BLOCK_TOGGLE_FLATTENED']);
  });

  it('renders quotes and callouts as block quotes (callouts reported)', () => {
    expect(render([block('quote', { text: [t('wise words')] })]).markdown).toBe('> wise words');
    const r = render([
      block('callout', { text: [t('Heads up')], icon: '💡', children: [para(t('detail'))] }),
    ]);
    expect(r.markdown).toBe('> 💡 Heads up\n>\n> detail');
    expect(codes(r)).toEqual(['BLOCK_CALLOUT_AS_QUOTE']);
  });

  it('renders fenced code safely, even when the code contains fences', () => {
    const r = render([
      block('code', { language: 'typescript', text: [t('const a = "```";\nreturn a;')] }),
    ]);
    expect(r.markdown).toBe('````typescript\nconst a = "```";\nreturn a;\n````');
    expect(render([block('code', { language: 'plain text', text: [t('x')] })]).markdown).toBe(
      '```\nx\n```',
    );
    expect(
      render([block('code', { language: 'js"><script>', text: [t('x')] })]).markdown.split('\n')[0],
    ).toBe('```jsscript');
  });

  it('renders dividers', () => {
    expect(render([para(t('a')), block('divider'), para(t('b'))]).markdown).toBe('a\n\n---\n\nb');
  });

  it('renders tables with a header row, and escapes pipes and newlines in cells', () => {
    const row = (...cells: string[]) => block('tableRow', { cells: cells.map((c) => [t(c)]) });
    const r = render([
      block('table', {
        hasColumnHeader: true,
        children: [row('Name', 'Note'), row('a|b', 'multi\nline'), row('日本', '🚀')],
      }),
    ]);
    expect(r.markdown).toBe(
      ['| Name | Note |', '| --- | --- |', '| a\\|b | multi line |', '| 日本 | 🚀 |'].join('\n'),
    );
  });

  it('gives header-less tables a blank header so they remain valid', () => {
    const r = render([
      block('table', { children: [block('tableRow', { cells: [[t('x')], [t('y')]] })] }),
    ]);
    expect(r.markdown).toBe('|  |  |\n| --- | --- |\n| x | y |');
  });

  it('flattens columns in order and reports layout loss once', () => {
    const r = render([
      block('columnList', {
        children: [
          block('column', { children: [para(t('left'))] }),
          block('column', { children: [para(t('right'))] }),
        ],
      }),
    ]);
    expect(r.markdown).toBe('left\n\nright');
    expect(codes(r)).toEqual(['BLOCK_COLUMNS_FLATTENED']);
  });

  it('indents deeply nested content without turning it into code blocks', () => {
    let node = block('bulletedListItem', { text: [t('leaf')] });
    for (let i = 0; i < 5; i++)
      node = block('bulletedListItem', { text: [t(`level ${i}`)], children: [node] });
    const md = render([node]).markdown;
    expect(md.split('\n')).toHaveLength(6);
    expect(md.split('\n')[5]).toBe(`${' '.repeat(20)}- leaf`);
  });

  it('copes with very large documents', () => {
    const blocks = Array.from({ length: 5000 }, (_, i) => para(t(`Paragraph ${i} ✓`)));
    const r = render(blocks);
    expect(r.blockCount).toBe(5000);
    expect(r.markdown.split('\n\n')).toHaveLength(5000);
  });
});

describe('media, embeds and unsupported content', () => {
  it('keeps external images and files as links', () => {
    const img = block('image', {
      hosting: 'external',
      url: 'https://img.example/a.png',
      fileName: 'a.png',
      fileKind: 'image',
      text: [t('A caption')],
    });
    const file = block('file', {
      hosting: 'external',
      url: 'https://x.example/f.pdf',
      fileName: 'f.pdf',
      fileKind: 'pdf',
    });
    const r = render([img, file]);
    expect(r.markdown).toBe(
      '![a.png](https://img.example/a.png)\n\n*A caption*\n\n[f.pdf](https://x.example/f.pdf)',
    );
    expect(r.findings.every((f) => f.outcome === 'transformed')).toBe(true);
  });

  it('never stores Notion-hosted files: leaves a placeholder and reports them unsupported', () => {
    const r = render([
      block('image', { hosting: 'internal', fileName: 'secret.png', fileKind: 'image' }),
    ]);
    expect(r.markdown).toBe('*[Image not migrated: "secret.png" (hosted by Notion)]*');
    const f = r.findings.find((x) => x.code === 'ATTACHMENT_HOSTED_NOT_MIGRATED');
    expect(f?.outcome).toBe('unsupported');
    expect(f?.entity).toBe('notion:page:abc');
  });

  it('rejects non-http attachment URLs', () => {
    const r = render([
      block('file', { hosting: 'external', url: 'ftp://host/file', fileName: 'f' }),
    ]);
    expect(r.markdown).toContain('URL not allowed');
    expect(codes(r)).toEqual(['ATTACHMENT_URL_REJECTED']);
  });

  it('turns bookmarks and embeds into links', () => {
    const r = render([
      block('bookmark', { url: 'https://example.com', title: 'Example', sourceType: 'bookmark' }),
    ]);
    expect(r.markdown).toBe('[Example](https://example.com)');
    expect(codes(r)).toEqual(['BLOCK_EMBED_AS_LINK']);
  });

  it('writes equations as latex code and reports them lossy', () => {
    const r = render([
      block('equation', { expression: 'E = mc^2' }),
      para(t('x', { equation: 'a^2' })),
    ]);
    expect(r.markdown).toBe('```latex\nE = mc^2\n```\n\n`a^2`');
    expect(codes(r)).toEqual(['BLOCK_EQUATION_AS_CODE', 'INLINE_EQUATION_AS_CODE']);
  });

  it('handles synced blocks, inaccessible originals and auto-generated blocks', () => {
    const copied = render([block('syncedBlock', { children: [para(t('shared'))] })]);
    expect(copied.markdown).toBe('shared');
    expect(codes(copied)).toEqual(['BLOCK_SYNCED_COPIED']);
    const lost = render([block('syncedBlock', { reason: 'original not shared' })]);
    expect(codes(lost)).toEqual(['BLOCK_SYNCED_UNAVAILABLE']);
    expect(codes(render([block('tableOfContents')]))).toEqual(['BLOCK_AUTO_GENERATED_OMITTED']);
  });

  it('child pages become links or are omitted for Docs sub-page migration', () => {
    const child = block('childPage', { title: 'Sub page', url: 'https://www.notion.so/abc' });
    expect(render([child]).markdown).toBe('[Sub page](https://www.notion.so/abc)');
    expect(render([child], { childPages: 'omit' }).markdown).toBe('');
  });

  it('inline databases are reported, not silently dropped', () => {
    const r = render([block('childDatabase', { title: 'Tasks' })]);
    expect(r.markdown).toBe('*[Inline database "Tasks" not migrated]*');
    expect(r.findings[0]?.outcome).toBe('unsupported');
  });

  it('unsupported blocks leave a visible placeholder by default and can be omitted explicitly', () => {
    const unsupported = block('unsupported', { sourceType: 'ai_block' });
    const shown = render([unsupported]);
    expect(shown.markdown).toBe('*[Unsupported Notion block: ai_block]*');
    const omitted = render([unsupported], { unsupportedBlocks: 'omit' });
    expect(omitted.markdown).toBe('');
    expect(codes(omitted)).toEqual(['BLOCK_UNSUPPORTED']); // still reported
  });

  it('counts how many blocks share a finding rather than repeating it', () => {
    const r = render(
      Array.from({ length: 40 }, () => block('unsupported', { sourceType: 'ai_block' })),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.count).toBe(40);
  });
});
