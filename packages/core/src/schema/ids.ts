import { z } from 'zod';

/**
 * Stable identifier for any entity in any system: `<system>:<kind>:<id>`, e.g.
 * `notion:page:0f1e2d3c4b5a69788796a5b4c3d2e1f0`. Keys are never rewritten, so source→destination
 * mappings survive re-planning and re-runs.
 */
export const EntityKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_]*:[A-Za-z0-9_-]{1,64}$/, 'Expected <system>:<kind>:<id>');

export type EntityKey = z.infer<typeof EntityKeySchema>;

export function entityKey(system: string, kind: string, id: string): EntityKey {
  return EntityKeySchema.parse(`${system}:${kind}:${id}`);
}

export interface ParsedEntityKey {
  system: string;
  kind: string;
  id: string;
}

export function parseEntityKey(key: string): ParsedEntityKey {
  const parts = key.split(':');
  const [system, kind, ...rest] = parts;
  if (system === undefined || kind === undefined || rest.length === 0) {
    throw new TypeError(`Invalid entity key: ${key}`);
  }
  return { system, kind, id: rest.join(':') };
}
