import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_NODE,
  isSupportedNode,
  nodeInstallHint,
  unsupportedNodeMessage,
} from '../src/runtime/node-version.js';
import { copyCommand, createEnvFileCommand, setEnvCommand } from '../src/runtime/platform.js';
import { makeCli, type TestCli } from './harness.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const NOTION = `ntn_${'Z'.repeat(40)}`;
const CLICKUP = `pk_123456_${'Y'.repeat(30)}`;

const clis: TestCli[] = [];
const cli = (options: Parameters<typeof makeCli>[0] = {}): TestCli => {
  const c = makeCli(options);
  clis.push(c);
  return c;
};
afterEach(() => {
  for (const c of clis.splice(0)) c.cleanup();
});

describe('Node.js version guard', () => {
  it('accepts 22.13 and newer, rejects anything older', () => {
    for (const ok of ['22.13.0', '22.13.1', '22.20.0', '23.0.0', '24.1.0', '26.0.0']) {
      expect(isSupportedNode(ok), ok).toBe(true);
    }
    for (const bad of ['22.12.9', '22.0.0', '20.19.0', '18.20.4', '21.7.3', 'nonsense', '']) {
      expect(isSupportedNode(bad), bad).toBe(false);
    }
  });

  it('tells people how to fix it on their own platform', () => {
    expect(nodeInstallHint('win32')).toContain('winget install');
    expect(nodeInstallHint('darwin')).toContain('brew install node');
    expect(nodeInstallHint('linux')).toContain('nvm install');
    const message = unsupportedNodeMessage('20.1.0', 'win32');
    expect(message).toContain('22.13');
    expect(message).toContain('20.1.0');
    expect(message).toContain('node --version');
  });

  it('the launcher script and the CLI agree on the minimum', () => {
    const launcher = readFileSync(join(root, 'scripts/exitos.mjs'), 'utf8');
    const match = /const MIN = \[(\d+), (\d+)\]/.exec(launcher);
    expect(match).not.toBeNull();
    expect([Number(match?.[1]), Number(match?.[2])]).toEqual([MIN_NODE.major, MIN_NODE.minor]);
  });
});

