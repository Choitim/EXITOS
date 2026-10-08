import { redactString } from '../redact.js';

/** Errors that mean "the certificate chain was not trusted", the usual sign of a TLS-inspecting proxy. */
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const MAX_DEPTH = 5;
const MAX_LENGTH = 400;

interface Link {
  code: string | undefined;
  message: string;
}

function chain(error: unknown): Link[] {
  const links: Link[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && current instanceof Error; depth += 1) {
    const raw = (current as { code?: unknown }).code;
    links.push({ code: typeof raw === 'string' ? raw : undefined, message: current.message });
    current = current.cause;
  }
  return links;
}

function hintFor(links: readonly Link[]): string | undefined {
  const codes = links.map((l) => l.code).filter((c): c is string => c !== undefined);
  const text = links.map((l) => l.message).join(' ');
  if (codes.some((c) => TLS_CODES.has(c))) {
    return 'The TLS certificate was not trusted. If a proxy or firewall inspects HTTPS traffic, set NODE_EXTRA_CA_CERTS to your organisation’s root CA file.';
  }
  if (/proxy/i.test(text) || codes.some((c) => c.startsWith('UND_ERR_PRX'))) {
    return 'The proxy refused or could not carry the request. Check HTTPS_PROXY (including its credentials) and that the proxy allows api.notion.com and api.clickup.com.';
  }
  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
    return 'DNS lookup failed. Check the network connection; behind a corporate proxy, set HTTPS_PROXY.';
  }
  if (codes.some((c) => CONNECT_CODES.has(c))) {
    return 'Could not connect. Behind a corporate proxy, set HTTPS_PROXY (and NO_PROXY for hosts that must not use it).';
  }
  return undefined;
}

/**
 * Turns a failed `fetch` into something an administrator can act on. Node's `fetch` reports every
 * transport failure as "fetch failed" and keeps the real reason (DNS, refused tunnel, untrusted
 * certificate…) in `error.cause`. For an error with no cause and no recognisable reason the original
 * message is returned unchanged. The result is redacted and bounded.
 */
export function describeNetworkFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'network error';
  const links = chain(error);
  const top = links[0];
  const root = links.length > 1 ? links[links.length - 1] : undefined;

  let text = top?.message ?? 'network error';
  if (root !== undefined && root.message !== text) {
    text += ` — ${root.code === undefined ? '' : `${root.code}: `}${root.message}`;
  } else if (root === undefined && top?.code !== undefined && !text.includes(top.code)) {
    text += ` (${top.code})`;
  }
  const hint = hintFor(links);
  if (hint !== undefined) text += `. ${hint}`;
  return redactString(text).slice(0, MAX_LENGTH);
}
