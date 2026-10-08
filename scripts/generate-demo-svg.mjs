#!/usr/bin/env node
/**
 * Renders docs/assets/demo.svg from the ACTUAL output of `exitos demo` — never hand-drawn, so the
 * README image cannot claim anything the product does not do.
 *
 *   pnpm build && pnpm docs:assets
 *
 * The excerpt is chosen by matching headings in the real output; if the output changes shape so that
 * a section can no longer be found, this script fails loudly instead of drawing something stale.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'apps/cli/dist/bin.js');

// ---- run the real demo in a throw-away directory ----------------------------------------------
const cwd = mkdtempSync(join(tmpdir(), 'exitos-svg-'));
const run = spawnSync(process.execPath, [bin, 'demo'], {
  cwd,
  env: { PATH: process.env.PATH ?? '', FORCE_COLOR: '1', COLUMNS: '100' },
  encoding: 'utf8',
});
rmSync(cwd, { recursive: true, force: true });
if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  throw new Error(`exitos demo exited with ${run.status}. Run \`pnpm build\` first.`);
}

// ---- parse ANSI into styled runs ----------------------------------------------------------------
// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[([0-9;]*)m/g;
const strip = (s) => s.replace(SGR, '');

function parseLine(line) {
  const runs = [];
  let state = { bold: false, dim: false, fg: null, bg: null };
  let last = 0;
  const push = (text) => text && runs.push({ text, ...state });
  for (const m of line.matchAll(SGR)) {
    push(line.slice(last, m.index));
    last = m.index + m[0].length;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (const c of codes) {
      if (c === 0) state = { bold: false, dim: false, fg: null, bg: null };
      else if (c === 1) state.bold = true;
      else if (c === 2) state.dim = true;
      else if (c === 22) state.bold = state.dim = false;
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) state.fg = c;
      else if (c === 39) state.fg = null;
      else if (c >= 40 && c <= 47) state.bg = c;
      else if (c === 49) state.bg = null;
    }
  }
  push(line.slice(last));
  return runs;
}

const lines = run.stdout.split('\n');
const plain = lines.map(strip);
const find = (needle, from = 0) => {
  const i = plain.findIndex((l, idx) => idx >= from && l.includes(needle));
  if (i === -1)
    throw new Error(
      `Could not find "${needle}" in the demo output; update scripts/generate-demo-svg.mjs`,
    );
  return i;
};

// ---- choose the excerpt ---------------------------------------------------------------------------
const banner = find('OFFLINE DEMO');
const plan = find('PLAN plan_');
const headline = find('HERE IS EVERYTHING');
const inventory = find('Everything that changes or cannot move');
const recovered = find('↺');
const rate = find('Rate limited');
const verified = find('✔ VERIFIED');
const notPreserved = find('NOT PRESERVED');
const done = plain.findIndex((l, i) => i > recovered && l.includes('100%'));
if (done === -1) throw new Error('Could not find the 100% progress line');

const take = (from, count) => lines.slice(from, from + count);
const sep = () => '\u001b[90m  ⋮\u001b[0m';
const excerpt = [
  ...take(banner - 1, 4),
  '',
  ...take(plan, 1),
  ...take(headline, 6),
  sep(),
  ...take(inventory, 11),
  sep(),
  lines[recovered],
  lines[done],
  '',
  ...take(rate, 4),
  sep(),
  ...take(verified - 1, 3),
  sep(),
  ...take(notPreserved, 7),
].map((l) => l ?? '');

// ---- draw the SVG -----------------------------------------------------------------------------------
const FG = {
  30: '#6e7681',
  31: '#ff7b72',
  32: '#56d364',
  33: '#e3b341',
  34: '#79c0ff',
  35: '#d2a8ff',
  36: '#56d4dd',
  37: '#c9d1d9',
  90: '#8b949e',
};
const BG = { 41: '#da3633', 42: '#238636', 43: '#d29922', 44: '#1f6feb' };
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const charW = 8.4;
const lineH = 19;
const padX = 22;
const top = 52;
const cols = Math.max(...excerpt.map((l) => [...strip(l)].length), 80);
const width = Math.ceil(cols * charW + padX * 2);
const height = top + excerpt.length * lineH + 26;

const body = excerpt
  .map((line, i) => {
    const y = top + (i + 1) * lineH - 5;
    let x = padX;
    const parts = [];
    for (const r of parseLine(line)) {
      const w = [...r.text].length * charW;
      if (r.bg)
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${y - 14}" width="${w.toFixed(1)}" height="${lineH}" fill="${BG[r.bg]}"/>`,
        );
      const colour = r.bg ? '#0d1117' : (r.fg && FG[r.fg]) || '#c9d1d9';
      const opacity = r.dim ? ' opacity="0.65"' : '';
      const weight = r.bold ? ' font-weight="700"' : '';
      parts.push(
        `<text x="${x.toFixed(1)}" y="${y}" fill="${colour}"${weight}${opacity} xml:space="preserve">${escapeXml(r.text)}</text>`,
      );
      x += w;
    }
    return parts.join('');
  })
  .join('\n  ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terminal output of the ExitOS offline demo: a plan that lists what moves, what changes and what cannot move, then an apply with recovered failures, then verification and the list of what was not preserved.">
  <title>exitos demo — output of the real offline demo (synthetic data)</title>
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
  <rect width="${width}" height="36" rx="10" fill="#161b22"/>
  <rect y="26" width="${width}" height="10" fill="#161b22"/>
  <circle cx="22" cy="18" r="6" fill="#ff5f56"/><circle cx="42" cy="18" r="6" fill="#ffbd2e"/><circle cx="62" cy="18" r="6" fill="#27c93f"/>
  <text x="${width / 2}" y="23" text-anchor="middle" fill="#8b949e" font-size="12" font-family="ui-sans-serif, system-ui, sans-serif">$ pnpm exitos demo   ·   generated from real output (excerpt)</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="13.5">
  ${body}
  </g>
</svg>
`;

mkdirSync(join(root, 'docs/assets'), { recursive: true });
writeFileSync(join(root, 'docs/assets/demo.svg'), svg);
console.log(
  `Wrote docs/assets/demo.svg (${width}×${height}, ${excerpt.length} lines, ${(svg.length / 1024).toFixed(0)} KB)`,
);
