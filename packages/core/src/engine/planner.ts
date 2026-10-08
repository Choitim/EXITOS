import { VERSION, type RequestRecorder } from '@exitos/shared';
import {
  JsonObjectSchema,
  itemOutcome,
  type Finding,
  type IdMapping,
  type MigrationAction,
  type MigrationConfig,
  type MigrationPlan,
  type PlanBody,
  type SourceSnapshot,
} from '../schema/index.js';
import type {
  DestinationConnector,
  DestinationInspection,
  PlanFragment,
  RunMode,
  SourceConnector,
} from '../sdk/types.js';
import type { StateStore } from '../state/store.js';
import { buildInventory, sealPlan, summarizePlan, validatePlanGraph } from './plan.js';

export interface BuildPlanInput {
  source: SourceConnector;
  destination: DestinationConnector;
  config: MigrationConfig;
  mode: RunMode;
  /** Previous mappings are used so already-migrated items are skipped, not duplicated. */
  store?: StateStore | undefined;
  now: () => Date;
  onProgress?: (message: string) => void;
  /** Request recorders of the connections used while planning (for the read estimate). */
  recorders?: readonly RequestRecorder[];
}

export interface BuildPlanOutput {
  plan: MigrationPlan;
  snapshot: SourceSnapshot;
  inspection: DestinationInspection;
}

/** Key used in `PlanInput.existing`. */
export function existingKey(scope: string, sourceKey: string): string {
  return `${scope}|${sourceKey}`;
}

function findingIdentity(f: Finding): string {
  return [f.code, f.entity ?? '', f.field ?? '', f.collection ?? ''].join('|');
}

/**
 * Attach entity-level source findings to the action that migrates that entity; everything that
 * cannot be attached (collection-level notes, entities with no action) stays plan-level so it is
 * still reported. Nothing from the source is ever lost between extraction and the plan.
 */
export function routeSourceFindings(
  snapshotFindings: readonly Finding[],
  actions: readonly MigrationAction[],
): { actions: MigrationAction[]; planLevel: Finding[] } {
  const bySource = new Map<string, MigrationAction[]>();
  for (const a of actions) {
    if (a.source === null) continue;
    const group = bySource.get(a.source);
    if (group === undefined) bySource.set(a.source, [a]);
    else group.push(a);
  }
  const extra = new Map<string, Finding[]>();
  const planLevel: Finding[] = [];
  for (const f of snapshotFindings) {
    const owners = f.entity === undefined ? undefined : bySource.get(f.entity);
    if (owners === undefined || owners.length === 0) {
      planLevel.push(f);
      continue;
    }
    // Attach to the first action for that entity (the one that carries the content).
    const owner = owners[0] as MigrationAction;
    const attached = extra.get(owner.id);
    if (attached === undefined) extra.set(owner.id, [f]);
    else attached.push(f);
  }
  const merged = actions.map((a) => {
    const add = extra.get(a.id);
    if (add === undefined) return a;
    const seen = new Set(a.findings.map(findingIdentity));
    const findings = [...a.findings, ...add.filter((f) => !seen.has(findingIdentity(f)))];
    const outcome =
      a.disposition === 'skip'
        ? a.outcome
        : itemOutcome([a.outcome, ...findings.map((f) => f.outcome)]);
    return { ...a, findings, outcome };
  });
  return { actions: merged, planLevel };
}

/**
 * Build a plan. Strictly read-only: the source is read, the destination is inspected and validated,
 * and the result is a sealed, self-contained document. The caller decides whether to save it.
 */
export async function buildPlan(input: BuildPlanInput): Promise<BuildPlanOutput> {
  const progress = input.onProgress ?? (() => undefined);

  progress('Reading the source (read-only)…');
  const raw = await input.source.extract({ onProgress: progress });
  const snapshot = input.source.normalize(raw);

  progress('Inspecting the destination (read-only)…');
  const inspection = await input.destination.inspect();

  const existing = new Map<string, IdMapping>();
  for (const mapping of input.store?.listMappings() ?? []) {
    existing.set(existingKey(mapping.scope, mapping.sourceKey), mapping);
  }

  progress('Mapping fields and content…');
  const fragment = input.destination.plan({
    snapshot,
    inspection,
    config: input.config,
    mode: input.mode,
    existing,
  });

  const routed = routeSourceFindings(snapshot.findings, fragment.actions);
  const sourceRef: PlanBody['source'] = {
    connector: { id: input.source.manifest.id, version: input.source.manifest.version },
    workspace: snapshot.source,
    selection: JsonObjectSchema.parse(input.config.source),
  };
  const destinationRef: PlanBody['destination'] = {
    connector: { id: input.destination.manifest.id, version: input.destination.manifest.version },
    workspace: inspection.workspace,
    targets: fragment.targets,
    config: fragment.destinationConfig,
  };
  const planLevel: Finding[] = [...routed.planLevel, ...inspection.findings, ...fragment.findings];

  const draftBody = assemble({
    mode: input.mode,
    sourceRef,
    destinationRef,
    fragment,
    actions: routed.actions,
    findings: planLevel,
    readRequests: 0,
  });
  validatePlanGraph(draftBody);
  const draft = sealPlan(draftBody, input.now().toISOString());

  progress('Validating against the live destination (read-only)…');
  const validation = await input.destination.validate(draft);

  // Adopt items already present in the destination (found via their provenance marker).
  const adopted = new Map(validation.adopted.map((a) => [a.actionId, a]));
  const actions = routed.actions.map((action): MigrationAction => {
    const hit = adopted.get(action.id);
    if (!hit || action.disposition === 'skip') return action;
    return {
      ...action,
      disposition: 'skip',
      skipReason: 'adopted_existing',
      existingDestinationId: hit.destinationId,
      outcome: 'skipped',
      estimatedRequests: 0,
    };
  });

  const readRequests =
    (input.recorders ?? []).reduce((n, r) => n + r.reads.length, 0) || validation.readRequests;

  const finalBody = assemble({
    mode: input.mode,
    sourceRef,
    destinationRef,
    fragment,
    actions,
    findings: [...planLevel, ...validation.findings],
    readRequests,
  });
  validatePlanGraph(finalBody);
  const plan = sealPlan(finalBody, input.now().toISOString(), VERSION);
  return { plan, snapshot, inspection };
}

function assemble(args: {
  mode: RunMode;
  sourceRef: PlanBody['source'];
  destinationRef: PlanBody['destination'];
  fragment: PlanFragment;
  actions: readonly MigrationAction[];
  findings: readonly Finding[];
  readRequests: number;
}): PlanBody {
  const { fragment, actions } = args;
  const everything = [...args.findings, ...actions.flatMap((a) => a.findings)];
  const inventory = buildInventory(everything);
  const writeRequests = actions
    .filter((a) => a.disposition === 'execute')
    .reduce((n, a) => n + a.estimatedRequests, 0);
  const rpm = fragment.requestsPerMinute;
  return {
    schemaVersion: 1,
    mode: args.mode,
    source: args.sourceRef,
    destination: args.destinationRef,
    options: fragment.options,
    collections: fragment.collections,
    mappings: fragment.mappings,
    actions: [...actions],
    users: fragment.users,
    findings: [...args.findings],
    inventory,
    summary: summarizePlan({
      actions,
      mappings: fragment.mappings,
      findings: everything,
      inventory,
    }),
    estimate: {
      readRequests: args.readRequests,
      writeRequests,
      requestsPerMinute: rpm,
      minutesAtRateLimit: Math.round((writeRequests / rpm) * 10) / 10,
    },
    knownLimits: fragment.knownLimits,
  };
}
