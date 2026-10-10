/**
 * The static online demo (apps/web/dist-demo), served like GitHub Pages serves it: from a SUB-PATH,
 * by a file server that sends no headers, so the page's own <meta> CSP is the only policy.
 *
 * Every figure the tests expect is read from the recorded demo-state.json, never typed in.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { DEMO_DIST, DEMO_STATE_FILE, ENV, requiredEnv } from './support/paths.js';
import { startStaticSite } from './support/static-server.js';

interface Recorded {
  mode: string;
  exitosVersion: string;
  plan: {
    source: {
      workspace: { name: string };
      selection: { pages?: Array<{ name: string }> };
    };
    collections: Array<{ name: string; recordCount: number }>;
    summary: {
      items: Record<'supported' | 'transformed' | 'lossy' | 'unsupported', number>;
      fields: Record<'supported' | 'transformed' | 'lossy' | 'unsupported', number>;
    };
    mappings: unknown[];
    options: Record<string, unknown>;
  };
  run: { runId: string; status: string; counts: Record<string, number> };
  events: Array<{ id: number; type: string; message: string }>;
  verification: {
    status: string;
    counts: { verified: number; mismatched: number; missing: number; unverified: number };
    scope: string;
  };
}

const recorded = JSON.parse(readFileSync(DEMO_STATE_FILE, 'utf8')) as Recorded;
const fmt = (n: number): string => n.toLocaleString('en-US');
const counts = recorded.run.counts;
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const done = (counts.succeeded ?? 0) + (counts.skipped ?? 0);

const STEPS = [
  'Select a sample Notion workspace',
  'Inspect the source',
  'Preview compatibility',
  'View the migration mapping',
  'Simulate the migration',
  'Review the verification report',
] as const;

/** The policy of the brief, written out on purpose: the page must carry exactly this. */
const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const site = (): string => requiredEnv(ENV.staticDemo);

interface Traffic {
  requests: string[];
  failed: string[];
  badStatus: string[];
}

/** Record every request and response, and never let anything leave this machine. */
async function watchTraffic(page: Page): Promise<Traffic> {
  const traffic: Traffic = { requests: [], failed: [], badStatus: [] };
  const origin = new URL(site()).origin;
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  page.on('request', (request) => traffic.requests.push(request.url()));
  page.on('requestfailed', (request) => traffic.failed.push(request.url()));
  page.on('response', (response) => {
    if (response.status() >= 400) traffic.badStatus.push(`${response.status()} ${response.url()}`);
  });
  return traffic;
}

