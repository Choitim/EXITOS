import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Only these keys are ever read from a `.env` file; anything else in it is ignored. */
export const ENV_KEYS = [
  'NOTION_TOKEN',
  'CLICKUP_API_TOKEN',
  'EXITOS_STATE_DIR',
  'NOTION_API_BASE_URL',
  'CLICKUP_API_BASE_URL',
] as const;

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    if (!(ENV_KEYS as readonly string[]).includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    if (value !== '') out[key] = value;
  }
  return out;
}

export interface LoadedEnv {
  env: Record<string, string | undefined>;
  /** Set when a `.env` was read. */
  file?: string;
  /** Human-readable problems worth showing (e.g. an over-permissive .env). */
  warnings: string[];
}

/**
 * Merge `./.env` under the real environment: variables that are already set always win, so a
 * shell `export` can never be silently replaced by a file. Never throws on a missing file.
 */
export function loadEnv(
  cwd: string,
  processEnv: Readonly<Record<string, string | undefined>>,
): LoadedEnv {
  const warnings: string[] = [];
  const path = join(cwd, '.env');
  if (!existsSync(path)) return { env: { ...processEnv }, warnings };
  try {
    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        warnings.push(
          `.env is readable by other users (mode ${mode.toString(8)}). It holds credentials: run \`chmod 600 .env\`.`,
        );
      }
    }
    const fromFile = parseEnvFile(readFileSync(path, 'utf8'));
    const merged: Record<string, string | undefined> = { ...fromFile, ...processEnv };
    return { env: merged, file: path, warnings };
  } catch {
    warnings.push('Could not read .env; continuing with the process environment only.');
    return { env: { ...processEnv }, warnings };
  }
}
