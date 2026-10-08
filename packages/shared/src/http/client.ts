import type { z } from 'zod';
import { timeoutSignal } from '../async.js';
import {
  AbortedError,
  AmbiguousWriteError,
  ApiError,
  NetworkError,
  ValidationError,
} from '../errors.js';
import { redactString, sanitizeUrl } from '../redact.js';
import { describeNetworkFailure } from './diagnose.js';
import type { RequestScheduler } from './scheduler.js';
import type { FetchLike } from './types.js';

export interface HttpClientOptions {
  fetch: FetchLike;
  scheduler: RequestScheduler;
  /** e.g. `https://api.clickup.com/api` (no trailing slash). */
  baseUrl: string;
  /** Short system name used in error messages: `clickup`. */
  system: string;
  /** Called per request so the secret is never stored on the client object. */
  headers: () => Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Extract `{ code, message }` from an error body. */
  parseError?: (status: number, body: unknown) => { code?: string; message?: string };
}

export interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path beginning with `/`. Callers must have validated any interpolated IDs. */
  path: string;
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  body?: unknown;
  schema: z.ZodType<T>;
  /** Defaults to `true` for GET. Writes are non-idempotent unless stated. */
  idempotent?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Minimal JSON-over-HTTP client: pacing/retry via the scheduler, size-limited bodies, Zod
 * validation of every response, redacted errors, and correct semantics for ambiguous writes.
 */
export class HttpClient {
  readonly #o: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.#o = options;
  }

  async request<T>(options: RequestOptions<T>): Promise<T> {
    const idempotent = options.idempotent ?? options.method === 'GET';
    const url = this.#buildUrl(options.path, options.query);
    const endpoint = `${options.method} ${options.path.replace(/\/[A-Za-z0-9_-]{16,}/g, '/:id')}`;
    const label = `${this.#o.system} ${endpoint}`;
    const timeoutMs = this.#o.timeoutMs ?? 30_000;

    let response: Response;
    try {
      response = await this.#o.scheduler.run(
        () => {
          const init: RequestInit = {
            method: options.method,
            headers: {
              Accept: 'application/json',
              ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...this.#o.headers(),
            },
            signal: timeoutSignal(timeoutMs, options.signal),
          };
          if (options.body !== undefined) init.body = JSON.stringify(options.body);
          return this.#o.fetch(url, init);
        },
        {
          label,
          idempotent,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch (error) {
      if (error instanceof AbortedError) throw error;
      if (!idempotent) {
        // The request may have reached the server. Do not pretend we know.
        throw new AmbiguousWriteError(
          `${label}: no response received; the write may or may not have happened.`,
          {
            cause: error,
          },
        );
      }
      if (error instanceof NetworkError) throw error;
      throw new NetworkError(
        `${label}: ${error instanceof Error ? describeNetworkFailure(error) : 'request failed'}`,
        {
          cause: error,
        },
      );
    }

    const text = await this.#readBody(response, label, idempotent);

    if (!response.ok) {
      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      const info = this.#o.parseError?.(response.status, parsed) ?? {};
      const serverError = response.status >= 500;
      const message = redactString(info.message ?? `HTTP ${response.status}`).slice(0, 300);
      if (!idempotent && serverError) {
        throw new AmbiguousWriteError(
          `${label} → HTTP ${response.status}: ${message}. The write may or may not have happened.`,
        );
      }
      throw new ApiError(message, {
        system: this.#o.system,
        status: response.status,
        endpoint,
        ...(info.code === undefined ? {} : { apiCode: info.code }),
        retryable: serverError || response.status === 429,
      });
    }

    let json: unknown;
    try {
      json = text.length === 0 ? {} : JSON.parse(text);
    } catch (cause) {
      return this.#unreadable(label, idempotent, 'response was not valid JSON', cause);
    }
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      const paths = parsed.error.issues
        .slice(0, 5)
        .map((i) => i.path.join('.') || '(root)')
        .join(', ');
      return this.#unreadable(
        label,
        idempotent,
        `response failed validation at: ${paths}`,
        parsed.error,
      );
    }
    return parsed.data;
  }

  #unreadable(label: string, idempotent: boolean, what: string, cause: unknown): never {
    if (!idempotent) {
      throw new AmbiguousWriteError(
        `${label}: the server accepted the request but ${what}. The write may have happened.`,
        { cause },
      );
    }
    throw new ValidationError('RESPONSE_SHAPE', `${label}: ${what}.`, { cause });
  }

  async #readBody(response: Response, label: string, idempotent: boolean): Promise<string> {
    const limit = this.#o.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > limit) {
      await response.body?.cancel().catch(() => undefined);
      return this.#unreadable(label, idempotent, `response exceeds ${limit} bytes`, undefined);
    }
    const text = await response.text();
    if (text.length > limit) {
      return this.#unreadable(label, idempotent, `response exceeds ${limit} bytes`, undefined);
    }
    return text;
  }

  #buildUrl(path: string, query: RequestOptions<unknown>['query']): string {
    if (!path.startsWith('/'))
      throw new ValidationError('BAD_PATH', 'Request path must start with "/".');
    const url = new URL(this.#o.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value as readonly string[]) url.searchParams.append(`${key}[]`, item);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Exposed for tests/diagnostics: the URL with sensitive query values removed. */
  describeUrl(path: string): string {
    return sanitizeUrl(this.#o.baseUrl + path);
  }
}
