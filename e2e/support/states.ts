/**
 * Builds the state directories the tests run against, using the real built core package: the
 * same code path (`SqliteStateStore`, `sealPlan`) that the CLI itself uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SqliteStateStore,
  parsePlanJson,
  sealPlan,
  splitPlan,
  type MigrationPlan,
  type VerificationResult,
} from '../../packages/core/dist/index.js';

export const HOSTILE = {
  /** Each string tries to run script or smuggle a dangerous URL into the page. */
  markdown: [
    '# Heading <script>window.__pwned = 1</script>',
    '',
    'Links: [x](javascript:alert(1)) [y](JaVaScRiPt:alert(2)) [z](data:text/html;base64,PHNjcmlwdD5hbGVydCgzKTwvc2NyaXB0Pg==) [v](vbscript:msgbox(1)) [f](file:///etc/passwd) [p](//evil.example/protocol-relative) and a safe [link](https://example.com/safe?a=1&b=2).',
    '',
    '<img src=x onerror="window.__pwned=1;alert(1)">',
    '',
    '![tracking pixel](https://example.com/pixel.png) and ![bad](javascript:alert(1))',
    '',
    '<a href="javascript:alert(1)" onclick="alert(1)">raw html anchor</a>',
    '',
    '| Property | Value |',
    '| --- | --- |',
    '| <b>bold?</b> | [t](vbscript:msgbox(1)) |',
    '',
    '```html',
    '<script>alert(1)</script>',
    '```',
    '',
    '> quote <iframe src="javascript:alert(1)"></iframe>',
    '',
    'A footer with `exitos-key:notion:page:hostile` and escaped \\*stars\\* and \\[brackets\\].',
  ].join('\n'),
  text: '<img src=x onerror="window.__pwned=1;alert(1)">',
  scriptText: '"><script>window.__pwned=1;alert(1)</script>',
} as const;

export function readPlan(file: string): MigrationPlan {
  return parsePlanJson(readFileSync(file, 'utf8'));
}

/** A valid, sealed `live` plan derived from the demo plan in which text fields carry hostile payloads. */
export function buildHostilePlan(demoPlan: MigrationPlan): MigrationPlan {
  const { body } = splitPlan(demoPlan);
  let firstTask = true;
  const actions = body.actions.map((action) => {
    if (action.kind !== 'clickup.create_task' || !firstTask) return action;
    firstTask = false;
    const payload = action.payload as { body: Record<string, unknown> };
    return {
      ...action,
      label: `Create task ${HOSTILE.text}`,
      findings: [
        ...action.findings,
        {
          code: 'HOSTILE_FINDING',
          outcome: 'lossy' as const,
          severity: 'warning' as const,
          category: 'data' as const,
          message: HOSTILE.text,
          field: HOSTILE.scriptText,
        },
      ],
      payload: {
        ...action.payload,
        body: {
          ...payload.body,
          name: `${HOSTILE.text} hostile task`,
          markdown_content: HOSTILE.markdown,
          tags: [HOSTILE.text, HOSTILE.scriptText],
        },
      },
    };
  });
  const hostile = {
    ...body,
    mode: 'live' as const,
    actions,
    source: { ...body.source, workspace: { ...body.source.workspace, name: HOSTILE.scriptText } },
    collections: body.collections.map((c, i) => (i === 0 ? { ...c, name: HOSTILE.text } : c)),
    knownLimits: [...body.knownLimits, HOSTILE.text],
    findings: [
      ...body.findings,
      {
        code: 'HOSTILE_PLAN_ERROR',
        outcome: 'unsupported' as const,
        severity: 'error' as const,
        category: 'destination' as const,
        message: HOSTILE.scriptText,
      },
    ],
  };
  return sealPlan(hostile, new Date().toISOString());
}

/**
 * Stores the hostile plan with a run that ended in `verification_failed`, a failed verification
 * whose checks and events carry hostile text, and a hostile destination URL.
 */
