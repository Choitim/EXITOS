import type { CliContext } from '../context.js';

/**
 * Commands we tell people to type differ between PowerShell and POSIX shells. Every hint the CLI
 * prints goes through here so a Windows user is never told to run `cp` or `chmod`.
 */
export const isWindows = (ctx: Pick<CliContext, 'platform'>): boolean => ctx.platform === 'win32';

/** Copy an example file to its working name. */
export function copyCommand(ctx: Pick<CliContext, 'platform'>, from: string, to: string): string {
  return isWindows(ctx) ? `Copy-Item ${from} ${to}` : `cp ${from} ${to}`;
}

/** Create `.env` from the example, locked down on systems that have file modes. */
export function createEnvFileCommand(ctx: Pick<CliContext, 'platform'>): string {
  return isWindows(ctx) ? 'Copy-Item .env.example .env' : 'cp .env.example .env && chmod 600 .env';
}

/** Set an environment variable for the current terminal session. */
export function setEnvCommand(
  ctx: Pick<CliContext, 'platform'>,
  name: string,
  value: string,
): string {
  return isWindows(ctx) ? `$env:${name} = "${value}"` : `export ${name}=${value}`;
}
