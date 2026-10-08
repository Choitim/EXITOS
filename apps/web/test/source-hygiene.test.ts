/**
 * Guard rails on the dashboard SOURCE: the constructs that would defeat the Markdown/URL
 * safeguards must not appear anywhere in it, and nothing from the @exitos runtime may be bundled.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Source with comments removed, so documentation may mention what is forbidden. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const entries = Object.entries(sources).map(
  ([file, text]) => [file.replace('../src/', ''), code(text)] as const,
);

describe('dashboard source', () => {
  it('finds the source files', () => {
    expect(entries.length).toBeGreaterThan(15);
    expect(entries.some(([file]) => file === 'lib/markdown.ts')).toBe(true);
  });

  it.each([
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['innerHTML / outerHTML', /\b(?:inner|outer)HTML\b/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\s*\.\s*write/],
    ['eval()', /\beval\s*\(/],
    ['new Function()', /\bnew\s+Function\b|\bFunction\s*\(/],
    ['string timers', /set(?:Timeout|Interval)\s*\(\s*['"`]/],
    ['console', /\bconsole\s*\./],
    ['createContextualFragment', /createContextualFragment/],
    ['DOMParser', /\bDOMParser\b/],
    ['javascript: literals', /['"`]javascript:/i],
  ])('never uses %s', (_name, pattern) => {
    const offenders = entries.filter(([, text]) => pattern.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('only imports TYPES from @exitos packages', () => {
    for (const [file, text] of entries) {
      for (const match of text.matchAll(
        /^\s*import\s+(?!type\b)[^;]*?from\s+['"](@exitos\/[^'"]+)['"]/gm,
      )) {
        throw new Error(`${file} imports runtime code from ${match[1]}; use "import type"`);
      }
    }
  });

  it('never loads anything from another origin', () => {
    for (const [file, text] of entries) {
      expect(text, file).not.toMatch(/['"`]https?:\/\/(?!example\.com)/i);
      expect(text, file).not.toMatch(/\bimport\s*\(\s*['"`]https?:/);
    }
  });

  it('sets href/src only from literals, the URL allow-list, or local state', () => {
    // Every href/src JSX attribute must be a template of a section id, a sanitised URL, or a Blob URL.
    const attribute = /\b(?:href|src)=\{(.+?)\}(?=\s|>|\/)/g;
    const allowed = /^(?:`#\$\{s\.id\}`|href|url)$/;
    for (const [file, text] of entries) {
      for (const match of text.matchAll(attribute)) {
        expect(match[1]?.trim() ?? '', `${file}: ${match[0]}`).toMatch(allowed);
      }
    }
  });
});
