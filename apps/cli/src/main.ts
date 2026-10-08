import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { BIN_NAME, ExitCode, ExitOsError, TAGLINE, VERSION, toSafeMessage } from '@exitos/shared';
import { createContext, createNodeIo, eprintln, type CliContext } from './context.js';
import { applyCommand } from './commands/apply.js';
import { connectorsCommand } from './commands/connectors.js';
import { demoCommand } from './commands/demo.js';
import {
  inspectCommand,
  reportCommand,
  statusCommand,
  verifyCommand,
} from './commands/inspect-status-verify-report.js';
import { planCommand } from './commands/plan.js';
import { resumeCommand } from './commands/resume.js';
import { uiCommand } from './commands/ui.js';
import { loadEnv } from './runtime/env.js';

const int =
  (name: string, min: number, max: number) =>
  (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new InvalidArgumentError(`${name} must be an integer between ${min} and ${max}.`);
    }
    return n;
  };

/** Build the command tree. `ctx` provides IO/environment so everything is testable in-process. */
export function buildProgram(ctx: CliContext, result: { code: number }): Command {
  const program = new Command();
  const run =
    (fn: () => Promise<number> | number): (() => Promise<void>) =>
    async () => {
      result.code = await fn();
    };

  program
    .name(BIN_NAME)
    .description(
      `${TAGLINE}\nMove supported content between apps — and see exactly what cannot move.`,
    )
    .version(VERSION, '-v, --version')
    .option('--no-color', 'disable colored output')
    .option('--verbose', 'print diagnostic logs (secrets are always redacted)')
    .exitOverride()
    .configureOutput({ writeOut: (s) => ctx.io.stdout(s), writeErr: (s) => ctx.io.stderr(s) })
    .showHelpAfterError('(run with --help for usage)')
    .addHelpText(
      'after',
      `
Safety model:  inspect → plan → approve → apply → verify
  Everything before "apply" is read-only. "apply" needs --approve <planId>.
  ExitOS never modifies the source and never deletes or overwrites destination content.

Try it offline (no account, no network):
  ${BIN_NAME} demo

Docs: docs/product-spec.md · docs/live-sandbox-testing.md`,
    );

  const verbose = (): boolean => program.opts<{ verbose?: boolean }>().verbose === true;

  program
    .command('demo')
    .description(
      'run a complete OFFLINE DEMO (plan → apply → verify) on synthetic data — no credentials, no network',
    )
    .option('--state-dir <dir>', 'where the demo keeps its state (default ./.exitos/demo)')
    .option('--pace <ms>', 'pause between steps, for screen recordings', int('--pace', 0, 5000))
    .option(
      '--interrupt-after <n>',
      'simulate a crash after n applied actions (then: resume --demo)',
      int('--interrupt-after', 1, 100000),
    )
    .option('--no-chaos', 'do not inject rate limits and a lost reply')
    .option('--json', 'print only a machine-readable result')
    .action(
      (o: {
        stateDir?: string;
        pace?: number;
        interruptAfter?: number;
        chaos: boolean;
        json?: boolean;
      }) => run(() => demoCommand(ctx, { ...o, chaos: o.chaos }))(),
    );

  program
    .command('inspect <target>')
    .description('read-only: list what an integration can see (notion | clickup)')
    .option(
      '-c, --config <file>',
      'migration config (optional: without a selection, shows what is shared)',
    )
    .option('--demo', 'use the offline demo workspace')
    .option('--state-dir <dir>', 'state directory')
    .option('--json', 'machine-readable output')
    .action(
      (target: string, o: { config?: string; demo?: boolean; stateDir?: string; json?: boolean }) =>
        run(() => inspectCommand(ctx, target, { ...o, verbose: verbose() }))(),
    );

  program
    .command('plan <source> <destination>')
    .description(
      'read-only: build an inspectable, hashed migration plan (e.g. `plan notion clickup`)',
    )
    .requiredOption('-c, --config <file>', 'migration config (see migration.example.yaml)')
    .option('-o, --out <file>', 'where to write the plan (default migration-plan.json)')
    .option('--summary', 'print a shorter terminal summary')
    .option('--json', 'machine-readable output')
    .option('--force', 'overwrite --out even if it is not an ExitOS plan')
    .option('--state-dir <dir>', 'state directory')
    .action(
      (
        source: string,
        destination: string,
        o: {
          config: string;
          out?: string;
          summary?: boolean;
          json?: boolean;
          force?: boolean;
          stateDir?: string;
        },
      ) => run(() => planCommand(ctx, source, destination, { ...o, verbose: verbose() }))(),
    );

  program
    .command('apply')
    .description(
      'execute an approved plan (writes to the destination only; the source is never modified)',
    )
    .requiredOption('--plan <file>', 'plan file created by `plan`')
    .option(
      '--approve <planId>',
      'explicit approval: must equal the plan id (otherwise you are prompted)',
    )
    .option('--concurrency <n>', 'parallel writes (1–16)', int('--concurrency', 1, 16))
    .option('--state-dir <dir>', 'state directory')
    .addOption(
      new Option('--interrupt-after <n>', 'testing: simulate a crash after n actions')
        .argParser(int('--interrupt-after', 1, 100000))
        .hideHelp(),
    )
    .action(
      (o: {
        plan: string;
        approve?: string;
        concurrency?: number;
        stateDir?: string;
        interruptAfter?: number;
      }) => run(() => applyCommand(ctx, { ...o, verbose: verbose() }))(),
    );

  program
    .command('status')
    .description('show the state of the latest (or a given) run')
    .option('--run <id>', 'run id (default: latest)')
    .option('--demo', 'use the demo state directory')
    .option('--state-dir <dir>', 'state directory')
    .option('--json', 'machine-readable output')
    .action((o: { run?: string; demo?: boolean; stateDir?: string; json?: boolean }) =>
      run(() => statusCommand(ctx, o))(),
    );

  program
    .command('resume')
    .description(
      'continue an interrupted or partly failed run (never re-creates what already exists)',
    )
    .option('--run <id>', 'run id (default: latest)')
    .option('--demo', 'use the demo state directory')
    .option('--state-dir <dir>', 'state directory')
    .option('--concurrency <n>', 'parallel writes (1–16)', int('--concurrency', 1, 16))
    .option(
      '--assume-not-created <actionId...>',
      'confirm that an item with an unknown outcome does NOT exist in the destination',
    )
    .addOption(
      new Option('--interrupt-after <n>', 'testing: simulate a crash after n actions')
        .argParser(int('--interrupt-after', 1, 100000))
        .hideHelp(),
    )
    .action(
      (o: {
        run?: string;
        demo?: boolean;
        stateDir?: string;
        concurrency?: number;
        assumeNotCreated?: string[];
        interruptAfter?: number;
      }) => run(() => resumeCommand(ctx, { ...o, verbose: verbose() }))(),
    );

  program
    .command('verify')
    .description('read-only: compare the plan with what the destination actually holds')
    .option('--run <id>', 'run id (default: latest)')
    .option('--demo', 'use the demo state directory')
    .option('--state-dir <dir>', 'state directory')
    .option('--json', 'machine-readable output')
    .action((o: { run?: string; demo?: boolean; stateDir?: string; json?: boolean }) =>
      run(() => verifyCommand(ctx, { ...o, verbose: verbose() }))(),
    );

  program
    .command('report')
    .description('the report: what moved, what changed, what was NOT preserved, and verification')
    .option('--run <id>', 'run id (default: latest)')
    .option('--format <format>', 'terminal | markdown | json')
    .option('-o, --out <file>', 'write to a file')
    .option('--redact', 'replace titles, names and URLs with hashes so it is safe to share')
    .option('--force', 'overwrite --out even if it is not an ExitOS report')
    .option('--demo', 'use the demo state directory')
    .option('--state-dir <dir>', 'state directory')
    .option('--json', 'shorthand for --format json')
    .action(
      (o: {
        run?: string;
        format?: string;
        out?: string;
        redact?: boolean;
        force?: boolean;
        demo?: boolean;
        stateDir?: string;
        json?: boolean;
      }) => run(() => reportCommand(ctx, o))(),
    );

  program
    .command('ui')
    .description('open the local, read-only dashboard (served from 127.0.0.1)')
    .option('--port <n>', 'port (default 4173)', int('--port', 0, 65535))
    .option('--demo', 'show the offline demo run')
    .option('--state-dir <dir>', 'state directory')
    .action((o: { port?: number; demo?: boolean; stateDir?: string }) =>
      run(() => uiCommand(ctx, o))(),
    );

  program
    .command('connectors')
    .description('list the connectors in this build and the credentials they need')
    .option('--json', 'machine-readable output')
    .action((o: { json?: boolean }) => run(() => connectorsCommand(ctx, o))());

  return program;
}

