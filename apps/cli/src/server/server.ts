import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { StateLocation } from '../runtime/state.js';
import { buildDashboardState } from './dashboard-state.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/**
 * Strict policy: the page may load only its own scripts and styles and talk only to this server.
 * Nothing in the dashboard needs inline script, remote fonts, frames or form posts.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export interface DashboardServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface DashboardOptions {
  location: StateLocation;
  webDir: string;
  /** 0 picks a free port. */
  port: number;
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

/**
 * A tiny, READ-ONLY local web server for the dashboard.
 *  - binds 127.0.0.1 only;
 *  - rejects any Host header other than this server's own (defeats DNS-rebinding);
 *  - accepts only GET/HEAD — there is no endpoint that changes anything;
 *  - serves static files from one directory with path-traversal protection;
 *  - exposes one JSON document built from the state database. No credential is in that database,
 *    and none is ever read by this process.
 */
export async function startDashboardServer(options: DashboardOptions): Promise<DashboardServer> {
  const webRoot = resolve(options.webDir);
  const index = join(webRoot, 'index.html');
  if (!existsSync(index)) {
    throw new Error(
      `The dashboard has not been built (missing ${index}). Run \`pnpm build\` first.`,
    );
  }
  let allowedHosts = new Set<string>();

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      const host = (req.headers.host ?? '').toLowerCase();
      if (!allowedHosts.has(host))
        return send(res, 421, 'Misdirected request: unexpected Host header.', {
          'Content-Type': 'text/plain',
        });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'Read-only server.', {
          Allow: 'GET, HEAD',
          'Content-Type': 'text/plain',
        });
      }
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/api/state') {
        const body = JSON.stringify(buildDashboardState(options.location));
        return send(res, 200, req.method === 'HEAD' ? '' : body, {
          'Content-Type': TYPES['.json'] as string,
          'Cache-Control': 'no-store',
        });
      }
      if (url.pathname === '/api/health') {
        return send(res, 200, '{"ok":true}', {
          'Content-Type': TYPES['.json'] as string,
          'Cache-Control': 'no-store',
        });
      }
      if (url.pathname.startsWith('/api/'))
        return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });

      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname);
      } catch {
        return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });
      }
      if (rel.includes('\0'))
        return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' });
      let file = normalize(join(webRoot, rel));
      if (file !== webRoot && !file.startsWith(webRoot + sep))
        return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
      if (!existsSync(file) || statSync(file).isDirectory()) {
        // Single-page app: unknown extension-less paths get index.html; missing assets are real 404s.
        if (extname(rel) !== '')
          return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        file = index;
      }
      const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const immutable = /[/\\]assets[/\\]/.test(file) && /-[A-Za-z0-9_-]{8,}\./.test(file);
      send(res, 200, req.method === 'HEAD' ? '' : readFileSync(file), {
        'Content-Type': type,
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    } catch {
      send(res, 500, 'Internal error', { 'Content-Type': 'text/plain' });
    }
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  const port = (server.address() as AddressInfo).port;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
