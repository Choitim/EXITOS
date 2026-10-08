/**
 * Corporate-proxy support for live runs.
 *
 * Node's built-in `fetch` ignores `HTTP_PROXY`/`HTTPS_PROXY` before Node 22.21 / 24, and ExitOS supports
 * Node >= 22.13, so a locked-down network would simply fail. When a proxy is configured through the
 * standard environment variables we route requests through `undici`'s `ProxyAgent`; with no proxy
 * configured the global `fetch` is used unchanged.
 *
 * Only the process environment is read (the standard variables below), never `.env`, and proxy
 * credentials (`http://user:pass@proxy:8080`) are never printed: every message names `host:port` only.
 * Custom CA certificates (TLS-inspecting proxies) are handled by Node itself: set `NODE_EXTRA_CA_CERTS`.
 */
import { ConfigError, type FetchLike, type Logger } from '@exitos/shared';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export interface ProxyConfig {
  /** Proxy for `http:` requests (`HTTP_PROXY` / `http_proxy`). */
  readonly httpProxy?: string | undefined;
  /** Proxy for `https:` requests (`HTTPS_PROXY` / `https_proxy`). */
  readonly httpsProxy?: string | undefined;
  /** Hosts that bypass the proxy (`NO_PROXY` / `no_proxy`), lower-cased. */
  readonly noProxy: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

const firstNonEmpty = (env: Env, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
};

/** Reads `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (upper-case wins over lower-case). */
export function proxyConfigFromEnv(env: Env): ProxyConfig {
  const noProxy = (firstNonEmpty(env, 'NO_PROXY', 'no_proxy') ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  return {
    httpProxy: firstNonEmpty(env, 'HTTP_PROXY', 'http_proxy'),
    httpsProxy: firstNonEmpty(env, 'HTTPS_PROXY', 'https_proxy'),
    noProxy,
  };
}

/** `host:port` of a proxy URL, never its credentials. */
export function describeProxy(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '(invalid proxy URL)';
  }
}

function parseProxyUrl(raw: string, variable: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Do not echo the value: it may contain credentials.
    throw new ConfigError(
      `${variable} is not a valid URL. Expected something like http://proxy.example.com:8080.`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(
      `${variable} must start with http:// or https:// (got "${url.protocol}//${url.host}").`,
    );
  }
  return url;
}

/**
 * `NO_PROXY` matching, following the common convention (curl, Go):
 * `*` matches everything; `example.com` matches that host and its subdomains; `.example.com` and
 * `*.example.com` match subdomains only; `host:8443` restricts the entry to one port.
 * CIDR ranges are not interpreted.
 */
export function isProxyBypassed(target: URL, noProxy: readonly string[]): boolean {
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = target.port !== '' ? target.port : target.protocol === 'https:' ? '443' : '80';
  for (const raw of noProxy) {
    if (raw === '*') return true;
    let entry = raw;
    let entryPort: string | undefined;
    const withPort = /^(.*):(\d{1,5})$/.exec(entry);
    if (withPort && !withPort[1]?.includes(':')) {
      entry = withPort[1] ?? '';
      entryPort = withPort[2];
    }
    if (entryPort !== undefined && entryPort !== port) continue;
    entry = entry.replace(/^\[|\]$/g, '');
    if (entry.startsWith('*.')) entry = entry.slice(1);
    if (entry.startsWith('.')) {
      if (host.endsWith(entry)) return true;
    } else if (host === entry || host.endsWith(`.${entry}`)) {
      return true;
    }
  }
  return false;
}

export interface NetworkFetch {
  readonly fetch: FetchLike;
  /** `host:port` of the proxies in use (never credentials); empty when going direct. */
  readonly proxies: readonly string[];
  /** Close pooled proxy connections so the process can exit promptly. */
  close(): Promise<void>;
}

/**
 * The `fetch` that live connectors use. With no proxy configured this is exactly the global `fetch`.
 */
export function createNetworkFetch(config: ProxyConfig, logger?: Logger): NetworkFetch {
  const httpUrl =
    config.httpProxy === undefined ? undefined : parseProxyUrl(config.httpProxy, 'HTTP_PROXY');
  const httpsUrl =
    config.httpsProxy === undefined ? undefined : parseProxyUrl(config.httpsProxy, 'HTTPS_PROXY');

  if (httpUrl === undefined && httpsUrl === undefined) {
    return {
      fetch: (input, init) => fetch(input, init),
      proxies: [],
      close: () => Promise.resolve(),
    };
  }

  const agents = new Map<string, ProxyAgent>();
  const agentFor = (proxy: URL): ProxyAgent => {
    const key = proxy.href;
    let agent = agents.get(key);
    if (agent === undefined) {
      agent = new ProxyAgent({ uri: key });
      agents.set(key, agent);
    }
    return agent;
  };

  const routed: FetchLike = (input, init) => {
    const target = new URL(input);
    const proxy = target.protocol === 'https:' ? httpsUrl : httpUrl;
    if (proxy === undefined || isProxyBypassed(target, config.noProxy)) {
      logger?.debug(`direct connection to ${target.host}`);
      return fetch(input, init);
    }
    logger?.debug(`${target.host} via proxy ${describeProxy(proxy.href)}`);
    // @types/node bundles an older undici-types than undici 7 ships; the two `RequestInit` shapes differ
    // only in `FormData` iterator helpers, and ExitOS only ever sends JSON string bodies.
    const options: Parameters<typeof undiciFetch>[1] = {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: agentFor(proxy),
    };
    return undiciFetch(input, options);
  };

  return {
    fetch: routed,
    proxies: [httpsUrl, httpUrl]
      .filter((u): u is URL => u !== undefined)
      .map((u) => describeProxy(u.href)),
    close: async () => {
      await Promise.all([...agents.values()].map((agent) => agent.close()));
      agents.clear();
    },
  };
}
