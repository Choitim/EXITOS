import { ConfigError } from '@exitos/shared';
import {
  formatConfigIssues,
  type ConfigIssue,
  type ConnectorRegistry,
  type MigrationConfig,
} from '@exitos/core';

/** The slice of a connector definition that owns the shape of its config section. */
interface HasConfigSchema<T> {
  readonly configSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: ConfigIssue[] } };
  };
}

const HINT =
  'Fix the file and run the command again. `exitos doctor --config <file>` checks a config without contacting any API.';

/** Parse one connector section, turning a schema failure into guidance instead of a stack of JSON. */
export function connectorConfig<T>(
  def: HasConfigSchema<T>,
  section: 'source' | 'destination',
  value: unknown,
): T {
  const parsed = def.configSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const lines = formatConfigIssues(parsed.error.issues, { prefix: section });
  throw new ConfigError(`Invalid ${section} settings:\n${lines.join('\n')}\n${HINT}`);
}

/**
 * Validate the source AND destination sections together, so the person sees every problem in one go
 * instead of fixing one only to meet the next.
 */
export function validateConnectorConfigs(
  registry: ConnectorRegistry,
  config: MigrationConfig,
): void {
  const problems: string[] = [];
  const check = (section: 'source' | 'destination', def: HasConfigSchema<unknown>): void => {
    const parsed = def.configSchema.safeParse(config[section]);
    if (!parsed.success)
      problems.push(...formatConfigIssues(parsed.error.issues, { prefix: section }));
  };
  check('source', registry.source(config.source.type));
  check('destination', registry.destination(config.destination.type));
  if (problems.length > 0) {
    throw new ConfigError(
      `The migration config has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.join('\n')}\n${HINT}`,
    );
  }
}
