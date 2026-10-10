import type { Clock, FetchLike } from '@exitos/shared';
import { createStyle, shouldUseColor, type Style } from './ui/style.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
  columns: number;
  /** Ask a question on a TTY; resolves to the typed line. */
  prompt(question: string): Promise<string>;
}

export interface CliContext {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  io: CliIo;
  style: Style;
  width: number;
  /** `process.platform`; a field so platform-specific hints can be tested. */
  platform: NodeJS.Platform;
  /** Test seams — never set by the real binary. */
  overrides?: {
    clock?: Clock;
    notionFetch?: FetchLike;
    clickupFetch?: FetchLike;
    /** Directory containing the built dashboard. */
    webDir?: string;
  };
  signal?: AbortSignal;
}

/** `COLUMNS` is honoured when output is piped (a TTY reports its own width). */
function columnsFromEnv(value: string | undefined): number | undefined {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n >= 40 && n <= 400 ? n : undefined;
}

export function createNodeIo(): CliIo {
  return {
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
    stdoutIsTTY: process.stdout.isTTY === true,
    stdinIsTTY: process.stdin.isTTY === true,
    columns: process.stdout.columns ?? columnsFromEnv(process.env.COLUMNS) ?? 100,
    async prompt(question) {
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
  };
}

export function createContext(input: {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  io: CliIo;
  noColor?: boolean | undefined;
  overrides?: CliContext['overrides'];
  signal?: AbortSignal | undefined;
  platform?: NodeJS.Platform | undefined;
}): CliContext {
  const color = shouldUseColor({
    noColorFlag: input.noColor,
    env: input.env,
    isTTY: input.io.stdoutIsTTY,
  });
  return {
    cwd: input.cwd,
    env: input.env,
    io: input.io,
    style: createStyle(color),
    width: Math.max(60, Math.min(input.io.columns, 120)),
    platform: input.platform ?? process.platform,
    ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
}

export const println = (ctx: CliContext, lines: string | readonly string[] = ''): void => {
  const text = typeof lines === 'string' ? [lines] : lines;
  ctx.io.stdout(text.map((l) => `${l}\n`).join(''));
};

export const eprintln = (ctx: CliContext, line: string): void => ctx.io.stderr(`${line}\n`);
