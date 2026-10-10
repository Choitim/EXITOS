import { ConfigError } from '@exitos/shared';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { MigrationConfigSchema, findSecretKeys, type MigrationConfig } from '../schema/index.js';
import { formatConfigIssues } from './issues.js';

/**
 * Parse and validate `migration.yaml` (or `.json`). Credentials are rejected outright: they must
 * come from the environment, never from a file that may be committed or shared.
 */
export function parseMigrationConfig(text: string, filename = 'migration.yaml'): MigrationConfig {
  let raw: unknown;
  try {
    raw = filename.endsWith('.json')
      ? JSON.parse(text)
      : parseYaml(text, { schema: 'core', maxAliasCount: 20 });
  } catch (error) {
    const detail =
      error instanceof YAMLParseError ? error.message.split('\n')[0] : 'invalid syntax';
    throw new ConfigError(`Could not parse ${filename}: ${detail}`);
  }
  if (raw === null || typeof raw !== 'object') {
    throw new ConfigError(`${filename} must contain a mapping at the top level.`);
  }

  const secretKeys = findSecretKeys(raw);
  if (secretKeys.length > 0) {
    throw new ConfigError(
      `${filename} contains keys that look like credentials (${secretKeys.join(', ')}). ` +
        'Remove them: ExitOS reads tokens only from environment variables (see .env.example).',
    );
  }

  const parsed = MigrationConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid ${filename}:\n${formatConfigIssues(parsed.error.issues, { max: 10 }).join('\n')}`,
    );
  }
  return parsed.data;
}
