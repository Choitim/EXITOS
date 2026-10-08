import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { SqliteStateStore } from '@exitos/core';
import { ConfigError } from '@exitos/shared';
import type { CliContext } from '../context.js';

export interface StateLocation {
  dir: string;
  dbPath: string;
}

/** `--state-dir` > `EXITOS_STATE_DIR` > `./.exitos` (demo: `./.exitos/demo`). */
export function resolveStateDir(
  ctx: CliContext,
  options: { stateDir?: string | undefined; demo?: boolean | undefined },
): StateLocation {
  const raw = options.stateDir ?? ctx.env.EXITOS_STATE_DIR;
  const dir = raw
    ? isAbsolute(raw)
      ? raw
      : resolve(ctx.cwd, raw)
    : options.demo === true
      ? join(ctx.cwd, '.exitos', 'demo')
      : join(ctx.cwd, '.exitos');
  return { dir, dbPath: join(dir, 'state.db') };
}

export function openStore(
  location: StateLocation,
  options: { readOnly?: boolean; now?: () => string } = {},
): SqliteStateStore {
  return SqliteStateStore.open(location.dbPath, {
    ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export function requireExistingState(location: StateLocation, hint: string): void {
  if (!existsSync(location.dbPath)) {
    throw new ConfigError(`No ExitOS state found in ${location.dir}. ${hint}`);
  }
}

/** Files the demo owns inside its state directory. `demo` deletes ONLY these. */
export const DEMO_FILES = [
  'state.db',
  'state.db-wal',
  'state.db-shm',
  'demo-world.json',
  'migration-plan.json',
] as const;

export function resetDemoState(location: StateLocation): void {
  mkdirSync(location.dir, { recursive: true, mode: 0o700 });
  for (const name of DEMO_FILES) rmSync(join(location.dir, name), { force: true });
}
