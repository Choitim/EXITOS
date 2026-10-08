import { redactString } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Writes redacted lines to a sink (stderr by default). Data values are JSON-encoded and redacted. */
export function createLogger(
  level: LogLevel,
  sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Logger {
  const emit =
    (name: Exclude<LogLevel, 'silent'>) =>
    (message: string, data?: Record<string, unknown>): void => {
      if (ORDER[name] < ORDER[level]) return;
      const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
      sink(redactString(`[${name}] ${message}${suffix}`));
    };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}

export interface CapturedLog {
  level: Exclude<LogLevel, 'silent'>;
  message: string;
  data?: Record<string, unknown> | undefined;
}

/** In-memory logger for tests. */
export function createMemoryLogger(): Logger & { readonly lines: CapturedLog[] } {
  const lines: CapturedLog[] = [];
  const push =
    (level: CapturedLog['level']) =>
    (message: string, data?: Record<string, unknown>): void => {
      lines.push({ level, message: redactString(message), data });
    };
  return {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}
