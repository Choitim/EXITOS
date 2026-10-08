/**
 * Defensive guard for the JSON document served at `GET /api/state`.
 *
 * The browser bundle must not contain runtime code from `@exitos/*`, so instead of re-using the
 * Zod schema this file checks the fields the dashboard actually reads. Unknown extra fields are
 * fine; a missing or mistyped field produces a readable error (and an error screen) instead of a
 * crash somewhere inside a table.
 */
import type { DashboardState } from '@exitos/core/schema';

/** Returns an error message, or `null` when the value is acceptable. */
type Check = (value: unknown, path: string) => string | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const kindOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;

const str: Check = (v, p) =>
  typeof v === 'string' ? null : `${p} must be a string (got ${kindOf(v)})`;
const num: Check = (v, p) =>
  typeof v === 'number' && Number.isFinite(v) ? null : `${p} must be a number (got ${kindOf(v)})`;
const bool: Check = (v, p) =>
  typeof v === 'boolean' ? null : `${p} must be a boolean (got ${kindOf(v)})`;
const anyObject: Check = (v, p) =>
  isRecord(v) ? null : `${p} must be an object (got ${kindOf(v)})`;

const oneOf =
  (...values: readonly string[]): Check =>
  (v, p) =>
    typeof v === 'string' && values.includes(v) ? null : `${p} must be one of ${values.join(', ')}`;

