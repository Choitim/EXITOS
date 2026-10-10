/**
 * Contrast guard on the design tokens in styles.css, in both colour schemes. Text pairs need
 * 4.5:1 (WCAG AA); borders, focus rings and bar fills (things you must see, not read) need 3:1.
 * The pairs are the ones the stylesheet actually combines (chips, callouts, table rows, buttons).
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Vitest replaces imported CSS with an empty string, so the stylesheet is read as a plain file.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

type Tokens = Record<string, string>;

function parseBlock(block: string): Tokens {
  const tokens: Tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[m[1] ?? ''] = (m[2] ?? '').toLowerCase();
  }
  return tokens;
}

const lightBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
const darkBlock =
  /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
const light = parseBlock(lightBlock);
const dark = { ...light, ...parseBlock(darkBlock) };

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground token, background token] */
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['fg', 'page'],
  ['fg', 'surface'],
  ['fg', 'sunken'],
  ['muted', 'page'],
  ['muted', 'surface'],
  ['muted', 'sunken'],
  ['accent', 'page'],
  ['accent', 'surface'],
  ['accent', 'sunken'],
  ['accent-fg', 'accent'],
  ['ok-fg', 'ok-bg'],
  ['info-fg', 'info-bg'],
  ['warn-fg', 'warn-bg'],
  ['bad-fg', 'bad-bg'],
  ['neutral-fg', 'neutral-bg'],
  // command lines and code sit on the sunken surface inside tinted callouts
  ['ok-fg', 'sunken'],
  ['info-fg', 'sunken'],
  ['warn-fg', 'sunken'],
  ['bad-fg', 'sunken'],
  ['neutral-fg', 'sunken'],
  ['ok-solid-fg', 'ok-solid-bg'],
  ['bad-solid-fg', 'bad-solid-bg'],
  ['ok-text', 'surface'],
  ['ok-text', 'page'],
  ['ok-text', 'sunken'],
  ['info-text', 'surface'],
  ['info-text', 'page'],
  ['info-text', 'sunken'],
  ['warn-text', 'surface'],
  ['warn-text', 'page'],
  ['warn-text', 'sunken'],
  ['bad-text', 'surface'],
  ['bad-text', 'page'],
  ['bad-text', 'sunken'],
  ['demo-fg', 'demo-bg'],
  ['live-fg', 'live-bg'],
  ['idle-fg', 'idle-bg'],
];

/** Things that must be visible but are not read: borders, focus ring, bar segments. */
const GRAPHIC_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['edge', 'surface'],
  ['edge', 'page'],
  ['accent', 'page'],
  ['accent', 'surface'],
  ['ok-bar', 'sunken'],
  ['info-bar', 'sunken'],
  ['warn-bar', 'sunken'],
  ['bad-bar', 'sunken'],
  ['neutral-bar', 'sunken'],
  ['ok-bar', 'surface'],
  ['bad-bar', 'surface'],
  ['edge', 'ok-bg'],
];

describe('design tokens', () => {
  it('reads both colour schemes from the stylesheet', () => {
    expect(light.fg).toBeDefined();
    expect(dark.fg).toBeDefined();
    expect(dark.page).not.toBe(light.page);
    expect(dark['ok-solid-bg']).not.toBe(light['ok-solid-bg']);
  });

  for (const [scheme, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    describe(scheme, () => {
      it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
        const a = tokens[fg];
        const b = tokens[bg];
        expect(a, `token --${fg}`).toBeDefined();
        expect(b, `token --${bg}`).toBeDefined();
        expect(ratio(a ?? '', b ?? '')).toBeGreaterThanOrEqual(4.5);
      });

      it.each(GRAPHIC_PAIRS)('%s against %s is at least 3:1', (fg, bg) => {
        expect(ratio(tokens[fg] ?? '', tokens[bg] ?? '')).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('keeps Verified and Failed visually distinct from the item outcomes in both schemes', () => {
    for (const tokens of [light, dark]) {
      expect(tokens['ok-solid-bg']).not.toBe(tokens['ok-bg']);
      expect(tokens['bad-solid-bg']).not.toBe(tokens['bad-bg']);
    }
  });
});
