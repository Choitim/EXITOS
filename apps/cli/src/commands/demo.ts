import { join } from 'node:path';
import {
  BIN_NAME,
  ExitCode,
  RequestRecorder,
  SimulatedInterruptError,
  VERSION,
  VirtualClock,
} from '@exitos/shared';
import {
  approveAndCreateRun,
  buildPlan,
  parseMigrationConfig,
  verifyRun,
  type MigrationPlan,
} from '@exitos/core';
import { DEMO_IDS, DEMO_MIGRATION_YAML } from '@exitos/demo-workspace';
import { eprintln, println, type CliContext } from '../context.js';
import { createRuntime, type Runtime } from '../runtime/runtime.js';
import { openStore, resetDemoState, resolveStateDir } from '../runtime/state.js';
import { box, keyValues } from '../ui/layout.js';
import { approvalView, banner, planView, reportView, step, verificationView } from '../ui/views.js';
import { configFromPlan } from './apply.js';
import { reportFor } from './inspect-status-verify-report.js';
import { executeWithProgress } from './execute.js';
import { recorderLine, viewOptions, writeArtifact } from './shared.js';

export interface DemoOptions {
  stateDir?: string | undefined;
  /** Milliseconds to pause between steps (useful when recording a screencast). */
  pace?: number | undefined;
  /** Simulate a crash after this many applied actions (then `exitos resume --demo`). */
  interruptAfter?: number | undefined;
  /** Inject a few API failures (429s, a lost reply) so the recovery logic is visible. Default on. */
  chaos?: boolean | undefined;
  json?: boolean | undefined;
}