/** Run the CLI in-process and return the exit code. Never throws. */
export async function runCli(argv: readonly string[], ctx: CliContext): Promise<number> {
  const result = { code: ExitCode.Ok };
  const program = buildProgram(ctx, result);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return result.code;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.help', 'commander.version'].includes(error.code))
        return ExitCode.Ok;
      return ExitCode.Usage; // Commander already printed the problem
    }
    if (error instanceof ExitOsError) {
      eprintln(ctx, `${ctx.style.red('Error')} ${error.message}`);
      return error.exitCode;
    }
    const message = toSafeMessage(error);
    eprintln(ctx, `${ctx.style.red('Unexpected error')} ${message}`);
    eprintln(
      ctx,
      ctx.style.gray(
        'Re-run with --verbose for more detail, and please report it (docs/CONTRIBUTING.md) — never include tokens.',
      ),
    );
    if (argv.includes('--verbose') && error instanceof Error && error.stack)
      eprintln(ctx, ctx.style.gray(toSafeMessage(error.stack)));
    return ExitCode.Unexpected;
  }
}

/** Process entry: wires the real environment, `.env`, colour detection and Ctrl-C. */
export async function runMain(argv: readonly string[]): Promise<number> {
  const io = createNodeIo();
  const loaded = loadEnv(process.cwd(), process.env);
  const controller = new AbortController();
  let interrupts = 0;
  process.on('SIGINT', () => {
    interrupts += 1;
    if (interrupts === 1) {
      io.stderr(
        '\nInterrupted — finishing in-flight work and saving state… (press Ctrl-C again to force quit; state is crash-safe)\n',
      );
      controller.abort();
    } else {
      process.exit(130);
    }
  });
  const ctx = createContext({
    cwd: process.cwd(),
    env: loaded.env,
    io,
    noColor: argv.includes('--no-color'),
    signal: controller.signal,
  });
  for (const w of loaded.warnings) eprintln(ctx, ctx.style.yellow(`warning: ${w}`));
  return runCli(argv, ctx);
}