describe('the pnpm launcher (scripts/exitos.mjs)', () => {
  /** A throw-away copy of the repo layout: scripts/exitos.mjs and, optionally, a fake built CLI. */
  function layout(withBuild: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), 'exitos-launcher-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(join(root, 'scripts/exitos.mjs'), join(dir, 'scripts/exitos.mjs'));
    if (withBuild) {
      mkdirSync(join(dir, 'apps/cli/dist'), { recursive: true });
      writeFileSync(
        join(dir, 'apps/cli/dist/bin.js'),
        "console.log('real cli ran with', process.argv.slice(2).join(' '));\n",
      );
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    }
    return dir;
  }

  it('before `pnpm build`: explains what to do instead of crashing', () => {
    const dir = layout(false);
    try {
      const run = spawnSync(process.execPath, [join(dir, 'scripts/exitos.mjs'), 'demo'], {
        encoding: 'utf8',
      });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('has not been built yet');
      expect(run.stderr).toContain('pnpm build');
      expect(run.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('after the build: hands over to the real CLI with the same arguments', () => {
    const dir = layout(true);
    try {
      const run = spawnSync(
        process.execPath,
        [join(dir, 'scripts/exitos.mjs'), 'plan', 'notion', 'clickup'],
        {
          encoding: 'utf8',
        },
      );
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('real cli ran with plan notion clickup');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('platform-aware hints', () => {
  it('never tells a Windows user to run cp or chmod', () => {
    const win = { platform: 'win32' } as const;
    const posix = { platform: 'linux' } as const;
    expect(copyCommand(win, 'a.yaml', 'b.yaml')).toBe('Copy-Item a.yaml b.yaml');
    expect(createEnvFileCommand(win)).toBe('Copy-Item .env.example .env');
    expect(setEnvCommand(win, 'HTTPS_PROXY', 'http://p:8080')).toBe(
      '$env:HTTPS_PROXY = "http://p:8080"',
    );
    expect(copyCommand(posix, 'a.yaml', 'b.yaml')).toBe('cp a.yaml b.yaml');
    expect(createEnvFileCommand(posix)).toBe('cp .env.example .env && chmod 600 .env');
    expect(setEnvCommand(posix, 'HTTPS_PROXY', 'http://p:8080')).toBe(
      'export HTTPS_PROXY=http://p:8080',
    );
  });
});

describe('configuration problems read like guidance, not like a crash', () => {
  const env = { NOTION_TOKEN: NOTION, CLICKUP_API_TOKEN: CLICKUP };

  it('plan without --config and without ./migration.yaml says what to create', async () => {
    const c = cli({ env });
    expect(await c.run(['plan', 'notion', 'clickup'])).toBe(2);
    const text = c.captured.errText();
    expect(text).toContain('./migration.yaml does not exist');
    expect(text).toContain('cp migration.example.yaml migration.yaml');
    expect(text).toContain('doctor --live');
    expect(text).not.toContain('required option');
  });

  it('on Windows the same message uses PowerShell', async () => {
    const c = cli({ env, platform: 'win32' });
    expect(await c.run(['plan', 'notion', 'clickup'])).toBe(2);
    expect(c.captured.errText()).toContain('Copy-Item migration.example.yaml migration.yaml');
    expect(c.captured.errText()).not.toContain('cp migration.example.yaml');
  });

  it('uses ./migration.yaml by itself and reports EVERY problem in it at once', async () => {
    const c = cli({ env });
    writeFileSync(
      join(c.cwd, 'migration.yaml'),
      [
        'version: 1',
        'source:',
        '  type: notion',
        '  dataSources: [{ id: "not-a-uuid" }]',
        'destination:',
        '  type: clickup',
        '  workspaceId: "123"',
        '  lists: []',
        '  surprise: true',
        '',
      ].join('\n'),
    );
    expect(await c.run(['plan', 'notion', 'clickup'])).toBe(2);
    const text = c.captured.errText();
    expect(text).toContain('Using ./migration.yaml');
    expect(text).toContain('2 problems');
    expect(text).toContain('source.dataSources[0].id');
    expect(text).toContain('Unrecognized key');
    // A user mistake must never look like an internal bug.
    expect(text).not.toContain('Unexpected error');
    expect(text).not.toContain('"code"');
    expect(text).not.toContain('please report it');
  });

  it('a missing credential says where to get one and how to check the setup', async () => {
    const c = cli({ env: {} });
    expect(await c.run(['inspect', 'notion'])).toBe(2);
    const text = c.captured.errText();
    expect(text).toContain('Missing NOTION_TOKEN');
    expect(text).toContain('https://developers.notion.com/guides/get-started/internal-connections');
    expect(text).toContain('doctor --live');
  });
});

describe('exitos doctor', () => {
  const live = { NOTION_TOKEN: NOTION, CLICKUP_API_TOKEN: CLICKUP };

  it('on a clean machine it is calm: the offline demo needs nothing, so exit 0', async () => {
    const c = cli();
    expect(await c.run(['doctor'])).toBe(0);
    const text = c.captured.text();
    expect(text).toContain('Node.js');
    expect(text).toContain('node:sqlite works');
    expect(text).toContain('only needed for a real migration');
    expect(text).toContain('Ready.');
    expect(text).toContain('exitos demo');
  });

  it('--live treats missing tokens and config as problems and says how to fix each', async () => {
    const c = cli();
    expect(await c.run(['doctor', '--live'])).toBe(2);
    const text = c.captured.text();
    expect(text).toMatch(/✖ NOTION_TOKEN\s+not set/);
    expect(text).toMatch(/✖ CLICKUP_API_TOKEN\s+not set/);
    expect(text).toMatch(/✖ Migration config\s+migration.yaml not found/);
    expect(text).toContain('https://developers.notion.com/guides/get-started/internal-connections');
    expect(text).toContain('https://developer.clickup.com/docs/authentication');
    expect(text).toContain('3 problem(s) to fix');
    expect(text).toContain('The offline demo needs none of this');
  });

  it('shows Windows commands on Windows', async () => {
    const c = cli({ platform: 'win32' });
    await c.run(['doctor', '--live']);
    const text = c.captured.text();
    expect(text).toContain('Copy-Item .env.example .env');
    expect(text).not.toContain('chmod');
  });

  it('never prints a token, only whether it is set and looks right', async () => {
    const c = cli({ env: live });
    expect(await c.run(['doctor', '--json'])).toBe(0);
    const out = c.captured.text();
    expect(out).not.toContain(NOTION);
    expect(out).not.toContain(CLICKUP);
    const parsed = JSON.parse(out) as {
      ok: boolean;
      checks: Array<{ id: string; status: string; detail: string }>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.find((x) => x.id === 'notion-token')).toMatchObject({
      status: 'ok',
      detail: 'set (ntn_…)',
    });
    expect(parsed.checks.find((x) => x.id === 'clickup-token')).toMatchObject({
      status: 'ok',
      detail: 'set (pk_…)',
    });
  });

  it('warns about a token with an unexpected prefix', async () => {
    const c = cli({ env: { NOTION_TOKEN: 'totally-wrong-value-123' } });
    await c.run(['doctor']);
    expect(c.captured.text()).toMatch(
      /! NOTION_TOKEN\s+set, but it does not start with "ntn_" or "secret_"/,
    );
    expect(c.captured.text()).not.toContain('totally-wrong-value-123');
  });

  it('checks the proxy settings and never echoes proxy credentials', async () => {
    const good = cli({
      env: { HTTPS_PROXY: 'http://svc:SuperSecret@proxy.corp:3128', NO_PROXY: 'localhost,.corp' },
    });
    expect(await good.run(['doctor'])).toBe(0);
    expect(good.captured.text()).toContain('http://proxy.corp:3128');
    expect(good.captured.text()).toContain('NO_PROXY: localhost, .corp');
    expect(good.captured.text()).not.toContain('SuperSecret');

    const bad = cli({ env: { HTTPS_PROXY: 'socks5://svc:SuperSecret@proxy.corp:1080' } });
    expect(await bad.run(['doctor'])).toBe(2);
    expect(bad.captured.text()).toContain('HTTPS_PROXY must start with http:// or https://');
    expect(bad.captured.text()).not.toContain('SuperSecret');
  });

  it('checks that NODE_EXTRA_CA_CERTS points at a readable file', async () => {
    const c = cli();
    const pem = join(c.cwd, 'corp-ca.pem');
    writeFileSync(pem, '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n');
    const ok = cli({ cwd: c.cwd, env: { NODE_EXTRA_CA_CERTS: pem } });
    expect(await ok.run(['doctor'])).toBe(0);
    expect(ok.captured.text()).toMatch(/✔ Company CA certificate/);

    const missing = cli({ env: { NODE_EXTRA_CA_CERTS: '/no/such/file.pem' } });
    expect(await missing.run(['doctor'])).toBe(2);
    expect(missing.captured.text()).toContain('cannot be read');
  });

  it.skipIf(process.platform === 'win32')(
    'warns when .env is readable by other users',
    async () => {
      const c = cli();
      const file = join(c.cwd, '.env');
      writeFileSync(file, 'NOTION_TOKEN=x\n');
      chmodSync(file, 0o644);
      await c.run(['doctor']);
      expect(c.captured.text()).toMatch(/! \.env file\s+readable by other users \(mode 644\)/);
      chmodSync(file, 0o600);
      const again = cli({ cwd: c.cwd });
      await again.run(['doctor']);
      expect(again.captured.text()).toMatch(/✔ \.env file\s+found and private/);
    },
  );

  it('validates a migration config offline, with every problem listed', async () => {
    const good = cli();
    writeFileSync(join(good.cwd, 'migration.yaml'), DEMO_MIGRATION_YAML);
    expect(await good.run(['doctor', '--config', 'migration.yaml'])).toBe(0);
    expect(good.captured.text()).toMatch(
      /✔ Migration config\s+migration.yaml: notion → clickup, valid/,
    );

    const bad = cli();
    writeFileSync(
      join(bad.cwd, 'broken.yaml'),
      'version: 1\nsource:\n  type: notion\n  dataSources: [{ id: "nope" }]\ndestination:\n  type: clickup\n  workspaceId: "1"\n  lists: []\n  extra: 1\n',
    );
    expect(await bad.run(['doctor', '--config', 'broken.yaml'])).toBe(2);
    expect(bad.captured.text()).toContain('source.dataSources[0].id');
    expect(bad.captured.text()).toContain('Unrecognized key');
  });

  it('makes NO network request unless --online is given', async () => {
    const notion = createFakeNotionApi(buildDemoNotionFixture());
    const clickup = createFakeClickUpApi(buildDemoClickUpState());
    const c = cli({
      env: live,
      overrides: { notionFetch: notion.fetch, clickupFetch: clickup.fetch },
    });
    expect(await c.run(['doctor', '--live'])).toBe(2); // no config yet, but that is not what we assert
    expect(notion.requests).toHaveLength(0);
    expect(clickup.requests).toHaveLength(0);
  });

  it('--online proves both tokens work with read-only calls only', async () => {
    const notion = createFakeNotionApi(buildDemoNotionFixture());
    const clickup = createFakeClickUpApi(buildDemoClickUpState());
    const c = cli({
      env: live,
      overrides: { notionFetch: notion.fetch, clickupFetch: clickup.fetch },
    });
    expect(await c.run(['doctor', '--online'])).toBe(0);
    const text = c.captured.text();
    expect(text).toMatch(
      /✔ Notion API\s+reachable, token accepted: workspace "Acme Robotics \(synthetic demo\)"/,
    );
    expect(text).toMatch(/✔ ClickUp API\s+reachable, token accepted: \d+ Workspace\(s\) visible/);
    expect(notion.requests.length).toBeGreaterThan(0);
    expect(clickup.requests.length).toBeGreaterThan(0);
    const writes = [...notion.requests, ...clickup.requests].filter(
      (r) =>
        !['GET', 'POST'].includes(r.method) ||
        (r.method === 'POST' && /\/(task|doc|page)/.test(r.path) && !/search|query/.test(r.path)),
    );
    expect(writes).toEqual([]);
  });

  it('--online reports a rejected token as a problem, with the reason', async () => {
    const reject = (): Promise<Response> =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            object: 'error',
            status: 401,
            code: 'unauthorized',
            message: 'API token is invalid.',
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    const c = cli({ env: live, overrides: { notionFetch: reject, clickupFetch: reject } });
    expect(await c.run(['doctor', '--online'])).toBe(2);
    expect(c.captured.text()).toMatch(/✖ Notion API/);
    expect(c.captured.text()).toContain('401');
    expect(c.captured.text()).not.toContain(NOTION);
  });

  it('skips an API whose token is missing instead of failing twice', async () => {
    const c = cli({
      env: { NOTION_TOKEN: NOTION },
      overrides: { notionFetch: createFakeNotionApi(buildDemoNotionFixture()).fetch },
    });
    await c.run(['doctor', '--online']);
    expect(c.captured.text()).toMatch(/! ClickUp API\s+skipped: CLICKUP_API_TOKEN is not set/);
  });
});

describe('one vocabulary for people, stable names for programs', () => {
  it('the demo speaks Preserved / Transformed / Requires review / Unsupported, while JSON keeps its keys', async () => {
    const c = cli();
    expect(await c.run(['demo', '--no-chaos'])).toBe(0);
    const text = c.captured.text();
    expect(text).toContain('✔ preserved');
    expect(text).toContain('↻ transformed');
    expect(text).toContain('⚠ requires review');
    expect(text).toContain('✖ unsupported');
    expect(text).toMatch(/\d+ preserved\s+↻ \d+ transformed\s+⚠ \d+ require review/);
    expect(text).not.toContain('⚠ lossy');
    expect(text).not.toContain('✔ supported');

    const json = cli({ cwd: c.cwd });
    expect(await json.run(['report', '--demo', '--json'])).toBe(0);
    const report = JSON.parse(json.captured.text()) as {
      plan: { summary: { items: Record<string, number> } };
    };
    expect(Object.keys(report.plan.summary.items).sort()).toEqual([
      'failed',
      'lossy',
      'skipped',
      'supported',
      'transformed',
      'unsupported',
    ]);
  });
});

describe('the demo adapts to the terminal width', () => {
  it('on a narrow terminal nothing is cut off with an ellipsis in the closing box', async () => {
    const c = cli({ columns: 70 });
    expect(await c.run(['demo', '--no-chaos'])).toBe(0);
    const lines = c.captured.text().split('\n');
    const start = lines.findIndex((l) => l.includes('That was an offline demo'));
    const box = lines.slice(start - 1, start + 16);
    expect(box.join('\n')).toContain('exitos doctor --live');
    expect(box.join('\n')).toContain('ready for a real migration? checks your setup');
    expect(box.join('\n')).not.toContain('…');
    for (const line of box) expect([...line].length).toBeLessThanOrEqual(70);
  });
});
