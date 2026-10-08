import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH, isSafeUrl, sanitizeUrl } from '../src/lib/url';

describe('sanitizeUrl: accepted URLs', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/path?q=1&r=2#frag', 'http://example.com/path?q=1&r=2#frag'],
    ['HTTPS://EXAMPLE.COM/Path', 'https://example.com/Path'],
    [
      'https://www.notion.so/26418939445640ceaf57af494e8b26fd',
      'https://www.notion.so/26418939445640ceaf57af494e8b26fd',
    ],
    ['http://localhost:3000/x', 'http://localhost:3000/x'],
    ['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/'],
    ['https://example.com/a%20b', 'https://example.com/a%20b'],
    ['https://例え.jp/パス', 'https://xn--r8jz45g.jp/%E3%83%91%E3%82%B9'],
    ['mailto:ada@example.com', 'mailto:ada@example.com'],
    ['MAILTO:ada@example.com?subject=Hi', 'mailto:ada@example.com?subject=Hi'],
  ])('accepts %s', (input, expected) => {
    expect(sanitizeUrl(input)).toBe(expected);
    expect(isSafeUrl(input)).toBe(true);
  });
});

describe('sanitizeUrl: hostile and malformed input is rejected', () => {
  const hostile: Array<[string, string]> = [
    ['plain javascript:', 'javascript:alert(1)'],
    ['mixed-case scheme', 'JaVaScRiPt:alert(1)'],
    ['tab inside the scheme', 'java\tscript:alert(1)'],
    ['newline inside the scheme', 'java\nscript:alert(1)'],
    ['carriage return inside the scheme', 'java\rscript:alert(1)'],
    ['leading space', ' javascript:alert(1)'],
    ['leading space before a valid URL', ' https://example.com'],
    ['trailing space', 'https://example.com '],
    ['leading NUL', '\u0000javascript:alert(1)'],
    ['leading C0 control', '\u0001javascript:alert(1)'],
    ['C1 control', '\u0085https://example.com'],
    ['no-break space prefix', ' javascript:alert(1)'],
    ['zero-width space inside the scheme', 'java​script:alert(1)'],
    ['zero-width joiner', 'https://exa‍mple.com'],
    ['BOM prefix', '﻿https://example.com'],
    ['line separator', 'javascript :alert(1)'],
    ['bidi override', 'https://example.com/‮exe.txt'],
    ['ideographic space', 'https://example.com/　x'],
    ['data: html', 'data:text/html,<script>alert(1)</script>'],
    ['data: base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
    ['protocol-relative', '//evil.example'],
    ['triple slash', '///evil.example'],
    ['backslash host', '\\\\evil.example'],
    ['backslash after the scheme', 'https:\\\\evil.example'],
    ['scheme without slashes', 'https:evil.example'],
    ['http without slashes', 'http:evil.example'],
    ['ftp', 'ftp://example.com/file'],
    ['about:', 'about:blank'],
    ['blob:', 'blob:https://example.com/1234'],
    ['chrome:', 'chrome://settings'],
    ['relative path', '/relative/path'],
    ['bare host', 'example.com'],
    ['fragment only', '#section'],
    ['empty string', ''],
    ['only whitespace', '   '],
    ['http with no host', 'http://'],
    ['https with no host', 'https:///path'],
    ['embedded credentials', 'https://user:pass@evil.example/'],
    ['embedded user only', 'https://admin@evil.example/'],
    ['mailto without an address', 'mailto:'],
    ['mailto without an @', 'mailto:nobody'],
    ['javascript hidden after a valid scheme', 'https://example.com\u0000@evil.example'],
    ['HTML entity colon', 'javascript&colon;alert(1)'],
    ['numeric entity scheme', '&#106;avascript:alert(1)'],
    ['hex entity tab', 'jav&#x09;ascript:alert(1)'],
    ['percent-encoded scheme', '%6aavascript:alert(1)'],
    ['space inside the host', 'https://exa mple.com'],
    ['unbalanced bracket host', 'https://[::1'],
    ['too long (just over the limit)', `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`],
    ['very long', `https://example.com/${'a'.repeat(200_000)}`],
    ['very long mailto', `mailto:${'a'.repeat(100_000)}@example.com`],
  ];

  it.each(hostile)('rejects %s', (_name, input) => {
    expect(sanitizeUrl(input)).toBeNull();
    expect(isSafeUrl(input)).toBe(false);
  });

  it('has at least 15 hostile cases', () => {
    expect(hostile.length).toBeGreaterThanOrEqual(15);
  });

  it('rejects values that are not strings', () => {
    for (const value of [null, undefined, 42, {}, [], ['https://example.com'], true]) {
      expect(sanitizeUrl(value)).toBeNull();
    }
  });

  it('accepts a URL right at the length limit', () => {
    const prefix = 'https://example.com/';
    const url = prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length);
    expect(url).toHaveLength(MAX_URL_LENGTH);
    expect(sanitizeUrl(url)).toBe(url);
  });

  it('never returns a URL whose scheme is not http, https or mailto', () => {
    const inputs = [
      'https://example.com',
      'mailto:a@b.co',
      'javascript:alert(1)',
      'data:text/plain,hi',
      'file:///x',
      '//x.y',
    ];
    for (const input of inputs) {
      const out = sanitizeUrl(input);
      if (out !== null) expect(out).toMatch(/^(https?:|mailto:)/);
    }
  });
});