async function open(page: Page): Promise<Traffic> {
  const traffic = await watchTraffic(page);
  await page.goto(site());
  await expect(page.getByTestId('tour')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Verification report' })).toBeAttached();
  return traffic;
}

const bar = (page: Page) => page.getByTestId('tour-bar');
const next = (page: Page) => page.getByTestId('tour-next');
const back = (page: Page) => page.getByTestId('tour-back');
const position = (page: Page) => page.getByTestId('tour-position');

async function goToStep(page: Page, index: number): Promise<void> {
  await page
    .getByTestId('tour-steps')
    .getByRole('button', { name: STEPS[index] ?? '', exact: false })
    .click();
  await expect(page.locator('[data-testid=tour-step][aria-current=step]')).toContainText(
    STEPS[index] ?? '',
  );
}

test.describe('static online demo: what it is', () => {
  test('is served from a sub-path, makes only same-site requests, never calls an API', async ({
    page,
    monitor,
  }) => {
    await page.clock.install();
    const traffic = await open(page);
    await expect(page).toHaveTitle('ExitOS online demo (synthetic data)');

    const base = site();
    expect(base).toMatch(/\/EXITOS\/$/);
    expect(traffic.requests.length).toBeGreaterThanOrEqual(4);
    for (const url of traffic.requests) expect(url.startsWith(base), url).toBe(true);
    expect(traffic.requests.filter((u) => u.includes('/api/') || u.endsWith('/api'))).toEqual([]);

    // the recording is requested exactly once, relative to the page
    expect(traffic.requests.filter((u) => u === `${base}demo-state.json`)).toHaveLength(1);
    expect(traffic.requests.some((u) => u.startsWith(`${base}assets/index-`))).toBe(true);

    // ... and nothing polls: a minute of page time brings no request at all
    const before = traffic.requests.length;
    await page.clock.runFor(70_000);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(traffic.requests.length).toBe(before);

    expect(traffic.failed).toEqual([]);
    expect(traffic.badStatus).toEqual([]);
    expect(monitor.problems).toEqual([]);
    expect(monitor.pageErrors).toEqual([]);
    expect(monitor.dialogs).toEqual([]);
    expect(await monitor.cspViolations()).toEqual([]);
  });

  test('also works from any other folder', async ({ page, monitor }) => {
    const other = await startStaticSite(DEMO_DIST, '/a/deeply/nested/folder/');
    try {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(other.url);
      await expect(page.getByTestId('tour')).toBeVisible();
      await expect(page.getByTestId('sample-card')).toContainText(
        recorded.plan.source.workspace.name,
      );
      expect(requests.every((url) => url.startsWith(other.url))).toBe(true);
      expect(monitor.problems).toEqual([]);
      expect(await monitor.cspViolations()).toEqual([]);
    } finally {
      await other.close();
    }
  });

  test('carries its Content-Security-Policy in a meta tag, first in the head, and enforces it', async ({
    page,
    request,
  }) => {
    const html = await (await request.get(site())).text();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//i);
    expect(html).not.toMatch(/(?:src|href)=["']\//i); // every URL is relative

    const response = await request.get(site());
    expect(response.headers()['content-security-policy']).toBeUndefined();

    await watchTraffic(page);
    await page.addInitScript(() => {
      (window as unknown as { __violations: string[] }).__violations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        (window as unknown as { __violations: string[] }).__violations.push(
          `${event.violatedDirective}|${event.blockedURI}`,
        );
      });
    });
    await page.goto(site());
    await expect(page.getByTestId('tour')).toBeVisible();

    const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
    await expect(meta).toHaveCount(1);
    await expect(meta).toHaveAttribute('content', EXPECTED_CSP);
    const beforeScripts = await page.evaluate(() => {
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const script = document.querySelector('script');
      const link = document.querySelector('link[rel="stylesheet"]');
      if (!csp || !script || !link) return false;
      const first = Node.DOCUMENT_POSITION_FOLLOWING;
      return (
        (csp.compareDocumentPosition(script) & first) !== 0 &&
        (csp.compareDocumentPosition(link) & first) !== 0
      );
    });
    expect(beforeScripts).toBe(true);

    // The policy really is enforced: an inline script, a remote fetch and an inline style are refused.
    const probe = await page.evaluate(async () => {
      let inlineRan = false;
      (window as unknown as { __inline: () => void }).__inline = () => {
        inlineRan = true;
      };
      const script = document.createElement('script');
      script.textContent = 'window.__inline()';
      document.head.appendChild(script);
      let fetchError = '';
      try {
        await fetch('https://example.com/probe', { mode: 'no-cors' });
      } catch (error) {
        fetchError = String(error);
      }
      const style = document.createElement('div');
      style.setAttribute('style', 'color: red');
      document.body.appendChild(style);
      const frame = document.createElement('iframe');
      frame.src = 'https://example.com/';
      document.body.appendChild(frame);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        inlineRan,
        fetchError,
        violations: (window as unknown as { __violations: string[] }).__violations,
      };
    });
    expect(probe.inlineRan).toBe(false);
    expect(probe.fetchError).not.toBe('');
    const directives = probe.violations.map((v) => v.split('|')[0]);
    expect(directives).toEqual(
      expect.arrayContaining(['script-src-elem', 'connect-src', 'style-src-attr']),
    );
    expect(directives.some((d) => d?.startsWith('default-src') || d === 'frame-src')).toBe(true);
  });

  test('says DEMO at all times, and never claims to be connected or live', async ({ page }) => {
    await open(page);
    const badge = page.getByTestId('mode-badge');
    await expect(badge).toHaveAttribute('data-mode', 'static-demo');
    await expect(badge).toContainText('DEMO');
    await expect(badge).toContainText('Replay of a recorded run on synthetic data');
    await expect(page.getByTestId('demo-banner')).toContainText(
      'This page cannot connect to Notion or ClickUp.',
    );
    await expect(page.getByTestId('demo-banner')).toContainText(
      'real ExitOS engine running its offline demo against a synthetic workspace and fake APIs',
    );
    await expect(page.getByTestId('demo-banner')).toContainText('pre-release');
    await expect(page.locator('header .mode-demo')).toBeVisible();

    // the badge stays on screen wherever the page is scrolled, and through the whole tour
    const check = async (): Promise<void> => {
      await expect(badge).toBeInViewport({ ratio: 1 });
    };
    await check();
    for (let i = 1; i < STEPS.length; i += 1) {
      await next(page).click();
      await check();
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await check();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await check();

    await expect(page.getByRole('banner')).not.toContainText(/\bLIVE\b|NOT CONNECTED/);
    await expect(page.getByRole('main')).not.toContainText(/\bLIVE\b/);
    await expect(page.getByRole('main')).not.toContainText(/connected to (Notion|ClickUp)/i);
    await expect(page.getByRole('main')).not.toContainText(/zero data loss(?!")/i);
    expect(
      await page.getByTestId('mode-badge').getByText('OFFLINE DEMO', { exact: true }).count(),
    ).toBe(0);
  });

  test('the Progress section describes a recording: no server, no polling, no refresh button', async ({
    page,
  }) => {
    await open(page);
    const progress = page.locator('#progress');
    await expect(progress.getByTestId('polling-text')).toContainText('this page does not poll');
    await expect(progress.getByTestId('refresh')).toHaveCount(0);
    await expect(progress.getByTestId('last-updated')).toHaveCount(0);
    await expect(progress.getByTestId('count-succeeded')).toHaveText(fmt(counts.succeeded ?? 0));
  });

  test('keeps nothing: no storage, no cookies, and a reload starts the tour over', async ({
    page,
  }) => {
    await open(page);
    await next(page).click();
    await next(page).click();
    await expect(position(page)).toContainText('Step 3 of 6');
    const stored = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
      databases: (await indexedDB.databases()).length,
      hash: location.hash,
    }));
    expect(stored).toEqual({ local: 0, session: 0, cookie: '', databases: 0, hash: '' });
    await page.reload();
    await expect(page.getByTestId('tour')).toBeVisible();
    await expect(position(page)).toContainText('Step 1 of 6');
  });
});

