import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface SecretsScript {
  PATTERNS: ReadonlyArray<readonly [string, RegExp]>;
  readonly scan: (text: string) => Array<{ line: number; name: string }>;
}

const scriptUrl = pathToFileURL(
  fileURLToPath(new URL('../../../scripts/check-secrets.mjs', import.meta.url)),
).href;
const load = async (): Promise<SecretsScript> => (await import(scriptUrl)) as SecretsScript;

// Built from pieces so this file never contains a credential-shaped literal itself.
const fakeNotion = ['ntn', '_', 'A'.repeat(40)].join('');
const fakeClickUp = ['pk', '_', '123456', '_', 'B'.repeat(28)].join('');
const fakeGitHub = ['ghp', '_', 'C'.repeat(40)].join('');

describe('scripts/check-secrets.mjs', () => {
  it('flags credential-shaped strings and reports the line, not the value', async () => {
    const { scan } = await load();
    const hits = scan(
      `line one\nNOTION_TOKEN=${fakeNotion}\nfine\n  ${fakeClickUp}\n${fakeGitHub}`,
    );
    expect(hits).toEqual([
      { line: 2, name: 'Notion token' },
      { line: 4, name: 'ClickUp personal token' },
      { line: 5, name: 'GitHub token' },
    ]);
    expect(JSON.stringify(hits)).not.toContain(fakeNotion);
  });

  it('does not flag placeholders, prose or short look-alikes', async () => {
    const { scan } = await load();
    const text = [
      'NOTION_TOKEN=',
      '# NOTION_TOKEN=ntn_your_token_here',
      'CLICKUP_API_TOKEN=pk_<your token>',
      'A token starts with ntn_ and is shown once.',
      'pk_1_SHORT',
    ].join('\n');
    expect(scan(text)).toEqual([]);
  });

  it('flags private key blocks', async () => {
    const { scan } = await load();
    expect(scan('-----BEGIN ' + 'PRIVATE KEY-----')).toEqual([
      { line: 1, name: 'Private key block' },
    ]);
  });
});
