import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeClickUpApi } from '@exitos/connector-clickup/testing';
import { createFakeNotionApi } from '@exitos/connector-notion/testing';
import {
  DEMO_MIGRATION_YAML,
  buildDemoClickUpState,
  buildDemoNotionFixture,
} from '@exitos/demo-workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveFake } from './harness.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = join(root, 'apps/cli/dist/bin.js');
const blocker = fileURLToPath(new URL('./block-network.cjs', import.meta.url));

const NOTION_TOKEN = 'ntn_spawntestspawntestspawntest1234';
const CLICKUP_TOKEN = 'pk_424242_SPAWNTESTSPAWNTESTSPAWN';

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function exec(
  args: string[],
  options: { cwd: string; env?: Record<string, string>; preload?: string[]; timeoutMs?: number },
): Promise<Result> {
  return new Promise((resolve) => {
    const nodeArgs = [...(options.preload ?? []).flatMap((p) => ['--require', p]), bin, ...args];
    const child = spawn(process.execPath, nodeArgs, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? '', HOME: options.cwd, NO_COLOR: '1', ...options.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

beforeAll(() => {
  // Make sure the binary is current. Incremental, so this is fast when nothing changed.
  execFileSync('pnpm', ['exec', 'tsc', '-b'], { cwd: root, stdio: 'ignore' });
}, 180_000);

describe('the offline demo makes ZERO network attempts (network blocked at the Node level)', () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'exitos-spawn-'));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('exitos demo completes, verified, in a process where any socket/DNS/fetch call kills it', async () => {
    const cwd = tmp();
    const started = Date.now();
    const r = await exec(['demo'], { cwd, preload: [blocker] });
    expect(r.stderr).not.toContain('NETWORK ACCESS ATTEMPTED');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OFFLINE DEMO');
    expect(r.stdout).toContain('175 verified · 0 mismatched · 0 missing · 0 unverified');
    expect(Date.now() - started).toBeLessThan(20_000); // "under a minute" with a wide margin
  });

  it('the blocker really does stop network access (control experiment)', async () => {
    const cwd = tmp();
    writeFileSync(join(cwd, 'probe.cjs'), "fetch('https://example.com').catch(()=>{});");
    const probe = await new Promise<Result>((resolve) => {
      const child = spawn(process.execPath, ['--require', blocker, join(cwd, 'probe.cjs')], {
        cwd,
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('close', (code) => resolve({ code, stdout: '', stderr }));
    });
    expect(probe.code).toBe(99);
    expect(probe.stderr).toContain('NETWORK ACCESS ATTEMPTED');
  });

  it('inspect, status, report and connectors also work offline', async () => {
    const cwd = tmp();
    await exec(['demo', '--no-chaos'], { cwd, preload: [blocker] });
    for (const args of [
      ['status', '--demo'],
      ['report', '--demo', '--format', 'markdown'],
      ['verify', '--demo'],
      ['connectors'],
      ['inspect', 'notion', '--demo'],
    ]) {
      const r = await exec(args, { cwd, preload: [blocker] });
      expect(r.stderr, args.join(' ')).not.toContain('NETWORK ACCESS ATTEMPTED');
      expect(r.code, `${args.join(' ')}\n${r.stderr}`).toBe(0);
    }
  });

  it('leaves no files outside .exitos/demo', async () => {
    const cwd = tmp();
    await exec(['demo'], { cwd });
    expect(readdirSync(cwd).sort()).toEqual(['.exitos']);
    expect(readdirSync(join(cwd, '.exitos'))).toEqual(['demo']);
  });
});

describe('live path over real HTTP (loopback mock servers) — mode "live", real fetch, real SDK', () => {
  let notionServer: Awaited<ReturnType<typeof serveFake>>;
  let clickupServer: Awaited<ReturnType<typeof serveFake>>;
  let notionFake: ReturnType<typeof createFakeNotionApi>;
  let clickupFake: ReturnType<typeof createFakeClickUpApi>;
  let cwd: string;
  let env: Record<string, string>;

  beforeAll(async () => {
    notionFake = createFakeNotionApi(buildDemoNotionFixture(), { validTokens: [NOTION_TOKEN] });
    clickupFake = createFakeClickUpApi(buildDemoClickUpState(), {
      rateLimitPerMinute: 0,
      validTokens: [CLICKUP_TOKEN],
    });
    notionServer = await serveFake(notionFake.fetch);
    clickupServer = await serveFake(clickupFake.fetch);
    cwd = mkdtempSync(join(tmpdir(), 'exitos-live-'));
    env = {
      NOTION_TOKEN,
      CLICKUP_API_TOKEN: CLICKUP_TOKEN,
      NOTION_API_BASE_URL: notionServer.url,
      CLICKUP_API_BASE_URL: `${clickupServer.url}/api`,
    };
    // Same demo configuration, with request budgets high enough that the test does not wait.
    const yaml = DEMO_MIGRATION_YAML.replace(
      'type: notion\n',
      'type: notion\n  requestsPerMinute: 600\n',
    ).replace('type: clickup\n', 'type: clickup\n  requestsPerMinute: 6000\n');
    writeFileSync(join(cwd, 'migration.yaml'), yaml);
  });
  afterAll(async () => {
    await notionServer.close();
    await clickupServer.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('refuses to start without credentials, naming the variable', async () => {
    const r = await exec(['plan', 'notion', 'clickup', '--config', 'migration.yaml'], {
      cwd,
      env: { NOTION_API_BASE_URL: notionServer.url },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('NOTION_TOKEN');
    expect(r.stderr).toContain('.env.example');
  });

  it('refuses a base-URL override that points anywhere but loopback or the real host', async () => {
    const r = await exec(['plan', 'notion', 'clickup', '--config', 'migration.yaml'], {
      cwd,
      env: { ...env, NOTION_API_BASE_URL: 'https://evil.example.net' },
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Refusing API base URL override');
  });

  it('inspect → plan (read-only) → apply refused without approval → apply → verify → report', async () => {
    const inspect = await exec(['inspect', 'notion', '--config', 'migration.yaml'], { cwd, env });
    expect(inspect.code, inspect.stderr).toBe(0);
    expect(inspect.stdout).toContain('Product Roadmap');

    // ---- plan: read-only ----
    const notionBefore = notionFake.requests.length;
    const plan = await exec(['plan', 'notion', 'clickup', '--config', 'migration.yaml'], {
      cwd,
      env,
    });
    expect(plan.code, plan.stderr + plan.stdout).toBe(0);
    expect(plan.stdout).toMatch(/Requests so far: \d+ read · 0 write · 0 blocked/);
    expect(clickupFake.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
    expect(clickupFake.state.tasks).toHaveLength(1); // only the pre-existing task
    for (const r of notionFake.requests.slice(notionBefore)) {
      expect(r.method === 'GET' || r.path === '/v1/search' || r.path.endsWith('/query')).toBe(true);
    }
    const planFile = join(cwd, 'migration-plan.json');
    expect(statSync(planFile).mode & 0o077).toBe(0); // owner-only
    const planText = readFileSync(planFile, 'utf8');
    const planId = (/"planId": "(plan_[0-9a-f]{12})"/.exec(planText) ?? [])[1] as string;
    expect(planText).not.toContain(NOTION_TOKEN);
    expect(planText).not.toContain(CLICKUP_TOKEN);
    expect(planText).toContain('"mode": "live"');

    // ---- the server saw the credentials in headers, but they are nowhere on disk ----
    // ---- apply without approval is refused ----
    const refused = await exec(['apply', '--plan', 'migration-plan.json'], { cwd, env });
    expect(refused.code).toBe(5);
    expect(clickupFake.state.tasks).toHaveLength(1);

    // ---- apply with approval, with one reply dropped AFTER ClickUp committed ----
    clickupFake.fault({
      match: (r) =>
        r.method === 'POST' &&
        /\/task$/.test(r.path) &&
        (r.body as { name?: string }).name === 'Calibrate joint encoders',
      failAfterCommit: () => new TypeError('connection dropped'),
    });
    const apply = await exec(['apply', '--plan', 'migration-plan.json', '--approve', planId], {
      cwd,
      env,
      timeoutMs: 120_000,
    });
    expect(apply.code, apply.stderr + apply.stdout).toBe(0);
    expect(apply.stdout).toContain('APPLIED — NOT VERIFIED');
    expect(clickupFake.state.tasks).toHaveLength(159);
    const names = clickupFake.state.tasks.filter((t) => t.name === 'Calibrate joint encoders');
    expect(names).toHaveLength(1); // the dropped reply was reconciled, not re-sent
    expect(clickupFake.state.docs).toHaveLength(1);
    expect(clickupFake.state.pages).toHaveLength(5);
    // Only POSTs, only to the four allowed endpoints, and the source saw nothing but reads.
    const writes = clickupFake.requests.filter((r) => r.method !== 'GET');
    expect(writes.every((r) => r.method === 'POST')).toBe(true);
    expect(notionFake.requests.some((r) => ['PUT', 'PATCH', 'DELETE'].includes(r.method))).toBe(
      false,
    );

    // ---- an already-applied plan cannot be applied twice ----
    const again = await exec(['apply', '--plan', 'migration-plan.json', '--approve', planId], {
      cwd,
      env,
    });
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('already has run');
    expect(clickupFake.state.tasks).toHaveLength(159);

    // ---- verify ----
    const verify = await exec(['verify'], { cwd, env });
    expect(verify.code, verify.stderr + verify.stdout).toBe(0);
    expect(verify.stdout).toContain('175 verified');

    // ---- report ----
    const report = await exec(['report', '--format', 'markdown'], { cwd, env });
    expect(report.code).toBe(0);
    expect(report.stdout).toContain('VERIFIED');
    expect(report.stdout).toContain('## Not preserved');

    // ---- no credential on disk, anywhere ----
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(cwd);
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const bytes = readFileSync(file);
      expect(bytes.includes(NOTION_TOKEN), file).toBe(false);
      expect(bytes.includes(CLICKUP_TOKEN), file).toBe(false);
    }
    expect(existsSync(join(cwd, '.exitos', 'state.db'))).toBe(true);
  }, 180_000);

  it('.env is loaded, but real environment variables win', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exitos-env-'));
    writeFileSync(
      join(dir, '.env'),
      'NOTION_TOKEN=ntn_fromdotenvfromdotenvfromdotenv\nCLICKUP_API_TOKEN=pk_1_FROMDOTENVFROMDOTENV\n',
      { mode: 0o600 },
    );
    writeFileSync(join(dir, 'migration.yaml'), readFileSync(join(cwd, 'migration.yaml')));
    // A wrong token in the environment must beat the right one in .env → the server rejects it.
    const r = await exec(['plan', 'notion', 'clickup', '--config', 'migration.yaml'], {
      cwd: dir,
      env: { ...env, NOTION_TOKEN: 'ntn_wrongwrongwrongwrongwrong1234' },
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/unauthorized|invalid|revoked/i);
    expect(r.stderr).not.toContain('wrongwrong');
    rmSync(dir, { recursive: true, force: true });
  });
});
