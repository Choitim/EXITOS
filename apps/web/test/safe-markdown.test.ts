/**
 * Renders the real React component to static HTML on the server (no DOM needed) and checks what
 * would reach the page: text is escaped, only allow-listed links become anchors, nothing else.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from '../src/components/SafeMarkdown';

const render = (source: string, headingOffset?: number): string =>
  renderToStaticMarkup(
    createElement(
      SafeMarkdown,
      headingOffset === undefined ? { source } : { source, headingOffset },
    ),
  );

describe('SafeMarkdown (server-rendered)', () => {
  it('escapes raw HTML instead of emitting it', () => {
    const html = render('<img src=x onerror=alert(1)> <script>alert(1)</script> <b>x</b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes attribute-breaking text in link labels and code', () => {
    const html = render('[" onmouseover="alert(1)](https://example.com) `"><svg onload=alert(1)>`');
    expect(html).not.toMatch(/<svg/);
    // an attribute would have to sit inside a tag
    expect(html).not.toMatch(/<[^>]*\sonmouseover=/);
    expect(html).not.toMatch(/<[^>]*\sonload=/);
    expect(html).toContain('&quot; onmouseover=&quot;alert(1)');
  });

  it('renders only allow-listed links, with rel and target', () => {
    const html = render(
      '[a](https://example.com/x) [b](javascript:alert(1)) [c](data:text/html,x) [d](//evil.example) [e](mailto:a@b.co) [f](vbscript:x)',
    );
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['https://example.com/x', 'mailto:a@b.co']);
    expect(html).not.toMatch(/javascript:|vbscript:|data:text/);
    expect(html.match(/<a /g)).toHaveLength(2);
    for (const anchor of html.match(/<a [^>]*>/g) ?? []) {
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noreferrer noopener"');
    }
    // the blocked ones stay readable as plain labels
    expect(html).toContain('>b</span>');
  });

  it('never emits an <img> element, even for image syntax', () => {
    const html = render('![pixel](https://example.com/p.png) ![x](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).toContain('[Image: pixel]');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('renders the engine output: heading, nested lists, table, quote, code, footer', () => {
    const md = [
      '# Title',
      '',
      '- Mechanical',
      '    - Stiffness',
      '        - Shore 30A',
      '',
      '1. First',
      '2. Second',
      '',
      '**Properties from Notion**',
      '',
      '| Property | Value |',
      '| --- | --- |',
      '| Reporter | Ada \\| Grace |',
      '',
      '> quote',
      '',
      '```plaintext',
      'a < b && c > d',
      '```',
      '',
      '---',
      '',
      '_Migrated with ExitOS._ [Original](https://www.notion.so/abc)',
      '',
      '`exitos-key:notion:page:abc`',
    ].join('\n');
    const html = render(md);
    expect(html).toContain('<h4 class="md-h1">Title</h4>');
    expect(html).toMatch(
      /<ul><li>Mechanical<ul><li>Stiffness<ul><li>Shore 30A<\/li><\/ul><\/li><\/ul><\/li><\/ul>/,
    );
    expect(html).toContain('<ol><li>First</li><li>Second</li></ol>');
    expect(html).toContain('<strong>Properties from Notion</strong>');
    expect(html).toContain('<th scope="col">Property</th>');
    expect(html).toContain('<td>Ada | Grace</td>');
    expect(html).toContain('<blockquote><p>quote</p></blockquote>');
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
    expect(html).toContain('<hr/>');
    expect(html).toContain('<em>Migrated with ExitOS.</em>');
    expect(html).toContain('<code>exitos-key:notion:page:abc</code>');
  });

  it('shows escaped characters without their backslashes', () => {
    const html = render('Revenue \\*Q3\\* \\[draft\\] a\\_b');
    expect(html).toContain('Revenue *Q3* [draft] a_b');
    expect(html).not.toContain('\\*');
  });

  it('keeps headings below the section heading in the outline', () => {
    expect(render('# a\n\n#### d')).toMatch(/<h4 [^>]*>a<\/h4><h6 [^>]*>d<\/h6>/);
    expect(render('# a', 0)).toMatch(/<h2 [^>]*>a<\/h2>/);
  });

  it('handles Unicode and says so when empty', () => {
    expect(render('**日本語** 🚀 שלום')).toContain('<strong>日本語</strong> 🚀 שלום');
    expect(render('')).toContain('This description is empty.');
  });

  it('renders task list items with an accessible state', () => {
    const html = render('- [x] done\n- [ ] todo');
    expect(html).toContain('Done: ');
    expect(html).toContain('To do: ');
  });
});
