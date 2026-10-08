import { describe, expect, it } from 'vitest';
import { defaultConfigYaml, notionFixture, world } from './harness.js';

/**
 * Opt-in scale check: `EXITOS_SCALE=1 EXITOS_SCALE_ROWS=20000 pnpm exec vitest run packages/connector-clickup/test/scale.test.ts --reporter=verbose`
 *
 * It runs the whole plan -> approve -> apply -> verify cycle against the in-process fakes and prints one
 * `SCALE {...}` line. Read the numbers for what they are:
 *  - there is NO network latency, so the times show ExitOS's own cost, not a real migration's duration;
 *  - the fakes live in the same process, so peak memory includes the fake Notion and ClickUp data (an
 *    upper bound on what ExitOS itself needs);
 *  - a real migration is paced by the destination's rate limit, which is far slower than anything here.
 * Skipped by default so `pnpm test` stays fast.
 */
const ENABLED = process.env.EXITOS_SCALE === '1';
const ROWS = Number(process.env.EXITOS_SCALE_ROWS ?? 5000);

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);

describe.skipIf(!ENABLED)('scale (opt-in: EXITOS_SCALE=1)', () => {
  it(
    `plans, applies and verifies ${ROWS} rows`,
    async () => {
      const rows = Array.from({ length: ROWS }, (_, i) => ({ n: i + 1, status: 'In progress' }));
      // Reading stops (and the plan is blocked) at limits.maxRecordsPerDataSource, 50 000 by default,
      // so a bigger data source needs the limit raised on purpose.
      const config = defaultConfigYaml().replace(
        'type: notion',
        `type: notion\n  limits: { maxRecordsPerDataSource: ${Math.max(ROWS + 1, 50_000)} }`,
      );
      const w = world({ notion: notionFixture(rows), config, rateLimitPerMinute: 0 });

      let peakRss = process.memoryUsage().rss;
      const sampler = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }, 25);

      const t0 = performance.now();
      const plan = await w.plan();
      const t1 = performance.now();
      const run = w.approve(plan);
      const applied = await w.run(plan, run.runId, { concurrency: 8 });
      const t2 = performance.now();
      const verification = await w.verify(plan, run.runId);
      const t3 = performance.now();
      clearInterval(sampler);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);

      const planJsonBytes = Buffer.byteLength(JSON.stringify(plan));
      process.stdout.write(
        `SCALE ${JSON.stringify({
          rows: ROWS,
          actions: plan.summary.actions.toExecute,
          planSeconds: +((t1 - t0) / 1000).toFixed(2),
          applySeconds: +((t2 - t1) / 1000).toFixed(2),
          verifySeconds: +((t3 - t2) / 1000).toFixed(2),
          peakRssMB: mb(peakRss),
          planJsonMB: +(planJsonBytes / 1024 / 1024).toFixed(1),
          requestsToClickUp: w.clickup.requests.length,
        })}\n`,
      );

      expect(applied.status).toBe('applied');
      expect(verification.status).toBe('passed');
      expect(w.clickup.state.tasks).toHaveLength(ROWS);
    },
    60 * 60_000,
  );
});
