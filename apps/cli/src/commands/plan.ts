import { join } from 'node:path';
import { BIN_NAME, ConfigError, ExitCode, RequestRecorder } from '@exitos/shared';
import { buildPlan } from '@exitos/core';
import { eprintln, println, type CliContext } from '../context.js';
import { createRuntime } from '../runtime/runtime.js';
import { openStore, resolveStateDir } from '../runtime/state.js';
import { planView } from '../ui/views.js';
import {
  loadConfigFile,
  recorderLine,
  resolveConfigPath,
  viewOptions,
  writeArtifact,
} from './shared.js';

export interface PlanOptions {
  config?: string | undefined;
  out?: string | undefined;
  json?: boolean | undefined;
  summary?: boolean | undefined;
  stateDir?: string | undefined;
  verbose?: boolean | undefined;
  force?: boolean | undefined;
}

/** Create a plan. Strictly read-only: it can read the source and inspect the destination, nothing else. */
export async function planCommand(
  ctx: CliContext,
  source: string,
  destination: string,
  options: PlanOptions,
): Promise<number> {
  const configPath = resolveConfigPath(ctx, options.config, `plan ${source} ${destination}`);
  const config = loadConfigFile(ctx, configPath);
  if (config.source.type !== source || config.destination.type !== destination) {
    throw new ConfigError(
      `The command says ${source} → ${destination}, but ${configPath} is configured for ${config.source.type} → ${config.destination.type}.`,
    );
  }
  const location = resolveStateDir(ctx, { stateDir: options.stateDir });
  const rt = createRuntime(ctx, { mode: 'live', location, verbose: options.verbose });
  try {
    // Everything wrong with the config is reported at once, before any file is touched or API called.
    rt.checkConfig(config);
  } catch (error) {
    rt.dispose();
    throw error;
  }
  const store = openStore(location);
  try {
    const sourceRecorder = new RequestRecorder();
    const destRecorder = new RequestRecorder();
    const progress =
      options.json === true
        ? () => undefined
        : (m: string) => eprintln(ctx, ctx.style.gray(`  ${m}`));
    const { plan } = await buildPlan({
      source: rt.createSource(config, sourceRecorder),
      destination: rt.createDestination(config, 'read-only', destRecorder),
      config,
      mode: 'live',
      store,
      now: () => rt.now(),
      onProgress: progress,
      recorders: [sourceRecorder, destRecorder],
    });

    const out = options.out ?? 'migration-plan.json';
    const saved = writeArtifact(
      ctx,
      out,
      `${JSON.stringify(plan, null, 2)}\n`,
      'plan',
      options.force === true,
    );
    store.savePlan(plan);

    if (options.json === true) {
      println(
        ctx,
        JSON.stringify(
          {
            planId: plan.planId,
            file: saved,
            summary: plan.summary,
            estimate: plan.estimate,
            blockingErrors: plan.summary.blockingErrors,
          },
          null,
          2,
        ),
      );
    } else {
      println(
        ctx,
        planView(plan, { ...viewOptions(ctx), savedTo: saved, full: options.summary !== true }),
      );
      println(ctx, recorderLine(ctx, sourceRecorder, destRecorder));
      println(ctx, '');
    }

    if (plan.summary.blockingErrors > 0) {
      eprintln(
        ctx,
        ctx.style.red(
          `This plan has ${plan.summary.blockingErrors} blocking error(s) and cannot be applied. Fix them and run \`${BIN_NAME} plan\` again.`,
        ),
      );
      return ExitCode.Usage;
    }
    if (options.json !== true) {
      println(ctx, ctx.style.bold('Next'));
      println(
        ctx,
        `  1. Read the plan above (and ${join('.', out)} — it holds your content, keep it private).`,
      );
      println(
        ctx,
        `  2. If you are happy: ${ctx.style.cyan(`${BIN_NAME} apply --plan ${out} --approve ${plan.planId}`)}`,
      );
    }
    return ExitCode.Ok;
  } finally {
    store.close();
    rt.dispose();
  }
}
