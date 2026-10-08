#!/usr/bin/env node
/**
 * Writes a CycloneDX SBOM (software bill of materials) of what the CLI ships, using pnpm's own
 * generator, so there is no extra dependency to trust.
 *
 *   pnpm sbom:generate    # -> sbom/exitos-cli.cdx.json  (git-ignored; CI uploads it as an artifact)
 *
 * (`pnpm sbom` alone is pnpm's own built-in command, which prints to stdout.)
 *
 * It fails rather than writing an empty or malformed file.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const raw = execFileSync(
  'pnpm',
  ['--filter', '@exitos/cli', 'sbom', '--sbom-format', 'cyclonedx', '--prod'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
);

let bom;
try {
  bom = JSON.parse(raw);
} catch {
  console.error('generate-sbom: pnpm did not return JSON.');
  process.exit(1);
}
if (
  bom.bomFormat !== 'CycloneDX' ||
  !Array.isArray(bom.components) ||
  bom.components.length === 0
) {
  console.error('generate-sbom: the SBOM has no components; refusing to write it.');
  process.exit(1);
}

mkdirSync(join(root, 'sbom'), { recursive: true });
const file = join(root, 'sbom', 'exitos-cli.cdx.json');
writeFileSync(file, `${JSON.stringify(bom, null, 2)}\n`);
console.log(
  `generate-sbom: wrote sbom/exitos-cli.cdx.json (CycloneDX ${bom.specVersion}, ${bom.components.length} components)`,
);
