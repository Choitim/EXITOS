import {
  ConfigError,
  createGuardedFetch,
  nullLogger,
  registerSecret,
  systemClock,
  type AccessMode,
  type Clock,
  type FetchLike,
  type Logger,
  type RequestRecorder,
} from '@exitos/shared';
import type { ConnectorContext, CredentialSpec, NetworkPolicy, RunMode } from './types.js';

export interface HostEnvironment {
  /** The real `fetch`, or an in-process fake for the offline demo and tests. */
  transport: FetchLike;
  mode: RunMode;
  /** Usually `process.env`. Injected so tests never depend on the developer's shell. */
  env: Readonly<Record<string, string | undefined>>;
  logger?: Logger;
  clock?: Clock;
  signal?: AbortSignal;
  recorder?: RequestRecorder;
  concurrency?: number;
  /** Optional base URL override (env `*_API_BASE_URL`). Must be the real host or loopback. */
  baseUrlOverride?: string | undefined;
}

export const DEMO_PLACEHOLDER_CREDENTIAL = 'demo-offline-placeholder-credential';

/** A base URL override may only point at loopback (mock servers) or at the connector's own host. */
export function resolveBaseUrl(defaultBaseUrl: string, override: string | undefined): string {
  if (override === undefined || override.trim() === '') return defaultBaseUrl;
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new ConfigError('API base URL override is not a valid URL.');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const sameHost = url.host === new URL(defaultBaseUrl).host;
  if (!loopback && !sameHost) {
    throw new ConfigError(
      `Refusing API base URL override "${url.host}": only loopback addresses (for local mock servers) or the official API host are accepted, so a stray variable cannot redirect your token.`,
    );
  }
  if (url.username || url.password)
    throw new ConfigError('API base URL must not contain credentials.');
  return url.toString().replace(/\/$/, '');
}

export function resolveCredentials(
  specs: readonly CredentialSpec[],
  env: HostEnvironment['env'],
  mode: RunMode,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const value = env[spec.env]?.trim();
    if (mode === 'demo') {
      out[spec.env] = DEMO_PLACEHOLDER_CREDENTIAL;
      continue;
    }
    if (value === undefined || value === '') {
      if (spec.required) {
        throw new ConfigError(
          `Missing ${spec.env} (${spec.description}). Set it in your environment or in a local .env file — see .env.example. ExitOS never reads credentials from the migration config.`,
        );
      }
      continue;
    }
    registerSecret(value);
    out[spec.env] = value;
  }
  return out;
}

/**
 * Build the context handed to a connector. Source connectors are always created with
 * `access: 'read-only'`; only the destination during apply/resume gets `read-write`.
 */
export function createConnectorContext(
  connector: {
    network: NetworkPolicy;
    credentials: readonly CredentialSpec[];
  },
  access: AccessMode,
  host: HostEnvironment,
): ConnectorContext {
  const baseUrl = resolveBaseUrl(connector.network.defaultBaseUrl, host.baseUrlOverride);
  const guarded = createGuardedFetch({
    fetch: host.transport,
    mode: access,
    classify: connector.network.classify,
    allowedHosts: connector.network.allowedHosts(baseUrl),
    ...(host.recorder === undefined ? {} : { recorder: host.recorder }),
  });
  return {
    fetch: guarded,
    logger: host.logger ?? nullLogger,
    clock: host.clock ?? systemClock,
    ...(host.signal === undefined ? {} : { signal: host.signal }),
    credentials: resolveCredentials(connector.credentials, host.env, host.mode),
    baseUrl,
    mode: host.mode,
    ...(host.recorder === undefined ? {} : { recorder: host.recorder }),
    concurrency: host.concurrency ?? 4,
  };
}
