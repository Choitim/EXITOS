import { ConfigError, ExitCode, RequestRecorder, BIN_NAME } from '@exitos/shared';
import {
  buildReport,
  redactReport,
  renderReportMarkdown,
  type MigrationPlan,
  type MigrationReport,
  type RunSummary,
  type StateStore,
  verifyRun,
} from '@exitos/core';
import { println, type CliContext } from '../context.js';
import { createRuntime } from '../runtime/runtime.js';
import { openStore, requireExistingState, resolveStateDir } from '../runtime/state.js';
import { keyValues, rule, table } from '../ui/layout.js';
import { reportView, statusView, verificationView } from '../ui/views.js';
import { configFromPlan } from './apply.js';
import { bareConfig, loadConfigFile, pickRun, viewOptions, writeArtifact } from './shared.js';

interface CommonStateOptions {
  stateDir?: string | undefined;
  demo?: boolean | undefined;
  run?: string | undefined;
  json?: boolean | undefined;
  verbose?: boolean | undefined;
}

// ---- inspect ---------------------------------------------------------------------------------------
export interface InspectOptions {
  config?: string | undefined;
  json?: boolean | undefined;
  demo?: boolean | undefined;
  stateDir?: string | undefined;
  verbose?: boolean | undefined;
}

export async function inspectCommand(
  ctx: CliContext,
  target: string,
  options: InspectOptions,
): Promise<number> {
  if (target !== 'notion' && target !== 'clickup') {
    throw new ConfigError(
      `Unknown inspect target "${target}". Use: ${BIN_NAME} inspect notion | clickup`,
    );
  }
  const demo = options.demo === true;
  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo });
  const rt = createRuntime(ctx, {
    mode: demo ? 'demo' : 'live',
    location,
    verbose: options.verbose,
  });
  const { style } = ctx;
  try {
    const config =
      options.config !== undefined
        ? loadConfigFile(ctx, options.config)
        : bareConfig('notion', 'clickup');
    const recorder = new RequestRecorder();

    if (target === 'notion') {
      const source = rt.createSource(config, recorder);
      const selected = config.source as { dataSources?: unknown[]; pages?: unknown[] };
      const hasSelection = (selected.dataSources?.length ?? 0) + (selected.pages?.length ?? 0) > 0;
      if (!hasSelection) {
        const d = await source.discover();
        if (options.json === true) return json(ctx, d);
        println(ctx, [
          rule(`Notion · ${d.workspace.name}`, style, ctx.width),
          style.gray('  (read-only discovery of what is shared with this integration)'),
          '',
        ]);
        println(
          ctx,
          table(
            [
              { header: 'Kind', value: (c: (typeof d.containers)[number]) => c.kind },
              { header: 'Title', value: (c) => c.name, max: 40 },
              { header: 'Id', value: (c) => c.id },
              { header: 'Info', value: (c) => c.path ?? '' },
            ],
            d.containers,
            style,
            ctx.width,
          ).map((l) => `  ${l}`),
        );
        println(ctx, '');
        for (const note of d.notes) println(ctx, `  ${style.yellow('!')} ${note}`);
        println(
          ctx,
          `  ${style.gray('Put the ids you want to migrate under source.dataSources / source.pages in migration.yaml.')}`,
        );
      } else {
        const i = await source.inspect();
        if (options.json === true) return json(ctx, i);
        println(ctx, [rule(`Notion · ${i.workspace.name}`, style, ctx.width), '']);
        for (const c of i.collections) {
          println(
            ctx,
            `${style.bold(c.name)} ${style.gray(`(${c.recordCount} rows)`)}${c.incomplete ? style.red('  INCOMPLETE — query cap reached') : ''}`,
          );
          println(
            ctx,
            table(
              [
                {
                  header: 'Property',
                  value: (f: (typeof c.fields)[number]) => f.field.name,
                  max: 28,
                },
                { header: 'Notion type', value: (f) => f.field.sourceType },
                {
                  header: 'Portability',
                  value: (f) => f.support,
                  colour: (f, cell) =>
                    f.support === 'supported'
                      ? style.green(cell)
                      : f.support === 'unsupported'
                        ? style.red(cell)
                        : style.yellow(cell),
                },
                { header: 'Note', value: (f) => f.note ?? '' },
              ],
              c.fields,
              style,
              ctx.width,
            ).map((l) => `  ${l}`),
          );
          println(ctx, '');
        }
        for (const d of i.documents) println(ctx, `  Page: ${d.title}`);
        for (const f of i.findings) println(ctx, `  ${style.red('✖')} [${f.code}] ${f.message}`);
      }
      println(
        ctx,
        style.gray(
          `  ${recorder.reads.length} read request(s), ${recorder.writes.length} write(s).`,
        ),
      );
      return ExitCode.Ok;
    }

    // clickup
    const dest = rt.createDestination(
      options.config === undefined ? bareConfigForClickup() : config,
      'read-only',
      recorder,
    );
    const d = await dest.discover();
    if (options.json === true) return json(ctx, d);
    println(ctx, [rule('ClickUp · what this token can see', style, ctx.width), '']);
    println(ctx, `  Workspaces: ${d.workspaces.map((w) => `${w.name} (id ${w.id})`).join(', ')}`);
    println(ctx, '');
    println(
      ctx,
      table(
        [
          { header: 'Kind', value: (c: (typeof d.containers)[number]) => c.kind },
          { header: 'Name', value: (c) => c.name, max: 36 },
          { header: 'Id', value: (c) => c.id },
          { header: 'Where', value: (c) => c.path ?? '' },
        ],
        d.containers.filter((c) => c.kind === 'list'),
        style,
        ctx.width,
      ).map((l) => `  ${l}`),
    );
    for (const n of d.notes) println(ctx, `  ${style.yellow('!')} ${n}`);
    return ExitCode.Ok;
  } finally {
    rt.dispose();
  }
}

