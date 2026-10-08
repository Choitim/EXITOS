import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface LicensesScript {
  ALLOWED: ReadonlySet<string>;
  readonly isAllowed: (expression: string) => boolean;
  readonly evaluate: (map: Record<string, Array<{ name: string; versions?: string[] }>>) => {
    violations: Array<{ license: string; name: string; versions: string[] }>;
    summary: Record<string, number>;
  };
}

const scriptUrl = pathToFileURL(
  fileURLToPath(new URL('../../../scripts/check-licenses.mjs', import.meta.url)),
).href;
const load = async (): Promise<LicensesScript> => (await import(scriptUrl)) as LicensesScript;

describe('scripts/check-licenses.mjs', () => {
  it('allows the permissive licenses the project ships with', async () => {
    const { isAllowed } = await load();
    for (const license of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0']) {
      expect(isAllowed(license), license).toBe(true);
    }
  });

  it('rejects copyleft, unknown and missing licenses', async () => {
    const { isAllowed } = await load();
    for (const license of [
      'GPL-3.0-only',
      'AGPL-3.0-or-later',
      'LGPL-2.1',
      'MPL-2.0',
      'SSPL-1.0',
      'UNLICENSED',
      'Unknown',
      '',
      'SEE LICENSE IN LICENSE.md',
    ]) {
      expect(isAllowed(license), license).toBe(false);
    }
  });

  it('evaluates SPDX expressions: OR needs one allowed side, AND needs both', async () => {
    const { isAllowed } = await load();
    expect(isAllowed('MIT OR GPL-3.0-only')).toBe(true);
    expect(isAllowed('(MIT OR Apache-2.0)')).toBe(true);
    expect(isAllowed('GPL-3.0-only OR AGPL-3.0-only')).toBe(false);
    expect(isAllowed('MIT AND BSD-3-Clause')).toBe(true);
    expect(isAllowed('MIT AND GPL-3.0-only')).toBe(false);
  });

  it('names every offending package and counts the rest', async () => {
    const { evaluate } = await load();
    const { violations, summary } = evaluate({
      MIT: [{ name: 'a' }, { name: 'b' }],
      'AGPL-3.0-only': [{ name: 'bad-lib', versions: ['1.2.3'] }],
    });
    expect(summary).toEqual({ MIT: 2, 'AGPL-3.0-only': 1 });
    expect(violations).toEqual([
      { license: 'AGPL-3.0-only', name: 'bad-lib', versions: ['1.2.3'] },
    ]);
  });
});
