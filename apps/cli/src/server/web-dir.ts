import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '@exitos/shared';

/** Find the built dashboard: override → env → packaged copy → monorepo build output. */
export function findWebDir(overrides: {
  webDir?: string | undefined;
  env?: string | undefined;
}): string {
  const here = dirname(fileURLToPath(import.meta.url)); // …/apps/cli/dist/server
  const cliRoot = join(here, '..', '..');
  const candidates = [
    overrides.webDir,
    overrides.env,
    join(cliRoot, 'web'),
    join(cliRoot, '..', 'web', 'dist'),
  ].filter((c): c is string => typeof c === 'string' && c !== '');
  for (const dir of candidates) if (existsSync(join(dir, 'index.html'))) return dir;
  throw new ConfigError(
    'The dashboard has not been built yet. From the repository root run `pnpm build`, then try again.',
  );
}