function bareConfigForClickup(): ReturnType<typeof bareConfig> {
  // Discovery needs no selection; a placeholder workspace id satisfies the destination schema.
  return {
    ...bareConfig('notion', 'clickup'),
    destination: { type: 'clickup', workspaceId: '0' },
  };
}

function json(ctx: CliContext, value: unknown): number {
  println(ctx, JSON.stringify(value, null, 2));
  return ExitCode.Ok;
}

// ---- shared loader ---------------------------------------------------------------------------------
function openExisting(
  ctx: CliContext,
  options: CommonStateOptions,
): {
  store: StateStore;
  run: RunSummary;
  plan: MigrationPlan;
  close: () => void;
  location: ReturnType<typeof resolveStateDir>;
} {
  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo: options.demo });
  requireExistingState(location, 'Run `exitos apply` (or `exitos demo`) first.');
  const store = openStore(location);
  const run = pickRun(store, options.run);
  const plan = store.getPlan(run.planId);
  if (!plan) {
    store.close();
    throw new ConfigError(`The plan for run ${run.runId} is missing from the state database.`);
  }
  return { store, run, plan, close: () => store.close(), location };
}

export function reportFor(
  store: StateStore,
  run: RunSummary | null,
  plan: MigrationPlan,
  now: Date,
): MigrationReport {
  const checkpoints = run ? store.listCheckpoints(run.runId) : [];
  const wanted = new Set(plan.actions.map((a) => `${a.scope}|${a.idempotencyKey}`));
  return buildReport({
    plan,
    run,
    checkpoints,
    verification: run ? (store.getVerification(run.runId) ?? null) : null,
    mappings: store.listMappings().filter((m) => wanted.has(`${m.scope}|${m.sourceKey}`)),
    now,
  });
}

// ---- status ----------------------------------------------------------------------------------------
export async function statusCommand(ctx: CliContext, options: CommonStateOptions): Promise<number> {
  const { store, run, plan, close } = openExisting(ctx, options);
  try {
    if (options.json === true)
      return json(ctx, { run, verification: store.getVerification(run.runId) ?? null });
    println(ctx, statusView(run, plan, store.getVerification(run.runId), viewOptions(ctx)));
    return ExitCode.Ok;
  } finally {
    close();
  }
}

// ---- verify ----------------------------------------------------------------------------------------
export async function verifyCommand(ctx: CliContext, options: CommonStateOptions): Promise<number> {
  const { store, run, plan, close, location } = openExisting(ctx, options);
  const rt = createRuntime(ctx, { mode: plan.mode, location, verbose: options.verbose });
  try {
    if (run.status === 'applying' || run.status === 'approved') {
      println(
        ctx,
        ctx.style.yellow(
          'This run has not finished applying; verification will list the items that do not exist yet.',
        ),
      );
    }
    const recorder = new RequestRecorder();
    const destination = rt.createDestination(configFromPlan(plan, 4), 'read-only', recorder);
    const result = await verifyRun({ plan, destination, store, runId: run.runId, clock: rt.clock });
    if (options.json === true) return json(ctx, result);
    println(ctx, '');
    println(ctx, verificationView(result, viewOptions(ctx)));
    println(ctx, '');
    println(
      ctx,
      `${ctx.style.gray(`${recorder.reads.length} read request(s), ${recorder.writes.length} write(s).`)}`,
    );
    println(
      ctx,
      ctx.style.gray(
        '  This checks the declared scope only — see "Not preserved" in `exitos report`. It is not a claim of zero data loss.',
      ),
    );
    return result.status === 'passed' ? ExitCode.Ok : ExitCode.VerificationFailed;
  } finally {
    rt.dispose();
    close();
  }
}

// ---- report ----------------------------------------------------------------------------------------
export interface ReportOptions extends CommonStateOptions {
  format?: string | undefined;
  out?: string | undefined;
  redact?: boolean | undefined;
  force?: boolean | undefined;
}

export async function reportCommand(ctx: CliContext, options: ReportOptions): Promise<number> {
  const format = options.format ?? (options.json === true ? 'json' : 'terminal');
  if (!['terminal', 'markdown', 'json'].includes(format)) {
    throw new ConfigError('--format must be terminal, markdown or json.');
  }
  const { store, run, plan, close } = openExisting(ctx, options);
  try {
    let report = reportFor(store, run, plan, new Date(run.updatedAt));
    if (options.redact === true) report = redactReport(report);
    const text =
      format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : format === 'markdown'
          ? renderReportMarkdown(report)
          : reportView(report, viewOptions(ctx)).join('\n') + '\n';
    if (options.out !== undefined) {
      const saved = writeArtifact(
        ctx,
        options.out,
        format === 'terminal' ? renderReportMarkdown(report) : text,
        'report',
        options.force === true,
      );
      println(
        ctx,
        `Report written to ${saved}${options.redact === true ? ' (redacted: safe to share)' : ' (contains your content: keep it private, or use --redact)'}`,
      );
    } else {
      ctx.io.stdout(text.endsWith('\n') ? text : `${text}\n`);
    }
    return ExitCode.Ok;
  } finally {
    close();
  }
}

// ---- connectors ------------------------------------------------------------------------------------
export function keyValueRows(
  rows: ReadonlyArray<readonly [string, string]>,
  ctx: CliContext,
): string[] {
  return keyValues(rows, ctx.style);
}
