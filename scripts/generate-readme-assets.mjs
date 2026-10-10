#!/usr/bin/env node
/**
 * Generates the README images from the REAL product, never by hand:
 *
 *   docs/assets/exitos-hero.png          the dashboard, as `exitos ui --demo` shows it
 *   docs/assets/exitos-preview.png       the migration preview (mapping) section
 *   docs/assets/exitos-verification.png  the verification report section
 *   docs/assets/exitos-demo.gif          the online demo's guided tour: sample, inspect, preview, mapping,
 *                                        a replayed simulation, verification (needs `pnpm build:demo`)
 *   docs/assets/social-preview.png       GitHub social preview (1280x640); its numbers come from the demo report
 *
 *   pnpm build && pnpm docs:readme-assets          # all of it
 *   pnpm docs:readme-assets -- --only hero,social  # a subset
 *
 * It runs the offline demo (synthetic data, fake APIs, no network), serves the read-only dashboard on a
 * free loopback port, drives it with Playwright, and shrinks the PNGs with ffmpeg (palette
 * quantisation). Requires: built CLI and dashboard (`pnpm build`), Playwright's Chromium
 * (`pnpm exec playwright install chromium`) and ffmpeg on PATH.
 * Nothing here contacts any service; every figure shown is read from the demo's own JSON report.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'apps/cli/dist/bin.js');
const assets = join(root, 'docs/assets');

const ALL = ['hero', 'preview', 'verification', 'gif', 'social'];
const onlyArg =
  process.argv.find((a) => a.startsWith('--only='))?.slice(7) ??
  (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined);
const wanted = new Set(onlyArg ? onlyArg.split(',') : ALL);
for (const w of wanted)
  if (!ALL.includes(w)) fail(`unknown asset "${w}" (choose from ${ALL.join(', ')})`);

function fail(message) {
  console.error(`generate-readme-assets: ${message}`);
  process.exit(1);
}

// ---- preflight ---------------------------------------------------------------------------------
const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpeg.status !== 0)
  fail('ffmpeg is required (it optimises the images). Install it and try again.');
try {
  statSync(bin);
  statSync(join(root, 'apps/web/dist/index.html'));
} catch {
  fail('the CLI and the dashboard are not built. Run `pnpm build` first.');
}

mkdirSync(assets, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'exitos-assets-'));

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

/** Shrink a PNG with a 128-colour palette; UI screenshots are flat colours, so this is visually lossless. */
function optimisePng(input, output) {
  const palette = join(work, `palette-${Math.random().toString(36).slice(2)}.png`);
  const run = (args) => {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
    if (r.status !== 0) fail(`ffmpeg failed: ${r.stderr}`);
  };
  run(['-i', input, '-vf', 'palettegen=max_colors=128:stats_mode=full', palette]);
  run([
    '-i',
    input,
    '-i',
    palette,
    '-lavfi',
    'paletteuse=dither=none',
    '-compression_level',
    '100',
    output,
  ]);
}

const kb = (file) => `${(statSync(file).size / 1024).toFixed(0)} KB`;

// ---- 1. run the real offline demo, once ----------------------------------------------------------
const demoDir = join(work, 'demo');
mkdirSync(demoDir);
const env = { PATH: process.env.PATH ?? '', HOME: demoDir };
const demo = spawnSync(process.execPath, [bin, 'demo', '--no-color'], {
  cwd: demoDir,
  env,
  encoding: 'utf8',
});
if (demo.status !== 0) fail(`the offline demo failed (exit ${demo.status}):\n${demo.stderr}`);
const reportRun = spawnSync(process.execPath, [bin, 'report', '--demo', '--json'], {
  cwd: demoDir,
  env,
  encoding: 'utf8',
});
if (reportRun.status !== 0) fail(`could not read the demo report:\n${reportRun.stderr}`);
const report = JSON.parse(reportRun.stdout);
const stats = {
  verified: report.verification?.counts?.verified ?? 0,
  preserved: report.plan.summary.items.supported,
  transformed: report.plan.summary.items.transformed,
  review: report.plan.summary.items.lossy,
  unsupported: report.plan.summary.notPreserved.unsupported,
  actions: report.plan.summary.actions.toExecute,
};
if (!stats.verified || !stats.actions)
  fail('the demo report has no verification counts; refusing to draw numbers I cannot read.');

