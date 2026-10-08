import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike } from '@exitos/shared';
import { createContext, runCli, type CliContext, type CliIo } from '../src/index.js';

export interface Captured {
  out: string[];
  err: string[];
  text(): string;
  errText(): string;
}

export interface TestCli {
  ctx: CliContext;
  captured: Captured;
  cwd: string;
  run(args: string[]): Promise<number>;
  cleanup(): void;
}

export const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex -- stripping ANSI escape sequences
  s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

export function makeCli(
  options: {
    env?: Record<string, string>;
    tty?: boolean;
    answers?: string[];
    overrides?: CliContext['overrides'];
    cwd?: string;
    color?: boolean;
  } = {},
): TestCli {
  const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), 'exitos-cli-'));
  const out: string[] = [];
  const err: string[] = [];
  const answers = [...(options.answers ?? [])];
  const io: CliIo = {
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    stdoutIsTTY: options.tty === true,
    stdinIsTTY: options.tty === true,
    columns: 110,
    prompt: async () => answers.shift() ?? '',
  };
  const ctx = createContext({
    cwd,
    env: { ...options.env },
    io,
    noColor: options.color !== true,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  return {
    ctx,
    cwd,
    captured: {
      out,
      err,
      text: () => stripAnsi(out.join('')),
      errText: () => stripAnsi(err.join('')),
    },
    run: (args) => runCli(args, ctx),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

/** Serve a fake API (a fetch function) over real loopback HTTP, so the whole HTTP stack is exercised. */
export async function serveFake(
  fakeFetch: FetchLike,
): Promise<{ url: string; port: number; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const host = req.headers.host ?? '127.0.0.1';
      fakeFetch(`http://${host}${req.url ?? '/'}`, {
        method: req.method ?? 'GET',
        headers,
        ...(body === '' ? {} : { body }),
      }).then(
        async (response) => {
          const text = await response.text();
          const out: Record<string, string> = {};
          response.headers.forEach((v, k) => (out[k] = v));
          res.writeHead(response.status, out);
          res.end(text);
        },
        (error: unknown) => {
          // A fake that "drops the connection" must look like a dropped connection to the client.
          res.destroy(error instanceof Error ? error : undefined);
        },
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
