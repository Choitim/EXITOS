/**
 * Hermetic fixture servers for the dashboard tests.
 *
 * Everything happens in fresh temporary directories, with the real built CLI and a scrubbed
 * environment (no tokens, no inherited ExitOS settings):
 *   demo   `exitos demo --json`, then `exitos ui --demo`
 *   xss    a live-mode plan whose text fields carry hostile payloads, then `exitos ui`
 *   live   a run that is still `applying`, to test polling
 *   empty  an empty directory, to test the empty state
 *   planned  a plan nobody approved: no run
 *   applied  every action written, never verified
 *   failed   a run that stopped with failed, blocked and ambiguous actions
 *   static   apps/web/dist-demo (the online demo) behind a header-less file server on a sub-path;
 *            built here with `pnpm build:demo` only when it is missing
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI_BIN,
  CORE_DIST,
  DEMO_DIST,
  DEMO_DIST_INDEX,
  DEMO_STATE_FILE,
  ENV,
  ROOT,
  WEB_DIST_INDEX,
} from './support/paths.js';
import { startStaticSite } from './support/static-server.js';
import {
  buildHostilePlan,
  demoPlanPath,
  readPlan,
  seedAppliedUnverified,
  seedFailedRun,
  seedHostileState,
  seedLiveRun,
  seedPlannedOnly,
} from './support/states.js';

interface Server {
  child: ChildProcess;
  url: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function cleanEnv(home: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '', HOME: home, NO_COLOR: '1', TZ: 'UTC' };
}

async function waitForHealth(
  url: string,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`exitos ui exited early (code ${child.exitCode}):\n${output()}`);
    }
    try {
      const response = await fetch(`${url}api/health`);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`exitos ui did not become healthy at ${url}:\n${output()}`);
}

async function startUi(cwd: string, args: string[], home: string): Promise<Server> {
  const port = await freePort();
  const child = spawn(process.execPath, [CLI_BIN, 'ui', ...args, '--port', String(port)], {
    cwd,
    env: cleanEnv(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForHealth(url, child, () => output);
  } catch (error) {
    child.kill();
    throw error;
  }
  return { child, url };
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  for (const [file, hint] of [
    [CLI_BIN, 'run `pnpm exec tsc -b` at the repository root'],
    [CORE_DIST, 'run `pnpm exec tsc -b` at the repository root'],
    [WEB_DIST_INDEX, 'run `pnpm --filter @exitos/web build`'],
  ] as const) {
    if (!existsSync(file)) throw new Error(`Missing ${file}: ${hint} first.`);
  }

  // The online demo is built on demand: CI builds it explicitly, a local run builds it once.
  if (!existsSync(DEMO_DIST_INDEX) || !existsSync(DEMO_STATE_FILE)) {
    const build = spawnSync('pnpm', ['run', 'build:demo'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (build.status !== 0) throw new Error('`pnpm build:demo` failed; see its output above.');
  }

  const root = mkdtempSync(join(tmpdir(), 'exitos-e2e-'));
  const home = join(root, 'home');
  mkdirSync(home);
  const servers: Server[] = [];
  const closers: Array<() => Promise<void>> = [];
  const teardown = async (): Promise<void> => {
    for (const { child } of servers) child.kill('SIGTERM');
    await Promise.all(closers.map((close) => close()));
    await new Promise((resolve) => setTimeout(resolve, 200));
    rmSync(root, { recursive: true, force: true });
  };

  try {
    // 1. demo: the real CLI creates the synthetic run.
    const demoDir = join(root, 'demo');
    mkdirSync(demoDir);
    const demo = spawnSync(process.execPath, [CLI_BIN, 'demo', '--json'], {
      cwd: demoDir,
      env: cleanEnv(home),
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (demo.status !== 0) {
      throw new Error(`exitos demo failed (exit ${demo.status}):\n${demo.stdout}\n${demo.stderr}`);
    }
    const demoServer = await startUi(demoDir, ['--demo'], home);
    servers.push(demoServer);
    process.env[ENV.demo] = demoServer.url;

    // 2. hostile content in a live-mode plan.
    const demoPlan = readPlan(demoPlanPath(demoDir));
    const xssDir = join(root, 'xss');
    mkdirSync(xssDir);
    seedHostileState(join(xssDir, '.exitos', 'state.db'), buildHostilePlan(demoPlan));
    const xssServer = await startUi(xssDir, [], home);
    servers.push(xssServer);
    process.env[ENV.xss] = xssServer.url;

    // 3. a run that is still applying.
    const liveDir = join(root, 'live');
    mkdirSync(liveDir);
    const liveDb = join(liveDir, '.exitos', 'state.db');
    seedLiveRun(liveDb, demoPlan);
    const liveServer = await startUi(liveDir, [], home);
    servers.push(liveServer);
    process.env[ENV.live] = liveServer.url;
    process.env[ENV.liveDb] = liveDb;

    // 4. nothing at all.
    const emptyDir = join(root, 'empty');
    mkdirSync(emptyDir);
    const emptyServer = await startUi(emptyDir, [], home);
    servers.push(emptyServer);
    process.env[ENV.empty] = emptyServer.url;

    // 5. a plan that was never approved.
    const plannedDir = join(root, 'planned');
    mkdirSync(plannedDir);
    seedPlannedOnly(join(plannedDir, '.exitos', 'state.db'), demoPlan);
    const plannedServer = await startUi(plannedDir, [], home);
    servers.push(plannedServer);
    process.env[ENV.planned] = plannedServer.url;

    // 6. applied but never verified.
    const appliedDir = join(root, 'applied');
    mkdirSync(appliedDir);
    seedAppliedUnverified(join(appliedDir, '.exitos', 'state.db'), demoPlan);
    const appliedServer = await startUi(appliedDir, [], home);
    servers.push(appliedServer);
    process.env[ENV.applied] = appliedServer.url;

    // 7. a run that stopped with failures.
    const failedDir = join(root, 'failed');
    mkdirSync(failedDir);
    seedFailedRun(join(failedDir, '.exitos', 'state.db'), demoPlan);
    const failedServer = await startUi(failedDir, [], home);
    servers.push(failedServer);
    process.env[ENV.failed] = failedServer.url;

    // 8. the static online demo, under a sub-path, with no headers.
    const site = await startStaticSite(DEMO_DIST);
    closers.push(site.close);
    process.env[ENV.staticDemo] = site.url;
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
