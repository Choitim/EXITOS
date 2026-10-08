import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '@exitos/shared';
import {
  createNetworkFetch,
  describeProxy,
  isProxyBypassed,
  proxyConfigFromEnv,
  type NetworkFetch,
} from '../src/runtime/proxy.js';

const PASSWORD = 'hunter2-proxy-password';

interface TestProxy {
  url: string;
  /** Every request the proxy was asked to carry: "CONNECT host:port" or "GET http://…". */
  seen: string[];
  /** Proxy-Authorization headers it received. */
  auth: string[];
  close(): Promise<void>;
}

const servers: Server[] = [];
const networks: NetworkFetch[] = [];
const sockets = new Set<Socket>();

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** A loopback web server that answers every request with `{"ok":true}` and counts hits. */
async function startTarget(): Promise<{ port: number; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  return { port: await listen(server), hits };
}

/**
 * A real HTTP proxy: tunnels `CONNECT` requests to the requested host and forwards absolute-form
 * requests. `refuseConnect` makes it answer CONNECT with 502 so HTTPS targets never need a certificate.
 */
async function startProxy(options: { refuseConnect?: boolean } = {}): Promise<TestProxy> {
  const seen: string[] = [];
  const auth: string[] = [];
  const server = createServer((req, res) => {
    // Plain-HTTP forwarding (absolute-form request target).
    seen.push(`${req.method} ${req.url}`);
    const header = req.headers['proxy-authorization'];
    if (typeof header === 'string') auth.push(header);
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true,"via":"proxy"}');
  });
  server.on('connect', (req, clientSocket: Socket, head: Buffer) => {
    seen.push(`CONNECT ${req.url ?? ''}`);
    const header = req.headers['proxy-authorization'];
    if (typeof header === 'string') auth.push(header);
    if (options.refuseConnect === true) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const [host = '', port = '80'] = (req.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    auth,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function network(config: Parameters<typeof createNetworkFetch>[0]): NetworkFetch {
  const n = createNetworkFetch(config);
  networks.push(n);
  return n;
}

afterEach(async () => {
  await Promise.all(networks.splice(0).map((n) => n.close()));
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('proxyConfigFromEnv', () => {
  it('reads the standard variables and prefers upper-case over lower-case', () => {
    const cfg = proxyConfigFromEnv({
      HTTPS_PROXY: 'http://upper:1',
      https_proxy: 'http://lower:2',
      http_proxy: 'http://only-lower:3',
      NO_PROXY: ' Example.com , .internal ,10.0.0.1:8443 ',
    });
    expect(cfg.httpsProxy).toBe('http://upper:1');
    expect(cfg.httpProxy).toBe('http://only-lower:3');
    expect(cfg.noProxy).toEqual(['example.com', '.internal', '10.0.0.1:8443']);
  });

  it('treats empty and missing values as "no proxy"', () => {
    const cfg = proxyConfigFromEnv({ HTTPS_PROXY: '   ', HTTP_PROXY: '' });
    expect(cfg.httpsProxy).toBeUndefined();
    expect(cfg.httpProxy).toBeUndefined();
    expect(cfg.noProxy).toEqual([]);
  });
});

describe('isProxyBypassed (NO_PROXY semantics)', () => {
  const bypass = (url: string, ...entries: string[]) => isProxyBypassed(new URL(url), entries);

  it('matches * against everything', () => {
    expect(bypass('https://api.notion.com/v1', '*')).toBe(true);
  });

  it('matches a bare domain and its subdomains, case-insensitively', () => {
    expect(bypass('https://api.notion.com/v1', 'notion.com')).toBe(true);
    expect(bypass('https://notion.com/', 'notion.com')).toBe(true);
    expect(bypass('https://API.Notion.COM/', 'notion.com')).toBe(true);
    expect(bypass('https://evilnotion.com/', 'notion.com')).toBe(false);
  });

  it('matches only subdomains for a leading dot or wildcard', () => {
    expect(bypass('https://api.notion.com/', '.notion.com')).toBe(true);
    expect(bypass('https://notion.com/', '.notion.com')).toBe(false);
    expect(bypass('https://api.notion.com/', '*.notion.com')).toBe(true);
    expect(bypass('https://notion.com/', '*.notion.com')).toBe(false);
  });

  it('honours an entry port, using the scheme default when the URL has none', () => {
    expect(bypass('https://host.test/', 'host.test:443')).toBe(true);
    expect(bypass('https://host.test/', 'host.test:8443')).toBe(false);
    expect(bypass('http://host.test:8080/', 'host.test:8080')).toBe(true);
    expect(bypass('http://host.test/', 'host.test:443')).toBe(false);
  });

  it('matches IP literals exactly and never treats CIDR notation as a range', () => {
    expect(bypass('http://127.0.0.1:9/', '127.0.0.1')).toBe(true);
    expect(bypass('http://[::1]:9/', '::1')).toBe(true);
    expect(bypass('http://10.1.2.3/', '10.0.0.0/8')).toBe(false);
  });

  it('does not bypass when the list is empty', () => {
    expect(isProxyBypassed(new URL('https://api.notion.com/'), [])).toBe(false);
  });
});

describe('createNetworkFetch', () => {
  it('without any proxy it is the plain global fetch and reports no proxies', async () => {
    const target = await startTarget();
    const n = network({ noProxy: [] });
    expect(n.proxies).toEqual([]);
    const res = await n.fetch(`http://127.0.0.1:${target.port}/direct`);
    expect(await res.json()).toEqual({ ok: true });
    expect(target.hits).toEqual(['GET /direct']);
  });

  it('routes requests through the proxy, authenticating without ever exposing the password', async () => {
    const target = await startTarget();
    const proxy = await startProxy();
    const url = new URL(proxy.url);
    url.username = 'svc-exitos';
    url.password = PASSWORD;
    const n = network({ httpProxy: url.href, noProxy: [] });

    const res = await n.fetch(`http://127.0.0.1:${target.port}/via-proxy`);
    expect(res.status).toBe(200);
    expect(proxy.seen).toHaveLength(1);
    expect(proxy.seen[0]).toMatch(
      new RegExp(
        `^(CONNECT 127\\.0\\.0\\.1:${target.port}|GET http://127\\.0\\.0\\.1:${target.port}/via-proxy)$`,
      ),
    );
    const expected = `Basic ${Buffer.from(`svc-exitos:${PASSWORD}`).toString('base64')}`;
    expect(proxy.auth).toContain(expected);

    // What ExitOS would print about the proxy must not contain the credentials.
    expect(n.proxies).toEqual([`http://127.0.0.1:${new URL(proxy.url).port}`]);
    expect(JSON.stringify(n.proxies)).not.toContain(PASSWORD);
    expect(describeProxy(url.href)).not.toContain(PASSWORD);
    expect(describeProxy(url.href)).not.toContain('svc-exitos');
  });

  it('bypasses the proxy for hosts matched by NO_PROXY', async () => {
    const target = await startTarget();
    const proxy = await startProxy();
    const n = network({ httpProxy: proxy.url, noProxy: ['127.0.0.1'] });
    const res = await n.fetch(`http://127.0.0.1:${target.port}/skip`);
    expect(await res.json()).toEqual({ ok: true });
    expect(target.hits).toEqual(['GET /skip']);
    expect(proxy.seen).toEqual([]);
  });

  it('picks the proxy by URL scheme: an https-only proxy is not used for http targets', async () => {
    const target = await startTarget();
    const proxy = await startProxy();
    const n = network({ httpsProxy: proxy.url, noProxy: [] });
    await n.fetch(`http://127.0.0.1:${target.port}/plain`);
    expect(target.hits).toEqual(['GET /plain']);
    expect(proxy.seen).toEqual([]);
  });

  it('tunnels https targets through CONNECT to host:443, and surfaces a refusal as an error without the password', async () => {
    const proxy = await startProxy({ refuseConnect: true });
    const url = new URL(proxy.url);
    url.username = 'svc-exitos';
    url.password = PASSWORD;
    const n = network({ httpsProxy: url.href, noProxy: [] });

    const error = await n.fetch('https://api.example.test/v1/users/me').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(proxy.seen).toEqual(['CONNECT api.example.test:443']);
    expect(String((error as Error).message)).not.toContain(PASSWORD);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(PASSWORD);
  });

  it('rejects an invalid proxy URL without echoing what was typed', () => {
    const bad = `not a url with ${PASSWORD}`;
    const thrown = (() => {
      try {
        createNetworkFetch({ httpsProxy: bad, noProxy: [] });
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as Error).message).toContain('HTTPS_PROXY');
    expect((thrown as Error).message).not.toContain(PASSWORD);
  });

  it('rejects proxy schemes other than http and https', () => {
    expect(() =>
      createNetworkFetch({ httpProxy: 'socks5://proxy.example.com:1080', noProxy: [] }),
    ).toThrow(/must start with http:\/\/ or https:\/\//);
  });
});
