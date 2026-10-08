import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardStateSchema } from '@exitos/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboardServer, type DashboardServer } from '../src/index.js';
import { makeCli } from './harness.js';

let dir: string;
let webDir: string;
let stateDir: string;
let server: DashboardServer;

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

function get(
  path: string,
  options: { method?: string; host?: string } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method: options.method ?? 'GET',
        headers: options.host === undefined ? {} : { Host: options.host },
      },
      (res) => {
        let body = '';
        res.on('data', (d: Buffer) => (body += d.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Send a raw request line so the client cannot normalise `..` away for us. */
function raw(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(server.port, '127.0.0.1');
    let data = '';
    socket.on('data', (d: Buffer) => (data += d.toString()));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`,
    );
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'exitos-server-'));
  const cli = makeCli({ cwd: dir });
  await cli.run(['demo', '--json']);
  stateDir = join(dir, '.exitos', 'demo');
  webDir = join(dir, 'web');
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(
    join(webDir, 'index.html'),
    '<!doctype html><title>ExitOS test</title><script type="module" src="/assets/app-abcdef12.js"></script>',
  );
  writeFileSync(join(webDir, 'assets', 'app-abcdef12.js'), 'console.log("ok")');
  writeFileSync(join(dir, 'secret.txt'), 'TOP SECRET OUTSIDE THE WEB ROOT');
  server = await startDashboardServer({
    location: { dir: stateDir, dbPath: join(stateDir, 'state.db') },
    webDir,
    port: 0,
  });
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('dashboard server', () => {
  it('serves the app with a strict content-security-policy and no framing', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('ExitOS test');
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  it('binds to loopback only', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('serves the state document, validated against the schema, uncached', async () => {
    const r = await get('/api/state');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const state = DashboardStateSchema.parse(JSON.parse(r.body));
    expect(state.mode).toBe('demo');
    expect(state.plan?.summary.actions.total).toBe(175);
    expect(state.report?.state).toBe('verified');
    // No credential-shaped content in anything the browser can read.
    expect(r.body).not.toMatch(/ntn_|pk_\d|bearer |authorization/i);
  });

  it('rejects requests whose Host header is not its own (DNS-rebinding defence)', async () => {
    for (const host of [
      'evil.example.com',
      `evil.example.com:${server.port}`,
      '127.0.0.1',
      'localhost:1',
    ]) {
      expect((await get('/api/state', { host })).status).toBe(421);
    }
    expect((await get('/api/state', { host: `localhost:${server.port}` })).status).toBe(200);
  });

  it('is strictly read-only: every method but GET/HEAD is refused', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const r = await get('/api/state', { method });
      expect(r.status, method).toBe(405);
      expect(r.headers.allow).toBe('GET, HEAD');
    }
  });

  it('does not modify the state database', async () => {
    const db = join(stateDir, 'state.db');
    const before = sha(db);
    for (let i = 0; i < 5; i++) await get('/api/state');
    expect(sha(db)).toBe(before);
  });

  it('never serves files outside the web root', async () => {
    const attempts = [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/assets/../../secret.txt',
      '/..\\secret.txt',
      '/%00',
      '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    ];
    for (const path of attempts) {
      const response = await raw(path);
      expect(response, path).not.toContain('TOP SECRET');
    }
  });

  it('single-page fallback for routes, real 404s for missing assets, no directory listings', async () => {
    expect((await get('/some/client/route')).body).toContain('ExitOS test');
    expect((await get('/assets/missing-12345678.js')).status).toBe(404);
    expect((await get('/assets')).body).toContain('ExitOS test'); // a directory serves the app, not a listing
    expect((await get('/api/unknown')).status).toBe(404);
  });

  it('fingerprinted assets are cached immutably, the page is not', async () => {
    expect((await get('/assets/app-abcdef12.js')).headers['cache-control']).toContain('immutable');
    expect((await get('/')).headers['cache-control']).toBe('no-cache');
  });

  it('refuses to start when the dashboard has not been built', async () => {
    await expect(
      startDashboardServer({
        location: { dir: stateDir, dbPath: join(stateDir, 'state.db') },
        webDir: join(dir, 'nowhere'),
        port: 0,
      }),
    ).rejects.toThrow(/has not been built/);
  });

  it('reports "empty" when there is no state yet', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'exitos-empty-'));
    const s2 = await startDashboardServer({
      location: { dir: empty, dbPath: join(empty, 'state.db') },
      webDir,
      port: 0,
    });
    const res = await new Promise<string>((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port: s2.port, path: '/api/state' }, (r) => {
        let b = '';
        r.on('data', (d: Buffer) => (b += d.toString()));
        r.on('end', () => resolve(b));
      })
        .on('error', reject)
        .end();
    });
    expect(DashboardStateSchema.parse(JSON.parse(res)).mode).toBe('empty');
    await s2.close();
    rmSync(empty, { recursive: true, force: true });
  });
});
