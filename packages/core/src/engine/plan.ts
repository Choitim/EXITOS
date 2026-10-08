import { PlanIntegrityError, VERSION, ValidationError, hashObject } from '@exitos/shared';
import {
  MigrationPlanSchema,
  PlanBodySchema,
  aggregateFindings,
  tallyOutcomes,
  type Finding,
  type MappingRule,
  type MigrationAction,
  type MigrationPlan,
  type PlanBody,
  type PlanSummary,
} from '../schema/index.js';

/** Fields that are NOT covered by the hash. Everything else is the approved content. */
type MetaKey = 'planId' | 'hash' | 'generatedAt' | 'exitosVersion';

export function splitPlan(plan: MigrationPlan): {
  body: PlanBody;
  meta: Pick<MigrationPlan, MetaKey>;
} {
  const { planId, hash, generatedAt, exitosVersion, ...rest } = plan;
  return { body: PlanBodySchema.parse(rest), meta: { planId, hash, generatedAt, exitosVersion } };
}

/**
 * Seal a plan body: compute its content hash and derive the plan id the user must type to approve.
 * The hash is computed over the Zod-normalised body so it is stable across save/load.
 */
export function sealPlan(
  body: PlanBody,
  generatedAt: string,
  exitosVersion: string = VERSION,
): MigrationPlan {
  const normalised = PlanBodySchema.parse(body);
  const hash = hashObject(normalised);
  return MigrationPlanSchema.parse({
    ...normalised,
    planId: `plan_${hash.slice(0, 12)}`,
    hash,
    generatedAt,
    exitosVersion,
  });
}

/** Throws if the plan content does not match its hash/id (tampering, hand-editing, corruption). */
export function verifyPlanIntegrity(plan: MigrationPlan): void {
  const { body } = splitPlan(plan);
  const actual = hashObject(body);
  if (actual !== plan.hash) {
    throw new PlanIntegrityError(
      'The plan file does not match its recorded hash: it has been edited or is corrupted. Re-run `exitos plan` to create a fresh, approvable plan.',
    );
  }
  if (plan.planId !== `plan_${plan.hash.slice(0, 12)}`) {
    throw new PlanIntegrityError('The plan id does not match its hash.');
  }
  validatePlanGraph(plan);
}

/** Action ids must be unique, dependencies must exist, and the graph must be acyclic. */
export function validatePlanGraph(plan: Pick<MigrationPlan, 'actions'>): void {
  const ids = new Set<string>();
  for (const action of plan.actions) {
    if (ids.has(action.id)) {
      throw new ValidationError('PLAN_DUPLICATE_ACTION', `Duplicate action id ${action.id}.`);
    }
    ids.add(action.id);
  }
  for (const action of plan.actions) {
    for (const dep of action.dependsOn) {
      if (!ids.has(dep)) {
        throw new ValidationError(
          'PLAN_MISSING_DEPENDENCY',
          `Action ${action.id} depends on unknown action ${dep}.`,
        );
      }
    }
  }
  // Kahn's algorithm
  const indegree = new Map<string, number>(plan.actions.map((a) => [a.id, a.dependsOn.length]));
  const dependents = new Map<string, string[]>();
  for (const a of plan.actions) {
    for (const dep of a.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), a.id]);
    }
  }
  const queue = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    visited += 1;
    for (const next of dependents.get(id) ?? []) {
      const n = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, n);
      if (n === 0) queue.push(next);
    }
  }
  if (visited !== plan.actions.length) {
    throw new ValidationError('PLAN_CYCLE', 'The plan contains a dependency cycle.');
  }
}

/** Parse and fully validate a plan from untrusted JSON text (a trust boundary). */
export function parsePlanJson(text: string): MigrationPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationError('PLAN_NOT_JSON', 'The plan file is not valid JSON.');
  }
  const parsed = MigrationPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 5)
      .map((i) => i.path.join('.') || '(root)')
      .join(', ');
    throw new ValidationError('PLAN_INVALID', `The plan file failed validation at: ${where}`);
  }
  verifyPlanIntegrity(parsed.data);
  return parsed.data;
}

export function summarizePlan(input: {
  actions: readonly MigrationAction[];
  mappings: readonly MappingRule[];
  findings: readonly Finding[];
  inventory: readonly Finding[];
}): PlanSummary {
  const byKind: Record<string, number> = {};
  for (const a of input.actions) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

  const sum = (outcome: Finding['outcome']): number =>
    input.inventory.filter((f) => f.outcome === outcome).reduce((n, f) => n + (f.count ?? 1), 0);

  return {
    actions: {
      total: input.actions.length,
      toExecute: input.actions.filter((a) => a.disposition === 'execute').length,
      toSkip: input.actions.filter((a) => a.disposition === 'skip').length,
      byKind,
    },
    items: tallyOutcomes(input.actions.map((a) => a.outcome)),
    fields: tallyOutcomes(input.mappings.map((m) => m.outcome)),
    notPreserved: { unsupported: sum('unsupported'), lossy: sum('lossy') },
    blockingErrors: input.findings.filter((f) => f.severity === 'error').length,
    // Distinct kinds of warning, not instances: 130 identical warnings are one thing to read.
    warnings: new Set(
      input.findings
        .filter((f) => f.severity === 'warning')
        .map((f) => `${f.code}|${f.field ?? ''}`),
    ).size,
  };
}

/** Everything that is not a clean "supported", aggregated, worst first. */
export function buildInventory(findings: readonly Finding[]): Finding[] {
  return aggregateFindings(
    findings.filter(
      (f) => f.outcome === 'transformed' || f.outcome === 'lossy' || f.outcome === 'unsupported',
    ),
  );
}

/** Findings that must stop `apply`: plan-level and action-level findings with severity `error`. */
export function blockingFindings(plan: Pick<MigrationPlan, 'findings' | 'actions'>): Finding[] {
  return [...plan.findings, ...plan.actions.flatMap((a) => a.findings)].filter(
    (f) => f.severity === 'error',
  );
}
