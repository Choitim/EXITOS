/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * A few tests start the BUILT command-line program as a separate process; that is their whole point
 * (it proves what a user actually runs). Build it once, here, before any test file starts, so that
 *   - `pnpm test` works on a fresh checkout without a separate `pnpm build`, and
 *   - parallel test files never race each other to compile the same packages.
 * `tsc -b` is incremental: when nothing changed this takes about a second.
 */
export default function setup(): void {
  const root = fileURLToPath(new URL('.', import.meta.url));
  execFileSync('pnpm', ['exec', 'tsc', '-b'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
