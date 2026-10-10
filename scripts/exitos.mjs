#!/usr/bin/env node
/**
 * Entry point for `pnpm exitos ...` in a source checkout. It exists to turn the two most common
 * first-run mistakes into instructions instead of stack traces:
 *   - running it on a Node.js that is too old,
 *   - running it before `pnpm build`.
 * Everything else is the real CLI (apps/cli/dist/bin.js), loaded unchanged.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Keep in step with MIN_NODE in apps/cli/src/runtime/node-version.ts (a test checks they agree).
const MIN = [22, 13];
const [major = 0, minor = 0] = process.versions.node
  .split('.')
  .map((part) => Number.parseInt(part, 10));
const supported = major > MIN[0] || (major === MIN[0] && minor >= MIN[1]);

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'apps', 'cli', 'dist', 'bin.js');

if (!supported) {
  const how =
    process.platform === 'win32'
      ? 'PowerShell:  winget install OpenJS.NodeJS.LTS   (then open a new terminal)'
      : process.platform === 'darwin'
        ? 'Homebrew:    brew install node'
        : 'Or with nvm: nvm install --lts && nvm use --lts';
  process.stderr.write(
    `ExitOS needs Node.js ${MIN[0]}.${MIN[1]} or newer, but this is Node.js ${process.versions.node}.\n` +
      `  Install a current LTS from https://nodejs.org/en/download\n  ${how}\nCheck with: node --version\n`,
  );
  process.exitCode = 2;
} else if (!existsSync(bin)) {
  process.stderr.write(
    'ExitOS has not been built yet.\n  Run:  pnpm install   (once)\n        pnpm build\nThen run your command again.\n',
  );
  process.exitCode = 2;
} else {
  await import(pathToFileURL(bin).href);
}
