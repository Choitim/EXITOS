import { ConfigError, SimulatedInterruptError, type RequestRecorder } from '@exitos/shared';
import {
  executePlan,
  type DestinationConnector,
  type ExecuteResult,
  type ExecutorEvent,
  type MigrationPlan,
  type StateStore,
} from '@exitos/core';
import { println, type CliContext } from '../context.js';
import type { Runtime } from '../runtime/runtime.js';
import { truncate } from '../ui/style.js';
import { progressLine } from '../ui/views.js';

/**
 * Before the first write, make sure the destination still looks like it did when the plan was made:
 * it is reachable with this credential, and every target list/location in the plan still exists.
 */
export async function preflight(
  plan: MigrationPlan,
  destination: DestinationConnector,
): Promise<void> {
  const inspection = await destination.inspect();
  const errors = inspection.findings.filter((f) => f.severity === 'error');
  const present = new Set(inspection.targets.map((t) => `${t.kind}:${t.id}`));
  const missing = plan.destination.targets
    .filter((t) => t.kind === 'list')
    .filter((t) => !present.has(`${t.kind}:${t.id}`));
  if (errors.length > 0 || missing.length > 0) {
    const lines = [
      ...errors.map((e) => `  • [${e.code}] ${e.message}`),
      ...missing.map(
        (t) => `  • ${t.kind} "${t.name}" (${t.id}) from the plan is no longer reachable.`,
      ),
    ];
    throw new ConfigError(
      `The destination no longer matches the plan, so nothing was written:\n${lines.join('\n')}\nFix it (or re-plan) and try again.`,
    );
  }
}

export interface ExecuteInput {
  rt: Runtime;
  plan: MigrationPlan;
  store: StateStore;
  runId: string;
  destination: DestinationConnector;
  concurrency: number;
  assumeNotCreated?: readonly string[];
  interruptAfter?: number | undefined;
  /** Suppress human output (used for --json). */
  quiet?: boolean;
  recorder?: RequestRecorder;
}

/** Run the executor with a live progress line, and map its outcome to a message and exit status. */
export async function executeWithProgress(
  ctx: CliContext,
  input: ExecuteInput,
): Promise<ExecuteResult> {
  const { style } = ctx;
  const tty = ctx.io.stdoutIsTTY && !input.quiet;
  let lastDraw = 0;
  let lastMilestone = -1;
  let lineOpen = false;

  const draw = (force = false): void => {
    if (input.quiet) return;
    const run = input.store.getRun(input.runId);
    if (!run) return;
    const counts = run.counts;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const done = counts.succeeded + counts.skipped;
    if (tty) {
      const now = Date.now();
      if (!force && now - lastDraw < 80) return;
      lastDraw = now;
      ctx.io.stdout(`\r  ${progressLine(counts, style)}\u001b[K`);
      lineOpen = true;
    } else {
      const milestone = total === 0 ? 100 : Math.floor((done / total) * 4) * 25;
      if (milestone !== lastMilestone) {
        lastMilestone = milestone;
        println(ctx, `  ${progressLine(counts, style)}`);
      }
    }
  };
  const closeLine = (): void => {
    if (tty && lineOpen) {
      ctx.io.stdout('\n');
      lineOpen = false;
    }
  };
  const note = (text: string): void => {
    if (input.quiet) return;
    if (tty && lineOpen) ctx.io.stdout('\r\u001b[K');
    println(ctx, text);
    lineOpen = false;
  };

  const onEvent = (e: ExecutorEvent): void => {
    switch (e.type) {
      case 'action_succeeded':
      case 'action_started':
        draw();
        break;
      case 'action_reconciled': {
        const short = truncate(
          e.label.replace(/^Create (task|page|Doc) /, '').replace(/ in list .*$/, ''),
          38,
        );
        const verdict =
          e.outcome === 'found'
            ? style.bold('it WAS created — adopted, not re-sent')
            : e.outcome === 'not_found'
              ? style.bold('not created — safe to send again')
              : style.bold('cannot tell — stopping');
        note(`  ${style.cyan('↺')} ${short}: reply lost → checked ClickUp: ${verdict}`);
        break;
      }
      case 'action_failed':
        note(`  ${style.red('✖')} ${e.label}: ${e.message}`);
        break;
      case 'run_stopped':
        note(`  ${style.red('■')} Stopped: ${e.reason}`);
        break;
      default:
        break;
    }
  };

  if (!input.quiet)
    println(
      ctx,
      `  ${style.gray(`Applying ${input.plan.summary.actions.toExecute} action(s), up to ${input.concurrency} at a time, paced to ${input.plan.estimate.requestsPerMinute} requests/min.`)}`,
    );
  draw(true);
  try {
    const result = await executePlan({
      plan: input.plan,
      destination: input.destination,
      store: input.store,
      runId: input.runId,
      concurrency: input.concurrency,
      clock: input.rt.clock,
      logger: input.rt.logger,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      ...(input.assumeNotCreated === undefined ? {} : { assumeNotCreated: input.assumeNotCreated }),
      ...(input.interruptAfter === undefined ? {} : { interruptAfter: input.interruptAfter }),
      onEvent,
    });
    draw(true);
    closeLine();
    return result;
  } catch (error) {
    closeLine();
    if (error instanceof SimulatedInterruptError) throw error;
    throw error;
  } finally {
    input.rt.flush();
  }
}