const TOTAL_STEPS = 6;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The offline demo: a complete plan → approve → apply → verify cycle on synthetic data. */
export async function demoCommand(ctx: CliContext, options: DemoOptions): Promise<number> {
  const quiet = options.json === true;
  const { style } = ctx;
  const vo = viewOptions(ctx);
  const say = (lines: string | readonly string[]): void => {
    if (!quiet) println(ctx, lines);
  };
  const pause = async (): Promise<void> => {
    if (options.pace && !quiet) await sleep(options.pace);
  };

  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo: true });
  resetDemoState(location);
  const rt = createRuntime(ctx, { mode: 'demo', location });
  const store = openStore(location, { now: () => rt.now().toISOString() });
  const demo = rt.demo;
  if (!demo) throw new Error('demo runtime is missing its fakes');

  try {
    const config = parseMigrationConfig(DEMO_MIGRATION_YAML, 'demo.yaml');
    const srcRec = new RequestRecorder();
    const roRec = new RequestRecorder();
    say(banner('demo', vo));

    // ---- 1. inspect ------------------------------------------------------------------------
    say(step(1, TOTAL_STEPS, 'Look at the synthetic Notion workspace (read-only)', vo));
    const source = rt.createSource(config, srcRec);
    const inspection = await source.inspect();
    for (const c of inspection.collections) {
      const by = (level: string): number => c.fields.filter((f) => f.support === level).length;
      const odd = c.fields.filter((f) => f.support !== 'supported').map((f) => f.field.name);
      say(
        `  ${style.bold(c.name)} ${style.gray(`· ${c.recordCount} rows · ${c.fields.length} properties`)}   ${style.green(`✔ ${by('supported')} portable`)}  ${style.cyan(`↻ ${by('transformed')}`)}  ${style.yellow(`⚠ ${by('lossy')}`)}  ${style.red(`✖ ${by('unsupported')}`)}`,
      );
      if (odd.length > 0) say(`    ${style.gray('needs attention: ' + odd.join(', '))}`);
    }
    for (const d of inspection.documents)
      say(
        `  ${style.bold('Page')} ${d.title} ${style.gray('(+ nested pages → ClickUp Doc, experimental)')}`,
      );
    say(style.gray(`  (see every property with: ${BIN_NAME} inspect notion --demo)`));
    await pause();

    // ---- 2. plan ---------------------------------------------------------------------------
    say(
      step(
        2,
        TOTAL_STEPS,
        'Plan — what would move, change, or stay behind (nothing is written)',
        vo,
      ),
    );
    const { plan } = await buildPlan({
      source: rt.createSource(config, srcRec),
      destination: rt.createDestination(config, 'read-only', roRec),
      config,
      mode: 'demo',
      store,
      now: () => rt.now(),
      recorders: [srcRec, roRec],
    });
    const planFile = writeArtifact(
      ctx,
      join(location.dir, 'migration-plan.json'),
      `${JSON.stringify(plan, null, 2)}\n`,
      'plan',
      true,
    );
    store.savePlan(plan);
    say('');
    say(planView(plan, { ...vo, savedTo: planFile, inventoryLimit: 5 }));
    say(recorderLine(ctx, srcRec, roRec));
    await pause();

    // ---- 3. approve ------------------------------------------------------------------------
    say(step(3, TOTAL_STEPS, 'Approve — explicit, by plan id', vo));
    say(approvalView(plan, vo));
    say(
      `  ${style.gray('For real runs you must pass')} ${style.cyan(`--approve ${plan.planId}`)} ${style.gray('(or type it). The demo approves for you.')}`,
    );
    const run = approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: rt.now() });
    await pause();

    // ---- 4. apply --------------------------------------------------------------------------
    say(step(4, TOTAL_STEPS, 'Apply — checkpointed, paced to ClickUp’s rate limit', vo));
    const isCreate = (r: { method: string; path: string }): boolean =>
      r.method === 'POST' && /\/list\/\d+\/task$/.test(r.path);
    if (options.chaos !== false) {
      say(
        style.gray(
          '  Injecting trouble on purpose: two 429 rate-limit responses, and one task whose reply is lost after ClickUp created it.',
        ),
      );
      demo.clickup.rateLimit(2, isCreate);
      demo.clickup.fault({
        match: (r) =>
          isCreate(r) && (r.body as { name?: string }).name === 'Calibrate joint encoders',
        failAfterCommit: () => new TypeError('fetch failed: socket hang up'),
      });
    }
    const writeRec = new RequestRecorder();
    const destination = rt.createDestination(configFromPlan(plan, 4), 'read-write', writeRec);
    let applyStatus: string;
    try {
      const result = await executeWithProgress(ctx, {
        rt,
        plan,
        store,
        runId: run.runId,
        destination,
        concurrency: 4,
        interruptAfter: options.interruptAfter,
        quiet,
      });
      applyStatus = result.status;
    } catch (error) {
      if (error instanceof SimulatedInterruptError) {
        if (!quiet) {
          eprintln(ctx, style.red(`\n⚡ ${error.message}`));
          eprintln(
            ctx,
            `The demo "crashed" mid-run. State is saved. Continue with: ${style.cyan(`${BIN_NAME} resume --demo`)}  then  ${style.cyan(`${BIN_NAME} verify --demo`)}`,
          );
        }
        return ExitCode.Partial;
      }
      throw error;
    }

    const duplicates = countDuplicates(demo.clickup.state.tasks.map((t) => t.markdown_description));
    const slept = rt.clock instanceof VirtualClock ? rt.clock.slept : 0;
    say('');
    say(
      keyValues(
        [
          [
            'Rate limited',
            `${demo.clickup.stats.rateLimited} response(s) with HTTP 429${demo.clickup.stats.rateLimited > 0 ? ' → waited, retried, nothing duplicated' : ''}`,
          ],
          [
            'Simulated wait',
            `${Math.round(slept / 100) / 10} s of pacing/backoff (instant in the demo; real time in a live run)`,
          ],
          ...(options.chaos === false
            ? []
            : ([
                [
                  'Lost reply',
                  'one create succeeded but its reply was lost → found via its marker, NOT re-sent',
                ],
              ] as const)),
          [
            'Duplicates',
            duplicates === 0
              ? style.green('0 — every Notion row exists in ClickUp exactly once')
              : style.red(String(duplicates)),
          ],
        ],
        style,
        16,
      ).map((l) => `  ${l}`),
    );
    say(sampleTask(demo.clickup.state, ctx));
    if (applyStatus !== 'applied') {
      say(style.red(`Apply ended as "${applyStatus}".`));
    }
    say(
      style.yellow(
        '  Status is "APPLIED — NOT VERIFIED". A migration is not complete until it verifies.',
      ),
    );
    await pause();

    // ---- 5. verify -------------------------------------------------------------------------
    say(step(5, TOTAL_STEPS, 'Verify — compare the plan with what ClickUp actually holds', vo));
    const verifyRec = new RequestRecorder();
    const verifier = rt.createDestination(configFromPlan(plan, 4), 'read-only', verifyRec);
    const verification = await verifyRun({
      plan,
      destination: verifier,
      store,
      runId: run.runId,
      clock: rt.clock,
    });
    say('');
    say(verificationView(verification, vo));
    await pause();

    // ---- 6. report -------------------------------------------------------------------------
    say(step(6, TOTAL_STEPS, 'Report — including everything that did NOT survive', vo));
    const report = reportFor(store, store.getRun(run.runId) ?? null, plan, rt.now());
    say('');
    say(reportView(report, vo, { limitPerGroup: 6 }));
    say('');
    say(
      box(
        [
          style.bold('That was an offline demo: synthetic data, in-process fake APIs.'),
          'It proves the engine, not your workspace. A real run needs your own tokens and',
          'a sandbox first — see docs/live-sandbox-testing.md.',
          '',
          `${style.cyan(`${BIN_NAME} ui --demo`)}                      explore this run in the local dashboard`,
          `${style.cyan(`${BIN_NAME} report --demo --format markdown`)}  the shareable report`,
          `${style.cyan(`${BIN_NAME} inspect notion --demo`)}           every property and how it fares`,
          `${style.cyan(`${BIN_NAME} demo --interrupt-after 40`)}        crash mid-run, then ${style.cyan(`${BIN_NAME} resume --demo`)}`,
        ],
        style,
        Math.min(ctx.width, 96),
        style.yellow,
      ),
    );

    if (quiet) {
      println(
        ctx,
        JSON.stringify(
          {
            mode: 'demo',
            exitosVersion: VERSION,
            plan: {
              planId: plan.planId,
              summary: plan.summary,
              estimate: plan.estimate,
              inventory: plan.inventory,
            },
            run: store.getRun(run.runId),
            verification,
            report,
            requests: {
              planning: {
                reads: srcRec.reads.length + roRec.reads.length,
                writes: srcRec.writes.length + roRec.writes.length,
              },
              apply: writeRec.summary(),
            },
          },
          null,
          2,
        ),
      );
    }
    return verification.status === 'passed' ? ExitCode.Ok : ExitCode.VerificationFailed;
  } finally {
    store.close();
    rt.dispose();
  }
}