test.describe('static online demo: when the recording cannot be shown', () => {
  test('a missing recording is an honest error, still labelled DEMO, and Retry works', async ({
    page,
    monitor,
  }) => {
    let blocked = true;
    await page.route('**/demo-state.json', (route) =>
      blocked ? route.fulfill({ status: 404, body: 'not found' }) : route.continue(),
    );
    await watchTraffic(page);
    await page.goto(site());
    const error = page.getByTestId('error-screen');
    await expect(error).toContainText('demo-state.json');
    await expect(error).toContainText('HTTP 404');
    await expect(page.getByTestId('mode-badge')).toContainText('DEMO');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await expect(page.getByTestId('mode-badge')).not.toContainText(/LIVE|connected/i);

    blocked = false;
    await page.getByTestId('retry').click();
    await expect(page.getByTestId('tour')).toBeVisible();
    await expect(error).toHaveCount(0);
    expect(await monitor.cspViolations()).toEqual([]);
  });

  test('a recording that is not a demo is refused, never shown as if it were real data', async ({
    page,
  }) => {
    const recordedCopy = structuredClone(recorded);
    recordedCopy.mode = 'live';
    await page.route('**/demo-state.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(recordedCopy) }),
    );
    await watchTraffic(page);
    await page.goto(site());
    await expect(page.getByTestId('error-screen')).toContainText('not a demo recording');
    await expect(page.getByTestId('tour')).toHaveCount(0);
    await expect(page.locator('#overview')).toHaveCount(0);
  });

  test('downloads are built in the browser from the page itself: nothing is fetched', async ({
    page,
    monitor,
  }) => {
    const traffic = await open(page);
    const before = traffic.requests.length;
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-report').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^migration-report-plan_[0-9a-f]{12}\.json$/);
    const saved = await download.path();
    const report = JSON.parse(readFileSync(saved, 'utf8')) as { mode: string };
    expect(report.mode).toBe('demo');
    expect(traffic.requests.slice(before).filter((u) => !u.startsWith('blob:'))).toEqual([]);
    expect(await monitor.cspViolations()).toEqual([]);
  });
});