// ---- 2. serve the read-only dashboard ------------------------------------------------------------
const port = await freePort();
const ui = spawn(process.execPath, [bin, 'ui', '--demo', '--port', String(port)], {
  cwd: demoDir,
  env,
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not listening yet */
  }
  if (i > 60) fail('the dashboard server did not start');
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const written = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector('section[aria-labelledby]');
  await page.waitForTimeout(400);

  /** Jump to a section the way a person would: through the navigation. */
  const goTo = async (label) => {
    await page
      .getByRole('navigation')
      .getByRole('link', { name: label, exact: true })
      .first()
      .click();
    await page.waitForTimeout(350);
  };
  const shoot = async (name, label) => {
    if (label) await goTo(label);
    else await page.evaluate('window.scrollTo(0, 0)');
    await page.waitForTimeout(150);
    const raw = join(work, `${name}.png`);
    await page.screenshot({ path: raw });
    const out = join(assets, `${name}.png`);
    optimisePng(raw, out);
    written.push(`${name}.png ${kb(out)}`);
  };

  if (wanted.has('hero')) await shoot('exitos-hero', null);
  if (wanted.has('preview')) await shoot('exitos-preview', 'Mapping preview');
  if (wanted.has('verification')) await shoot('exitos-verification', 'Verification');

  // ---- 3. the demo GIF: the online demo's guided tour, frame by frame --------------------------------
  if (wanted.has('gif')) {
    const siteRoot = join(root, 'apps/web/dist-demo');
    if (
      !existsSync(join(siteRoot, 'index.html')) ||
      !existsSync(join(siteRoot, 'demo-state.json'))
    ) {
      fail('the GIF records the online demo: run `pnpm build:demo` first.');
    }
    // Serve it like GitHub Pages does: under a sub-path, with no special headers.
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
    };
    const site = createHttpServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (!rel.startsWith('/EXITOS/')) {
        res.writeHead(404).end();
        return;
      }
      rel = rel.slice('/EXITOS/'.length) || 'index.html';
      const file = join(siteRoot, rel);
      if (!file.startsWith(siteRoot) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    const demoUrl = `http://127.0.0.1:${site.address().port}/EXITOS/`;

    // Real animation here (not reduced motion): the replay is part of what the GIF shows.
    const tour = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const t = await tour.newPage();
    const frames = join(work, 'frames');
    mkdirSync(frames);
    let n = 0;
    const frame = async (hold = 1) => {
      // `hold` repeats a frame so the viewer has time to read it (the GIF runs at a fixed frame rate).
      await t.waitForTimeout(1000); // let a smooth scroll finish before the frame is taken
      const file = join(frames, `f${String(n).padStart(3, '0')}.png`);
      await t.screenshot({ path: file });
      n += 1;
      for (let i = 1; i < hold; i += 1) {
        const copy = join(frames, `f${String(n).padStart(3, '0')}.png`);
        spawnSync('cp', [file, copy]);
        n += 1;
      }
    };
    const next = () => t.getByRole('button', { name: /^next/i }).first().click();

    await t.goto(demoUrl);
    await t.waitForSelector('text=Take the guided tour');
    await frame(3); // 1. the DEMO banner and the tour
    await t.getByRole('button', { name: /open this sample workspace/i }).click(); // 1 -> 2: select the sample
    await frame(2); // 2. inspect the source
    await next();
    await frame(2); // 3. preview compatibility
    await next();
    await frame(2); // 4. the migration mapping
    await next(); // 5. simulate
    await frame(1);
    await t.getByRole('button', { name: /start simulation/i }).click();
    for (let i = 0; i < 5; i += 1) {
      await t.waitForTimeout(1500);
      await frame(1);
    } // the replay advancing
    await t
      .waitForSelector('text=/175 of 175|\\d+ of \\d+ actions written or skipped \\(100%\\)/', {
        timeout: 20000,
      })
      .catch(() => {});
    await frame(2); // replay done
    await next();
    await frame(3); // 6. verification
    await tour.close();
    await new Promise((resolve) => site.close(resolve));

    const palette = join(work, 'gif-palette.png');
    const out = join(assets, 'exitos-demo.gif');
    const scale = 'scale=880:-1:flags=lanczos';
    // 1 frame every 0.7 s; frames the viewer must read are repeated above.
    const rate = ['-framerate', '1/0.7', '-i', join(frames, 'f%03d.png')];
    let r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        ...rate,
        '-vf',
        `${scale},palettegen=max_colors=96:stats_mode=diff`,
        palette,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) fail(`ffmpeg palette failed: ${r.stderr}`);
    r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        ...rate,
        '-i',
        palette,
        '-lavfi',
        `${scale}[x];[x][1:v]paletteuse=dither=none`,
        '-loop',
        '0',
        out,
      ],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) fail(`ffmpeg gif failed: ${r.stderr}`);
    written.push(`exitos-demo.gif ${kb(out)}`);
  }

  // ---- 4. the GitHub social preview (1280x640), with numbers taken from the report above ------------
  if (wanted.has('social')) {
    const mark = readFileSync(join(assets, 'logo-dark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
    const card = await context.newPage();
    await card.setViewportSize({ width: 1280, height: 640 });
    await card.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0}
      body{width:1280px;height:640px;background:#0d1117;color:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:64px 72px}
      .logo svg{height:64px;width:auto}
      h1{font-size:64px;line-height:1.08;font-weight:700;letter-spacing:-1.5px;max-width:980px}
      h1 span{color:#60a5fa}
      p.sub{margin-top:22px;font-size:28px;color:#9aa4b2;max-width:940px;line-height:1.35}
      .flow{display:flex;gap:14px;margin-top:26px;margin-bottom:40px;font-size:24px;font-weight:600;color:#cbd5e1;align-items:center}
      .flow i{font-style:normal;color:#475569}
      .stats{display:flex;gap:18px}
      .stat{background:#161b22;border:1px solid #2d333b;border-radius:14px;padding:18px 26px;min-width:190px}
      .stat b{display:block;font-size:44px;line-height:1.1;letter-spacing:-1px}
      .stat span{font-size:20px;color:#9aa4b2}
      .ok b{color:#4ade80}.info b{color:#22d3ee}.warn b{color:#fbbf24}.bad b{color:#f87171}
      .note{margin-top:14px;font-size:18px;color:#7d8590}
    </style>
    <div class="logo">${mark}</div>
    <div>
      <h1>See what survives <span>before you switch apps.</span></h1>
      <p class="sub">Preview a migration, approve it, apply it, and verify the result, with every lost or unsupported item listed.</p>
      <div class="flow">Inspect <i>→</i> Plan <i>→</i> Approve <i>→</i> Apply <i>→</i> Verify</div>
    </div>
    <div>
      <div class="stats">
        <div class="stat ok"><b>${stats.verified}</b><span>verified</span></div>
        <div class="stat"><b>${stats.preserved}</b><span>preserved</span></div>
        <div class="stat info"><b>${stats.transformed}</b><span>transformed</span></div>
        <div class="stat warn"><b>${stats.review}</b><span>require review</span></div>
        <div class="stat bad"><b>${stats.unsupported}</b><span>unsupported</span></div>
      </div>
      <p class="note">Open source · local-first · Notion → ClickUp. Figures: the offline demo (synthetic data, fake APIs).</p>
    </div>`);
    const raw = join(work, 'social.png');
    await card.screenshot({ path: raw });
    const out = join(assets, 'social-preview.png');
    optimisePng(raw, out);
    written.push(`social-preview.png ${kb(out)}`);
  }
} finally {
  await browser.close();
  ui.kill();
  rmSync(work, { recursive: true, force: true });
}

console.log('generate-readme-assets: wrote');
for (const line of written) console.log(`  docs/assets/${line}`);
console.log(`numbers used: ${JSON.stringify(stats)}`);