export function seedHostileState(dbPath: string, plan: MigrationPlan): void {
  const store = SqliteStateStore.open(dbPath);
  try {
    const runId = 'run_e2e_hostile';
    const approvedAt = new Date().toISOString();
    store.createRun({ runId, plan, approvedAt });
    store.addEvent(runId, 'info', 'approved', `Plan ${plan.planId} approved.`);
    store.addEvent(runId, 'warn', HOSTILE.text.slice(0, 60), HOSTILE.text);
    store.addEvent(runId, 'error', 'hostile', HOSTILE.scriptText);
    const executable = plan.actions.filter((a) => a.disposition === 'execute');
    for (const [index, action] of executable.entries()) {
      store.markInFlight(runId, action.id);
      store.markSucceeded(runId, action.id, {
        destinationId: `dest_${index}`,
        destinationUrl:
          index === 0 ? 'javascript:alert(1)' : `https://app.example.test/t/dest_${index}`,
      });
    }
    store.setRunStatus(runId, 'verification_failed', {
      startedAt: approvedAt,
      finishedAt: new Date().toISOString(),
      stopReason: HOSTILE.text,
    });
    const first = executable[0];
    if (first === undefined) throw new Error('the demo plan has no executable action');
    const verification: VerificationResult = {
      runId,
      planId: plan.planId,
      verifiedAt: new Date().toISOString(),
      status: 'failed',
      counts: { verified: executable.length - 1, mismatched: 1, missing: 0, unverified: 0 },
      targets: [
        { target: HOSTILE.text, expected: executable.length, found: executable.length - 1 },
      ],
      items: [
        {
          actionId: first.id,
          source: first.source,
          destinationId: 'dest_0',
          status: 'mismatched',
          checks: [
            { field: 'name', status: 'verified' },
            {
              field: 'description',
              status: 'mismatched',
              expected: HOSTILE.text,
              actual: HOSTILE.scriptText,
              note: '[x](javascript:alert(1))',
            },
          ],
        },
      ],
      scope: `Scope: ${HOSTILE.text}`,
      notes: [HOSTILE.scriptText],
    };
    store.saveVerification(verification);
  } finally {
    store.close();
  }
}

/** A run that is `applying` with a little progress, to exercise live polling. */
export function seedLiveRun(dbPath: string, plan: MigrationPlan): string {
  const store = SqliteStateStore.open(dbPath);
  try {
    const runId = 'run_e2e_live';
    const approvedAt = new Date().toISOString();
    store.createRun({ runId, plan, approvedAt });
    store.addEvent(runId, 'info', 'approved', `Plan ${plan.planId} approved.`);
    store.setRunStatus(runId, 'applying', { startedAt: approvedAt });
    store.addEvent(runId, 'info', 'run_started', 'Run started.');
    return runId;
  } finally {
    store.close();
  }
}

/** Mark `count` more executable actions as succeeded in a running run (what the executor does). */
export function advanceLiveRun(dbPath: string, runId: string, count: number): number {
  const store = SqliteStateStore.open(dbPath);
  try {
    const plan = store.latestPlan();
    if (plan === undefined) throw new Error('no plan in the live state');
    const pending = store
      .listCheckpoints(runId)
      .filter((c) => c.status === 'pending')
      .slice(0, count);
    const byId = new Map(plan.actions.map((a) => [a.id, a]));
    for (const checkpoint of pending) {
      store.markInFlight(runId, checkpoint.actionId);
      store.markSucceeded(runId, checkpoint.actionId, {
        destinationId: `live_${checkpoint.actionId}`,
      });
      store.addEvent(
        runId,
        'info',
        'action_succeeded',
        `Wrote ${byId.get(checkpoint.actionId)?.label ?? checkpoint.actionId}`,
      );
    }
    return pending.length;
  } finally {
    store.close();
  }
}

/** A plan that was never approved: the state holds the plan and nothing else. */
export function seedPlannedOnly(dbPath: string, plan: MigrationPlan): void {
  const store = SqliteStateStore.open(dbPath);
  try {
    store.savePlan(plan);
  } finally {
    store.close();
  }
}