test.describe('static online demo: the six steps', () => {
  test('are an ordered list with aria-current, Back and Next', async ({ page }) => {
    await open(page);
    const list = page.getByRole('list', { name: 'Tour steps' });
    expect(await list.evaluate((el) => el.tagName)).toBe('OL');
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) await expect(items.nth(i)).toContainText(STEPS[i] ?? '');
    await expect(page.locator('[data-testid=tour-step][aria-current=step]')).toHaveCount(1);

    // bounds: Back does nothing on step one
    await expect(back(page)).toHaveAttribute('aria-disabled', 'true');
    await back(page).click({ force: true });
    await expect(position(page)).toContainText('Step 1 of 6');

    for (let i = 1; i < 6; i += 1) {
      await next(page).click();
      await expect(position(page)).toContainText(`Step ${i + 1} of 6 · ${STEPS[i]}`);
      await expect(items.nth(i)).toHaveAttribute('aria-current', 'step');
      await expect(page.locator('[data-testid=tour-step][aria-current=step]')).toHaveCount(1);
      await expect(page.getByTestId('tour-step-title')).toHaveText(
        `Step ${i + 1} of 6: ${STEPS[i]}`,
      );
    }
    // ... and Next does nothing on the last one
    await expect(next(page)).toHaveAttribute('aria-disabled', 'true');
    await next(page).click({ force: true });
    await expect(position(page)).toContainText('Step 6 of 6');

    await back(page).click();
    await expect(position(page)).toContainText('Step 5 of 6');
    await goToStep(page, 1);
    await expect(position(page)).toContainText('Step 2 of 6');
    await expect(page.getByTestId('tour-announcer')).toContainText(
      'Step 2 of 6: Inspect the source',
    );
  });

  test('1 · there is exactly one sample workspace, and it says so', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('sample-count')).toHaveText('1 sample workspace available.');
    await expect(page.getByTestId('tour-step-body')).toContainText(
      'there are no others to choose from',
    );
    const card = page.getByTestId('sample-card');
    await expect(page.getByTestId('sample-card')).toHaveCount(1);
    await expect(card).toContainText(recorded.plan.source.workspace.name);
    await expect(card).toContainText('synthetic');

    const items = card.getByTestId('sample-collections').getByRole('listitem');
    await expect(items).toHaveCount(recorded.plan.collections.length);
    for (const collection of recorded.plan.collections) {
      await expect(card.getByTestId('sample-collections')).toContainText(
        `${collection.name}: ${fmt(collection.recordCount)} ${collection.recordCount === 1 ? 'row' : 'rows'}`,
      );
    }
    const pages = recorded.plan.source.selection.pages ?? [];
    expect(pages.length).toBeGreaterThan(0);
    await expect(card.getByTestId('sample-pages').getByRole('listitem')).toHaveCount(pages.length);
    for (const entry of pages) await expect(card).toContainText(entry.name);
    if (recorded.plan.options.experimentalDocs === true) {
      await expect(card).toContainText('experimental');
    }

    await expect(card.getByTestId('tour-open-sample')).toBeVisible();
    await expect(position(page)).toContainText('Step 1 of 6');
    await card.getByTestId('tour-open-sample').click();
    await expect(position(page)).toContainText('Step 2 of 6');
    await expect(page.getByRole('region', { name: 'Source and destination' })).toHaveClass(
      /tour-highlight/,
    );
    // back on step one the card remembers it was opened
    await back(page).click();
    await expect(page.getByTestId('sample-card')).toContainText('opened');
  });

  test('2, 3, 4 and 6 scroll to the real sections and highlight them; the sections stay', async ({
    page,
  }) => {
    await open(page);
    const targets: Array<[number, string, string]> = [
      [1, 'source-destination', 'Source and destination'],
      [2, 'compatibility', 'Compatibility summary'],
      [3, 'mapping', 'Mapping preview'],
      [5, 'verification', 'Verification report'],
    ];
    const ids = await page.locator('main section[id]').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual([
      'tour',
      'overview',
      'source-destination',
      'compatibility',
      'mapping',
      'unsupported',
      'progress',
      'verification',
      'run-it-for-real',
    ]);

    for (const [index, id, heading] of targets) {
      await goToStep(page, index);
      const section = page.locator(`#${id}`);
      await expect(section).toHaveClass(/tour-highlight/);
      await expect(page.locator('.tour-highlight')).toHaveCount(1);
      await expect(section.getByTestId('tour-flag')).toContainText(`step ${index + 1} of 6`);
      const title = page.getByRole('heading', { level: 2, name: heading, exact: true });
      await expect(title).toBeInViewport({ ratio: 1 });
      // not hidden under the sticky header or the tour bar
      const covered = await title.evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        const header =
          document.querySelector('header.app-header')?.getBoundingClientRect().bottom ?? 0;
        const controls = document.querySelector('[data-testid=tour-bar]')?.getBoundingClientRect();
        return {
          top,
          header,
          barBottom: controls ? controls.bottom : 0,
          barTop: controls?.top ?? 0,
        };
      });
      expect(covered.top).toBeGreaterThanOrEqual(covered.header);
      if (covered.barTop < covered.top)
        expect(covered.top).toBeGreaterThanOrEqual(covered.barBottom);
      // the controls are still on screen while the section is
      await expect(next(page)).toBeInViewport();
      await expect(back(page)).toBeInViewport();
    }

    // moving on removes the highlight
    await goToStep(page, 4);
    await expect(page.locator('.tour-highlight')).toHaveCount(0);
    await expect(page.getByTestId('tour')).toBeInViewport();
    // every real section is still on the page
    for (const id of [
      'overview',
      'source-destination',
      'compatibility',
      'mapping',
      'verification',
    ]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });

  test('2 · 3 · 4 quote the recording, not a script', async ({ page }) => {
    await open(page);
    const { items, fields } = recorded.plan.summary;
    await goToStep(page, 1);
    const body = page.getByTestId('tour-step-body');
    await expect(body).toContainText(recorded.plan.source.workspace.name);
    const rows = recorded.plan.collections.reduce((sum, c) => sum + c.recordCount, 0);
    await expect(body).toContainText(`${fmt(rows)} rows in total`);

    await goToStep(page, 2);
    const outcomes = page.getByTestId('tour-outcomes');
    for (const [name, key] of [
      ['Preserved', 'supported'],
      ['Transformed', 'transformed'],
      ['Requires review', 'lossy'],
      ['Unsupported', 'unsupported'],
    ] as const) {
      await expect(outcomes.getByRole('listitem').filter({ hasText: name })).toContainText(
        fmt(items[key]),
      );
    }

    await goToStep(page, 3);
    await expect(page.getByTestId('tour-mapping-facts')).toContainText(
      `${recorded.plan.mappings.length} field mappings across ${recorded.plan.collections.length} collections`,
    );
    await expect(page.getByTestId('tour-mapping-facts')).toContainText(
      `${fmt(fields.supported)} preserved, ${fmt(fields.transformed)} transformed, ${fmt(fields.lossy)} require review, ${fmt(fields.unsupported)} unsupported`,
    );
  });

  test('6 · reviews the recorded verification result and highlights it', async ({ page }) => {
    await open(page);
    await goToStep(page, 5);
    const v = recorded.verification;
    const result = page.getByTestId('tour-verification-result');
    await expect(result).toHaveAttribute('data-status', v.status);
    await expect(result).toContainText(v.status.toUpperCase());
    await expect(result).toContainText(
      `${fmt(v.counts.verified)} items of ${fmt(v.counts.verified + v.counts.mismatched + v.counts.missing + v.counts.unverified)} matched the plan`,
    );
    await expect(page.getByTestId('tour-step-body')).toContainText(
      'not a claim that nothing was lost',
    );

    // the real section says the same, and its result carries the highlight ring
    const section = page.locator('#verification');
    await expect(section.getByTestId('vcount-verified')).toHaveText(fmt(v.counts.verified));
    await expect(section.getByTestId('vcount-mismatched')).toHaveText(fmt(v.counts.mismatched));
    await expect(section.getByTestId('verification-status')).toHaveText(v.status.toUpperCase());
    const banner = section.getByTestId('verification-banner');
    await expect(banner).toBeInViewport();
    expect(await banner.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await expect(section.getByTestId('verification-scope')).toContainText(v.scope.slice(0, 40));
  });
});

