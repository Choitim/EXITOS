import { canonicalJson, type RequestRecorder } from '@exitos/shared';
import { validatePlanGraph } from '../engine/plan.js';
import {
  MigrationActionSchema,
  MappingRuleSchema,
  SourceSnapshotSchema,
  type SourceSnapshot,
} from '../schema/index.js';
import type {
  DestinationConnector,
  PlanFragment,
  PlanInput,
  SourceConnector,
} from '../sdk/types.js';

export interface ConformanceCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ConformanceReport {
  passed: boolean;
  checks: ConformanceCheck[];
}

function finish(checks: ConformanceCheck[]): ConformanceReport {
  return { passed: checks.every((c) => c.ok), checks };
}

function attempt(name: string, fn: () => string | undefined): ConformanceCheck {
  try {
    const problem = fn();
    return problem === undefined ? { name, ok: true } : { name, ok: false, detail: problem };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Referential integrity of a snapshot: the invariants every destination relies on. */
export function checkSnapshotIntegrity(snapshot: SourceSnapshot): ConformanceCheck[] {
  const collections = new Set(snapshot.collections.map((c) => c.key));
  const recordKeys = new Set(snapshot.records.map((r) => r.key));
  const documentKeys = new Set(snapshot.documents.map((d) => d.key));
  return [
    attempt('snapshot matches the schema', () => {
      const parsed = SourceSnapshotSchema.safeParse(snapshot);
      return parsed.success ? undefined : parsed.error.issues[0]?.message;
    }),
    attempt('record keys are unique', () =>
      recordKeys.size === snapshot.records.length ? undefined : 'duplicate record keys',
    ),
    attempt('every record belongs to a known collection', () => {
      const bad = snapshot.records.find((r) => !collections.has(r.collection));
      return bad ? `record ${bad.key} references unknown collection ${bad.collection}` : undefined;
    }),
    attempt('every record body points to a document', () => {
      const bad = snapshot.records.find((r) => r.body !== undefined && !documentKeys.has(r.body));
      return bad ? `record ${bad.key} body ${bad.body} has no document` : undefined;
    }),
    attempt('every record value is keyed by a declared field', () => {
      for (const record of snapshot.records) {
        const collection = snapshot.collections.find((c) => c.key === record.collection);
        const known = new Set(collection?.fields.map((f) => f.id));
        const unknown = Object.keys(record.values).find((id) => !known.has(id));
        if (unknown !== undefined)
          return `record ${record.key} has a value for undeclared field ${unknown}`;
      }
      return undefined;
    }),
    attempt('relationships start at known records', () => {
      const bad = snapshot.relationships.find((r) => !recordKeys.has(r.from));
      return bad ? `relationship from unknown record ${bad.from}` : undefined;
    }),
  ];
}

export interface SourceConformanceOptions {
  /** Credential values that must never appear in extracted/normalized data. */
  secrets?: readonly string[];
  /** The recorder behind the connector's fetch; asserts it made zero writes. */
  recorder?: RequestRecorder;
}

/**
 * Check a source connector against the contract. Run it in your connector's test suite against
 * a fixture or mock server. It does not replace connector-specific tests.
 */
export async function checkSourceConnector(
  source: SourceConnector,
  options: SourceConformanceOptions = {},
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  checks.push(
    attempt('manifest declares a source connector', () =>
      source.manifest.kind === 'source' && /^[a-z][a-z0-9-]*$/.test(source.manifest.id)
        ? undefined
        : 'manifest.kind must be "source" and manifest.id kebab-case',
    ),
  );

  let raw: unknown;
  let snapshot: SourceSnapshot | undefined;
  try {
    raw = await source.extract();
    snapshot = source.normalize(raw);
  } catch (error) {
    checks.push({ name: 'extract + normalize succeed', ok: false, detail: String(error) });
    return finish(checks);
  }
  checks.push({ name: 'extract + normalize succeed', ok: true });
  checks.push(...checkSnapshotIntegrity(snapshot));
  checks.push(
    attempt('normalize is deterministic', () =>
      canonicalJson(source.normalize(raw)) === canonicalJson(snapshot)
        ? undefined
        : 'two normalize() calls on the same input differ',
    ),
  );
  if (options.secrets?.length) {
    const serialised = JSON.stringify(snapshot);
    checks.push(
      attempt('no credential appears in the snapshot', () =>
        options.secrets?.some((s) => s.length > 0 && serialised.includes(s))
          ? 'a credential value leaked into normalized data'
          : undefined,
      ),
    );
  }
  if (options.recorder) {
    const recorder = options.recorder;
    checks.push(
      attempt('a source performs zero write requests', () =>
        recorder.writes.length === 0
          ? undefined
          : `${recorder.writes.length} write request(s) were sent`,
      ),
    );
  }
  return finish(checks);
}

/** Check a destination's pure planning step: determinism, schema validity and a sound graph. */
export function checkDestinationPlan(
  destination: DestinationConnector,
  input: PlanInput,
): ConformanceReport {
  const checks: ConformanceCheck[] = [];
  checks.push(
    attempt('manifest declares a destination connector', () =>
      destination.manifest.kind === 'destination'
        ? undefined
        : 'manifest.kind must be "destination"',
    ),
  );
  let fragment: PlanFragment;
  try {
    fragment = destination.plan(input);
  } catch (error) {
    checks.push({ name: 'plan() succeeds', ok: false, detail: String(error) });
    return finish(checks);
  }
  checks.push({ name: 'plan() succeeds', ok: true });
  checks.push(
    attempt('plan() is deterministic', () =>
      canonicalJson(destination.plan(input)) === canonicalJson(fragment)
        ? undefined
        : 'two plan() calls on identical input differ',
    ),
    attempt('actions match the schema', () => {
      for (const a of fragment.actions) {
        const parsed = MigrationActionSchema.safeParse(a);
        if (!parsed.success) return `${a.id}: ${parsed.error.issues[0]?.message ?? 'invalid'}`;
      }
      return undefined;
    }),
    attempt('mappings match the schema', () => {
      for (const m of fragment.mappings) {
        const parsed = MappingRuleSchema.safeParse(m);
        if (!parsed.success) return `${m.id}: ${parsed.error.issues[0]?.message ?? 'invalid'}`;
      }
      return undefined;
    }),
    attempt('action graph is valid (unique ids, known dependencies, acyclic)', () => {
      validatePlanGraph({ actions: fragment.actions });
      return undefined;
    }),
    attempt('idempotency keys are unique within a scope', () => {
      const seen = new Set<string>();
      for (const a of fragment.actions) {
        const k = `${a.scope}|${a.idempotencyKey}`;
        if (seen.has(k)) return `duplicate idempotency key ${a.idempotencyKey}`;
        seen.add(k);
      }
      return undefined;
    }),
    attempt('every unsupported/lossy outcome is explained by a finding', () => {
      const bad = fragment.actions.find(
        (a) => (a.outcome === 'lossy' || a.outcome === 'unsupported') && a.findings.length === 0,
      );
      return bad
        ? `action ${bad.id} is ${bad.outcome} but has no finding explaining why`
        : undefined;
    }),
  );
  return finish(checks);
}