const arrayOf =
  (item: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) return `${p} must be an array (got ${kindOf(v)})`;
    for (let i = 0; i < v.length; i += 1) {
      const problem = item(v[i], `${p}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  };

const nullable =
  (check: Check): Check =>
  (v, p) =>
    v === null ? null : check(v, p);

const obj =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, p) => {
    if (!isRecord(v)) return `${p} must be an object (got ${kindOf(v)})`;
    for (const [key, check] of Object.entries(required)) {
      if (!(key in v)) return `${p}.${key} is missing`;
      const problem = check(v[key], `${p}.${key}`);
      if (problem !== null) return problem;
    }
    for (const [key, check] of Object.entries(optional)) {
      const value = v[key];
      if (value === undefined) continue;
      const problem = check(value, `${p}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  };

const MODES = ['demo', 'live'] as const;

const outcomeCounts = obj({
  supported: num,
  transformed: num,
  lossy: num,
  unsupported: num,
  skipped: num,
  failed: num,
});

const planSummary = obj({
  actions: obj({ total: num, toExecute: num, toSkip: num, byKind: anyObject }),
  items: outcomeCounts,
  fields: outcomeCounts,
  notPreserved: obj({ unsupported: num, lossy: num }),
  blockingErrors: num,
  warnings: num,
});

const finding = obj(
  { code: str, outcome: str, severity: str, category: str, message: str },
  { entity: str, collection: str, field: str, count: num },
);

const workspace = obj({ system: str, id: str, name: str }, { url: str });
const target = obj({ kind: str, id: str, name: str }, { path: str });
const connectorRef = obj({ id: str, version: str });

const mapping = obj(
  {
    id: str,
    collection: str,
    source: obj({ fieldId: str, name: str, kind: str, sourceType: str }),
    target: obj({ kind: str }, { customField: obj({ id: str, name: str, type: str }) }),
    transform: str,
    outcome: str,
    reason: str,
    explicit: bool,
  },
  { valueMap: anyObject, unmappedValues: arrayOf(str) },
);

const action = obj({
  id: str,
  kind: str,
  label: str,
  source: nullable(str),
  idempotencyKey: str,
  scope: str,
  dependsOn: arrayOf(str),
  disposition: str,
  outcome: str,
  findings: arrayOf(finding),
  estimatedRequests: num,
  payload: anyObject,
});

const plan = obj({
  planId: str,
  hash: str,
  generatedAt: str,
  exitosVersion: str,
  mode: oneOf(...MODES),
  source: obj({ connector: connectorRef, workspace, selection: anyObject }),
  destination: obj({
    connector: connectorRef,
    workspace,
    targets: arrayOf(target),
    config: anyObject,
  }),
  options: anyObject,
  collections: arrayOf(
    obj({ key: str, name: str, recordCount: num, target: nullable(target) }, { incomplete: bool }),
  ),
  mappings: arrayOf(mapping),
  actions: arrayOf(action),
  users: obj({
    mapped: arrayOf(obj({ source: str, destinationId: str, via: str }, { name: str })),
    unmapped: arrayOf(obj({ source: str }, { name: str })),
    assignmentsThatNotify: num,
  }),
  findings: arrayOf(finding),
  inventory: arrayOf(finding),
  summary: planSummary,
  estimate: obj({
    readRequests: num,
    writeRequests: num,
    requestsPerMinute: num,
    minutesAtRateLimit: num,
  }),
  knownLimits: arrayOf(str),
});

const run = obj(
  {
    runId: str,
    planId: str,
    mode: oneOf(...MODES),
    status: str,
    approvedAt: str,
    updatedAt: str,
    counts: obj({
      pending: num,
      in_flight: num,
      succeeded: num,
      failed: num,
      ambiguous: num,
      blocked: num,
      skipped: num,
    }),
  },
  { planHash: str, startedAt: str, finishedAt: str, stopReason: str },
);

const runEvent = obj({ id: num, runId: str, ts: str, level: str, type: str, message: str });

const verification = obj({
  runId: str,
  planId: str,
  verifiedAt: str,
  status: oneOf('passed', 'failed', 'incomplete'),
  counts: obj({ verified: num, mismatched: num, missing: num, unverified: num }),
  targets: arrayOf(obj({ target: str, expected: num, found: num })),
  items: arrayOf(
    obj(
      {
        actionId: str,
        source: nullable(str),
        status: str,
        checks: arrayOf(
          obj({ field: str, status: str }, { expected: str, actual: str, note: str }),
        ),
      },
      { destinationId: str },
    ),
  ),
  scope: str,
  notes: arrayOf(str),
});

const report = obj({
  schemaVersion: num,
  generatedAt: str,
  exitosVersion: str,
  mode: oneOf(...MODES),
  redacted: bool,
  state: str,
  headline: str,
  plan: obj({
    planId: str,
    hash: str,
    source: obj({ system: str, workspace: str }),
    destination: obj({ system: str, workspace: str }),
    summary: planSummary,
  }),
  run: nullable(run),
  items: arrayOf(
    obj(
      {
        actionId: str,
        label: str,
        source: nullable(str),
        status: str,
        outcome: str,
        findings: arrayOf(finding),
      },
      { destinationId: str, destinationUrl: str, error: str },
    ),
  ),
  notPreserved: arrayOf(finding),
  verification: nullable(verification),
  mappings: arrayOf(anyObject),
  requests: nullable(obj({ reads: num, writes: num, retries: num, rateLimited: num })),
  disclaimers: arrayOf(str),
});

const root = obj({
  schemaVersion: (v, p) => (v === 1 ? null : `${p} must be 1 (got ${String(v)})`),
  mode: oneOf('demo', 'live', 'empty'),
  generatedAt: str,
  exitosVersion: str,
  plan: nullable(plan),
  run: nullable(run),
  runs: arrayOf(run),
  events: arrayOf(runEvent),
  verification: nullable(verification),
  report: nullable(report),
});

export type ParseResult = { ok: true; state: DashboardState } | { ok: false; error: string };

/** Validate an already-parsed JSON value. */
export function validateDashboardState(raw: unknown): ParseResult {
  const problem = root(raw, 'state');
  if (problem !== null) return { ok: false, error: problem };
  const state = raw as DashboardState;
  if (state.mode !== 'empty' && state.plan === null) {
    return { ok: false, error: 'state.plan is null although state.mode is not "empty"' };
  }
  return { ok: true, state };
}

/** Parse the response body text. */
export function parseDashboardState(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The response is not valid JSON.' };
  }
  return validateDashboardState(raw);
}

/**
 * Identity of a response ignoring the top-level `generatedAt` (which changes on every request), so
 * a poll that brings no news does not re-render large tables. The server writes that key first, so
 * the first match is the top-level one; if the order ever changes this only loses the shortcut.
 */
export function contentSignature(text: string): string {
  return text.replace(/"generatedAt":"[^"]*"/, '"generatedAt":""');
}