test.describe('static online demo: the replay (real time)', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('takes about nine seconds, advances monotonically and ends at the recorded totals', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page);
    await goToStep(page, 4);

    const panel = page.getByTestId('replay-panel');
    await expect(page.getByTestId('replay-label')).toHaveText(
      'Replay of a recorded offline run, not a live migration',
    );
    await expect(panel).toHaveAttribute('data-mode', 'idle');
    await expect(page.getByTestId('replay-count')).toHaveText(
      `0 of ${fmt(total)} actions written or skipped`,
    );
    await expect(page.getByTestId('replay-row')).toHaveCount(0);

    const readDone = async (): Promise<number> =>
      Number(
        (await page.getByTestId('replay-progress').getAttribute('aria-valuenow')) ?? Number.NaN,
      );
    // Time the replay inside the page (click to "done"), so the measurement does not include the
    // test runner's own delays.
    await page.evaluate(() => {
      const timing = { click: 0, done: null as number | null };
      (window as unknown as { __replay: typeof timing }).__replay = timing;
      document.querySelector('[data-testid=replay-start]')?.addEventListener(
        'click',
        () => {
          timing.click = performance.now();
        },
        { capture: true },
      );
      new MutationObserver(() => {
        const mode = document
          .querySelector('[data-testid=replay-panel]')
          ?.getAttribute('data-mode');
        if (mode === 'done' && timing.done === null) timing.done = performance.now();
      }).observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-mode'],
      });
    });
    const started = Date.now();
    await page.getByTestId('replay-start').click();
    await expect(panel).toHaveAttribute('data-mode', 'running');

    const samples: number[] = [];
    const rowSamples: number[] = [];
    while ((await panel.getAttribute('data-mode')) === 'running') {
      samples.push(await readDone());
      rowSamples.push(await page.getByTestId('replay-row').count());
      await page.waitForTimeout(400);
      if (Date.now() - started > 20_000) throw new Error('the replay did not finish');
    }
    const timing = await page.evaluate(
      () => (window as unknown as { __replay: { click: number; done: number } }).__replay,
    );
    const elapsed = Math.round(timing.done - timing.click);
    test.info().annotations.push({ type: 'replay-duration-ms', description: String(elapsed) });
    // about 9 s: the brief asks for 8 to 10 seconds
    expect(elapsed).toBeGreaterThanOrEqual(8_500);
    expect(elapsed).toBeLessThanOrEqual(10_000);

    // it moved, never backwards, never past the total, and the log grew with it
    expect(samples.length).toBeGreaterThan(10);
    expect(samples.some((n) => n > 0 && n < done)).toBe(true);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] ?? 0);
      expect(rowSamples[i]).toBeGreaterThanOrEqual(rowSamples[i - 1] ?? 0);
    }
    expect(Math.max(...samples)).toBeLessThanOrEqual(done);

    // the end is the recording, exactly
    await expect(page.getByTestId('replay-count')).toHaveText(
      `${fmt(done)} of ${fmt(total)} actions written or skipped`,
    );
    await expect(page.getByTestId('replay-percent')).toHaveText('100%');
    expect(await readDone()).toBe(done);
    await expect(page.getByTestId('replay-progress')).toHaveAttribute(
      'aria-valuemax',
      String(total),
    );
    await expect(page.getByTestId('replay-final')).toHaveText(`${fmt(done)} of ${fmt(total)}`);
    await expect(page.getByTestId('replay-result')).toContainText(
      `${recorded.verification.status.toUpperCase()}`,
    );
    const rows = page.getByTestId('replay-row');
    await expect(rows).toHaveCount(recorded.events.length);
    await expect(rows.first()).toContainText(recorded.events[0]?.message ?? 'missing');
    await expect(rows.last()).toContainText(recorded.events.at(-1)?.message ?? 'missing');
    const types = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-event-type')),
    );
    expect(types).toEqual(recorded.events.map((e) => e.type));
    await expect(page.getByTestId('replay-status')).toContainText(
      `Replay finished. ${fmt(done)} of ${fmt(total)} actions written or skipped`,
    );
    // the replay never touched the rest of the page: the Progress section still shows the recording
    await expect(page.locator('#progress').getByTestId('count-succeeded')).toHaveText(
      fmt(counts.succeeded ?? 0),
    );
  });

  test('Skip jumps to the recorded totals; Reset starts over', async ({ page }) => {
    await open(page);
    await goToStep(page, 4);
    const panel = page.getByTestId('replay-panel');
    await expect(page.getByTestId('replay-skip')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('replay-reset')).toHaveAttribute('aria-disabled', 'true');

    await page.getByTestId('replay-start').click();
    await page.waitForTimeout(1_200);
    const midway = Number(await page.getByTestId('replay-progress').getAttribute('aria-valuenow'));
    expect(midway).toBeLessThan(done);
    await page.getByTestId('replay-skip').click();
    await expect(panel).toHaveAttribute('data-mode', 'done');
    await expect(page.getByTestId('replay-count')).toHaveText(
      `${fmt(done)} of ${fmt(total)} actions written or skipped`,
    );
    await expect(page.getByTestId('replay-row')).toHaveCount(recorded.events.length);

    await page.getByTestId('replay-reset').click();
    await expect(panel).toHaveAttribute('data-mode', 'idle');
    await expect(page.getByTestId('replay-count')).toHaveText(
      `0 of ${fmt(total)} actions written or skipped`,
    );
    await expect(page.getByTestId('replay-row')).toHaveCount(0);
    await expect(page.getByTestId('replay-result')).toHaveCount(0);
    await expect(page.getByTestId('replay-start')).toHaveText('Start simulation');
  });

  test('keeps its place when the tour moves away and comes back', async ({ page }) => {
    await open(page);
    await goToStep(page, 4);
    await page.getByTestId('replay-start').click();
    await page.getByTestId('replay-skip').click();
    await goToStep(page, 1);
    await goToStep(page, 4);
    await expect(page.getByTestId('replay-panel')).toHaveAttribute('data-mode', 'done');
    await expect(page.getByTestId('replay-row')).toHaveCount(recorded.events.length);
  });
});