/** Every executable action written, the run `applied`, and no verification ever run. */
export function seedAppliedUnverified(dbPath: string, plan: MigrationPlan): void {
  const store = SqliteStateStore.open(dbPath);
  try {
    const runId = 'run_e2e_applied';
    const approvedAt = new Date().toISOString();
    store.createRun({ runId, plan, approvedAt });
    store.addEvent(runId, 'info', 'approved', `Plan ${plan.planId} approved.`);
    store.setRunStatus(runId, 'applying', { startedAt: approvedAt });
    store.addEvent(runId, 'info', 'run_started', 'Run started.');
    for (const [index, action] of plan.actions.entries()) {
      if (action.disposition !== 'execute') continue;
      store.markInFlight(runId, action.id);
      store.markSucceeded(runId, action.id, { destinationId: `applied_${index}` });
      store.addEvent(runId, 'info', 'action_succeeded', action.label);
    }
    store.setRunStatus(runId, 'applied', { finishedAt: new Date().toISOString() });
    store.addEvent(runId, 'info', 'run_finished', 'All actions applied. Not verified yet.');
  } finally {
    store.close();
  }
}

/**
 * A run that stopped half way: some actions written, one reconciled after a lost reply, two
 * failed, one blocked by them and one whose outcome is unknown, the rest still pending.
 */
export function seedFailedRun(dbPath: string, plan: MigrationPlan): void {
  const store = SqliteStateStore.open(dbPath);
  try {
    const runId = 'run_e2e_failed';
    const approvedAt = new Date().toISOString();
    store.createRun({ runId, plan, approvedAt });
    store.addEvent(runId, 'info', 'approved', `Plan ${plan.planId} approved.`);
    store.setRunStatus(runId, 'applying', { startedAt: approvedAt });
    store.addEvent(runId, 'info', 'run_started', 'Run started.');
    const executable = plan.actions.filter((a) => a.disposition === 'execute');
    const written = executable.slice(0, 5);
    const lost = executable[5];
    const failedA = executable[6];
    const failedB = executable[7];
    const blocked = executable[8];
    const unknown = executable[9];
    for (const [index, action] of written.entries()) {
      store.markInFlight(runId, action.id);
      store.markSucceeded(runId, action.id, { destinationId: `failed_${index}` });
      store.addEvent(runId, 'info', 'action_succeeded', action.label);
    }
    if (lost === undefined || failedA === undefined || failedB === undefined) {
      throw new Error('the demo plan has too few executable actions');
    }
    store.markInFlight(runId, lost.id);
    store.markSucceeded(runId, lost.id, { destinationId: 'failed_lost' });
    store.addEvent(runId, 'info', 'action_reconciled', `${lost.label}: found`);
    for (const action of [failedA, failedB]) {
      store.markInFlight(runId, action.id);
      store.markFailed(runId, action.id, 'failed', {
        code: 'HTTP_500',
        message: 'The destination answered HTTP 500.',
      });
      store.addEvent(runId, 'error', 'action_failed', `${action.label}: HTTP 500`);
    }
    if (blocked !== undefined) {
      store.markFailed(runId, blocked.id, 'blocked', {
        code: 'DEPENDENCY_FAILED',
        message: 'A prerequisite action did not succeed.',
      });
    }
    if (unknown !== undefined) {
      store.markInFlight(runId, unknown.id);
      store.markFailed(runId, unknown.id, 'ambiguous', {
        code: 'INTERRUPTED',
        message: 'The process stopped while this write was in flight.',
      });
    }
    const reason = 'Stopped after 2 consecutive failures.';
    store.addEvent(runId, 'error', 'run_stopped', reason);
    store.setRunStatus(runId, 'failed', {
      stopReason: reason,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    store.close();
  }
}

export function demoPlanPath(demoDir: string): string {
  return join(demoDir, '.exitos', 'demo', 'migration-plan.json');
}
