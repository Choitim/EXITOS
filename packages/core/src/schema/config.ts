import { z } from 'zod';

/**
 * The connector-independent part of `migration.yaml`. The `source` and `destination` blocks are
 * validated by the respective connector with its own schema.
 *
 * Credentials are NEVER accepted here: they come from the environment (see .env.example).
 */
export const UsersConfigSchema = z.strictObject({
  /** Suggest matches by exact, case-insensitive e-mail. Off by default (ADR 0010). */
  matchByEmail: z.boolean().default(false),
  /** What to do with people who cannot be mapped. They are never assigned. */
  unmapped: z.enum(['description', 'ignore']).default('description'),
  /** Source user id or e-mail → destination user id. */
  map: z.record(z.string().min(1), z.union([z.string().min(1), z.number().int()])).default({}),
});
export type UsersConfig = z.infer<typeof UsersConfigSchema>;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const OptionsConfigSchema = z.strictObject({
  /** IANA zone used for date-only and floating date-times. */
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, 'Unknown IANA time zone (e.g. Europe/Berlin)')
    .default('UTC'),
  /** Write a visible provenance footer (needed for reliable reconciliation, ADR 0007). */
  provenance: z.enum(['footer', 'none']).default('footer'),
  /** Unmappable field values: keep as a table in the description, or drop (and report). */
  unmappedFields: z.enum(['description', 'skip']).default('description'),
  /** Unsupported blocks: leave a visible placeholder, or omit (and report). */
  unsupportedBlocks: z.enum(['placeholder', 'omit']).default('placeholder'),
  /** Parallel write requests during apply. */
  concurrency: z.number().int().min(1).max(16).default(4),
  experimental: z
    .strictObject({
      /** Notion pages → ClickUp Docs. Implemented against the documented API; not live-validated. */
      docs: z.boolean().default(false),
    })
    .prefault({}),
});
export type OptionsConfig = z.infer<typeof OptionsConfigSchema>;

export const MigrationConfigSchema = z.strictObject({
  version: z.literal(1),
  source: z.looseObject({ type: z.string().min(1) }),
  destination: z.looseObject({ type: z.string().min(1) }),
  users: UsersConfigSchema.prefault({}),
  options: OptionsConfigSchema.prefault({}),
});
export type MigrationConfig = z.infer<typeof MigrationConfigSchema>;

const SECRET_KEY = /(^|[_-])(token|secret|password|apikey|api_key|authorization|bearer)([_-]|$)/i;

/** Walk the raw config and return paths of keys that look like credentials. */
export function findSecretKeys(raw: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((item, i) => hits.push(...findSecretKeys(item, `${path}[${i}]`)));
  } else if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      const here = path === '' ? key : `${path}.${key}`;
      if (SECRET_KEY.test(key)) hits.push(here);
      hits.push(...findSecretKeys(value, here));
    }
  }
  return hits;
}
