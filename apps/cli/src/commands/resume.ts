import {
  ConfigError,
  RequestRecorder,
  SimulatedInterruptError,
  ExitCode,
  BIN_NAME,
} from '@exitos/shared';
import { eprintln, println, type CliContext } from '../context.js';
import { createRuntime } from '../runtime/runtime.js';
import { openStore, requireExistingState, resolveStateDir } from '../runtime/state.js';
import { finish, configFromPlan } from './apply.js';
import { executeWithProgress, preflight } from './execute.js';
import { pickRun } from './shared.js';

export interface ResumeOptions {
  run?: string | undefined;
  demo?: boolean | undefined;
  stateDir?: string | undefined;
  concurrency?: number | undefined;
  assumeNotCreated?: string[] | undefined;
  interruptAfter?: number | undefined;
  verbose?: boolean | undefined;
}

/** Continue an interrupted or partially failed run. Already-created items are never re-created. */
export async function resumeCommand(ctx: CliContext, options: ResumeOptions): Promise<number> {
  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo: options.demo });
  requireExistingState(location, 'Nothing to resume. Run `exitos apply` first.');
  const peek = openStore(location);
  const run = pickRun(peek, options.run);
  const plan = peek.getPlan(run.planId);
  peek.close();
  if (!plan)
    throw new ConfigError(`The plan for run ${run.runId} is missing from the state database.`);
  if (run.status === 'verified') {
    println(
      ctx,
      `${ctx.style.green('✔')} Run ${run.runId} is already verified. Nothing to resume.`,
    );
    return ExitCode.Ok;
  }

  const rt = createRuntime(ctx, { mode: plan.mode, location, verbose: options.verbose });
  const store = openStore(location, { now: () => rt.now().toISOString() });
  try {
    const concurrency = options.concurrency ?? 4;
    const destination = rt.createDestination(
      configFromPlan(plan, concurrency),
      'read-write',
      new RequestRecorder(),
    );
    await preflight(plan, destination);
    println(ctx, `${ctx.style.bold('Resuming')} run ${run.runId} (${plan.planId})`);
    const result = await executeWithProgress(ctx, {
      rt,
      plan,
      store,
      runId: run.runId,
      destination,
      concurrency,
      ...(options.assumeNotCreated === undefined
        ? {}
        : { assumeNotCreated: options.assumeNotCreated }),
      interruptAfter: options.interruptAfter,
    });
    return finish(ctx, rt, store, run.runId, plan, result.status);
  } catch (error) {
    if (error instanceof SimulatedInterruptError) {
      eprintln(ctx, ctx.style.red(`\n⚡ ${error.message}`));
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
