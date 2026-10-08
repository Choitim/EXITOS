import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clickupDestination } from '@exitos/connector-clickup';
import {
  createFakeClickUpApi,
  type FakeClickUpApi,
  type FakeClickUpState,
} from '@exitos/connector-clickup/testing';
import { notionSource } from '@exitos/connector-notion';
import { createFakeNotionApi, type FakeNotionApi } from '@exitos/connector-notion/testing';
import {
  ConnectorRegistry,
  createConnectorContext,
  type DestinationConnector,
  type MigrationConfig,
  type RunMode,
  type SourceConnector,
} from '@exitos/core';
import { buildDemoClickUpState, buildDemoNotionFixture } from '@exitos/demo-workspace';
import {
  type RequestRecorder,
  VirtualClock,
  createLogger,
  systemClock,
  type AccessMode,
  type Clock,
  type FetchLike,
  type Logger,
} from '@exitos/shared';
import type { CliContext } from '../context.js';
import type { StateLocation } from './state.js';

/** Fixed start so the demo's timestamps, run ids and plan ids are reproducible. */
export const DEMO_START_MS = Date.UTC(2026, 9, 8, 9, 0, 0);

export function createRegistry(): ConnectorRegistry {
  return new ConnectorRegistry()
    .registerSource(notionSource)
    .registerDestination(clickupDestination);
}

export interface Runtime {
  readonly mode: RunMode;
  readonly clock: Clock;
  readonly logger: Logger;
  now(): Date;
  createSource(config: MigrationConfig, recorder: RequestRecorder): SourceConnector;
  createDestination(
    config: MigrationConfig,
    access: AccessMode,
    recorder: RequestRecorder,
  ): DestinationConnector;
  /** Present only in demo mode. */
  readonly demo?: { notion: FakeNotionApi; clickup: FakeClickUpApi };
  /** Persist in-memory state that must survive the process (the demo's fake ClickUp). */
  flush(): void;
  dispose(): void;
}

interface DemoWorldFile {
  clickup: FakeClickUpState;
  clockMs: number;
}

export interface RuntimeOptions {
  mode: RunMode;
  location: StateLocation;
  verbose?: boolean | undefined;
}

export function createRuntime(ctx: CliContext, options: RuntimeOptions): Runtime {
  const registry = createRegistry();
  const logger = createLogger(options.verbose === true ? 'debug' : 'warn', (line) =>
    ctx.io.stderr(`${line}\n`),
  );
  return options.mode === 'demo'
    ? demoRuntime(ctx, options, registry, logger)
    : liveRuntime(ctx, registry, logger);
}

function baseUrlFor(env: CliContext['env'], connectorId: string): string | undefined {
  return env[`${connectorId.toUpperCase()}_API_BASE_URL`];
}

function liveRuntime(ctx: CliContext, registry: ConnectorRegistry, logger: Logger): Runtime {
  const clock = ctx.overrides?.clock ?? systemClock;
  const transports: Record<string, FetchLike> = {
    notion: ctx.overrides?.notionFetch ?? ((url, init) => fetch(url, init)),
    clickup: ctx.overrides?.clickupFetch ?? ((url, init) => fetch(url, init)),
  };
  const host = (id: string, recorder: RequestRecorder, config: MigrationConfig) => ({
    transport: transports[id] ?? ((url: string, init?: RequestInit) => fetch(url, init)),
    mode: 'live' as const,
    env: ctx.env,
    logger,
    clock,
    recorder,
    concurrency: config.options.concurrency,
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    baseUrlOverride: baseUrlFor(ctx.env, id),
  });
  return {
    mode: 'live',
    clock,
    logger,
    now: () => new Date(clock.now()),
    createSource(config, recorder) {
      const def = registry.source(config.source.type);
      const context = createConnectorContext(
        def,
        'read-only',
        host(def.manifest.id, recorder, config),
      );
      return def.create(context, def.configSchema.parse(config.source), config);
    },
    createDestination(config, access, recorder) {
      const def = registry.destination(config.destination.type);
      const context = createConnectorContext(def, access, host(def.manifest.id, recorder, config));
      return def.create(context, def.configSchema.parse(config.destination), config);
    },
    flush() {},
    dispose() {},
  };
}

function demoRuntime(
  ctx: CliContext,
  options: RuntimeOptions,
  registry: ConnectorRegistry,
  logger: Logger,
): Runtime {
  const worldPath = join(options.location.dir, 'demo-world.json');
  let stored: DemoWorldFile | undefined;
  if (existsSync(worldPath)) {
    try {
      stored = JSON.parse(readFileSync(worldPath, 'utf8')) as DemoWorldFile;
    } catch {
      stored = undefined; // a damaged demo world is simply rebuilt
    }
  }
  const clock = new VirtualClock(stored?.clockMs ?? DEMO_START_MS);
  const notion = createFakeNotionApi(buildDemoNotionFixture());
  let dirty = false;
  const clickup = createFakeClickUpApi(stored?.clickup ?? buildDemoClickUpState(), {
    now: () => clock.now(),
    rateLimitPerMinute: 100,
    onChange: () => {
      dirty = true;
    },
  });
  const flush = (): void => {
    if (!dirty) return;
    const tmp = `${worldPath}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({
        clickup: clickup.exportState(),
        clockMs: clock.now(),
      } satisfies DemoWorldFile),
    );
    renameSync(tmp, worldPath);
    dirty = false;
  };
  const onExit = (): void => {
    try {
      flush();
    } catch {
      /* best effort at exit */
    }
  };
  process.once('exit', onExit);

  const transports: Record<string, FetchLike> = { notion: notion.fetch, clickup: clickup.fetch };
  const host = (id: string, recorder: RequestRecorder, config: MigrationConfig) => ({
    transport: transports[id] as FetchLike,
    mode: 'demo' as const,
    env: {},
    logger,
    clock,
    recorder,
    concurrency: config.options.concurrency,
  });
  return {
    mode: 'demo',
    clock,
    logger,
    now: () => new Date(clock.now()),
    demo: { notion, clickup },
    createSource(config, recorder) {
      const def = registry.source(config.source.type);
      const context = createConnectorContext(
        def,
        'read-only',
        host(def.manifest.id, recorder, config),
      );
      return def.create(context, def.configSchema.parse(config.source), config);
    },
    createDestination(config, access, recorder) {
      const def = registry.destination(config.destination.type);
      const context = createConnectorContext(def, access, host(def.manifest.id, recorder, config));
      return def.create(context, def.configSchema.parse(config.destination), config);
    },
    flush,
    dispose() {
      flush();
      process.removeListener('exit', onExit);
    },
  };
}
