import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  BIN_NAME,
  ExitCode,
  ExitOsError,
  RequestRecorder,
  describeNetworkFailure,
} from '@exitos/shared';
import { SqliteStateStore, type MigrationConfig } from '@exitos/core';
import { println, type CliContext } from '../context.js';
import { MIN_NODE, isSupportedNode, nodeInstallHint } from '../runtime/node-version.js';
import { createEnvFileCommand, copyCommand, isWindows } from '../runtime/platform.js';
import { createNetworkFetch, proxyConfigFromEnv } from '../runtime/proxy.js';
import { createRuntime } from '../runtime/runtime.js';
import { resolveStateDir } from '../runtime/state.js';
import { findWebDir } from '../server/web-dir.js';
import { rule } from '../ui/layout.js';
import { bareConfig, loadConfigFile } from './shared.js';

export type CheckStatus = 'ok' | 'info' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** What to do about it, when there is something to do. */
  readonly fix?: string | undefined;
}

export interface DoctorOptions {
  /** Treat missing credentials and config as problems (you are about to run a real migration). */
  live?: boolean | undefined;
  /** Also contact the two APIs, read-only, to prove the tokens and the network path work. */
  online?: boolean | undefined;
  config?: string | undefined;
  stateDir?: string | undefined;
  json?: boolean | undefined;
  verbose?: boolean | undefined;
}

const check = (
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  fix?: string,
): DoctorCheck => ({ id, label, status, detail, ...(fix === undefined ? {} : { fix }) });

// ---- individual checks (pure where possible, so they can be tested without a real machine) ----------

export function checkNode(version: string, platform: NodeJS.Platform, arch: string): DoctorCheck {
  const supported = isSupportedNode(version);
  return supported
    ? check('node', 'Node.js', 'ok', `v${version} on ${platform}/${arch}`)
    : check(
        'node',
        'Node.js',
        'fail',
        `v${version} is too old (needs ${MIN_NODE.major}.${MIN_NODE.minor} or newer)`,
        nodeInstallHint(platform),
      );
}

/** ExitOS keeps its state in SQLite through Node's built-in `node:sqlite`. */
export function checkSqlite(): DoctorCheck {
  try {
    SqliteStateStore.open(':memory:').close();
    return check('sqlite', 'Built-in SQLite', 'ok', 'node:sqlite works');
  } catch {
    return check(
      'sqlite',
      'Built-in SQLite',
      'fail',
      'node:sqlite is not available in this Node.js',
      `Use Node.js ${MIN_NODE.major}.${MIN_NODE.minor} or newer.`,
    );
  }
}

export function checkDashboardBuild(ctx: CliContext): DoctorCheck {
  try {
    findWebDir({ webDir: ctx.overrides?.webDir, env: ctx.env.EXITOS_WEB_DIST });
    return check('dashboard', 'Dashboard build', 'ok', 'found (exitos ui will work)');
  } catch {
    return check(
      'dashboard',
      'Dashboard build',
      'warn',
      'not built, so `exitos ui` will not start',
      'From the repository root run: pnpm build',
    );
  }
}

/** A path relative to where the person is standing, when it is inside it. */
function shown(ctx: CliContext, path: string): string {
  const rel = relative(ctx.cwd, path);
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? path : `.${sep}${rel}`;
}

export function checkStateDir(ctx: CliContext, stateDir: string | undefined): DoctorCheck {
  const { dir } = resolveStateDir(ctx, { stateDir, demo: false });
  // Check the nearest directory that exists; doctor itself must not create anything.
  let probe = dir;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  try {
    accessSync(probe, constants.W_OK);
    return check(
      'state',
      'State directory',
      'ok',
      `${shown(ctx, dir)} ${existsSync(dir) ? 'is writable' : 'will be created when needed'}`,
    );
  } catch {
    return check(
      'state',
      'State directory',
      'fail',
      `${probe} is not writable`,
      'Run from a folder you can write to, or choose one with --state-dir (or EXITOS_STATE_DIR).',
    );
  }
}

export function checkEnvFile(ctx: CliContext): DoctorCheck {
  const path = resolve(ctx.cwd, '.env');
  if (!existsSync(path)) {
    return check(
      'envfile',
      '.env file',
      'info',
      'not found (credentials can also come from the environment)',
      createEnvFileCommand(ctx),
    );
  }
  if (!isWindows(ctx)) {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      return check(
        'envfile',
        '.env file',
        'warn',
        `readable by other users (mode ${mode.toString(8)})`,
        'chmod 600 .env',
      );
    }
  }
  return check('envfile', '.env file', 'ok', 'found and private');
}

interface TokenSpec {
  readonly id: string;
  readonly env: string;
  readonly what: string;
  readonly prefixes: readonly string[];
  readonly how: string;
}

