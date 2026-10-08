import { describe, expect, it } from 'vitest';
import {
  normalizeFile,
  normalizeNotionId,
  normalizeRichText,
  parseNotionId,
  toDashedUuid,
  validExternalUrl,
} from '../src/index.js';
import { RichTextRawSchema } from '../src/raw.js';
import {
  equationInline,
  hostedFile,
  externalFile,
  mentionPage,
  mentionUser,
  rt,
  uid,
} from '../src/testing/index.js';

const parseRt = (items: Record<string, unknown>[]) => items.map((i) => RichTextRawSchema.parse(i));

describe('Notion ids', () => {
  const hex = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const dashed = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

  it('accepts bare ids, dashed ids and uppercase', () => {
    expect(parseNotionId(hex)).toBe(hex);
    expect(parseNotionId(dashed)).toBe(hex);
    expect(parseNotionId(hex.toUpperCase())).toBe(hex);
    expect(toDashedUuid(hex)).toBe(dashed);
    expect(normalizeNotionId(dashed.toUpperCase())).toBe(hex);
  });

  it('extracts the id from pasted Notion URLs', () => {
    expect(parseNotionId(`https://www.notion.so/acme/Product-Roadmap-${hex}?v=abc&pvs=4`)).toBe(
      hex,
    );
    expect(parseNotionId(`https://acme.notion.site/${hex}`)).toBe(hex);
  });

  it('rejects other hosts, junk and short ids with an actionable message', () => {
    expect(() => parseNotionId(`https://evil.example.com/${hex}`)).toThrow(/not a Notion host/);
    expect(() => parseNotionId('not-an-id')).toThrow(/32-character id/);
    expect(() => parseNotionId('abc123')).toThrow();
    expect(() => parseNotionId('')).toThrow();
  });
});

describe('URL validation', () => {
  it('keeps plain http(s) URLs and rejects everything else', () => {
    expect(validExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(validExternalUrl('http://example.com')).toBe('http://example.com/');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      'file:///etc/passwd',
      'ftp://x/y',
      'https://user:pw@example.com/',
      '',
      null,
      undefined,
      'not a url',
    ]) {
      expect(validExternalUrl(bad)).toBeUndefined();
    }
    expect(validExternalUrl(`https://example.com/${'a'.repeat(3000)}`)).toBeUndefined();
  });
});

describe('rich text', () => {
  it('maps annotations and drops the default colour', () => {
    const [span] = normalizeRichText(
      parseRt([rt('hi', { bold: true, italic: true, underline: true, color: 'red', code: false })]),
    );
    expect(span).toEqual({ text: 'hi', bold: true, italic: true, underline: true, color: 'red' });
    const [plain] = normalizeRichText(parseRt([rt('plain')]));
    expect(plain).toEqual({ text: 'plain' });
  });

  it('keeps Unicode intact', () => {
    const text = 'タスク 🚀 — café — مرحبا — 𝔘𝔫𝔦𝔠𝔬𝔡𝔢';
    expect(normalizeRichText(parseRt([rt(text)]))[0]?.text).toBe(text);
  });

  it('keeps valid links and drops dangerous ones', () => {
    const spans = normalizeRichText(
      parseRt([
        rt('ok', { href: 'https://example.com/x' }),
        rt('bad', { href: 'javascript:alert(1)' }),
        rt('mail', { href: 'mailto:a@b.co' }),
      ]),
    );
    expect(spans[0]?.href).toBe('https://example.com/x');
    expect(spans[1]?.href).toBeUndefined();
    expect(spans[2]?.href).toBe('mailto:a@b.co');
  });

  it('represents mentions and equations explicitly', () => {
    const user = uid('u');
    const page = uid('p');
    const spans = normalizeRichText(
      parseRt([mentionUser(user, 'Ada'), mentionPage(page, 'Spec'), equationInline('E=mc^2')]),
    );
    expect(spans[0]).toMatchObject({
      text: '@Ada',
      mention: { kind: 'user', target: `notion:user:${normalizeNotionId(user)}` },
    });
    expect(spans[1]).toMatchObject({
      text: 'Spec',
      mention: { kind: 'page' },
      href: `https://www.notion.so/${normalizeNotionId(page)}`,
    });
    expect(spans[2]).toMatchObject({ equation: 'E=mc^2' });
  });
});

describe('attachments never keep signed URLs', () => {
  const owner = 'notion:page:abc' as const;

  it('hosted files become references without their expiring URL', () => {
    const file = normalizeFile(hostedFile('report.pdf') as never, owner, 'Files', 0);
    expect(file).toMatchObject({
      name: 'report.pdf',
      hosting: 'internal',
      expiresAt: '2026-10-08T13:00:00.000Z',
    });
    expect(JSON.stringify(file)).not.toMatch(/X-Amz|amazonaws|SIGNATURE/);
    expect(file.url).toBeUndefined();
  });

  it('keeps validated external URLs only', () => {
    expect(
      normalizeFile(
        externalFile('a.png', 'https://cdn.example.com/a.png') as never,
        owner,
        'Files',
        0,
      ).url,
    ).toBe('https://cdn.example.com/a.png');
    expect(
      normalizeFile(externalFile('b', 'javascript:alert(1)') as never, owner, 'Files', 1).url,
    ).toBeUndefined();
  });

  it('keys are stable and independent of URL', () => {
    const a = normalizeFile(hostedFile('x.pdf') as never, owner, 'Files', 0);
    const b = normalizeFile(
      {
        ...(hostedFile('x.pdf') as object),
        file: { url: 'https://different.example/zzz', expiry_time: 'later' },
      } as never,
      owner,
      'Files',
      0,
    );
    expect(a.key).toBe(b.key);
  });
});
