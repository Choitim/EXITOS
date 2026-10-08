import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTION_API_VERSION } from '@exitos/connector-notion';
import { VERSION } from '@exitos/shared';
import { describe, expect, it } from 'vitest';
import { buildProgram, createContext } from '../src/index.js';
import { ENV_KEYS } from '../src/runtime/env.js';
import { makeCli } from './harness.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (
      [
        'node_modules',
        'dist',
        'dist-test',
        '.git',
        '.exitos',
        'playwright-report',
        'test-results',
      ].includes(name)
    )
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const sourceFiles = [
  'packages/connector-notion/src',
  'packages/connector-clickup/src',
  'packages/core/src',
  'packages/shared/src',
]
  .flatMap((d) => walk(join(root, d)))
  .filter((f) => f.endsWith('.ts') && !f.includes('/testing/'));

const markdownFiles = [
  ...walk(join(root, 'docs')),
  ...readdirSync(root).map((f) => join(root, f)),
].filter((f) => f.endsWith('.md') && statSync(f).isFile());

describe('documentation stays true', () => {
  it('every finding code that the engine can emit is documented in docs/finding-codes.md', () => {
    const codes = new Set<string>();
    const patterns = [
      /code:\s*(?:\n\s*)?(?:[^'"\n]*\?\s*)?'([A-Z][A-Z0-9_]{3,})'/g,
      /\.note\(\s*'([A-Z][A-Z0-9_]{3,})'/g,
      /\berr\(\s*[A-Za-z.]+,\s*'([A-Z][A-Z0-9_]{3,})'/g,
      /\bfallback\(\s*'([A-Z][A-Z0-9_]{3,})'/g,
      /\?\s*'([A-Z][A-Z0-9_]{3,})'\s*:\s*'([A-Z][A-Z0-9_]{3,})'/g,
    ];
    for (const file of sourceFiles) {
      const text = readFileSync(file, 'utf8');
      for (const re of patterns)
        for (const m of text.matchAll(re)) for (const g of m.slice(1)) if (g) codes.add(g);
    }
    // Codes that are execution-engine or internal error codes, documented in the "Run codes" section or not user-facing.
    const internal = new Set(['PLAN_NOT_JSON', 'PLAN_INVALID', 'STATE_CONFLICT', 'STATE_CORRUPT']);
    const doc = read('docs/finding-codes.md');
    const missing = [...codes].filter((c) => !internal.has(c) && !doc.includes(c)).sort();
    expect(missing, `undocumented finding codes: ${missing.join(', ')}`).toEqual([]);
    expect(codes.size).toBeGreaterThan(60); // the extraction itself works
  });

  it('every relative link in the markdown files points at something that exists', () => {
    const broken: string[] = [];
    for (const file of markdownFiles) {
      const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = (m[1] ?? '').split('#')[0] ?? '';
        if (target === '' || /^(https?:|mailto:|#)/.test(target)) continue;
        const resolved = resolve(dirname(file), target);
        if (!existsSync(resolved)) broken.push(`${relative(root, file)} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every `exitos <command>` that the README and guides tell people to run is a real command', () => {
    const ctx = makeCli().ctx;
    const program = buildProgram(ctx, { code: 0 });
    const known = new Set(program.commands.map((c) => c.name()));
    const used = new Set<string>();
    for (const file of [
      'README.md',
      'CONTRIBUTING.md',
      'docs/live-sandbox-testing.md',
      'docs/demo-recording.md',
      'docs/reliability.md',
    ]) {
      for (const block of read(file).matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)) {
        for (const m of (block[1] ?? '').matchAll(
          /(?:pnpm exitos|^\s*exitos|\$ exitos)\s+([a-z-]+)/gm,
        ))
          used.add(m[1] as string);
      }
    }
    const unknown = [...used].filter((c) => !known.has(c));
    expect(unknown).toEqual([]);
    expect(used.size).toBeGreaterThan(3);
  });

  it('.env.example documents exactly the variables the CLI reads from .env', () => {
    const example = read('.env.example');
    for (const key of ENV_KEYS) expect(example, key).toContain(key);
    const assigned = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
    for (const key of assigned) expect(ENV_KEYS as readonly string[], key).toContain(key);
    expect(example).not.toMatch(/(ntn_|secret_|pk_\d)[A-Za-z0-9]{8,}/);
  });

  it('versions agree everywhere', () => {
    const versions = [
      'package.json',
      ...readdirSync(join(root, 'packages')).map((d) => `packages/${d}/package.json`),
      ...readdirSync(join(root, 'apps')).map((d) => `apps/${d}/package.json`),
    ]
      .filter((f) => existsSync(join(root, f)))
      .map((f) => [f, (JSON.parse(read(f)) as { version?: string }).version] as const);
    for (const [file, version] of versions) expect(version, file).toBe(VERSION);
    expect(read('CHANGELOG.md')).toContain(`## [${VERSION}]`);
  });

  it('the verified Notion API version in the docs equals the one in the code', () => {
    expect(read('docs/api-verification.md')).toContain(`\`${NOTION_API_VERSION}\``);
    expect(read('docs/decisions/0012-notion-version-pin.md')).toContain(NOTION_API_VERSION);
  });

  it('every ADR is indexed and exists', () => {
    const index = read('docs/decisions/README.md');
    const adrs = readdirSync(join(root, 'docs/decisions')).filter((f) => /^\d{4}-.*\.md$/.test(f));
    expect(adrs.length).toBeGreaterThanOrEqual(12);
    for (const adr of adrs) expect(index, adr).toContain(adr);
  });

  it('never claims "zero data loss" except to disclaim it', () => {
    const offenders: string[] = [];
    for (const file of markdownFiles) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/zero data loss/gi)) {
        const before = text.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
        const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3);
        const quoted = /["“'`]\s*$/.test(before) || /^["”'`]/.test(after);
        const disclaimed =
          /(no claim|not claim|never claim|not a claim|don't claim|do not claim|isn't a claim|nor|unless|"zero|not "|no "|without)/i.test(
            before,
          );
        if (!quoted && !disclaimed)
          offenders.push(`${relative(root, file)}: …${before}[zero data loss]`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the README is honest about live validation and does not claim unimplemented connectors', () => {
    const readme = read('README.md');
    expect(readme).toMatch(
      /not (yet )?(been )?validated (against|with) (real|live)|No live validation|live[- ]validat/i,
    );
    expect(readme).toContain('Notion');
    expect(readme).toContain('ClickUp');
    for (const claimed of ['Jira', 'Asana', 'Trello', 'Airtable', 'Linear', 'Monday']) {
      // They may be mentioned as examples of FUTURE work, never in the supported matrix.
      const matrix = readme.split('## Supported migration matrix')[1]?.split('\n## ')[0] ?? '';
      expect(matrix, claimed).not.toContain(claimed);
    }
  });

  it('LICENSE is Apache-2.0', () => {
    expect(read('LICENSE')).toContain('Apache License');
    expect(read('LICENSE')).toContain('Version 2.0, January 2004');
  });

  it('createContext is exercised (keeps the CLI context API honest)', () => {
    const ctx = createContext({ cwd: '/tmp', env: {}, io: makeCli().ctx.io });
    expect(ctx.width).toBeGreaterThanOrEqual(60);
  });
});