const TOKENS: readonly TokenSpec[] = [
  {
    id: 'notion-token',
    env: 'NOTION_TOKEN',
    what: 'Notion',
    prefixes: ['ntn_', 'secret_'],
    how: 'Create an internal connection: https://developers.notion.com/guides/get-started/internal-connections',
  },
  {
    id: 'clickup-token',
    env: 'CLICKUP_API_TOKEN',
    what: 'ClickUp',
    prefixes: ['pk_'],
    how: 'Create a personal API token: https://developer.clickup.com/docs/authentication',
  },
];

/** Never prints the value: only whether it is set and whether its prefix looks right. */
export function checkToken(ctx: CliContext, spec: TokenSpec, live: boolean): DoctorCheck {
  const value = ctx.env[spec.env]?.trim();
  if (value === undefined || value === '') {
    return check(
      spec.id,
      spec.env,
      live ? 'fail' : 'info',
      live ? 'not set' : 'not set (only needed for a real migration; the offline demo needs none)',
      `${spec.how}\nthen add it to .env or your environment`,
    );
  }
  const looksRight = spec.prefixes.some((p) => value.startsWith(p));
  return looksRight
    ? check(spec.id, spec.env, 'ok', `set (${spec.prefixes.find((p) => value.startsWith(p))}…)`)
    : check(
        spec.id,
        spec.env,
        'warn',
        `set, but it does not start with ${spec.prefixes.map((p) => `"${p}"`).join(' or ')}`,
        `Check that you copied the ${spec.what} token, not another value.`,
      );
}

export function checkNetworkSettings(ctx: CliContext): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const config = proxyConfigFromEnv(ctx.env);
  try {
    const net = createNetworkFetch(config);
    void net.close();
    out.push(
      net.proxies.length === 0
        ? check('proxy', 'Proxy', 'info', 'none configured (direct connection)')
        : check(
            'proxy',
            'Proxy',
            'ok',
            `${net.proxies.join(', ')}${config.noProxy.length > 0 ? `; NO_PROXY: ${config.noProxy.join(', ')}` : ''} (credentials hidden)`,
          ),
    );
  } catch (error) {
    out.push(
      check(
        'proxy',
        'Proxy',
        'fail',
        error instanceof ExitOsError ? error.message : 'invalid proxy settings',
        'Use the form http://[user:password@]host:port in HTTPS_PROXY / HTTP_PROXY.',
      ),
    );
  }
  const ca = ctx.env.NODE_EXTRA_CA_CERTS?.trim();
  if (ca !== undefined && ca !== '') {
    try {
      readFileSync(resolve(ctx.cwd, ca));
      out.push(check('ca', 'Company CA certificate', 'ok', `NODE_EXTRA_CA_CERTS: ${ca}`));
    } catch {
      out.push(
        check(
          'ca',
          'Company CA certificate',
          'fail',
          `NODE_EXTRA_CA_CERTS points at ${ca}, which cannot be read`,
          'Point it at your organisation’s root CA file (PEM).',
        ),
      );
    }
  }
  return out;
}

/** Validates a migration config offline: syntax, schema, and each connector's own settings. */
export function checkConfigFile(
  ctx: CliContext,
  explicit: string | undefined,
  live: boolean,
  verbose: boolean,
): DoctorCheck {
  const path = explicit ?? 'migration.yaml';
  if (explicit === undefined && !existsSync(resolve(ctx.cwd, path))) {
    return check(
      'config',
      'Migration config',
      live ? 'fail' : 'info',
      live ? 'migration.yaml not found' : 'no migration.yaml yet (only needed for `plan`)',
      copyCommand(ctx, 'migration.example.yaml', 'migration.yaml'),
    );
  }
  let config: MigrationConfig;
  try {
    config = loadConfigFile(ctx, path);
  } catch (error) {
    return check(
      'config',
      'Migration config',
      'fail',
      error instanceof ExitOsError ? error.message : `cannot read ${path}`,
    );
  }
  const rt = createRuntime(ctx, {
    mode: 'live',
    location: resolveStateDir(ctx, { stateDir: undefined, demo: false }),
    verbose,
  });
  try {
    rt.checkConfig(config);
  } catch (error) {
    return check(
      'config',
      'Migration config',
      'fail',
      error instanceof ExitOsError ? error.message : `${path} has problems`,
    );
  } finally {
    rt.dispose();
  }
  return check(
    'config',
    'Migration config',
    'ok',
    `${path}: ${config.source.type} → ${config.destination.type}, valid`,
  );
}

