import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/index.js';
import { makeCli } from './harness.js';

/**
 * The README exists in English and Korean and the two must say the same thing: same sections, same
 * images, same commands, same links. Prose is translated; structure and facts are not allowed to drift.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

const en = read('README.md');
const ko = read('README.ko.md');

const headings = (text: string, level: number): number =>
  [...text.replace(/```[\s\S]*?```/g, '').matchAll(new RegExp(`^${'#'.repeat(level)} `, 'gm'))]
    .length;

/** Every image source, in document order (Markdown and HTML). */
const images = (text: string): string[] =>
  [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]*\ssrc="([^"]+)"/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );

/** Link targets (Markdown and HTML), without in-page anchors and the language switcher. */
const links = (text: string): string[] =>
  [...text.matchAll(/\]\(([^)\s]+)\)|\shref="([^"]+)"/g)]
    .map((m) => m[1] ?? m[2] ?? '')
    .filter((t) => t !== '' && !t.startsWith('#') && t !== 'README.md' && t !== 'README.ko.md')
    .sort();

/** Fenced code blocks with comments removed, so translated comments do not matter. */
const commands = (text: string): string[][] =>
  [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) =>
    (m[1] ?? '')
      .split('\n')
      .map((line) => line.replace(/\s+#\s.*$/, '').trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );

describe('README.md and README.ko.md', () => {
  it('each offers the other language at the top', () => {
    expect(en.slice(0, 900)).toContain('**English** | [한국어](README.ko.md)');
    expect(ko.slice(0, 900)).toContain('[English](README.md) | **한국어**');
  });

  it('have the same sections', () => {
    expect(headings(ko, 2)).toBe(headings(en, 2));
    expect(headings(ko, 3)).toBe(headings(en, 3));
    expect(headings(en, 2)).toBeGreaterThanOrEqual(10);
  });

  it('show the same images, in the same order', () => {
    expect(images(ko)).toEqual(images(en));
    expect(images(en).length).toBeGreaterThanOrEqual(5);
  });

  it('give the same commands (comments may be translated)', () => {
    expect(commands(ko)).toEqual(commands(en));
  });

  it('link to the same places', () => {
    expect(links(ko)).toEqual(links(en));
  });

  it('use the real repository URL, never a placeholder', () => {
    for (const [name, text] of [
      ['README.md', en],
      ['README.ko.md', ko],
    ] as const) {
      expect(text, name).toContain('git clone https://github.com/Choitim/EXITOS.git');
      expect(text, name).not.toMatch(/<this-repo>|<repo>|<your-fork>|YOUR_USERNAME/i);
    }
  });

  it('name the six states the same way in both languages', () => {
    for (const state of [
      'Preserved',
      'Transformed',
      'Requires review',
      'Unsupported',
      'Failed',
      'Verified',
    ]) {
      expect(en, state).toContain(`**${state}**`);
      expect(ko, state).toContain(`**${state}**`);
    }
  });
});

describe('the install and demo commands in the README are real', () => {
  const pkg = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
    engines: { node: string };
  };
  const quickStart = commands(en).find((block) => block[0]?.startsWith('git clone')) ?? [];

  it('the quick start is the documented five commands', () => {
    expect(quickStart).toEqual([
      'git clone https://github.com/Choitim/EXITOS.git',
      'cd EXITOS',
      'pnpm install',
      'pnpm build',
      'pnpm exitos demo',
    ]);
  });

  it('every `pnpm <script>` exists in package.json, and every `exitos <command>` is a real command', () => {
    const builtins = new Set(['install', 'add', 'exec', 'run']);
    const known = new Set(buildProgram(makeCli().ctx, { code: 0 }).commands.map((c) => c.name()));
    for (const text of [en, ko]) {
      for (const block of commands(text)) {
        for (const line of block) {
          const exitos = /^pnpm exitos (\w[\w-]*)/.exec(line);
          if (exitos) {
            expect(known.has(exitos[1] as string), line).toBe(true);
            continue;
          }
          const script = /^pnpm (\w[\w:-]*)/.exec(line);
          if (script && !builtins.has(script[1] as string)) {
            expect(pkg.scripts[script[1] as string], line).toBeDefined();
          }
        }
      }
    }
  });

  it('the Node.js floor in the README is the one in package.json', () => {
    expect(pkg.engines.node).toBe('>=22.13.0');
    for (const text of [en, ko]) {
      expect(text).toContain('22.13');
      expect(text).toContain('node-%E2%89%A522.13');
    }
  });

  it('Windows PowerShell equivalents are given where the shell commands differ', () => {
    for (const text of [en, ko]) {
      expect(text).toContain('Copy-Item .env.example .env');
      expect(text).toContain('Copy-Item migration.example.yaml migration.yaml');
      expect(text).toContain('winget install OpenJS.NodeJS.LTS');
    }
  });
});

describe('the images the README shows', () => {
  const sources = [...new Set(images(en))].filter((s) => !s.startsWith('http'));
  const maxBytes = (file: string): number => (file.endsWith('.gif') ? 2_500_000 : 500_000);

  it('all exist', () => {
    for (const source of sources) expect(existsSync(join(root, source)), source).toBe(true);
  });

  it('are optimised: a README should load fast', () => {
    for (const source of sources) {
      const size = statSync(join(root, source)).size;
      expect(size, `${source} is ${(size / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(
        maxBytes(source),
      );
    }
  });

  it('include the social preview card at the size GitHub expects', () => {
    const file = join(root, 'docs/assets/social-preview.png');
    expect(existsSync(file)).toBe(true);
    const png = readFileSync(file);
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(640);
    expect(png.length).toBeLessThanOrEqual(1_000_000);
  });
});
