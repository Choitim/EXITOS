import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConnectorRegistry,
  MigrationConfigSchema,
  SqliteStateStore,
  approveAndCreateRun,
  buildPlan,
  createConnectorContext,
  executePlan,
  verifyRun,
} from '@exitos/core';
import { checkDestinationPlan, checkSourceConnector } from '@exitos/core/testing';
import { VirtualClock } from '@exitos/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonFileSource, markdownFolderDestination } from '../src/index.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'exitos-example-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(
  items: unknown[] = [
    { id: 'a1', title: 'Write the docs', done: false, notes: 'Start with the README' },
    { id: 'b2', title: 'Café ☕ launch', done: true },
    { id: 'c3', title: 'Has attachment', attachmentUrl: 'https://example.com/x.pdf' },
  ],
) {
  const dir = tmp();
  const input = join(dir, 'tasks.json');
  const out = join(dir, 'out');
  writeFileSync(input, JSON.stringify({ title: 'Demo tasks', items }));
  const config = MigrationConfigSchema.parse({
    version: 1,
    source: { type: 'json-file', path: input },
    destination: { type: 'markdown-folder', directory: out },
  });
  const transport = async (): Promise<Response> => {
    throw new Error('the example connectors must never use the network');
  };
  const host = { transport, mode: 'live' as const, env: {}, clock: new VirtualClock() };
  const source = jsonFileSource.create(
    createConnectorContext(jsonFileSource, 'read-only', host),
    jsonFileSource.configSchema.parse(config.source),
    config,
  );
  const destination = markdownFolderDestination.create(
    createConnectorContext(markdownFolderDestination, 'read-write', host),
    markdownFolderDestination.configSchema.parse(config.destination),
    config,
  );
  const store = SqliteStateStore.open(':memory:');
  return { dir, out, config, source, destination, store, clock: new VirtualClock() };
}

describe('example connectors', () => {
  it('register like any other connector', () => {
    const registry = new ConnectorRegistry()
      .registerSource(jsonFileSource)
      .registerDestination(markdownFolderDestination);
    expect(registry.source('json-file').manifest.name).toBe('JSON file');
    expect(registry.destination('markdown-folder').credentials).toEqual([]);
  });

  it('the source passes the conformance kit', async () => {
    const w = setup();
    const report = await checkSourceConnector(w.source);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('the destination passes the planning conformance kit', async () => {
    const w = setup();
    const snapshot = w.source.normalize(await w.source.extract());
    const inspection = await w.destination.inspect();
    const report = checkDestinationPlan(w.destination, {
      snapshot,
      inspection,
      config: w.config,
      mode: 'live',
      existing: new Map(),
    });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('runs a complete plan → approve → apply → verify cycle through the real engine', async () => {
    const w = setup();
    const { plan } = await buildPlan({
      source: w.source,
      destination: w.destination,
      config: w.config,
      mode: 'live',
      store: w.store,
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    expect(plan.summary.actions.toExecute).toBe(3);
    expect(plan.inventory.map((f) => f.code)).toContain('ATTACHMENT_NOT_SUPPORTED'); // reported, not dropped
    expect(readdirSyncSafe(w.out)).toEqual([]); // planning wrote nothing

    const run = approveAndCreateRun({
      plan,
      store: w.store,
      approvedPlanId: plan.planId,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(
      (
        await executePlan({
          plan,
          destination: w.destination,
          store: w.store,
          runId: run.runId,
          concurrency: 2,
          clock: w.clock,
        })
      ).status,
    ).toBe('applied');
    expect(readdirSyncSafe(w.out)).toHaveLength(3);

    const v = await verifyRun({
      plan,
      destination: w.destination,
      store: w.store,
      runId: run.runId,
      clock: w.clock,
    });
    expect(v.status).toBe('passed');
    expect(w.store.getRun(run.runId)?.status).toBe('verified');
  });

  it('never overwrites a file that already exists with different content', async () => {
    const w = setup();
    const { plan } = await buildPlan({
      source: w.source,
      destination: w.destination,
      config: w.config,
      mode: 'live',
      store: w.store,
      now: () => new Date(),
    });
    const file = (plan.actions[0]?.payload as { file: string }).file;
    mkdirSync(w.out, { recursive: true });
    writeFileSync(join(w.out, file), 'MY OWN NOTES');
    const run = approveAndCreateRun({
      plan,
      store: w.store,
      approvedPlanId: plan.planId,
      now: new Date(),
    });
    const result = await executePlan({
      plan,
      destination: w.destination,
      store: w.store,
      runId: run.runId,
      concurrency: 1,
      clock: w.clock,
    });
    expect(result.status).toBe('failed');
    expect(readFileSync(join(w.out, file), 'utf8')).toBe('MY OWN NOTES');
  });

  it('is idempotent: resuming a finished plan writes nothing new', async () => {
    const w = setup();
    const { plan } = await buildPlan({
      source: w.source,
      destination: w.destination,
      config: w.config,
      mode: 'live',
      store: w.store,
      now: () => new Date(),
    });
    const run = approveAndCreateRun({
      plan,
      store: w.store,
      approvedPlanId: plan.planId,
      now: new Date(),
    });
    await executePlan({
      plan,
      destination: w.destination,
      store: w.store,
      runId: run.runId,
      concurrency: 1,
      clock: w.clock,
    });
    const before = readdirSyncSafe(w.out);
    expect(
      (
        await executePlan({
          plan,
          destination: w.destination,
          store: w.store,
          runId: run.runId,
          concurrency: 1,
          clock: w.clock,
        })
      ).status,
    ).toBe('applied');
    expect(readdirSyncSafe(w.out)).toEqual(before);
  });

  it('a plan cannot make it write outside its folder', async () => {
    const w = setup();
    const { plan } = await buildPlan({
      source: w.source,
      destination: w.destination,
      config: w.config,
      mode: 'live',
      store: w.store,
      now: () => new Date(),
    });
    const evil = {
      ...plan.actions[0],
      payload: { file: '../../escape.md', content: 'x' },
    } as (typeof plan.actions)[number];
    await expect(
      w.destination.apply(evil, {
        runId: 'r',
        attempt: 1,
        resolveDependency: () => undefined,
        lookupBySource: () => undefined,
      }),
    ).rejects.toThrow();
  });

  it('rejects a source file with a malformed item instead of guessing', async () => {
    const w = setup([{ id: '../bad', title: 'x' }]);
    await expect(w.source.extract()).rejects.toThrow();
  });
});

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