test.describe('static online demo: reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the replay does not animate: Start shows the finished replay at once', async ({ page }) => {
    await open(page);
    await goToStep(page, 4);
    const started = Date.now();
    await page.getByTestId('replay-start').click();
    await expect(page.getByTestId('replay-panel')).toHaveAttribute('data-mode', 'done');
    expect(Date.now() - started).toBeLessThan(1_500);
    await expect(page.getByTestId('replay-count')).toHaveText(
      `${fmt(done)} of ${fmt(total)} actions written or skipped`,
    );
    await expect(page.getByTestId('replay-row')).toHaveCount(recorded.events.length);
  });

  test('the tour jumps to sections without smooth scrolling', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe('auto');
    await goToStep(page, 3);
    await expect(page.getByRole('heading', { level: 2, name: 'Mapping preview' })).toBeInViewport({
      ratio: 1,
    });
  });
});

test.describe('static online demo: keyboard', () => {
  test('the whole tour, the replay and the copy buttons work without a mouse', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);

    const focusedTestId = (): Promise<string | null> =>
      page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
    const tabTo = async (testId: string, key = 'Tab', limit = 60): Promise<void> => {
      for (let i = 0; i < limit; i += 1) {
        await page.keyboard.press(key);
        if ((await focusedTestId()) === testId) return;
      }
      throw new Error(`${testId} was not reached with ${key} in ${limit} presses`);
    };
    const visibleFocus = async (): Promise<void> => {
      const ring = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      expect(ring.style).not.toBe('none');
      expect(ring.width).toBeGreaterThanOrEqual(2);
    };

    // step one: the button that opens the sample
    await tabTo('tour-open-sample');
    await visibleFocus();
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 2 of 6');
    // the button went away with its step; the focus moved to Next instead of being lost
    expect(await focusedTestId()).toBe('tour-next');
    await visibleFocus();

    // Enter and Space on Next walk the tour; the focus stays on it
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 3 of 6');
    await page.keyboard.press('Space');
    await expect(position(page)).toContainText('Step 4 of 6');
    expect(await focusedTestId()).toBe('tour-next');

    // Shift+Tab reaches Back; Back works from the keyboard
    await page.keyboard.press('Shift+Tab');
    expect(await focusedTestId()).toBe('tour-back');
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 3 of 6');

    // a step in the list can be chosen with the keyboard, too
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 4 of 6');
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 5 of 6');

    // step five: Start simulation (reached backwards from the bar), with Enter
    await tabTo('replay-start', 'Shift+Tab');
    await visibleFocus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('replay-count')).toHaveText(
      `${fmt(done)} of ${fmt(total)} actions written or skipped`,
    );
    // the log can be scrolled with the keyboard
    await tabTo('replay-log');
    await visibleFocus();

    // on to the end, then Next is unavailable but keeps the focus
    await tabTo('tour-next');
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 6 of 6');
    await page.keyboard.press('Enter');
    await expect(position(page)).toContainText('Step 6 of 6');
    expect(await focusedTestId()).toBe('tour-next');
    await expect(next(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('tour-verification-result')).toBeAttached();

    // "Run it for real": copy a command with the keyboard
    await tabTo('copy-run-1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('copy-run-1-status')).toContainText('Copied to clipboard');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'git clone https://github.com/Choitim/EXITOS.git',
    );
  });

  test('the skip link and the section navigation still work', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
    await nav.getByRole('link', { name: 'Compatibility' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#compatibility$/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Compatibility summary' }),
    ).toBeInViewport();
  });
});

