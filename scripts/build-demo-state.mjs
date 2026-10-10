#!/usr/bin/env node
/**
 * Records the data of the static online demo: apps/web/dist-demo/demo-state.json.
 *
 *   pnpm build && pnpm build:demo        # normally run through the root script
 *   node scripts/build-demo-state.mjs --preflight   # only check that the CLI and core are built
 *
 * What it does, with the REAL engine and nothing else:
 *   1. runs `exitos demo` (synthetic Notion workspace, in-process fake APIs, no network) in a fresh
 *      temporary directory with a scrubbed environment (no tokens, no inherited ExitOS settings);
 *   2. starts `exitos ui --demo` on a free loopback port from that directory and fetches
 *      GET /api/state, i.e. exactly the document the local dashboard renders;
 *   3. validates it with the built @exitos/core schema (DashboardStateSchema);
 *   4. SCRUBS machine-specific strings (the temporary directory, the repository path) and then
 *      ASSERTS that none remain: no absolute file-system paths, no user or host names, no
 *      token-shaped strings, no unexpected URL hosts, and that the mode is `demo` everywhere;
 *   5. writes the document, and only that file, to apps/web/dist-demo/demo-state.json.
 *
 * It fails loudly (exit 1, nothing written) if any check fails. It never contacts a service.
 */
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PATTERNS as SECRET_PATTERNS } from './check-secrets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'apps', 'cli', 'dist', 'bin.js');
const coreSchema = join(root, 'packages', 'core', 'dist', 'schema', 'index.js');
const outDir = join(root, 'apps', 'web', 'dist-demo');
const outFile = join(outDir, 'demo-state.json');

/** A problem with a message meant for the person running the build (no stack trace). */
class Failure extends Error {}

function fail(message) {
  throw new Failure(message);
}

// ---- preflight ---------------------------------------------------------------------------------
function preflight() {
  const missing = [bin, coreSchema].filter((file) => !existsSync(file));
  if (missing.length > 0) {
    fail(
      `the CLI and @exitos/core are not built (missing ${missing
        .map((file) => relative(root, file))
        .join(', ')}).\n  Run \`pnpm build\` first, then \`pnpm build:demo\`.`,
    );
  }
}

function requireStaticBuild() {
  if (!existsSync(join(outDir, 'index.html'))) {
    fail(
      `the static demo has not been built (missing ${relative(root, join(outDir, 'index.html'))}).\n` +
        '  Run `pnpm build:demo`, which builds it first and then records the data.',
    );
  }
}

// ---- what counts as a leak -------------------------------------------------------------------------

/** Hosts that appear in the engine's synthetic data. Anything else needs a human look. */
const ALLOWED_HOSTS = new Set(['www.notion.so', 'app.clickup.com', 'example.com']);

/** Substrings that identify a file-system location, a user or a machine. */
const PATH_PATTERNS = [
  ['an absolute /Users path', /\/Users\//],
  ['an absolute /home path', /\/home\//],
  ['an absolute /private path', /\/private\//],
  ['an absolute /var/folders path', /\/var\/folders/],
  ['an absolute /tmp path', /(?:^|[^A-Za-z0-9])\/tmp\//],
  ['an absolute /root path', /(?:^|[^A-Za-z0-9])\/root(?:\/|$)/],
  ['a Windows drive path', /\b[A-Za-z]:[\\/]/],
  ['a Windows UNC path', /\\\\[A-Za-z0-9.$_-]+\\/],
  ['a file: URL', /\bfile:\/\//i],
  ['a home-relative path', /(?:^|\s)~\//],
];

/** Credential shapes beyond scripts/check-secrets.mjs. */
const EXTRA_SECRET_PATTERNS = [
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ['bearer credential', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i],
  ['API key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Authorization header', /\bAuthorization\s*:/i],
];

/** Account names too generic to search for as words ("root cause" is ordinary prose). */
const GENERIC_NAMES = new Set(['root', 'user', 'users', 'admin', 'ubuntu', 'runner', 'node']);

/**
 * Things that identify this machine or the person running the build: [needle, description,
 * wholeWord]. Locations are searched as substrings; account and host names as whole words.
 */
function machineIdentifiers(extra) {
  const values = new Map();
  const addLocation = (what, value) => {
    if (typeof value === 'string' && value.length >= 4) values.set(value, { what, word: false });
  };
  const addName = (what, value) => {
    if (typeof value !== 'string' || value.length < 3) return;
    if (GENERIC_NAMES.has(value.toLowerCase())) return;
    values.set(value, { what, word: true });
  };
  for (const [what, value] of extra) addLocation(what, value);
  addLocation('the repository path', root.replace(/[\\/]+$/, ''));
  addLocation('the temporary directory root', tmpdir());
  addLocation('the home directory', homedir());
  addName('the host name', hostname());
  try {
    addName('the user name', userInfo().username);
  } catch {
    /* no passwd entry (some containers) */
  }
  addName('the user name', process.env.USER);
  addName('the user name', process.env.LOGNAME);
  addName('the user name', process.env.USERNAME);
  return values;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every string in a JSON value, keys included, with a path for error messages. */
function* strings(value, path = '$') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* strings(value[i], `${path}[${i}]`);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      yield [`${path}.${key} (key)`, key];
      yield* strings(inner, `${path}.${key}`);
    }
  }
}

/** Replaces `needle` everywhere in a JSON value; returns the new value and how many were replaced. */
function replaceEverywhere(value, needle, replacement) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      const parts = v.split(needle);
      count += parts.length - 1;
      return parts.join(replacement);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, inner]) => [walk(k), walk(inner)]));
    }
    return v;
  };
  return [walk(value), count];
}

