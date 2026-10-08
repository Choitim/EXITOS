import { BIN_NAME, ExitCode } from '@exitos/shared';
import { println, type CliContext } from '../context.js';
import { resolveStateDir } from '../runtime/state.js';
import { startDashboardServer } from '../server/server.js';
import { findWebDir } from '../server/web-dir.js';
import { buildDashboardState } from '../server/dashboard-state.js';

export interface UiOptions {
  port?: number | undefined;
  demo?: boolean | undefined;
  stateDir?: string | undefined;
  /** Used by tests and scripts: return after the server is up instead of waiting for Ctrl-C. */
  detach?: boolean | undefined;
}

export interface RunningUi {
  url: string;
  close(): Promise<void>;
}

export async function startUi(ctx: CliContext, options: UiOptions): Promise<RunningUi> {
  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo: options.demo });
  const webDir = findWebDir({ webDir: ctx.overrides?.webDir, env: ctx.env.EXITOS_WEB_DIST });
  const server = await startDashboardServer({ location, webDir, port: options.port ?? 4173 });
  return server;
}

export async function uiCommand(ctx: CliContext, options: UiOptions): Promise<number> {
  const running = await startUi(ctx, options);
  const location = resolveStateDir(ctx, { stateDir: options.stateDir, demo: options.demo });
  const state = buildDashboardState(location);
  const { style } = ctx;
  println(ctx, '');
  println(ctx, `${style.bold('ExitOS dashboard')} ${style.gray('(local, read-only)')}`);
  println(ctx, `  ${style.cyan(running.url)}`);
  println(ctx, `  ${style.gray(`state: ${location.dir}`)}`);
  println(
    ctx,
    state.mode === 'empty'
      ? `  ${style.yellow('No plan or run yet.')} Try ${style.cyan(`${BIN_NAME} demo`)} then ${style.cyan(`${BIN_NAME} ui --demo`)}.`
      : `  ${state.mode === 'demo' ? style.badge('OFFLINE DEMO', 'yellow') : style.badge('LIVE', 'blue')} ${state.plan?.planId ?? ''} ${style.gray(state.run ? `· run ${state.run.status}` : '· plan only')}`,
  );
  println(ctx, `  ${style.gray('Press Ctrl-C to stop.')}`);
  if (options.detach === true) {
    await running.close();
    return ExitCode.Ok;
  }
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    if (ctx.signal?.aborted) return resolve();
    ctx.signal?.addEventListener('abort', stop, { once: true });
    process.once('SIGTERM', stop);
  });
  await running.close();
  return ExitCode.Ok;
}
