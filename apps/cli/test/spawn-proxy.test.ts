import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The real built CLI, started as a separate process with proxy variables, talking to a local proxy that
 * refuses every tunnel. No packet ever leaves the machine, yet it proves what an administrator needs:
 * the process honours HTTPS_PROXY, authenticates, explains the failure and leaks nothing.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = join(root, 'apps/cli/dist/bin.js');

const NOTION_TOKEN = `ntn_${'B'.repeat(40)}`;
const PROXY_PASSWORD = 'Sup3rSecretProxyPw';

let proxy: Server;
let port = 0;
const connects: string[] = [];
const credentials: string[] = [];
let workdir = '';

beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'exitos-proxy-'));
  proxy = createServer((_req, res) => res.end());
  proxy.on('connect', (req, socket: Socket) => {
    connects.push(req.url ?? '');
    const header = req.headers['proxy-authorization'];
    if (typeof header === 'string') credentials.push(header);
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  port = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    proxy.closeAllConnections();
    proxy.close(() => resolve());
  });
  rmSync(workdir, { recursive: true, force: true });
});

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
  seconds: number;
}

function run(args: string[], env: Record<string, string>): Promise<Outcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [bin, ...args, '--no-color'], {
      cwd: workdir,
      env: { PATH: process.env.PATH ?? '', HOME: workdir, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, seconds: (Date.now() - started) / 1000 });
    });
  });
}

describe('the real CLI behind a corporate proxy', () => {
  it('sends Notion traffic through HTTPS_PROXY, explains the refusal, and leaks no secret', async () => {
    connects.length = 0;
    credentials.length = 0;
    const result = await run(['inspect', 'notion'], {
      NOTION_TOKEN,
      HTTPS_PROXY: `http://svc-exitos:${PROXY_PASSWORD}@127.0.0.1:${port}`,
    });

    // It really went to the proxy, asking to tunnel to Notion on 443, and it authenticated.
    expect(connects.length).toBeGreaterThanOrEqual(1);
    expect(new Set(connects)).toEqual(new Set(['api.notion.com:443']));
    const expected = `Basic ${Buffer.from(`svc-exitos:${PROXY_PASSWORD}`).toString('base64')}`;
    expect(credentials).toContain(expected);

    // It failed cleanly with an actionable explanation.
    expect(result.code).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Proxy response (502)');
    expect(output).toContain('HTTPS_PROXY');

    // Neither the API token nor the proxy password appears anywhere.
    expect(output).not.toContain(NOTION_TOKEN);
    expect(output).not.toContain(PROXY_PASSWORD);

    // And the process ends by itself: pooled proxy connections do not keep it alive.
    expect(result.seconds).toBeLessThan(60);
  }, 100_000);

  it('rejects a malformed proxy setting up front, without echoing it', async () => {
    const result = await run(['inspect', 'notion'], {
      NOTION_TOKEN,
      HTTPS_PROXY: `socks5://svc:${PROXY_PASSWORD}@127.0.0.1:1080`,
    });
    expect(result.code).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('HTTPS_PROXY must start with http:// or https://');
    expect(output).not.toContain(PROXY_PASSWORD);
    expect(result.seconds).toBeLessThan(15);
  }, 30_000);
});