/** @returns {string[]} one human-readable problem per leak found */
function findLeaks(state, identifiers) {
  const problems = [];
  const hosts = new Set();
  for (const [path, text] of strings(state)) {
    for (const [what, pattern] of PATH_PATTERNS) {
      if (pattern.test(text)) problems.push(`${path}: contains ${what}`);
    }
    for (const [what, pattern] of [...SECRET_PATTERNS, ...EXTRA_SECRET_PATTERNS]) {
      if (pattern.test(text)) problems.push(`${path}: looks like a credential (${what})`);
    }
    for (const [needle, { what, word }] of identifiers) {
      const found = word
        ? new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(needle)}(?![A-Za-z0-9])`).test(text)
        : text.includes(needle);
      if (found) problems.push(`${path}: contains ${what} ("${needle}")`);
    }
    for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi)) {
      try {
        hosts.add(new URL(match[0]).host);
      } catch {
        problems.push(`${path}: contains a URL that cannot be parsed (${match[0].slice(0, 60)})`);
      }
    }
  }
  for (const host of hosts) {
    if (!ALLOWED_HOSTS.has(host) && !/(^|\.)example\.(com|org|net)$/.test(host)) {
      problems.push(
        `the state mentions the host "${host}", which is not one of the engine's synthetic hosts ` +
          `(${[...ALLOWED_HOSTS].join(', ')}); check it, then add it to ALLOWED_HOSTS if it is fake`,
      );
    }
  }
  return problems;
}

function assertDemoMode(state) {
  const problems = [];
  if (state.mode !== 'demo') problems.push(`state.mode is "${state.mode}", not "demo"`);
  if (state.plan === null) problems.push('state.plan is null: there is nothing to show');
  else if (state.plan.mode !== 'demo') problems.push(`plan.mode is "${state.plan.mode}"`);
  if (state.run === null) problems.push('state.run is null: the demo did not run');
  else {
    if (state.run.mode !== 'demo') problems.push(`run.mode is "${state.run.mode}"`);
    if (state.run.status !== 'verified') {
      problems.push(`run.status is "${state.run.status}", not "verified"`);
    }
  }
  for (const run of state.runs) {
    if (run.mode !== 'demo') problems.push(`runs contains a ${run.mode}-mode run (${run.runId})`);
  }
  if (state.report === null) problems.push('state.report is null');
  else if (state.report.mode !== 'demo') problems.push(`report.mode is "${state.report.mode}"`);
  if (state.verification === null) problems.push('state.verification is null');
  else if (state.verification.status !== 'passed') {
    problems.push(`verification.status is "${state.verification.status}", not "passed"`);
  }
  if (state.events.length === 0) problems.push('state.events is empty: there is nothing to replay');
  return problems;
}

