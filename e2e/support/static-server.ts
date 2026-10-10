/**
 * A deliberately dumb static file server that behaves like GitHub Pages for the online demo:
 *   - the site lives under a SUB-PATH (`/EXITOS/`), so anything that assumed the site root breaks;
 *   - it sends NO security headers (Pages cannot), so the demo's `<meta>` CSP is the only policy;
 *   - GET/HEAD only, no directory listings, no single-page fallback: an unknown path is a 404;
 *   - it keeps a list of every path it was asked for, so tests can see what the page requested.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface StaticSite {
  /** e.g. `http://127.0.0.1:40123/EXITOS/` */
  url: string;
  /** Paths requested so far (path only, in order), including the ones that were 404. */
  requested: string[];
  close: () => Promise<void>;
}

export async function startStaticSite(root: string, prefix = '/EXITOS/'): Promise<StaticSite> {
  const base = resolve(root);
  const requested: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requested.push(url.pathname);
    const notFound = (): void => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(prefix)) return notFound();
    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      return notFound();
    }
    const file = normalize(join(base, relative === '' ? 'index.html' : relative));
    if (file !== base && !file.startsWith(base + sep)) return notFound();
    if (!existsSync(file) || statSync(file).isDirectory()) return notFound();
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${prefix}`,
    requested,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          done();
        });
        server.closeAllConnections();
      }),
  };
}
