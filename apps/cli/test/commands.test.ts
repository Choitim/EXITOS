import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DashboardStateSchema,
  MigrationPlanSchema,
  MigrationReportSchema,
  SqliteStateStore,
} from '@exitos/core';
import { VERSION } from '@exitos/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { makeCli, type TestCli } from './harness.js';

const clis: TestCli[] = [];
const cli = (options?: Parameters<typeof makeCli>[0]): TestCli => {
  const c = makeCli(options);
  clis.push(c);
  return c;
};
afterEach(() => {
  for (const c of clis.splice(0)) c.cleanup();
});

describe('exitos --help / --version', () => {
  it('states the safety model and offers the offline demo', async () => {
    const c = cli();
    expect(await c.run(['--help'])).toBe(0);
    const text = c.captured.text();
    expect(text).toContain('See what survives before you switch apps.');
    expect(text).toContain('inspect → plan → approve → apply → verify');
    expect(text).toContain('never modifies the source');
    for (const cmd of [
      'demo',
      'inspect',
      'plan',
      'apply',
      'status',
      'resume',
      'verify',
      'report',
      'ui',
    ]) {
      expect(text).toMatch(new RegExp(`\\n\\s+${cmd}[ \\n]`));
    }
  });

  it('prints the version', async () => {
    const c = cli();
    expect(await c.run(['--version'])).toBe(0);
    expect(c.captured.text().trim()).toBe(VERSION);
  });

  it('an unknown command or missing option is a usage error (exit 2)', async () => {
    expect(await cli().run(['frobnicate'])).toBe(2);
    expect(await cli().run(['plan', 'notion', 'clickup'])).toBe(2); // --config required
    expect(await cli().run(['apply'])).toBe(2); // --plan required
    expect(await cli().run(['demo', '--pace', 'abc'])).toBe(2);
  });
});

