import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const CLI_BIN = fileURLToPath(new URL('../../apps/cli/dist/bin.js', import.meta.url));
export const WEB_DIST_INDEX = fileURLToPath(
  new URL('../../apps/web/dist/index.html', import.meta.url),
);
export const CORE_DIST = fileURLToPath(
  new URL('../../packages/core/dist/index.js', import.meta.url),
);

/** Environment variables that carry the URLs of the servers started by global setup. */
export const ENV = {
  demo: 'EXITOS_E2E_DEMO_URL',
  xss: 'EXITOS_E2E_XSS_URL',
  live: 'EXITOS_E2E_LIVE_URL',
  liveDb: 'EXITOS_E2E_LIVE_DB',
  empty: 'EXITOS_E2E_EMPTY_URL',
} as const;

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set: the Playwright global setup did not run.`);
  }
  return value;
}
