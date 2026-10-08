#!/usr/bin/env node
/** Remove build output and local ExitOS state. Never touches sources, .env or anything outside the repo. */
import { rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = new Set(['dist', 'dist-test', 'coverage', 'playwright-report', 'test-results']);
const SKIP = new Set(['node_modules', '.git']);

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (name.endsWith('.tsbuildinfo')) rmSync(p, { force: true });
      continue;
    }
    if (TARGETS.has(name)) rmSync(p, { recursive: true, force: true });
    else walk(p);
  }
}
walk(root);
rmSync(join(root, '.exitos'), { recursive: true, force: true });
console.log('Cleaned build output and .exitos/.');
