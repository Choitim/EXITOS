import { z } from 'zod';
import { EntityKeySchema } from './ids.js';

/**
 * What happens to a piece of content. Every item, field and block gets exactly one.
 *
 *  supported    arrives intact with equivalent meaning
 *  transformed  arrives, but in a different representation (information preserved)
 *  lossy        arrives, but some information is lost
 *  unsupported  cannot be migrated at all (reported, never silently dropped)
 *  skipped      intentionally not migrated (already present, excluded by config)
 *  failed       migration was attempted and failed (apply/verify time only)
 */
export const OutcomeSchema = z.enum([
  'supported',
  'transformed',
  'lossy',
  'unsupported',
  'skipped',
  'failed',
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const OUTCOMES = OutcomeSchema.options;

/** Worst-first ordering used when collapsing several outcomes into one. */
const SEVERITY_RANK: Record<Outcome, number> = {
  failed: 5,
  unsupported: 4,
  lossy: 3,
  transformed: 2,
  skipped: 1,
  supported: 0,
};

export function worstOutcome(outcomes: readonly Outcome[]): Outcome {
  let worst: Outcome = 'supported';
  for (const outcome of outcomes) {
    if (SEVERITY_RANK[outcome] > SEVERITY_RANK[worst]) worst = outcome;
  }
  return worst;
}

/**
 * Outcome of an ITEM that is still created. "unsupported" means "cannot be migrated at all"; an
 * item with an unsupported PART is still migrated, so it is `lossy` (the unsupported part is
 * counted in the not-preserved inventory instead).
 */
export function itemOutcome(outcomes: readonly Outcome[]): Outcome {
  const worst = worstOutcome(outcomes);
  return worst === 'unsupported' ? 'lossy' : worst;
}

export const SeveritySchema = z.enum(['info', 'warning', 'error']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingCategorySchema = z.enum([
  'field_type',
  'block_type',
  'formatting',
  'relation',
  'attachment',
  'user_mapping',
  'permission',
  'destination',
  'scope',
  'data',
  'source_feature',
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

/**
 * A single, human-explainable observation about fidelity. The `code` is stable and documented so
 * users can filter on it; the `message` is for humans.
 */
export const FindingSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  outcome: OutcomeSchema,
  severity: SeveritySchema,
  category: FindingCategorySchema,
  message: z.string().max(1000),
  /** The item this concerns, when it concerns one item. */
  entity: EntityKeySchema.optional(),
  collection: EntityKeySchema.optional(),
  /** Field or block type name as the user knows it (e.g. the Notion property name). */
  field: z.string().max(300).optional(),
  /** How many items share this finding when findings are aggregated. */
  count: z.number().int().positive().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export type Tally<K extends string> = Record<K, number>;

export function emptyOutcomeTally(): Tally<Outcome> {
  return { supported: 0, transformed: 0, lossy: 0, unsupported: 0, skipped: 0, failed: 0 };
}

export function tallyOutcomes(outcomes: Iterable<Outcome>): Tally<Outcome> {
  const tally = emptyOutcomeTally();
  for (const outcome of outcomes) tally[outcome] += 1;
  return tally;
}

/** Collapse repeated findings (same code, outcome, field) into counted ones. */
export function aggregateFindings(findings: readonly Finding[]): Finding[] {
  const groups = new Map<string, Finding>();
  for (const f of findings) {
    const key = [f.code, f.outcome, f.field ?? ''].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + (f.count ?? 1);
    } else {
      const { entity: _entity, ...rest } = f;
      groups.set(key, { ...rest, count: f.count ?? 1 });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      SEVERITY_RANK[b.outcome] - SEVERITY_RANK[a.outcome] ||
      a.code.localeCompare(b.code) ||
      (a.field ?? '').localeCompare(b.field ?? ''),
  );
}
