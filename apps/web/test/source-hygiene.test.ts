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

/** The only absolute address the online demo may contain (see demo/links.ts). */
const REPO_ADDRESS = 'https://github.com/Choitim/EXITOS';

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
      // The online demo names its own repository once, in demo/links.ts, as a link to click and
      // text to copy; the page never requests it. Nothing else may carry an absolute address.
      const checked = file === 'demo/links.ts' ? text.split(REPO_ADDRESS).join('') : text;
      expect(checked, file).not.toMatch(/['"`]https?:\/\/(?!example\.com)/i);
      expect(checked, file).not.toMatch(/\bimport\s*\(\s*['"`]https?:/);
    }
  });

  it('mentions the repository address in one file only', () => {
    const files = entries.filter(([, text]) => text.includes(REPO_ADDRESS)).map(([file]) => file);
    expect(files).toEqual(['demo/links.ts']);
  });

  it('sets href/src only from literals, the URL allow-list, or local state', () => {
    // Every href/src JSX attribute must be a template of a section id (a fragment, which cannot
    // leave the page), a sanitised URL, or a Blob URL.
    const attribute = /\b(?:href|src)=\{(.+?)\}(?=\s|>|\/)/g;
    const allowed = /^(?:`#\$\{(?:s\.)?id\}`|href|url)$/;
    for (const [file, text] of entries) {
      for (const match of text.matchAll(attribute)) {
        expect(match[1]?.trim() ?? '', `${file}: ${match[0]}`).toMatch(allowed);
      }
    }
  });

  // ---- the static online demo ----------------------------------------------------------------

  const demoFiles = entries.filter(
    ([file]) =>
      file.startsWith('demo/') ||
      [
        'lib/replay.ts',
        'lib/tour.ts',
        'lib/sample.ts',
        'lib/static-state.ts',
        'hooks/useReplay.ts',
        'hooks/useStaticDemoState.ts',
        'hooks/TourContext.ts',
        'hooks/InertLinks.ts',
      ].includes(file),
  );

  it('covers the online demo files', () => {
    const names = entries.map(([file]) => file);
    for (const expected of [
      'demo/DemoApp.tsx',
      'demo/DemoBanner.tsx',
      'demo/GuidedTour.tsx',
      'demo/ReplayPanel.tsx',
      'demo/RunItForReal.tsx',
      'demo/links.ts',
      'lib/replay.ts',
      'lib/tour.ts',
      'lib/static-state.ts',
      'hooks/useStaticDemoState.ts',
    ]) {
      expect(names).toContain(expected);
    }
    expect(demoFiles.length).toBeGreaterThanOrEqual(15);
  });

  it('the demo never polls, listens, or opens a channel to anything', () => {
    for (const [file, text] of demoFiles) {
      expect(text, file).not.toMatch(/setInterval|visibilitychange/);
      expect(text, file).not.toMatch(/['"`]\/api\b/);
      expect(text, file).not.toMatch(/EventSource|WebSocket|XMLHttpRequest|sendBeacon|postMessage/);
    }
  });

  it('only the two data hooks call fetch, and the demo one asks for no URL of its own', () => {
    const callers = entries
      .filter(([, text]) => /\bfetch\s*\(/.test(text))
      .map(([file]) => file)
      .sort();
    expect(callers).toEqual(['hooks/useDashboardState.ts', 'hooks/useStaticDemoState.ts']);
    const demoHook = entries.find(([file]) => file === 'hooks/useStaticDemoState.ts')?.[1] ?? '';
    expect(demoHook).not.toMatch(/fetch\s*\(\s*['"`]/);
  });

  it('keeps tour and replay state in memory only', () => {
    for (const [file, text] of entries) {
      expect(text, file).not.toMatch(
        /\b(?:localStorage|sessionStorage|indexedDB|caches|cookieStore)\b|document\s*\.\s*cookie/,
      );
      expect(text, file).not.toMatch(
        /\b(?:history\s*\.\s*(?:push|replace)State|location\s*\.\s*(?:hash|href|assign|replace)\s*=)/,
      );
    }
  });

  it('never claims more than the recording shows', () => {
    for (const [file, text] of demoFiles) {
      expect(text, file).not.toMatch(
        /zero[- ]data[- ]loss|no data (?:is )?lost|lossless|100% safe/i,
      );
      expect(text, file).not.toMatch(/\bconnected to (?:Notion|ClickUp)\b|\bLIVE\b/);
    }
  });

  it('labels the Docs migration as experimental wherever the demo mentions Docs', () => {
    const mentioning = demoFiles.filter(([, text]) => /\bDocs\b/.test(text));
    expect(mentioning.length).toBeGreaterThan(0);
    for (const [file, text] of mentioning) expect(text, file).toMatch(/experimental/);
  });

  it('only the demo entry point reaches the demo: shared components know nothing about it', () => {
    const shared = entries.filter(
      ([file]) => !file.startsWith('demo/') && !file.startsWith('lib/') && file !== 'main.tsx',
    );
    for (const [file, text] of shared) {
      expect(text, file).not.toMatch(/demo-state|\.\/demo\/|\.\.\/demo\//);
    }
    const main = entries.find(([file]) => file === 'main.tsx')?.[1] ?? '';
    expect(main).toMatch(/__STATIC_DEMO__\s*\?/);
  });
});
