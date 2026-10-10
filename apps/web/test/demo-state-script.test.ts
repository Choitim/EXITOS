/// <reference types="node" />
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { counts, makeRun, makeState, makeVerification } from './fixtures';

type Identifiers = Map<string, { what: string; word: boolean }>;
interface Checks {
  assertDemoMode: (state: unknown) => string[];
  findLeaks: (state: unknown, identifiers: Identifiers) => string[];
  machineIdentifiers: (extra: Array<[string, string]>) => Identifiers;
  replaceEverywhere: (value: unknown, needle: string, replacement: string) => [unknown, number];
}

// The script is plain JavaScript run by Node; it exports its checks so they can be tested here.
const script = pathToFileURL(
  new URL('../../../scripts/build-demo-state.mjs', import.meta.url).pathname,
).href;
const { assertDemoMode, findLeaks, machineIdentifiers, replaceEverywhere } = (await import(
  /* @vite-ignore */ script
)) as Checks;

const none: Identifiers = new Map();

/** A state that is fit to publish: demo mode throughout, verified, with events to replay. */
function goodState() {
  const run = makeRun({ status: 'verified', counts: counts({ succeeded: 4 }) });
  return makeState({
    run,
    runs: [run],
    verification: makeVerification({ status: 'passed' }),
    report: { mode: 'demo' } as never,
  });
}

describe('build-demo-state: demo mode', () => {
  it('accepts a verified demo recording', () => {
    expect(assertDemoMode(goodState())).toEqual([]);
  });

  it.each([
    ['live mode', { mode: 'live' as const }, 'state.mode is "live"'],
    ['no plan', { plan: null }, 'state.plan is null'],
    ['no run', { run: null }, 'state.run is null'],
    ['no events', { events: [] }, 'state.events is empty'],
    ['no verification', { verification: null }, 'state.verification is null'],
    ['no report', { report: null }, 'state.report is null'],
    [
      'a failed verification',
      { verification: makeVerification({ status: 'failed' }) },
      'verification.status is "failed"',
    ],
    ['an unfinished run', { run: makeRun({ status: 'applied' }) }, 'run.status is "applied"'],
    [
      'a live run in the history',
      { runs: [makeRun({ mode: 'live' })] },
      'runs contains a live-mode run',
    ],
  ])('refuses %s', (_name, change, message) => {
    const problems = assertDemoMode({ ...goodState(), ...change });
    expect(problems.join('\n')).toContain(message);
  });
});

describe('build-demo-state: leaks', () => {
  it('finds nothing in an ordinary synthetic state', () => {
    expect(findLeaks(goodState(), none)).toEqual([]);
  });

  it('allows the synthetic hosts the engine uses, and nothing else', () => {
    const state = goodState();
    state.run = {
      ...makeRun(),
      stopReason:
        'see https://www.notion.so/abc and https://app.clickup.com/t/1 and https://example.com/x',
    };
    expect(findLeaks(state, none)).toEqual([]);
    state.run = {
      ...makeRun(),
      stopReason: 'see https://api.stripe.com/v1 or http://127.0.0.1:4173/api/state',
    };
    const problems = findLeaks(state, none).join('\n');
    expect(problems).toContain('api.stripe.com');
    expect(problems).toContain('127.0.0.1:4173');
  });

  it.each([
    ['a macOS home path', '/Users/alice/projects/exitos'],
    ['a Linux home path', '/home/bob/.exitos/state.db'],
    ['a /private path', '/private/tmp/x'],
    ['a macOS temp path', '/var/folders/zz/abc/T/exitos-demo'],
    ['a /tmp path', 'wrote /tmp/exitos-demo/state.db'],
    ['a Windows path', 'C:\\Users\\alice\\AppData'],
    ['a file URL', 'file:///opt/exitos/state.db'],
    ['a home-relative path', 'saved to ~/exitos/state.db'],
  ])('flags %s', (_name, text) => {
    const state = goodState();
    state.run = { ...makeRun(), stopReason: text };
    const problems = findLeaks(state, none);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('$.run.stopReason');
  });

  it.each([
    ['a Notion token', `ntn_${'a1B2'.repeat(10)}`],
    ['a ClickUp token', `pk_12345678_${'A1B2C3D4'.repeat(4)}`],
    ['a GitHub token', `ghp_${'a1B2'.repeat(10)}`],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'],
    ['a bearer credential', 'Bearer abcdefghijklmnopqrstuvwx0123'],
    ['an Authorization header', 'Authorization: x'],
  ])('flags %s', (_name, text) => {
    const state = goodState();
    state.run = { ...makeRun(), stopReason: text };
    expect(findLeaks(state, none).join('\n')).toContain('looks like a credential');
  });

  it('flags a leaked temporary directory, user name or host name, wherever it hides', () => {
    const identifiers: Identifiers = new Map([
      ['exitos-demo-state-Ab12Cd', { what: 'the temporary directory name', word: false }],
      ['carol', { what: 'the user name', word: true }],
    ]);
    const state = goodState();
    state.plan = { ...(state.plan as object), planId: 'x' } as never;
    state.run = { ...makeRun(), stopReason: 'dir exitos-demo-state-Ab12Cd and user carol' };
    const problems = findLeaks(state, identifiers).join('\n');
    expect(problems).toContain('the temporary directory name');
    expect(problems).toContain('the user name ("carol")');
    // keys are scanned too
    const keyed = { ...goodState(), extra: { 'carol-key': 1 } };
    expect(findLeaks(keyed, identifiers).join('\n')).toContain('(key)');
  });

  it('matches names as whole words, so ordinary words are not flagged', () => {
    const identifiers: Identifiers = new Map([['carol', { what: 'the user name', word: true }]]);
    const state = goodState();
    state.run = { ...makeRun(), stopReason: 'carols and thcarol are other words' };
    expect(findLeaks(state, identifiers)).toEqual([]);
  });

  it('knows this machine: temp directory, home directory and repository path', () => {
    const identifiers = machineIdentifiers([['the temporary directory', '/some/work/dir']]);
    const needles = [...identifiers.keys()];
    expect(needles).toContain('/some/work/dir');
    expect(needles).toContain(tmpdir());
    expect(needles).toContain(homedir());
    expect(needles.some((n) => n.endsWith('exitos') || n.includes('exitos'))).toBe(true);
  });
});

describe('build-demo-state: scrubbing', () => {
  it('replaces a string everywhere it occurs, in keys and values, and counts it', () => {
    const [scrubbed, count] = replaceEverywhere(
      {
        '/tmp/x/work': ['a /tmp/x/work b', { deep: '/tmp/x/work/state.db' }],
        n: 1,
        ok: true,
        none: null,
      },
      '/tmp/x/work',
      '<demo-workdir>',
    );
    expect(count).toBe(3);
    expect(JSON.stringify(scrubbed)).not.toContain('/tmp/x');
    expect(scrubbed).toEqual({
      '<demo-workdir>': ['a <demo-workdir> b', { deep: '<demo-workdir>/state.db' }],
      n: 1,
      ok: true,
      none: null,
    });
  });

  it('leaves a clean value alone', () => {
    const value = { a: ['b', 1, null] };
    expect(replaceEverywhere(value, '/tmp/x', 'y')).toEqual([value, 0]);
  });
});