function countDuplicates(descriptions: readonly string[]): number {
  const seen = new Map<string, number>();
  for (const d of descriptions) {
    const m = /exitos-key:([^\s`]+)/.exec(d);
    if (m?.[1]) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
}

/** Show one migrated task as it now exists in the (fake) ClickUp, so the result is tangible. */
function sampleTask(
  state: NonNullable<Runtime['demo']>['clickup']['state'],
  ctx: CliContext,
): string[] {
  const { style } = ctx;
  const key = DEMO_IDS.rowId(1).replace(/-/g, '');
  const task = state.tasks.find((t) =>
    t.markdown_description.includes(`exitos-key:notion:page:${key}`),
  );
  if (!task) return [];
  const list = state.lists.find((l) => l.id === task.listId);
  const names = task.assignees.map(
    (id) => state.members.find((m) => m.id === id)?.username ?? String(id),
  );
  const cf = Object.entries(task.customValues).map(([id, v]) => {
    const def = list?.fields.find((f) => f.id === id);
    const shown = def?.options?.find((o) => o.id === v)?.name ?? String(v);
    return `${def?.name ?? id}=${shown}`;
  });
  const lines = task.markdown_description.split('\n');
  const excerpt = lines.slice(0, 16).map((l) => `    ${style.gray('│')} ${l}`);
  return [
    '',
    style.bold('  One task, as it now exists in ClickUp'),
    ...keyValues(
      [
        ['Name', task.name],
        ['List / status', `${list?.name ?? '?'} / ${task.status}`],
        [
          'Priority',
          task.priority === null
            ? '—'
            : (['urgent', 'high', 'normal', 'low'][task.priority - 1] ?? String(task.priority)),
        ],
        ['Due', task.due_date === null ? '—' : new Date(Number(task.due_date)).toISOString()],
        ['Assignees', names.join(', ') || '—'],
        ['Tags', task.tags.join(', ') || '—'],
        ['Custom fields', cf.join(' · ') || '—'],
        ['Linked tasks', String(task.links.length)],
      ],
      style,
      16,
    ).map((l) => `  ${l}`),
    `    ${style.gray('description (Markdown), first lines:')}`,
    ...excerpt,
    `    ${style.gray(`… ${Math.max(0, lines.length - 16)} more line(s)`)}`,
  ];
}

export type { MigrationPlan };
