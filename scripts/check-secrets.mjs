#!/usr/bin/env node
/**
 * Scans tracked files for credential-shaped strings. Deliberately simple and dependency-free so CI
 * does not rely on an external service. Test and e2e files are skipped because they contain obviously
 * fake tokens on purpose; docs and the example env file ARE scanned.
 *
 *   node scripts/check-secrets.mjs            # exit 1 if anything suspicious is found
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const PATTERNS = [
  ['Notion token', /\bntn_[A-Za-z0-9]{36,}\b/],
  ['Notion legacy secret', /\bsecret_[A-Za-z0-9]{40,}\b/],
  ['ClickUp personal token', /\bpk_\d{5,}_[A-Z0-9]{24,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-test',
  '.git',
  '.exitos',
  'coverage',
  'playwright-report',
  'test-results',
]);
const SKIP_PATH = [/(^|\/)test\//, /\.test\.ts$/, /(^|\/)e2e\//, /^pnpm-lock\.yaml$/];

function listFiles() {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8' },
    );
    const files = out.split('\0').filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    /* not a git checkout: fall through to a directory walk */
  }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return files;
}

export function scan(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of PATTERNS) if (re.test(line)) hits.push({ line: i + 1, name });
  });
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = [];
  for (const file of listFiles()) {
    if (SKIP_PATH.some((re) => re.test(file))) continue;
    let text;
    try {
      const buf = readFileSync(join(root, file));
      if (buf.includes(0)) continue; // binary
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    for (const hit of scan(text)) findings.push(`${file}:${hit.line}  ${hit.name}`);
  }
  if (findings.length > 0) {
    console.error(
      'Possible credentials found (values are not printed):\n  ' + findings.join('\n  '),
    );
    process.exit(1);
  }
  console.log('check-secrets: no credential-shaped strings in tracked files.');
}