test.describe('static online demo: run it for real', () => {
  test('gives the exact commands, copyable, and links only to the repository', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    const panel = page.getByTestId('run-it-for-real');
    await expect(panel.getByRole('heading', { level: 2, name: 'Run it for real' })).toBeVisible();

    const commands = [
      'git clone https://github.com/Choitim/EXITOS.git',
      'cd EXITOS',
      'pnpm install',
      'pnpm build',
      'pnpm exitos demo',
    ];
    await expect(panel.locator('ol > li pre code')).toHaveText(commands);
    for (const [index, command] of commands.entries()) {
      await page.getByTestId(`copy-run-${index + 1}`).click();
      await expect(page.getByTestId(`copy-run-${index + 1}-status`)).toContainText(
        'Copied to clipboard',
      );
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    }

    const repo = page.getByTestId('repo-link');
    await expect(repo).toHaveAttribute('href', 'https://github.com/Choitim/EXITOS');
    await expect(repo).toHaveAttribute('target', '_blank');
    expect(await repo.getAttribute('rel')).toMatch(/noreferrer/);
    expect(await repo.getAttribute('rel')).toMatch(/noopener/);

    const note = page.getByTestId('prerelease-note');
    await expect(note).toContainText('pre-release');
    await expect(note).toContainText('not validated against live Notion or ClickUp');
    await expect(note).toContainText('experimental');

    // that is the only link on the whole page that leads off the site
    const external = await page
      .locator('a[href]')
      .evaluateAll((els) =>
        els
          .map((el) => el.getAttribute('href') ?? '')
          .filter((href) => /^[a-z][a-z0-9+.-]*:/i.test(href)),
      );
    expect(external).toEqual(['https://github.com/Choitim/EXITOS']);
  });

  test('links inside the synthetic content are shown as text, never as links', async ({ page }) => {
    await open(page);
    const section = page.locator('#mapping');
    await section.getByTestId('task-select').selectOption({ index: 0 });
    const description = section.getByTestId('task-description');
    await expect(description).toContainText('Original Notion page');
    await expect(description.locator('a')).toHaveCount(0);
    await expect(description.locator('.md-blocked-link').first()).toBeVisible();
    await expect(page.locator('a[href*="notion.so"], a[href*="clickup.com"]')).toHaveCount(0);
  });
});

