#!/usr/bin/env node
/**
 * License allow-list for everything that ships (production dependencies of every workspace package,
 * including transitive ones). Legal review of an open-source tool usually starts with "what licenses
 * are in the dependency tree?"; this makes the answer a CI gate instead of a promise.
 *
 *   node scripts/check-licenses.mjs     # exit 1 if any production dependency is outside the allow-list
 *
 * Anything not listed (GPL, AGPL, LGPL, MPL, SSPL, unknown, missing) fails and needs a human decision:
 * add it to ALLOWED only after review, and say why in the commit.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
]);

/**
 * Is an SPDX expression acceptable? `A OR B` needs one allowed alternative, `A AND B` needs both.
 * Parentheses are accepted for simple cases; anything we cannot parse is rejected.
 */
export function isAllowed(expression, allowed = ALLOWED) {
  const text = String(expression ?? '').trim();
  if (text === '') return false;
  const stripped = text.replace(/^\((.*)\)$/, '$1').trim();
  if (/\s+OR\s+/i.test(stripped)) {
    return stripped.split(/\s+OR\s+/i).some((part) => isAllowed(part, allowed));
  }
  if (/\s+AND\s+/i.test(stripped)) {
    return stripped.split(/\s+AND\s+/i).every((part) => isAllowed(part, allowed));
  }
  return allowed.has(stripped);
}

/** `licenseMap` is the JSON that `pnpm licenses list --json` prints: { "<license>": [{ name, versions }] }. */
export function evaluate(licenseMap, allowed = ALLOWED) {
  const violations = [];
  const summary = {};
  for (const [license, packages] of Object.entries(licenseMap)) {
    summary[license] = packages.length;
    if (!isAllowed(license, allowed)) {
      for (const pkg of packages)
        violations.push({ license, name: pkg.name, versions: pkg.versions ?? [] });
    }
  }
  return { violations, summary };
}

function main() {
  const out = execFileSync('pnpm', ['-r', 'licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const licenseMap = JSON.parse(out);
  const total = Object.values(licenseMap).reduce((n, list) => n + list.length, 0);
  if (total === 0) {
    console.error('check-licenses: the license listing was empty; refusing to pass on no data.');
    process.exit(1);
  }
  const { violations, summary } = evaluate(licenseMap);
  const shown = Object.entries(summary)
    .map(([license, count]) => `${license} ${count}`)
    .join(', ');
  if (violations.length > 0) {
    console.error(
      `check-licenses: ${violations.length} production dependenc(ies) outside the allow-list:`,
    );
    for (const v of violations) console.error(`  ${v.name}@${v.versions.join(',')}  ${v.license}`);
    console.error(`(allowed: ${[...ALLOWED].join(', ')})`);
    process.exit(1);
  }
  console.log(`check-licenses: ${total} production dependencies, all allowed (${shown}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