describe('exitos demo', () => {
  it('runs the whole cycle offline, verifies, and labels itself OFFLINE DEMO', async () => {
    const c = cli();
    expect(await c.run(['demo'])).toBe(0);
    const text = c.captured.text();
    expect(text).toContain('OFFLINE DEMO');
    expect(text).toContain('Synthetic data');
    expect(text).toContain('HERE IS EVERYTHING THAT MOVES, CHANGES, AND CANNOT MOVE');
    expect(text).toContain('Requests so far: 84 read · 0 write · 0 blocked');
    expect(text).toContain('APPLIED — NOT VERIFIED');
    expect(text).toContain('✔ VERIFIED');
    expect(text).toContain('175 verified · 0 mismatched · 0 missing · 0 unverified');
    expect(text).toContain('NOT PRESERVED');
    expect(text).toContain('Duplicates      0');
    expect(text).toContain('makes no claim of "zero data loss"');
    expect(text).not.toMatch(/zero data loss(?!")/i);
  });

  it('is deterministic: the same plan id every time', async () => {
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const c = cli();
      await c.run(['demo', '--json']);
      ids.push((JSON.parse(c.captured.text()) as { plan: { planId: string } }).plan.planId);
    }
    expect(ids[0]).toBe(ids[1]);
  });

  it('--json prints only machine-readable output that validates against the schemas', async () => {
    const c = cli();
    expect(await c.run(['demo', '--json'])).toBe(0);
    const data = JSON.parse(c.captured.text()) as {
      mode: string;
      report: unknown;
      verification: { status: string; counts: Record<string, number> };
      requests: { planning: { writes: number } };
    };
    expect(data.mode).toBe('demo');
    expect(MigrationReportSchema.parse(data.report).state).toBe('verified');
    expect(data.verification.status).toBe('passed');
    expect(data.requests.planning.writes).toBe(0);
  });

  it('writes a plan file and state under its own directory, never elsewhere', async () => {
    const c = cli();
    await c.run(['demo']);
    expect(existsSync(join(c.cwd, '.exitos', 'demo', 'state.db'))).toBe(true);
    const plan = MigrationPlanSchema.parse(
      JSON.parse(readFileSync(join(c.cwd, '.exitos', 'demo', 'migration-plan.json'), 'utf8')),
    );
    expect(plan.mode).toBe('demo');
    expect(existsSync(join(c.cwd, 'migration-plan.json'))).toBe(false);
  });

  it('crash mid-run with --interrupt-after, then resume and verify: no duplicates', async () => {
    const c = cli();
    expect(await c.run(['demo', '--interrupt-after', '40'])).toBe(3);
    expect(c.captured.errText()).toContain('resume --demo');

    const status = cli({ cwd: c.cwd });
    expect(await status.run(['status', '--demo'])).toBe(0);
    expect(status.captured.text()).toMatch(/APPLYING/);
    expect(status.captured.text()).toContain('exitos resume');

    const resume = cli({ cwd: c.cwd });
    expect(await resume.run(['resume', '--demo'])).toBe(0);
    expect(resume.captured.text()).toContain('APPLIED — NOT VERIFIED');

    const verify = cli({ cwd: c.cwd });
    expect(await verify.run(['verify', '--demo'])).toBe(0);
    expect(verify.captured.text()).toContain('175 verified');

    // The persisted fake ClickUp must hold each Notion row exactly once.
    const world = JSON.parse(
      readFileSync(join(c.cwd, '.exitos', 'demo', 'demo-world.json'), 'utf8'),
    ) as { clickup: { tasks: Array<{ markdown_description: string }> } };
    const keys = world.clickup.tasks
      .map((t) => /exitos-key:(\S+?)`/.exec(t.markdown_description)?.[1])
      .filter(Boolean);
    expect(world.clickup.tasks.length).toBe(159); // 158 migrated + 1 pre-existing
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('--no-chaos skips the injected failures', async () => {
    const c = cli();
    expect(await c.run(['demo', '--no-chaos'])).toBe(0);
    expect(c.captured.text()).toContain('Rate limited    0 response(s)');
    expect(c.captured.text()).not.toContain('Lost reply');
  });

  it('respects NO_COLOR and a non-TTY: no escape sequences', async () => {
    const c = makeCli({ env: { NO_COLOR: '1' }, color: true });
    clis.push(c);
    await c.run(['demo', '--no-chaos']);
    // eslint-disable-next-line no-control-regex -- looking for ANSI escape sequences
    expect(c.captured.out.join('')).not.toMatch(/\u001b\[/);
  });
});

describe('state commands after a demo', () => {
  const afterDemo = async (): Promise<string> => {
    const c = cli();
    await c.run(['demo']);
    return c.cwd;
  };

  it('status', async () => {
    const c = cli({ cwd: await afterDemo() });
    expect(await c.run(['status', '--demo'])).toBe(0);
    expect(c.captured.text()).toContain('VERIFIED');
    expect(c.captured.text()).toContain('OFFLINE DEMO');
    const j = cli({ cwd: c.cwd });
    await j.run(['status', '--demo', '--json']);
    expect((JSON.parse(j.captured.text()) as { run: { status: string } }).run.status).toBe(
      'verified',
    );
  });

  it('report: terminal, markdown, json, and file output', async () => {
    const cwd = await afterDemo();
    const md = cli({ cwd });
    expect(await md.run(['report', '--demo', '--format', 'markdown'])).toBe(0);
    expect(md.captured.text()).toContain('# ExitOS migration report — OFFLINE DEMO');
    expect(md.captured.text()).toContain('## Not preserved');
    expect(md.captured.text()).toContain('## Verification');

    const js = cli({ cwd });
    await js.run(['report', '--demo', '--format', 'json']);
    expect(MigrationReportSchema.parse(JSON.parse(js.captured.text())).state).toBe('verified');

    const file = cli({ cwd });
    expect(await file.run(['report', '--demo', '--format', 'markdown', '--out', 'report.md'])).toBe(
      0,
    );
    expect(readFileSync(join(cwd, 'report.md'), 'utf8')).toContain('Not preserved');
  });

  it('report --redact removes titles and people', async () => {
    const cwd = await afterDemo();
    const plain = cli({ cwd });
    await plain.run(['report', '--demo', '--format', 'json']);
    expect(plain.captured.text()).toContain('Design robot arm v2 gripper');

    const red = cli({ cwd });
    await red.run(['report', '--demo', '--format', 'json', '--redact']);
    const text = red.captured.text();
    expect(text).not.toContain('Design robot arm');
    expect(text).not.toContain('Ada Lovelace');
    expect(text).not.toContain('Acme Robotics');
    expect(MigrationReportSchema.parse(JSON.parse(text)).redacted).toBe(true);
  });

  it('report --out refuses to overwrite an unrelated file', async () => {
    const cwd = await afterDemo();
    writeFileSync(join(cwd, 'notes.txt'), 'my precious notes');
    const c = cli({ cwd });
    expect(await c.run(['report', '--demo', '--out', 'notes.txt'])).toBe(2);
    expect(c.captured.errText()).toContain('Refusing to overwrite');
    expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('my precious notes');
  });

  it('inspect notion --demo lists every property with its portability', async () => {
    const c = cli();
    expect(
      await c.run(['inspect', 'notion', '--demo', '--config', join(await writeDemoConfig(c.cwd))]),
    ).toBe(0);
    const text = c.captured.text();
    expect(text).toContain('Product Roadmap');
    expect(text).toMatch(/Notify team\s+button\s+unsupported/);
    expect(text).toMatch(/Depends on\s+relation\s+transformed/);
  });

  it('connectors lists what is built in', async () => {
    const c = cli();
    expect(await c.run(['connectors'])).toBe(0);
    expect(c.captured.text()).toMatch(/source\s+notion/);
    expect(c.captured.text()).toMatch(/destination\s+clickup/);
    expect(c.captured.text()).toContain('NOTION_TOKEN');
    expect(c.captured.text()).toContain('CLICKUP_API_TOKEN');
  });
});

async function writeDemoConfig(cwd: string): Promise<string> {
  const { DEMO_MIGRATION_YAML } = await import('@exitos/demo-workspace');
  const path = join(cwd, 'demo.yaml');
  writeFileSync(path, DEMO_MIGRATION_YAML);
  return path;
}

describe('approval gate', () => {
  const planFile = async (): Promise<{ cwd: string; file: string; planId: string }> => {
    const c = cli();
    await c.run(['demo']);
    const file = join(c.cwd, '.exitos', 'demo', 'migration-plan.json');
    const plan = MigrationPlanSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    return { cwd: c.cwd, file, planId: plan.planId };
  };

  it('refuses to apply without --approve in a non-interactive shell, and writes nothing', async () => {
    const { cwd, file } = await planFile();
    const fresh = join(cwd, 'fresh');
    const c = cli({ cwd });
    expect(await c.run(['apply', '--plan', file, '--state-dir', fresh])).toBe(5);
    expect(c.captured.errText()).toMatch(/--approve plan_[0-9a-f]{12}/);
    expect(existsSync(join(fresh, 'state.db'))).toBe(false);
  });

  it('refuses a wrong approval', async () => {
    const { cwd, file } = await planFile();
    const c = cli({ cwd });
    expect(
      await c.run([
        'apply',
        '--plan',
        file,
        '--approve',
        'plan_000000000000',
        '--state-dir',
        join(cwd, 'x'),
      ]),
    ).toBe(5);
    expect(c.captured.errText()).toContain('does not match');
  });

  it('on a terminal, asks you to type the plan id; Enter cancels', async () => {
    const { cwd, file, planId } = await planFile();
    const cancel = cli({ cwd, tty: true, answers: [''] });
    expect(await cancel.run(['apply', '--plan', file, '--state-dir', join(cwd, 'a')])).toBe(5);
    expect(cancel.captured.text()).toContain('Approval required');

    const ok = cli({ cwd, tty: true, answers: [planId] });
    expect(await ok.run(['apply', '--plan', file, '--state-dir', join(cwd, 'b')])).toBe(0);
    expect(ok.captured.text()).toContain('APPLIED — NOT VERIFIED');
  });

  it('refuses a hand-edited plan file', async () => {
    const { cwd, file, planId } = await planFile();
    const plan = JSON.parse(readFileSync(file, 'utf8')) as {
      actions: Array<{ payload: { body?: { name: string } } }>;
    };
    const first = plan.actions[0];
    if (first?.payload.body) first.payload.body.name = 'Edited after review';
    writeFileSync(file, JSON.stringify(plan));
    const c = cli({ cwd });
    expect(
      await c.run(['apply', '--plan', file, '--approve', planId, '--state-dir', join(cwd, 'z')]),
    ).toBe(5);
    expect(c.captured.errText()).toMatch(/hash|edited|corrupt/i);
  });

  it('a missing plan file is a clear usage error', async () => {
    const c = cli();
    expect(await c.run(['apply', '--plan', 'nope.json', '--approve', 'x'])).toBe(2);
    expect(c.captured.errText()).toContain('Plan file not found');
  });
});

describe('the verified state is only reachable through verification', () => {
  it('apply alone leaves the run at "applied", and `status` says NOT VERIFIED', async () => {
    const c = cli();
    await c.run(['demo', '--interrupt-after', '10']);
    await cli({ cwd: c.cwd }).run(['resume', '--demo']);
    const s = cli({ cwd: c.cwd });
    await s.run(['status', '--demo']);
    expect(s.captured.text()).toContain('APPLIED — NOT VERIFIED');
    expect(s.captured.text()).toContain('exitos verify');
    const store = SqliteStateStore.open(join(c.cwd, '.exitos', 'demo', 'state.db'), {
      readOnly: true,
    });
    expect(store.latestRun()?.status).toBe('applied');
    store.close();
    const r = cli({ cwd: c.cwd });
    await r.run(['report', '--demo']);
    expect(r.captured.text()).toContain('APPLIED — NOT VERIFIED');
    expect(r.captured.text()).not.toMatch(/\bVERIFIED —/);
  });
});

describe('dashboard state document', () => {
  it('is built from the state database and validates against the schema', async () => {
    const c = cli();
    await c.run(['demo']);
    const { buildDashboardState } = await import('../src/index.js');
    const state = buildDashboardState({
      dir: join(c.cwd, '.exitos', 'demo'),
      dbPath: join(c.cwd, '.exitos', 'demo', 'state.db'),
    });
    expect(DashboardStateSchema.parse(state).mode).toBe('demo');
    expect(state.report?.state).toBe('verified');
    expect(state.events.length).toBeGreaterThan(100);
    expect(JSON.stringify(state)).not.toMatch(/token|secret|authorization/i);
  });

  it('is "empty" before anything has run', async () => {
    const { buildDashboardState } = await import('../src/index.js');
    const c = cli();
    expect(buildDashboardState({ dir: c.cwd, dbPath: join(c.cwd, 'none.db') }).mode).toBe('empty');
  });
});
