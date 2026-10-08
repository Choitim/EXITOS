import { describe, expect, it } from 'vitest';
import { describeNetworkFailure } from '../src/index.js';

/** Node's `fetch` reports every transport failure as `TypeError: fetch failed` with the reason in `cause`. */
function fetchFailed(cause: Error & { code?: string }): Error {
  return new TypeError('fetch failed', { cause });
}
const withCode = (message: string, code: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

describe('describeNetworkFailure', () => {
  it('returns a plain error message unchanged, so existing messages keep their wording', () => {
    expect(describeNetworkFailure(new Error('boom'))).toBe('boom');
  });

  it('gives a non-error a generic description', () => {
    expect(describeNetworkFailure('nope')).toBe('network error');
    expect(describeNetworkFailure(undefined)).toBe('network error');
  });

  it('surfaces the real reason hidden behind "fetch failed"', () => {
    const text = describeNetworkFailure(
      fetchFailed(withCode('connect ECONNREFUSED 10.0.0.5:3128', 'ECONNREFUSED')),
    );
    expect(text).toContain('fetch failed');
    expect(text).toContain('ECONNREFUSED: connect ECONNREFUSED 10.0.0.5:3128');
    expect(text).toContain('HTTPS_PROXY');
  });

  it('points at NODE_EXTRA_CA_CERTS for untrusted certificates (TLS-inspecting proxies)', () => {
    for (const code of [
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
    ]) {
      const text = describeNetworkFailure(fetchFailed(withCode('certificate problem', code)));
      expect(text, code).toContain(code);
      expect(text, code).toContain('NODE_EXTRA_CA_CERTS');
    }
  });

  it('explains a refused proxy tunnel', () => {
    const text = describeNetworkFailure(
      fetchFailed(
        withCode(
          'Proxy response (407) !== 200 when HTTP Tunneling',
          'UND_ERR_PRX_RESPONSE_STATUS_CODE',
        ),
      ),
    );
    expect(text).toContain('Proxy response (407)');
    expect(text).toMatch(/proxy refused or could not carry/i);
  });

  it('explains DNS failures', () => {
    const text = describeNetworkFailure(
      fetchFailed(withCode('getaddrinfo ENOTFOUND api.notion.com', 'ENOTFOUND')),
    );
    expect(text).toContain('ENOTFOUND');
    expect(text).toMatch(/DNS lookup failed/);
  });

  it('follows a multi-level cause chain to the root cause', () => {
    const root = withCode('socket hang up', 'ECONNRESET');
    const middle = new Error('tunnel failed', { cause: root });
    const text = describeNetworkFailure(new TypeError('fetch failed', { cause: middle }));
    expect(text).toContain('ECONNRESET: socket hang up');
  });

  it('never leaks credentials found in an error message, and stays bounded', () => {
    const cause = withCode(
      `connect to http://svc:SuperSecretPw@proxy.corp:3128 failed with token ntn_${'A'.repeat(40)} ${'x'.repeat(2000)}`,
      'ECONNREFUSED',
    );
    const text = describeNetworkFailure(fetchFailed(cause));
    expect(text).not.toContain('SuperSecretPw');
    expect(text).not.toContain('ntn_AAAA');
    expect(text.length).toBeLessThanOrEqual(400);
  });

  it('survives a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(() => describeNetworkFailure(a)).not.toThrow();
  });
});
