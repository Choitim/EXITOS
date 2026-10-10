import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ApprovalError,
  BIN_NAME,
  ConfigError,
  ExitCode,
  type RequestRecorder,
} from '@exitos/shared';
import {
  MigrationConfigSchema,
  parseMigrationConfig,
  parsePlanJson,
  type MigrationConfig,
  type MigrationPlan,
  type RunSummary,
  type StateStore,
} from '@exitos/core';
import { eprintln, println, type CliContext } from '../context.js';
import { copyCommand } from '../runtime/platform.js';
import { approvalView, type ViewOptions } from '../ui/views.js';

export const viewOptions = (ctx: CliContext): ViewOptions => ({
  style: ctx.style,
  width: ctx.width,
});

export function loadConfigFile(ctx: CliContext, path: string): MigrationConfig {
  const full = resolve(ctx.cwd, path);
  if (!existsSync(full)) {
    throw new ConfigError(
      `Config file not found: ${path}.\nStart from the example, then fill in your ids:\n  ${copyCommand(ctx, 'migration.example.yaml', 'migration.yaml')}`,
    );
  }
  return parseMigrationConfig(readFileSync(full, 'utf8'), full);
}

/**
 * Which config file to use: the one named with `--config`, else `./migration.yaml` when it exists.
 * With neither, say exactly what to do next instead of a bare "required option".
 */
export function resolveConfigPath(
  ctx: CliContext,
  explicit: string | undefined,
  command: string,
): string {
  if (explicit !== undefined) return explicit;
  if (existsSync(resolve(ctx.cwd, 'migration.yaml'))) {
    eprintln(ctx, ctx.style.gray('  Using ./migration.yaml (pass --config to use another file)'));
    return 'migration.yaml';
  }
  throw new ConfigError(
    [
      'No migration config was given, and ./migration.yaml does not exist.',
      'The config says what to read and where to write. Create one from the example, fill in your ids, and run again:',
      `  ${copyCommand(ctx, 'migration.example.yaml', 'migration.yaml')}`,
      `  ${BIN_NAME} ${command} --config migration.yaml`,
      `Not sure what is missing? \`${BIN_NAME} doctor --live\` checks your setup.`,
    ].join('\n'),
  );
}

/** A config with only the connector types, for commands that need no selection (discovery). */
export function bareConfig(source: string, destination: string): MigrationConfig {
  return MigrationConfigSchema.parse({
    version: 1,
    source: { type: source },
    destination: { type: destination },
  });
}

export function readPlanFile(ctx: CliContext, path: string): MigrationPlan {
  const full = resolve(ctx.cwd, path);
  if (!existsSync(full))
    throw new ConfigError(`Plan file not found: ${path}. Create one with \`exitos plan\`.`);
  return parsePlanJson(readFileSync(full, 'utf8'));
}

/** True if the file looks like something ExitOS wrote (so overwriting it is expected). */
function looksLikeOurs(text: string, kind: 'plan' | 'report'): boolean {
  if (kind === 'plan') return /"planId"\s*:\s*"plan_/.test(text) && /"schemaVersion"/.test(text);
  return /"exitosVersion"/.test(text) || text.startsWith('# ExitOS migration report');
}

/**
 * Write a generated artefact with owner-only permissions. Refuses to overwrite a file that is not
 * recognisably an ExitOS artefact of the same kind, so a typo in `--out` cannot destroy user files.
 */
export function writeArtifact(
  ctx: CliContext,
  path: string,
  text: string,
  kind: 'plan' | 'report',
  force = false,
): string {
  const full = resolve(ctx.cwd, path);
  if (existsSync(full)) {
    if (statSync(full).isDirectory()) throw new ConfigError(`${path} is a directory.`);
    if (!force && !looksLikeOurs(readFileSync(full, 'utf8'), kind)) {
      throw new ConfigError(
        `Refusing to overwrite ${path}: it does not look like an ExitOS ${kind}. Choose another path or pass --force.`,
      );
    }
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, { mode: 0o600 });
  return full;
}

export function pickRun(store: StateStore, runId: string | undefined): RunSummary {
  const run = runId === undefined ? store.latestRun() : store.getRun(runId);
  if (!run) {
    throw new ConfigError(
      runId === undefined
        ? 'There is no run yet. Create a plan with `exitos plan`, then `exitos apply --plan <file>`; or try `exitos demo`.'
        : `Run ${runId} was not found.`,
    );
  }
  return run;
}

export function recorderLine(ctx: CliContext, ...recorders: RequestRecorder[]): string {
  const reads = recorders.reduce((n, r) => n + r.reads.length, 0);
  const writes = recorders.reduce((n, r) => n + r.writes.length, 0);
  const blocked = recorders.reduce((n, r) => n + r.blocked.length, 0);
  const s = ctx.style;
  return `${s.gray('Requests so far:')} ${reads} read · ${writes === 0 ? s.green('0 write') : s.red(`${writes} write`)} · ${blocked} blocked by the read-only guard`;
}

/**
 * Explicit approval (principle 4). Returns the plan id the human approved, or throws.
 * Non-interactive callers must pass `--approve <planId>`.
 */
export async function obtainApproval(
  ctx: CliContext,
  plan: MigrationPlan,
  provided: string | undefined,
): Promise<string> {
  if (provided !== undefined) return provided;
  if (!ctx.io.stdinIsTTY) {
    throw new ApprovalError(
      `Approval required. Review the plan, then re-run with: --approve ${plan.planId}\n(non-interactive shells cannot be prompted)`,
    );
  }
  println(ctx, approvalView(plan, viewOptions(ctx)));
  const answer = await ctx.io.prompt(
    `\nType the plan id (${plan.planId}) to approve, or press Enter to cancel: `,
  );
  if (answer === '') {
    eprintln(ctx, 'Cancelled. Nothing was written.');
    throw new ApprovalError('Cancelled by the user.');
  }
  return answer;
}

/** Cheap pure check so a wrong approval fails before anything is created on disk or contacted. */
export function assertApprovalMatches(plan: MigrationPlan, approved: string): void {
  if (approved !== plan.planId) {
    throw new ApprovalError(
      `Approval does not match this plan. Expected ${plan.planId}, got ${approved}.`,
    );
  }
}

export function exitCodeFor(status: string): number {
  switch (status) {
    case 'applied':
    case 'verified':
      return ExitCode.Ok;
    case 'verification_failed':
      return ExitCode.VerificationFailed;
    default:
      return ExitCode.Partial;
  }
}