test.describe('static online demo: small screens and basics', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('at 360 px nothing scrolls sideways, in any step, and the controls are usable', async ({
    page,
  }) => {
    await open(page);
    const sideways = (): Promise<{ scroll: number; client: number }> =>
      page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
    const check = async (label: string): Promise<void> => {
      const { scroll, client } = await sideways();
      expect(scroll, `${label}: page is wider than the screen`).toBeLessThanOrEqual(client);
      const box = await bar(page).boundingBox();
      expect(box, `${label}: tour bar`).not.toBeNull();
      expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 999) <= 360).toBe(true);
      for (const id of ['tour-back', 'tour-next']) {
        const button = await page.getByTestId(id).boundingBox();
        expect(button?.height ?? 0, `${label}: ${id} is too small to tap`).toBeGreaterThanOrEqual(
          36,
        );
        expect((button?.x ?? -1) >= 0 && (button?.x ?? 0) + (button?.width ?? 999) <= 360).toBe(
          true,
        );
      }
      await expect(next(page)).toBeInViewport();
      await expect(page.getByTestId('mode-badge')).toBeInViewport();
    };

    await check('first screen');
    for (let i = 1; i < STEPS.length; i += 1) {
      await next(page).click();
      await expect(position(page)).toContainText(`Step ${i + 1} of 6`);
      if (i === 4) {
        await page.getByTestId('replay-start').click();
        await expect(page.getByTestId('replay-panel')).toHaveAttribute('data-mode', 'done');
      }
      await check(`step ${i + 1}`);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await check('bottom of the page');
    await goToStep(page, 0);
    await check('back to step 1');
  });

  test('with a much wider system font (as on Linux) nothing scrolls sideways either, in any step', async ({
    browser,
  }) => {
    // The page's Content-Security-Policy forbids injected styles, on purpose. This one test context
    // opts out of it only to swap the font for a wide one: the default fonts of a developer's laptop
    // are narrow, which once hid a 10 px overflow that a Linux CI runner then found.
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      bypassCSP: true,
    });
    const wide = await context.newPage();
    try {
      await open(wide);
      await wide.addStyleTag({
        content:
          'html, body, button, input, select, textarea { font-family: Verdana, "DejaVu Sans", sans-serif !important; }',
      });
      const overflow = (): Promise<number> =>
        wide.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      expect(await overflow(), 'first screen').toBeLessThanOrEqual(0);
      for (let i = 1; i < STEPS.length; i += 1) {
        await next(wide).click();
        await expect(position(wide)).toContainText(`Step ${i + 1} of 6`);
        if (i === 4) {
          await wide.getByTestId('replay-start').click();
          await expect(wide.getByTestId('replay-panel')).toHaveAttribute('data-mode', 'done');
        }
        expect(await overflow(), `step ${i + 1}`).toBeLessThanOrEqual(0);
      }
    } finally {
      await context.close();
    }
  });

  test('landmarks, headings, labels and focus follow the basics', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // landmarks
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Dashboard sections' })).toHaveCount(1);
    expect(await page.locator('main header, header header').count()).toBeGreaterThanOrEqual(0);
    // the tour and the demo notice are regions with a name
    await expect(page.getByRole('region', { name: 'Take the guided tour' })).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: /DEMO · Replay of a recorded run on synthetic data/ }),
    ).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Tour controls' })).toHaveCount(1);

    // headings: one h1, and no level is skipped on the way down
    const levels = await page
      .locator('h1, h2, h3, h4, h5, h6')
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect((levels[i] ?? 0) - (levels[i - 1] ?? 0), `heading #${i}`).toBeLessThanOrEqual(1);
    }

    // names: every button, link, progress bar and scrollable region says what it is
    const unnamed = await page
      .locator('button, a[href], [role=progressbar], [role=log], [role=region]')
      .evaluateAll((els) =>
        els
          .filter((el) => {
            const label =
              el.getAttribute('aria-label') ??
              el.getAttribute('aria-labelledby') ??
              (el.textContent ?? '').trim();
            return label === '';
          })
          .map((el) => el.outerHTML.slice(0, 120)),
      );
    expect(unnamed).toEqual([]);
    const duplicateIds = await page.evaluate(() => {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const el of document.querySelectorAll('[id]')) {
        if (seen.has(el.id)) dupes.push(el.id);
        seen.add(el.id);
      }
      return dupes;
    });
    expect(duplicateIds).toEqual([]);
    expect(await page.locator('img').count()).toBe(0);

    // aria-current: one step; the progress bar exposes its numbers
    await expect(
      page.getByRole('list', { name: 'Tour steps' }).locator('[aria-current="step"]'),
    ).toHaveCount(1);
    await goToStep(page, 4);
    const bar2 = page.getByTestId('replay-progress');
    await expect(bar2).toHaveAttribute('aria-valuemin', '0');
    await expect(bar2).toHaveAttribute('aria-valuemax', String(total));
    await expect(bar2).toHaveAttribute('aria-valuenow', '0');
    await expect(bar2).toHaveAttribute('aria-label', 'Replay progress');
    await expect(page.getByTestId('replay-log')).toHaveAttribute('aria-live', 'off');

    // focus is visible on the controls (a key press first, so the browser treats focus as keyboard focus)
    await page.keyboard.press('Tab');
    for (const id of ['tour-back', 'tour-next', 'replay-start']) {
      await page.getByTestId(id).focus();
      const ring = await page.getByTestId(id).evaluate((el) => {
        const style = getComputedStyle(el);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      expect(ring.style, id).not.toBe('none');
      expect(ring.width, id).toBeGreaterThanOrEqual(2);
    }
  });

  test('in dark mode the demo badge and the tour keep their contrast', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    try {
      await open(page);
      const colors = await page.getByTestId('mode-badge').evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color };
      });
      // the amber badge keeps dark text on amber in both schemes (tokens are contrast-tested)
      expect(colors.background).toBe('rgb(251, 191, 36)');
      expect(colors.color).toBe('rgb(31, 19, 0)');
      await expect(page.getByTestId('tour')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe('static online demo: the recorded data', () => {
  test('is a demo recording with no machine-specific strings', () => {
    expect(recorded.mode).toBe('demo');
    expect(recorded.run.status).toBe('verified');
    expect(recorded.verification.status).toBe('passed');
    expect(recorded.events.length).toBeGreaterThan(0);
    const text = readFileSync(DEMO_STATE_FILE, 'utf8');
    for (const forbidden of ['/Users/', '/home/', '/private/', '/var/folders', '/tmp/', 'C:\\\\']) {
      expect(text.includes(forbidden), forbidden).toBe(false);
    }
    expect(text).not.toMatch(/\bntn_|\bsecret_[A-Za-z0-9]{20}|\bpk_\d{5,}_|\bghp_|Bearer /);
  });
});