// ---- run the real engine -------------------------------------------------------------------------

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function recordState(work, home) {
  // No tokens, no inherited ExitOS settings: the same recipe as the browser tests.
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    USERPROFILE: home,
    NO_COLOR: '1',
    TZ: 'UTC',
    // The UI only needs *a* built dashboard to start; this one is already on disk.
    EXITOS_WEB_DIST: outDir,
  };

  const demo = spawnSync(process.execPath, [bin, 'demo', '--no-color'], {
    cwd: work,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (demo.status !== 0) {
    fail(`\`exitos demo\` failed (exit ${demo.status}):\n${demo.stdout}\n${demo.stderr}`);
  }
  if (!/OFFLINE DEMO/.test(demo.stdout)) {
    fail('`exitos demo` did not print its OFFLINE DEMO banner; refusing to record its output.');
  }

  const port = await freePort();
  const child = spawn(process.execPath, [bin, 'ui', '--demo', '--port', String(port)], {
    cwd: work,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) fail(`\`exitos ui\` exited early:\n${output}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) fail(`\`exitos ui\` did not become healthy:\n${output}`);
      await sleep(100);
    }
    const response = await fetch(`${base}/api/state`);
    if (!response.ok) fail(`GET /api/state answered HTTP ${response.status}`);
    return JSON.parse(await response.text());
  } finally {
    child.kill('SIGTERM');
    await sleep(150);
  }
}

// ---- main ------------------------------------------------------------------------------------------
async function main() {
  preflight();
  if (process.argv.includes('--preflight')) return;
  requireStaticBuild();
  // A failed run must never leave an older recording behind to be published by mistake.
  rmSync(outFile, { force: true });

  const tempRoot = mkdtempSync(join(tmpdir(), 'exitos-demo-state-'));
  try {
    const realTemp = realpathSync(tempRoot);
    const work = join(realTemp, 'work');
    const home = join(realTemp, 'home');
    mkdirSync(work);
    mkdirSync(home);

    let state = await recordState(work, home);

    // 1. schema
    const { DashboardStateSchema } = await import(pathToFileURL(coreSchema).href);
    const parsed = DashboardStateSchema.safeParse(state);
    if (!parsed.success) {
      fail(
        `the recorded state does not match DashboardStateSchema:\n${parsed.error.issues
          .slice(0, 10)
          .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
          .join('\n')}`,
      );
    }

    // 2. scrub what is known to be machine-specific, then assert nothing is left
    const identifiers = machineIdentifiers([
      ['the temporary directory', realTemp],
      ['the temporary directory', tempRoot],
      ['the temporary directory name', basename(tempRoot)],
    ]);
    const scrubs = [
      [realTemp, '<demo-workdir>'],
      [tempRoot, '<demo-workdir>'],
      [root.replace(/[\\/]+$/, ''), '<repository>'],
    ];
    for (const [needle, replacement] of scrubs) {
      if (needle.length < 4) continue;
      let count;
      [state, count] = replaceEverywhere(state, needle, replacement);
      if (count > 0) {
        console.warn(`build-demo-state: scrubbed ${count} occurrence(s) of ${replacement}`);
      }
    }

    const problems = [...assertDemoMode(state), ...findLeaks(state, identifiers)];
    if (problems.length > 0) {
      const shown = problems.slice(0, 25).map((problem) => `  - ${problem}`);
      if (problems.length > shown.length) {
        shown.push(`  ... and ${problems.length - shown.length} more`);
      }
      fail(`refusing to write demo-state.json:\n${shown.join('\n')}`);
    }

    // 3. write exactly one file, inside dist-demo
    const target = resolve(outFile);
    if (!target.startsWith(resolve(outDir) + sep)) fail(`refusing to write outside ${outDir}`);
    const json = JSON.stringify(state);
    writeFileSync(target, json);

    const raw = Buffer.byteLength(json);
    const gzip = gzipSync(json, { level: 9 }).length;
    const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
    console.log(`build-demo-state: wrote ${relative(root, target)}`);
    console.log(`  size   ${raw} bytes (${kib(raw)}) raw, ${gzip} bytes (${kib(gzip)}) gzip`);
    console.log(
      `  engine ExitOS ${state.exitosVersion}, mode ${state.mode}, plan ${state.plan.planId}, ` +
        `run ${state.run.status}`,
    );
    console.log(
      `  data   ${state.events.length} events, ${state.plan.actions.length} planned actions, ` +
        `${state.verification.counts.verified} verified`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

// The checks are exported so the unit tests can prove they catch what they claim to catch.
export { assertDemoMode, findLeaks, machineIdentifiers, replaceEverywhere };

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (error) => {
      if (error instanceof Failure) console.error(`build-demo-state: ${error.message}`);
      else console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exit(1);
    },
  );
}