/** Read-only calls to the two APIs. Skips an API whose token is missing instead of failing twice. */
export async function checkApis(ctx: CliContext, verbose: boolean): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const rt = createRuntime(ctx, {
    mode: 'live',
    location: resolveStateDir(ctx, { stateDir: undefined, demo: false }),
    verbose,
  });
  const base = bareConfig('notion', 'clickup');
  const clickupBase = { ...base, destination: { type: 'clickup', workspaceId: '0' } };
  try {
    for (const spec of TOKENS) {
      const id = spec.id.replace('-token', '-api');
      const label = `${spec.what} API`;
      if ((ctx.env[spec.env] ?? '').trim() === '') {
        out.push(check(id, label, 'warn', `skipped: ${spec.env} is not set`));
        continue;
      }
      try {
        if (spec.what === 'Notion') {
          const d = await rt.createSource(base, new RequestRecorder()).discover();
          out.push(
            check(
              id,
              label,
              'ok',
              `reachable, token accepted: workspace "${d.workspace.name}", ${d.containers.length} item(s) shared with the connection`,
            ),
          );
        } else {
          const d = await rt
            .createDestination(clickupBase, 'read-only', new RequestRecorder())
            .discover();
          out.push(
            check(
              id,
              label,
              'ok',
              `reachable, token accepted: ${d.workspaces.length} Workspace(s) visible`,
            ),
          );
        }
      } catch (error) {
        out.push(
          check(
            id,
            label,
            'fail',
            error instanceof ExitOsError ? error.message : describeNetworkFailure(error),
            'Re-run with --verbose to see which proxy settings were used.',
          ),
        );
      }
    }
  } finally {
    rt.dispose();
  }
  return out;
}

// ---- the command ---------------------------------------------------------------------------------

export async function runChecks(ctx: CliContext, options: DoctorOptions): Promise<DoctorCheck[]> {
  const live = options.live === true || options.online === true;
  const checks: DoctorCheck[] = [
    checkNode(process.versions.node, ctx.platform, process.arch),
    checkSqlite(),
    checkDashboardBuild(ctx),
    checkStateDir(ctx, options.stateDir),
    checkEnvFile(ctx),
    ...TOKENS.map((t) => checkToken(ctx, t, live)),
    ...checkNetworkSettings(ctx),
    checkConfigFile(ctx, options.config, options.live === true, options.verbose === true),
  ];
  if (options.online === true) checks.push(...(await checkApis(ctx, options.verbose === true)));
  return checks;
}

const MARK: Record<CheckStatus, string> = { ok: '✔', info: '•', warn: '!', fail: '✖' };

export async function doctorCommand(ctx: CliContext, options: DoctorOptions): Promise<number> {
  const checks = await runChecks(ctx, options);
  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const code = fails.length > 0 ? ExitCode.Usage : ExitCode.Ok;

  if (options.json === true) {
    println(ctx, JSON.stringify({ ok: fails.length === 0, checks }, null, 2));
    return code;
  }

  const { style } = ctx;
  const paint: Record<CheckStatus, (s: string) => string> = {
    ok: style.green,
    info: style.gray,
    warn: style.yellow,
    fail: style.red,
  };
  const labelWidth = Math.max(...checks.map((c) => c.label.length)) + 2;
  println(ctx, '');
  println(ctx, rule(`${BIN_NAME} doctor`, style, ctx.width));
  println(
    ctx,
    style.gray(
      options.online === true
        ? '  Checking your setup, including read-only calls to the Notion and ClickUp APIs.'
        : '  Checking your setup. Nothing is sent anywhere (add --online to test the APIs).',
    ),
  );
  println(ctx, '');
  for (const c of checks) {
    println(
      ctx,
      `  ${paint[c.status](MARK[c.status])} ${style.bold(c.label.padEnd(labelWidth))}${c.detail.split('\n')[0] ?? ''}`,
    );
    for (const extra of c.detail.split('\n').slice(1)) {
      println(ctx, `    ${' '.repeat(labelWidth)}${extra}`);
    }
    if (c.fix !== undefined && c.status !== 'ok') {
      for (const line of c.fix.split('\n')) {
        println(ctx, `    ${' '.repeat(labelWidth)}${style.cyan(`→ ${line}`)}`);
      }
    }
  }
  println(ctx, '');
  if (fails.length === 0) {
    println(
      ctx,
      `  ${style.green('Ready.')} ${warns.length > 0 ? `${warns.length} warning(s) above are worth a look. ` : ''}Try the offline demo any time: ${style.cyan(`${BIN_NAME} demo`)}`,
    );
  } else {
    println(
      ctx,
      `  ${style.red(`${fails.length} problem(s) to fix`)} before a real migration. The offline demo needs none of this: ${style.cyan(`${BIN_NAME} demo`)}`,
    );
  }
  println(ctx, '');
  return code;
}
