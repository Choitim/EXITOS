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

export function demoPlanPath(demoDir: string): string {
  return join(demoDir, '.exitos', 'demo', 'migration-plan.json');
}
