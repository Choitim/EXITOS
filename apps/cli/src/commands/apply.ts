import {
  BIN_NAME,
  ConfigError,
  ExitCode,
  RequestRecorder,
  SimulatedInterruptError,
} from '@exitos/shared';
import { MigrationConfigSchema, approveAndCreateRun, type MigrationPlan } from '@exitos/core';
import { eprintln, println, type CliContext } from '../context.js';
import { createRuntime, type Runtime } from '../runtime/runtime.js';
import { openStore, resolveStateDir } from '../runtime/state.js';
import { statusView } from '../ui/views.js';
import { executeWithProgress, preflight } from './execute.js';
import {
  assertApprovalMatches,
  exitCodeFor,
  obtainApproval,
  readPlanFile,
  viewOptions,
} from './shared.js';

/** The tiny config a connector needs to be constructed for apply/verify, taken from the plan itself. */
export function configFromPlan(
  plan: MigrationPlan,
  concurrency: number,
): ReturnType<typeof MigrationConfigSchema.parse> {
  return MigrationConfigSchema.parse({
    version: 1,
    source: { type: plan.source.connector.id },
    destination: { ...plan.destination.config, type: plan.destination.connector.id },
    options: { concurrency },
  });
}

export interface ApplyOptions {
  plan: string;
  approve?: string | undefined;
  concurrency?: number | undefined;
  stateDir?: string | undefined;
  interruptAfter?: number | undefined;
  verbose?: boolean | undefined;
}

export async function applyCommand(ctx: CliContext, options: ApplyOptions): Promise<number> {
  const plan = readPlanFile(ctx, options.plan); // validates schema + integrity hash
  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo: plan.mode === 'demo' });
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new ConfigError('--concurrency must be an integer between 1 and 16.');
  }
  // 1. approval — checked BEFORE any runtime, connection or state file exists
  if (plan.mode === 'demo')
    println(
      ctx,
      ctx.style.badge('OFFLINE DEMO', 'yellow') +
        ' this plan targets the in-process demo ClickUp, not a real one.',
    );
  const approved = await obtainApproval(ctx, plan, options.approve);
  assertApprovalMatches(plan, approved);

  const rt = createRuntime(ctx, { mode: plan.mode, location, verbose: options.verbose });
  const store = openStore(location, { now: () => rt.now().toISOString() });
  try {
    const run = approveAndCreateRun({ plan, store, approvedPlanId: approved, now: rt.now() });

    // 2. preflight — is the destination still what the plan was made against?
    const recorder = new RequestRecorder();
    const destination = rt.createDestination(
      configFromPlan(plan, concurrency),
      'read-write',
      recorder,
    );
    await preflight(plan, destination);

    // 3. apply
    println(ctx, '');
    println(ctx, `${ctx.style.bold('Applying')} ${plan.planId} as run ${run.runId}`);
    println(
      ctx,
      ctx.style.gray(
        '  The source is never modified. Nothing in the destination is deleted or overwritten.',
      ),
    );
    const result = await executeWithProgress(ctx, {
      rt,
      plan,
      store,
      runId: run.runId,
      destination,
      concurrency,
      interruptAfter: options.interruptAfter,
    });
    return finish(ctx, rt, store, run.runId, plan, result.status);
  } catch (error) {
    if (error instanceof SimulatedInterruptError) {
      eprintln(
        ctx,
        ctx.style.red(`\n⚡ ${error.message} The process "crashed"; its state is saved.`),
      );
      eprintln(
        ctx,
        `Continue with: ${ctx.style.cyan(`${BIN_NAME} resume${plan.mode === 'demo' ? ' --demo' : ''}`)}`,
      );
      return ExitCode.Partial;
    }
    throw error;
  } finally {
    store.close();
    rt.dispose();
  }
}

export function finish(
  ctx: CliContext,
  _rt: Runtime,
  store: ReturnType<typeof openStore>,
  runId: string,
  plan: MigrationPlan,
  status: string,
): number {
  const run = store.getRun(runId);
  println(ctx, '');
  if (run) println(ctx, statusView(run, plan, undefined, viewOptions(ctx)));
  return exitCodeFor(status);
}
