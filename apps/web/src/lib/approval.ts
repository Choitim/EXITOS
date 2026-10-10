/**
 * What approving a plan would do, read off the plan itself (its actions, user mapping and summary).
 * Nothing is estimated or invented: every number here is a count taken from the state document.
 */
import type { MigrationPlan } from '@exitos/core/schema';

/** Action kinds this dashboard can describe. They only create items or add links between items. */
const KIND_WORDS: Readonly<Record<string, { one: string; many: string; experimental: boolean }>> = {
  'clickup.create_task': { one: 'task', many: 'tasks', experimental: false },
  'clickup.link_tasks': {
    one: 'link between tasks',
    many: 'links between tasks',
    experimental: false,
  },
  'clickup.create_doc': { one: 'Doc', many: 'Docs', experimental: true },
  'clickup.create_doc_page': { one: 'Doc page', many: 'Doc pages', experimental: true },
};

export interface CreateRow {
  kind: string;
  /** "tasks", "Doc pages". Falls back to the raw kind for a kind this dashboard does not know. */
  noun: string;
  count: number;
  /** Where in the destination, when the plan names a target for it ("Roadmap"). */
  target: string | null;
  /** Docs migration is experimental and says so wherever it is listed. */
  experimental: boolean;
  /** True when the kind is one this dashboard does not recognise. */
  unrecognised: boolean;
}

export interface ApprovalSummary {
  /** One row per action kind and destination target, only for actions that would be written. */
  creates: CreateRow[];
  /** Number of actions that would be written (the sum of `creates`). */
  toWrite: number;
  /** Actions skipped because the destination already has them. */
  toSkip: number;
  /** Raw kinds the dashboard has no description for; the "nothing is overwritten" line is withheld. */
  unrecognisedKinds: string[];
  /** Assignments that make the destination notify a person. */
  notified: number;
  /** Errors that make `exitos apply` refuse the plan. */
  blockingErrors: number;
}

export function nounFor(kind: string, count: number): string {
  const words = KIND_WORDS[kind];
  if (!words) return kind;
  return count === 1 ? words.one : words.many;
}

/** The destination target an action writes into, found by its scope (`clickup:list:901001`). */
function targetName(plan: Pick<MigrationPlan, 'destination'>, scope: string): string | null {
  const hit = plan.destination.targets.find(
    (t) => scope === `${t.kind}:${t.id}` || scope.endsWith(`:${t.kind}:${t.id}`),
  );
  return hit?.name ?? null;
}

export function summarizeApproval(
  plan: Pick<MigrationPlan, 'actions' | 'destination' | 'users' | 'summary'>,
): ApprovalSummary {
  const rows = new Map<string, CreateRow>();
  let toSkip = 0;
  for (const action of plan.actions) {
    if (action.disposition !== 'execute') {
      toSkip += 1;
      continue;
    }
    const target = targetName(plan, action.scope);
    const key = `${action.kind}\u0001${target ?? ''}`;
    const existing = rows.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const words = KIND_WORDS[action.kind];
    rows.set(key, {
      kind: action.kind,
      noun: words ? words.many : action.kind,
      count: 1,
      target,
      experimental: words?.experimental ?? false,
      unrecognised: words === undefined,
    });
  }
  const creates = [...rows.values()].map((row) => ({
    ...row,
    noun: nounFor(row.kind, row.count),
  }));
  return {
    creates,
    toWrite: creates.reduce((sum, row) => sum + row.count, 0),
    toSkip,
    unrecognisedKinds: [...new Set(creates.filter((r) => r.unrecognised).map((r) => r.kind))],
    notified: plan.users.assignmentsThatNotify,
    blockingErrors: plan.summary.blockingErrors,
  };
}
