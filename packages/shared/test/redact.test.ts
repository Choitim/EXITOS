import { describe, expect, it } from 'vitest';
import {
  SecretRedactor,
  ExitOsError,
  redactDeep,
  redactString,
  registerSecret,
  sanitizeUrl,
} from '../src/index.js';

describe('redaction', () => {
  it('scrubs Notion and ClickUp token shapes', () => {
    const text =
      'token ntn_abcdefghijklmnopqrstuvwxyz0123456789 and secret_AbCdEfGhIjKlMnOpQrStUvWx and pk_12345678_ABCDEFGHIJKLMNOPQRSTUV';
    const out = redactString(text);
    expect(out).not.toMatch(/ntn_abc/);
    expect(out).not.toMatch(/secret_AbCd/);
    expect(out).not.toMatch(/pk_1234/);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(3);
  });

  it('scrubs bearer tokens and authorization headers', () => {
    expect(redactString('Authorization: Bearer abc.def-ghi_1234567890')).not.toContain('abc.def');
    expect(redactString('{"authorization":"pk_1_AAAAAAAAAAAAAAAA"}')).not.toContain('AAAAAAAA');
  });

  it('scrubs signed-URL query parameters but keeps the rest of the URL', () => {
    const url =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA123&width=100';
    const out = redactString(url);
    expect(out).not.toContain('deadbeef');
    expect(out).not.toContain('AKIA123');
    expect(out).toContain('width=100');
  });

  it('scrubs credentials embedded in URLs', () => {
    expect(redactString('https://user:hunter2@example.com/x')).not.toContain('hunter2');
  });

  it('scrubs exact registered secrets even when they have no recognisable shape', () => {
    const r = new SecretRedactor();
    r.add('my-custom-opaque-credential');
    expect(r.redact('failed with my-custom-opaque-credential in header')).toBe(
      'failed with [REDACTED] in header',
    );
  });

  it('ignores very short strings so ordinary words are not masked', () => {
    const r = new SecretRedactor();
    r.add('abc');
    expect(r.redact('abc def')).toBe('abc def');
  });

  it('redacts values under sensitive keys, recursively', () => {
    const r = new SecretRedactor();
    const out = r.redactDeep({
      name: 'ok',
      headers: { Authorization: 'Bearer xyzxyzxyzxyz', accept: 'json' },
      nested: [{ api_key: 'k', note: 'pk_9_ZZZZZZZZZZZZZZZZ' }],
    });
    expect(JSON.stringify(out)).not.toContain('xyzxyzxyz');
    expect(JSON.stringify(out)).not.toContain('ZZZZZZZZ');
    expect(out.headers.accept).toBe('json');
    expect(out.name).toBe('ok');
  });

  it('sanitizeUrl strips userinfo, fragment and sensitive query values', () => {
    const out = sanitizeUrl('https://u:p@api.example.com/v1/x?token=abc123&page=2#frag');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('u:p');
    expect(out).not.toContain('frag');
    expect(out).toContain('page=2');
    expect(sanitizeUrl('not a url')).toBe('[unparsable-url]');
  });

  it('error messages are redacted at construction time', () => {
    registerSecret('super-secret-value-123');
    const err = new ExitOsError('X', 'boom super-secret-value-123 boom');
    expect(err.message).not.toContain('super-secret-value-123');
    expect(redactDeep({ token: 'abc' })).toEqual({ token: '[REDACTED]' });
  });
});
