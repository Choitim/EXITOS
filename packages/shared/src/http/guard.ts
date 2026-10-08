import { HostNotAllowedError, WriteBlockedError } from '../errors.js';
import type { RequestRecorder } from './recorder.js';
import type { FetchLike, RequestClassifier } from './types.js';

export type AccessMode = 'read-only' | 'read-write';

export interface GuardOptions {
  /** The real transport (global fetch, or an in-process fake for the offline demo and tests). */
  fetch: FetchLike;
  mode: AccessMode;
  classify: RequestClassifier;
  /** Exact `host` (or `host:port`) values requests may target. */
  allowedHosts: readonly string[];
  recorder?: RequestRecorder;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname);
}

/**
 * Wrap a fetch so that, before the network is touched, it:
 *  1. enforces a host allow-list (tokens can only go to the connector's own API host);
 *  2. refuses plain http except to loopback (tests / local mock servers);
 *  3. in read-only mode, refuses anything not classified as `read` — unknown endpoints fail closed.
 *
 * See ADR 0006.
 */
export function createGuardedFetch(options: GuardOptions): FetchLike {
  const allowed = new Set(options.allowedHosts);
  return async (input, init) => {
    const url = new URL(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (!allowed.has(url.host) && !allowed.has(url.hostname)) {
      options.recorder?.record({
        method,
        host: url.host,
        path,
        class: 'unknown',
        blocked: true,
      });
      throw new HostNotAllowedError(url.host);
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
      options.recorder?.record({ method, host: url.host, path, class: 'unknown', blocked: true });
      throw new HostNotAllowedError(`${url.protocol}//${url.host}`);
    }

    const cls = options.classify({ method, url });
    const permitted = cls === 'read' || (options.mode === 'read-write' && cls === 'write');
    if (!permitted) {
      options.recorder?.record({ method, host: url.host, path, class: cls, blocked: true });
      throw new WriteBlockedError(
        method,
        url.host,
        path,
        cls === 'unknown'
          ? 'endpoint is not classified as read-only (fail-closed)'
          : 'connection is read-only',
      );
    }

    const response = await options.fetch(input, init);
    options.recorder?.record({
      method,
      host: url.host,
      path,
      class: cls,
      blocked: false,
      status: response.status,
    });
    return response;
  };
}
