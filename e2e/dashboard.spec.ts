import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, fetchState, fmt, mockState, test, urls, type ApiState } from './fixtures.js';
import { ENV, requiredEnv } from './support/paths.js';
import { HOSTILE, advanceLiveRun } from './support/states.js';

const SECTIONS = [
  { id: 'overview', nav: 'Overview', heading: 'Migration overview' },
  { id: 'source-destination', nav: 'Source & destination', heading: 'Source and destination' },
  { id: 'compatibility', nav: 'Compatibility', heading: 'Compatibility summary' },
  { id: 'mapping', nav: 'Mapping preview', heading: 'Mapping preview' },
  { id: 'unsupported', nav: 'Unsupported', heading: 'Unsupported content' },
  { id: 'progress', nav: 'Progress', heading: 'Migration progress' },
  { id: 'verification', nav: 'Verification', heading: 'Verification report' },
] as const;

const OUTCOMES = ['supported', 'transformed', 'lossy', 'unsupported'] as const;

/** What the dashboard calls each data outcome, and the plain sub-label next to it. */
const OUTCOME_LABEL = {
  supported: 'Preserved',
  transformed: 'Transformed',
  lossy: 'Requires review',
  unsupported: 'Unsupported',
} as const;
const OUTCOME_PLAIN = {
  supported: 'Moves as-is',
  transformed: 'Changes shape',
  lossy: 'Loses detail',
  unsupported: 'Cannot move',
} as const;

const number = async (locator: Locator): Promise<number> =>
  Number((await locator.innerText()).replace(/[,\s]/g, ''));

const heading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 2, name, exact: true });

async function openDemo(page: Page): Promise<ApiState> {
  await page.goto(urls.demo);
  await expect(heading(page, 'Verification report')).toBeVisible();
  return fetchState(urls.demo);
}

/**
 * Install a fake clock that is paused from the start, so that `page.clock.runFor` moves time by an
 * exact amount and the polling timers fire exactly when the clock says.
 */
async function installFrozenClock(page: Page): Promise<void> {
  const start = new Date('2026-10-08T10:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
}

function countStateRequests(page: Page): { count: () => number } {
  let n = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/state') n += 1;
  });
  return { count: () => n };
}

test.describe('offline demo', () => {
  test('loads cleanly: title, mode badge, no console noise, no CSP violations', async ({
    page,
    monitor,
  }) => {
    await openDemo(page);
    await expect(page).toHaveTitle('ExitOS Dashboard');
    const badge = page.getByTestId('mode-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('OFFLINE DEMO');
    await expect(badge).toContainText('Synthetic data · fake APIs · no network');
    await expect(badge).toHaveAttribute('data-mode', 'demo');
    await expect(page.getByTestId('mode-badge').getByText('LIVE', { exact: true })).toHaveCount(0);

    // Let a few polls and idle time pass: still nothing in the console.
    await page.getByTestId('refresh').click();
    await expect(page.getByTestId('refresh')).toHaveText('Refresh now');

    expect(monitor.problems).toEqual([]);
    expect(monitor.pageErrors).toEqual([]);
    expect(monitor.failedRequests).toEqual([]);
    expect(monitor.dialogs).toEqual([]);
    expect(await monitor.cspViolations()).toEqual([]);
  });

  test('serves a page that needs no inline script, inline style or remote resource', async ({
    page,
    request,
  }) => {
    await page.goto(urls.demo);
    const html = await (await request.get(urls.demo)).text();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//i);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets)
      expect(asset).toMatch(/\/assets\/index-[A-Za-z0-9_-]{8,}\.(js|css)$/);
    const response = await request.get(urls.demo);
    expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  });

  test('shows all seven sections, reachable from the sticky nav', async ({ page }) => {
    await openDemo(page);
    const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
    await expect(nav.getByRole('link')).toHaveCount(SECTIONS.length);

    for (const section of SECTIONS) {
      const region = page.getByRole('region', { name: section.heading, exact: true });
      await expect(region).toHaveAttribute('id', section.id);
      await expect(heading(page, section.heading)).toBeAttached();
    }
    // The sections appear in the documented order.
    const ids = await page.locator('main section[id]').evaluateAll((els) => els.map((el) => el.id));
    expect(ids).toEqual(SECTIONS.map((s) => s.id));

    for (const section of SECTIONS) {
      await nav.getByRole('link', { name: section.nav, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${section.id}$`));
      const h = heading(page, section.heading);
      await expect(h).toBeInViewport({ ratio: 1 });
      // ... and not hidden under the sticky header.
      const headerBottom = await page
        .locator('header.app-header')
        .evaluate((el) => el.getBoundingClientRect().bottom);
      const top = await h.evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(headerBottom - 1);
    }
    // The header (with the badge) stays put while scrolling.
    await expect(page.getByTestId('mode-badge')).toBeInViewport();
  });

  test('is operable from the keyboard: skip link, nav links, visible focus', async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeInViewport();
    await page.keyboard.press('Tab');
    const first = page
      .getByRole('navigation', { name: 'Dashboard sections' })
      .getByRole('link', { name: 'Overview' });
    await expect(first).toBeFocused();
    const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    const last = page
      .getByRole('navigation', { name: 'Dashboard sections' })
      .getByRole('link', { name: 'Verification' });
    await expect(last).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(heading(page, 'Verification report')).toBeInViewport();
  });

  test('overview: honest state wording, plan id, run id, counts', async ({ page }) => {
    const api = await openDemo(page);
    const banner = page.getByTestId('status-banner');
    await expect(banner).toContainText('Verified within the declared scope');
    await expect(page.getByTestId('report-headline')).toHaveText(api.report?.headline ?? 'missing');
    await expect(page.getByTestId('plan-id')).toHaveText(api.plan.planId);
    await expect(page.getByTestId('run-id')).toHaveText(api.run?.runId ?? 'missing');
    expect(await number(page.getByTestId('count-actions-total'))).toBe(
      api.plan.summary.actions.total,
    );
    expect(await number(page.getByTestId('count-actions-execute'))).toBe(
      api.plan.summary.actions.toExecute,
    );
    expect(await number(page.getByTestId('count-actions-skip'))).toBe(
      api.plan.summary.actions.toSkip,
    );
    // Not verified wording must not appear for a verified run, and the page never says "complete".
    await expect(page.locator('main')).not.toContainText(/\bcomplete(d)?\b/i);
  });

  test('"Copy approve command" copies the exact command', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const api = await openDemo(page);
    const expected = `exitos apply --plan migration-plan.json --approve ${api.plan.planId}`;
    await expect(page.locator('#overview pre code')).toHaveText(expected);
    await page.getByTestId('copy-approve').click();
    await expect(page.getByTestId('copy-approve-status')).toContainText('Copied to clipboard');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    // The confirmation goes away again by itself.
    await expect(page.getByTestId('copy-approve-status')).toBeEmpty({ timeout: 8000 });
  });

  test('source and destination: collections, targets, user mapping, options', async ({ page }) => {
    const api = await openDemo(page);
    const section = page.locator('#source-destination');
    for (const c of api.plan.collections) {
      await expect(section.getByTestId(`rows-${c.name}`)).toHaveText(fmt(c.recordCount));
    }
    await expect(section.getByText('clickup@0.1.0')).toBeVisible();
    await expect(section.getByText('notion@0.1.0')).toBeVisible();
    expect(await number(section.getByTestId('users-mapped'))).toBe(api.plan.users.mapped.length);
    expect(await number(section.getByTestId('users-unmapped'))).toBe(
      api.plan.users.unmapped.length,
    );
    expect(await number(section.getByTestId('users-notify'))).toBe(
      api.plan.users.assignmentsThatNotify,
    );
    await expect(section.getByRole('heading', { name: 'Options in effect' })).toBeVisible();
  });

  test('compatibility numbers equal plan.summary from the API', async ({ page }) => {
    const api = await openDemo(page);
    const { items, fields, notPreserved } = api.plan.summary;
    expect(api.plan.summary.actions.total).toBeGreaterThan(0);
    const section = page.locator('#compatibility');
    for (const outcome of OUTCOMES) {
      expect(await number(section.getByTestId(`items-${outcome}`))).toBe(items[outcome]);
      expect(await number(section.getByTestId(`fields-${outcome}`))).toBe(fields[outcome]);
    }
    const itemTotal = Object.values(items).reduce((a, b) => a + b, 0);
    const fieldTotal = Object.values(fields).reduce((a, b) => a + b, 0);
    expect(await number(section.getByTestId('items-total'))).toBe(itemTotal);
    expect(await number(section.getByTestId('fields-total'))).toBe(fieldTotal);
    expect(await number(section.getByTestId('notpreserved-unsupported'))).toBe(
      notPreserved.unsupported,
    );
    expect(await number(section.getByTestId('notpreserved-lossy'))).toBe(notPreserved.lossy);

    // Colour is never the only signal: every outcome row carries an icon and a word.
    const row = section
      .locator('table')
      .first()
      .getByRole('row', { name: /Transformed/ });
    await expect(row.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(row).toContainText('Changes shape');
    await expect(section.getByRole('img', { name: /Items by outcome/ })).toBeVisible();
  });

  test('mapping preview: collection filter and text search really filter the rows', async ({
    page,
  }) => {
    const api = await openDemo(page);
    const section = page.locator('#mapping');
    const rows = section.getByTestId('mapping-row');
    const total = api.plan.mappings.length;
    await expect(rows).toHaveCount(total);
    await expect(section.getByTestId('mapping-count')).toContainText(
      `Showing ${total} of ${total} mappings`,
    );

    // collection filter
    const target = api.plan.collections.find((c) =>
      api.plan.mappings.some((m) => m.collection !== c.key),
    );
    if (!target) throw new Error('the demo has a single collection');
    const expected = api.plan.mappings.filter((m) => m.collection === target.key).length;
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(total);
    await section.getByLabel('Collection').selectOption(target.key);
    await expect(rows).toHaveCount(expected);
    await expect(section.getByTestId('mapping-count')).toContainText(
      `Showing ${expected} of ${total}`,
    );
    for (const text of await rows.locator('td:first-child').allInnerTexts())
      expect(text).toBe(target.name);

    // text search on top of the collection filter
    const probe = api.plan.mappings.find((m) => m.collection === target.key);
    if (!probe) throw new Error('no mapping in the first collection');
    await section.getByLabel('Search mappings').fill(probe.source.name.toUpperCase());
    const matching = api.plan.mappings.filter(
      (m) =>
        m.collection === target.key &&
        m.source.name.toLowerCase().includes(probe.source.name.toLowerCase()),
    ).length;
    await expect(rows).toHaveCount(matching);
    await expect(rows.first()).toContainText(probe.source.name);

    // search across all collections, then something that matches nothing
    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(total);
    await section.getByLabel('Search mappings').fill('unsupported');
    const unsupported = api.plan.mappings.filter((m) => m.outcome === 'unsupported').length;
    expect(unsupported).toBeGreaterThan(0);
    expect(await rows.count()).toBeGreaterThanOrEqual(unsupported);
    await section.getByLabel('Search mappings').fill('zzz no such mapping zzz');
    await expect(rows).toHaveCount(0);
    await expect(section.getByText('No mapping matches these filters.')).toBeVisible();
  });

  test('task preview: payload fields, safe rendered Markdown, raw toggle', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const api = await openDemo(page);
    const section = page.locator('#mapping');
    const task = api.plan.actions.find(
      (a) =>
        a.kind === 'clickup.create_task' &&
        (a.payload.body as { name?: string }).name === 'Design robot arm v2 gripper',
    );
    if (!task) throw new Error('demo task not found');
    const body = task.payload.body as {
      name: string;
      markdown_content: string;
      priority: number;
      due_date: number;
      assignees: number[];
      tags: string[];
      custom_fields: unknown[];
    };

    await section.getByLabel('Filter tasks').fill('gripper v2');
    await section.getByTestId('task-select').selectOption({ index: 0 });
    const preview = section.getByTestId('task-preview');
    await expect(section.getByTestId('task-name')).toHaveText(body.name);
    await expect(preview).toContainText('High (2)');
    await expect(preview).toContainText(new Date(body.due_date).toISOString());
    await expect(
      preview.getByText('Assignees').locator('xpath=following-sibling::dd[1]'),
    ).toContainText(String(body.assignees.length));
    await expect(preview).toContainText(body.tags[0] ?? '');
    await expect(preview).toContainText('Story points');

    // rendered
    const description = section.getByTestId('task-description');
    await expect(
      description.getByRole('heading', { name: 'Gripper v2 — design notes' }),
    ).toBeVisible();
    await expect(description.locator('ul ul ul li').first()).toContainText('Shore 30A silicone');
    await expect(description.locator('ol').first()).toBeVisible();
    await expect(description.locator('table').first()).toBeVisible();
    await expect(description.locator('pre code').first()).toBeVisible();
    await expect(description.locator('blockquote').first()).toBeVisible();
    await expect(
      description.locator('strong', { hasText: 'Properties from Notion' }),
    ).toBeVisible();
    await expect(
      description.locator('code', { hasText: /^exitos-key:notion:page:/ }),
    ).toBeVisible();
    const links = description.locator('a');
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
      expect(await link.getAttribute('href')).toMatch(/^(https?:\/\/|mailto:)/);
    }
    // nothing the Markdown says can create these elements
    await expect(
      description.locator('script, iframe, img, object, embed, style, form, input'),
    ).toHaveCount(0);
    // the escaped characters in the engine's output are shown without their backslashes
    await expect(description).not.toContainText('\\*');

    // raw
    await section.getByTestId('view-raw').click();
    await expect(section.getByTestId('view-raw')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('task-description-raw')).toHaveText(body.markdown_content);
    await section.getByTestId('view-rendered').click();
    await expect(
      description.getByRole('heading', { name: 'Gripper v2 — design notes' }),
    ).toBeVisible();
  });

  test('unsupported content: outcome filter, search, plan findings, known limits', async ({
    page,
  }) => {
    const api = await openDemo(page);
    const section = page.locator('#unsupported');
    const rows = section.getByTestId('finding-row');
    const all = api.plan.inventory;
    expect(all.length).toBeGreaterThan(0);
    await expect(rows).toHaveCount(all.length);

    for (const outcome of ['unsupported', 'lossy', 'transformed'] as const) {
      const expected = all.filter((f) => f.outcome === outcome).length;
      await section.getByTestId('outcome-filter').selectOption(outcome);
      await expect(rows).toHaveCount(expected);
      await expect(section.locator('[data-testid^="finding-group-"]')).toHaveCount(1);
      await expect(section.getByTestId(`finding-group-${outcome}`)).toBeVisible();
      for (const chip of await rows.locator('th .chip').allInnerTexts())
        expect(chip).toBe(OUTCOME_LABEL[outcome]);
    }

    // search combined with a filter
    await section.getByTestId('outcome-filter').selectOption('all');
    const sample = all[0];
    if (!sample) throw new Error('inventory is empty');
    await section.getByTestId('finding-search').fill(sample.code.toLowerCase());
    const withCode = all.filter((f) =>
      f.code.toLowerCase().includes(sample.code.toLowerCase()),
    ).length;
    await expect(rows).toHaveCount(withCode);
    await section.getByTestId('finding-search').fill('zzz nothing zzz');
    await expect(rows).toHaveCount(0);
    await expect(section.getByText('No finding matches these filters.')).toBeVisible();
    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(all.length);

    // each row shows code, count, field and message
    const first = rows.first();
    await expect(first).toContainText(all[0]?.code ?? '');
    await expect(first).toContainText(all[0]?.message ?? '');

    // never-migrated list
    await expect(section.getByTestId('known-limits').getByRole('listitem')).toHaveCount(
      api.plan.knownLimits.length,
    );
    await expect(
      section.getByRole('heading', { name: 'Never migrated by this version' }),
    ).toBeVisible();
  });

  test('progress: bar, status counts, log (newest last), refresh, polling text', async ({
    page,
  }) => {
    const api = await openDemo(page);
    const run = api.run;
    if (!run) throw new Error('demo has no run');
    const section = page.locator('#progress');
    const done = (run.counts.succeeded ?? 0) + (run.counts.skipped ?? 0);
    const total = Object.values(run.counts).reduce((a, b) => a + b, 0);
    const bar = section.getByRole('progressbar', { name: 'Run progress' });
    await expect(bar).toHaveAttribute('aria-valuenow', String(done));
    await expect(bar).toHaveAttribute('aria-valuemax', String(total));
    await expect(section.getByTestId('progress-percent')).toHaveText(
      `${Math.floor((done / total) * 100)}%`,
    );
    for (const key of [
      'succeeded',
      'skipped',
      'pending',
      'in_flight',
      'ambiguous',
      'blocked',
      'failed',
    ]) {
      expect(await number(section.getByTestId(`count-${key}`))).toBe(run.counts[key]);
    }
    await expect(section.getByTestId('polling-text')).toContainText('every 10 s');
    await expect(section.getByTestId('last-updated')).toContainText(/\d{2}:\d{2}:\d{2}/);

    // newest last, scrolled to the end while auto-scroll is on
    const log = section.getByTestId('event-log');
    const messages = await log.locator('tbody tr td:last-child').allInnerTexts();
    expect(messages).toHaveLength(api.events.length);
    expect(messages[messages.length - 1]).toBe(api.events[api.events.length - 1]?.message);
    expect(messages[0]).toBe(api.events[0]?.message);
    await expect(section.getByTestId('autoscroll')).toBeChecked();
    const atEnd = await log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(atEnd).toBeLessThanOrEqual(2);

    // manual refresh really asks the server again
    const requests = countStateRequests(page);
    const before = requests.count();
    await section.getByTestId('refresh').click();
    await expect.poll(() => requests.count()).toBeGreaterThan(before);
  });

  test('verification: status, counts, targets and scope match the API', async ({ page }) => {
    const api = await openDemo(page);
    const v = api.verification;
    if (!v) throw new Error('demo has no verification');
    const section = page.locator('#verification');
    await expect(section.getByTestId('verification-status')).toHaveText('PASSED');
    expect(v.status).toBe('passed');
    for (const key of ['verified', 'mismatched', 'missing', 'unverified'] as const) {
      expect(await number(section.getByTestId(`vcount-${key}`))).toBe(v.counts[key]);
    }
    expect(v.counts.verified).toBeGreaterThan(0);
    const targets = section.getByTestId('verification-target');
    await expect(targets).toHaveCount(v.targets.length);
    for (const [i, t] of v.targets.entries()) {
      const row = targets.nth(i);
      await expect(row.getByRole('rowheader')).toHaveText(t.target);
      const cells = await row.getByRole('cell').allInnerTexts();
      expect(cells.slice(0, 2).map((c) => Number(c.replace(/,/g, '')))).toEqual([
        t.expected,
        t.found,
      ]);
    }
    await expect(section.getByTestId('verification-scope')).toHaveText(v.scope);
    await expect(section.getByTestId('no-failures')).toBeVisible();
    await expect(section.getByTestId('unverified-row')).toHaveCount(0);
    await expect(section.getByTestId('not-verified')).toHaveCount(0);
  });

  test('downloads the report and the plan as JSON files', async ({ page }) => {
    const api = await openDemo(page);
    const [reportDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-report').click(),
    ]);
    expect(reportDownload.suggestedFilename()).toBe(`migration-report-${api.plan.planId}.json`);
    const reportPath = await reportDownload.path();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      state: string;
      plan: { planId: string };
      headline: string;
    };
    expect(report.state).toBe('verified');
    expect(report.plan.planId).toBe(api.plan.planId);
    expect(report.headline).toBe(api.report?.headline);

    const [planDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-plan').click(),
    ]);
    expect(planDownload.suggestedFilename()).toBe('migration-plan.json');
    const plan = JSON.parse(readFileSync(await planDownload.path(), 'utf8')) as ApiState['plan'];
    expect(plan).toEqual(api.plan);
  });

  test('no horizontal page scroll at 375px, mode badge and nav still usable', async ({
    page,
    monitor,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDemo(page);
    await expect(page.getByTestId('mode-badge')).toBeInViewport({ ratio: 1 });
    const overflow = async (): Promise<{ page: number; offenders: string[] }> =>
      page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const offenders: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('main *, header *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= width + 1) continue;
          // wide content is fine when an ancestor scrolls it
          let p: HTMLElement | null = el.parentElement;
          let clipped = false;
          while (p && p !== document.body) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
              clipped = true;
              break;
            }
            p = p.parentElement;
          }
          if (!clipped)
            offenders.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`);
        }
        return {
          page: document.documentElement.scrollWidth - width,
          offenders: offenders.slice(0, 5),
        };
      });
    expect(await overflow()).toEqual({ page: 0, offenders: [] });
    for (const section of SECTIONS) {
      await page
        .getByRole('navigation', { name: 'Dashboard sections' })
        .getByRole('link', { name: section.nav, exact: true })
        .click();
      await expect(heading(page, section.heading)).toBeInViewport();
    }
    expect((await overflow()).page).toBe(0);
    expect(monitor.problems).toEqual([]);
  });

  test('works at 360px and with a larger text size', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openDemo(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.getByTestId('task-select').scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });

  test('respects prefers-reduced-motion for scrolling and transitions', async ({ page }) => {
    const behavior = async (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDemo(page);
    expect(await behavior()).toBe('auto');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await behavior()).toBe('smooth');
  });

  test.describe('colour schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: tokens apply, text stays readable`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openDemo(page);
        const colors = await page.evaluate(() => {
          const cs = getComputedStyle(document.body);
          const badge = getComputedStyle(
            document.querySelector('[data-testid="mode-badge"]') as Element,
          );
          return { bg: cs.backgroundColor, fg: cs.color, badge: badge.backgroundColor };
        });
        const luminance = (rgb: string): number => {
          const [r = 0, g = 0, b = 0] = (rgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        };
        if (scheme === 'dark') {
          expect(luminance(colors.bg)).toBeLessThan(0.15);
          expect(luminance(colors.fg)).toBeGreaterThan(0.8);
        } else {
          expect(luminance(colors.bg)).toBeGreaterThan(0.9);
          expect(luminance(colors.fg)).toBeLessThan(0.15);
        }
        // the amber demo badge is the same in both schemes: unmissable
        expect(colors.badge).toBe('rgb(251, 191, 36)');
      });
    }
  });
});

test.describe('failure and empty states', () => {
  test('server unreachable: clear message and a Retry that works', async ({ page }) => {
    let blocked = true;
    await page.route('**/api/state', (route) =>
      blocked ? route.abort('connectionrefused') : route.continue(),
    );
    await page.goto(urls.demo);
    const screen = page.getByTestId('error-screen');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText('could not be reached');
    await expect(screen).toContainText('exitos ui');
    await expect(page.getByTestId('mode-badge')).toContainText('NOT CONNECTED');
    blocked = false;
    await page.getByTestId('retry').click();
    await expect(heading(page, 'Migration overview')).toBeVisible();
    await expect(page.getByTestId('mode-badge')).toContainText('OFFLINE DEMO');
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
  });

  test('later failure keeps the last data and says so', async ({ page }) => {
    let failing = false;
    await page.route('**/api/state', (route) =>
      failing ? route.fulfill({ status: 500, body: 'boom' }) : route.continue(),
    );
    await page.goto(urls.demo);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    failing = true;
    await page.getByTestId('refresh').click();
    const banner = page.getByTestId('stale-banner');
    await expect(banner).toContainText('HTTP 500');
    await expect(heading(page, 'Migration overview')).toBeVisible();
    failing = false;
    await banner.getByTestId('retry').click();
    await expect(banner).toHaveCount(0);
  });

  test('a document the dashboard cannot read gives an error, not a crash', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.route('**/api/state', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 1, mode: 'demo', plan: { planId: 1 } }),
      }),
    );
    await page.goto(urls.demo);
    await expect(page.getByTestId('error-screen')).toContainText('cannot read');
    await expect(page.getByTestId('retry')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('empty state explains how to get data and shows no fake numbers', async ({
    page,
    monitor,
  }) => {
    await page.goto(urls.empty);
    const empty = page.getByTestId('empty-state');
    await expect(empty).toBeVisible();
    await expect(page.getByTestId('mode-badge')).toContainText('NO DATA YET');
    await expect(empty).toContainText('exitos demo');
    await expect(empty).toContainText('exitos ui --demo');
    await expect(empty).toContainText('exitos plan notion clickup --config');
    await expect(page.locator('main section')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Dashboard sections' })).toHaveCount(0);
    await expect(page.getByTestId('count-actions-total')).toHaveCount(0);
    expect(monitor.problems).toEqual([]);
    expect(await monitor.cspViolations()).toEqual([]);
  });
});

test.describe('security: hostile content in a plan', () => {
  test('never executes script, never creates a dangerous link or element', async ({
    page,
    monitor,
  }) => {
    await page.goto(urls.xss);
    await expect(heading(page, 'Verification report')).toBeVisible();

    // live mode is announced as LIVE, in blue, and never as the demo
    const badge = page.getByTestId('mode-badge');
    await expect(badge).toContainText('LIVE');
    await expect(badge).not.toContainText('OFFLINE DEMO');
    expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(29, 78, 216)',
    );

    // the hostile task
    const section = page.locator('#mapping');
    await section.getByLabel('Filter tasks').fill('hostile task');
    const description = section.getByTestId('task-description');
    await expect(description.getByRole('heading', { name: /^Heading <script>/ })).toBeVisible();
    await expect(description).toContainText('<img src=x onerror="window.__pwned=1;alert(1)">');
    await expect(description).toContainText(
      '<a href="javascript:alert(1)" onclick="alert(1)">raw html anchor</a>',
    );
    await expect(description).toContainText('<iframe src="javascript:alert(1)"></iframe>');
    await expect(description.locator('.md-blocked-link')).not.toHaveCount(0);
    // only the two safe https URLs became anchors: the text link and the (link-only) image
    expect(
      await description.locator('a').evaluateAll((els) => els.map((el) => el.getAttribute('href'))),
    ).toEqual(['https://example.com/safe?a=1&b=2', 'https://example.com/pixel.png']);
    await expect(description.getByRole('link', { name: '[Image: tracking pixel]' })).toBeVisible();
    await expect(description.locator('.md-blocked-link', { hasText: /^x$/ })).toHaveCount(1);

    // raw view is verbatim text
    await section.getByTestId('view-raw').click();
    await expect(section.getByTestId('task-description-raw')).toHaveText(HOSTILE.markdown);
    await section.getByTestId('view-rendered').click();

    // other hostile strings (collection name, workspace name, finding, tag, event, stop reason, ...)
    await expect(page.locator('main')).toContainText(HOSTILE.text);
    await expect(page.locator('main')).toContainText(HOSTILE.scriptText);
    await expect(page.locator('#unsupported').getByTestId('plan-errors')).toContainText(
      HOSTILE.scriptText,
    );
    await expect(page.locator('#verification').getByTestId('unverified-row').first()).toContainText(
      HOSTILE.text,
    );
    await expect(page.locator('#verification').getByTestId('verification-scope')).toContainText(
      HOSTILE.text,
    );
    await expect(page.getByTestId('status-banner')).toContainText('Verification failed');

    // the DOM contains no link that is not http(s)/mailto/in-page, and no hostile element or handler
    const dom = await page.evaluate(() => {
      const hrefs = [
        ...document.querySelectorAll('[href], [src], [action], [formaction], [data]'),
      ].map(
        (el) =>
          `${el.tagName.toLowerCase()} ${el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action') ?? ''}`,
      );
      const handlers = [...document.querySelectorAll('*')].flatMap((el) =>
        el
          .getAttributeNames()
          .filter((n) => n.startsWith('on'))
          .map((n) => `${el.tagName}.${n}`),
      );
      return {
        hrefs,
        handlers,
        hostileElements: document.querySelectorAll(
          'img, iframe, object, embed, svg[onload], form, base, meta[http-equiv], link[rel="import"]',
        ).length,
        scripts: [...document.querySelectorAll('script')].map(
          (s) => s.getAttribute('src') ?? '(inline)',
        ),
        pwned: (window as unknown as { __pwned?: unknown }).__pwned ?? null,
      };
    });
    expect(dom.pwned).toBeNull();
    expect(dom.handlers).toEqual([]);
    expect(dom.hostileElements).toBe(0);
    expect(dom.scripts).toHaveLength(1);
    expect(dom.scripts[0]).toMatch(/^\/assets\/index-.+\.js$/);
    for (const entry of dom.hrefs) {
      expect(entry).not.toMatch(/javascript:|data:|vbscript:|file:/i);
    }
    const anchors = await page
      .locator('a[href]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    for (const href of anchors) expect(href).toMatch(/^(#|https?:\/\/|mailto:)/);

    expect(monitor.dialogs).toEqual([]);
    expect(monitor.pageErrors).toEqual([]);
    expect(monitor.problems).toEqual([]);
    expect(await monitor.cspViolations()).toEqual([]);
  });

  test('a hostile destination URL is shown as text, never as a link', async ({ page }) => {
    await page.goto(urls.xss);
    const row = page.locator('#verification').getByTestId('unverified-row').first();
    await expect(row).toContainText('destination');
    await expect(row.locator('a')).toHaveCount(0);
  });
});

test.describe('live updates', () => {
  test.describe.configure({ mode: 'serial' });

  test('polls every 2 s while the run is applying and shows new progress and events', async ({
    page,
    monitor,
  }) => {
    await installFrozenClock(page);
    const requests = countStateRequests(page);
    await page.goto(urls.live);
    await expect(heading(page, 'Migration progress')).toBeVisible();
    const section = page.locator('#progress');
    await expect(section.getByTestId('polling-text')).toContainText(
      'every 2 s while the run is active',
    );
    await expect(page.getByTestId('state-title')).toContainText('In progress');
    await expect(page.getByTestId('status-banner')).not.toContainText('Verified');
    await expect(section.getByTestId('progress-percent')).toHaveText('0%');
    await expect(section.getByTestId('not-verified')).toHaveCount(0);
    await expect(page.locator('#verification').getByTestId('not-verified')).toBeVisible();
    await expect(page.locator('#verification')).toContainText('exitos verify');

    // the stage tracker says the same, from the same state: applying, nothing written yet
    const liveTotal = Object.values((await fetchState(urls.live)).run?.counts ?? {}).reduce(
      (a, b) => a + b,
      0,
    );
    const stages = page.getByTestId('stage-tracker');
    await expect(stages).toHaveAttribute('data-phase', 'applying');
    await expect(stages.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(stages.locator('[aria-current="step"]')).toHaveAttribute('data-stage', 'apply');
    await expect(stages.locator('[aria-current="step"]')).toHaveAttribute('data-result', 'active');
    await expect(stages.locator('[aria-current="step"]')).toContainText(
      `0 of ${liveTotal} actions written or skipped.`,
    );
    await expect(stages.locator('li[data-stage="verify"]')).toHaveAttribute(
      'data-status',
      'upcoming',
    );

    const dbPath = requiredEnv(ENV.liveDb);
    const initial = (await fetchState(urls.live)).events.length;
    const advanced = advanceLiveRun(dbPath, 'run_e2e_live', 30);
    expect(advanced).toBe(30);

    const before = requests.count();
    await page.clock.runFor(1900);
    expect(requests.count()).toBe(before); // not yet: the interval is 2 s
    await page.clock.runFor(200);
    await expect.poll(() => requests.count()).toBeGreaterThan(before);
    const total = (await fetchState(urls.live)).plan.summary.actions.total;
    await expect(section.getByTestId('progress-percent')).toHaveText(
      `${Math.floor((30 / total) * 100)}%`,
    );
    await expect(section.getByTestId('count-succeeded')).toHaveText('30');
    await expect(stages.locator('[aria-current="step"]')).toContainText(
      `30 of ${liveTotal} actions written or skipped.`,
    );
    // friendly labels for the new events, with the raw message untouched
    await expect(section.getByTestId('event-log').locator('tbody tr').last()).toContainText(
      'Written',
    );
    await expect(section.getByTestId('event-log').locator('tbody tr')).toHaveCount(initial + 30);
    await expect(section.getByTestId('event-log').locator('tbody tr').last()).toContainText(
      'Wrote',
    );
    await expect(section.getByTestId('last-updated')).toContainText(/\d{2}:\d{2}:\d{2}/);

    // auto-scroll follows the newest event; switching it off leaves the log where it is
    const log = section.getByTestId('event-log');
    const gap = (): Promise<number> =>
      log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(await gap()).toBeLessThanOrEqual(2);
    await section.getByTestId('autoscroll').uncheck();
    await log.evaluate((el) => (el.scrollTop = 0));
    advanceLiveRun(dbPath, 'run_e2e_live', 5);
    await page.clock.runFor(2100);
    await expect(log.locator('tbody tr')).toHaveCount(initial + 35);
    expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
    await section.getByTestId('autoscroll').check();
    await expect.poll(gap).toBeLessThanOrEqual(2);

    expect(monitor.problems).toEqual([]);
    expect(monitor.pageErrors).toEqual([]);
  });

  test('pauses polling while the tab is hidden and catches up when shown', async ({ page }) => {
    await installFrozenClock(page);
    const requests = countStateRequests(page);
    await page.goto(urls.live);
    await expect(heading(page, 'Migration progress')).toBeVisible();

    const setVisibility = (state: 'hidden' | 'visible'): Promise<void> =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => value,
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => value === 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);

    await setVisibility('hidden');
    await expect(page.locator('#progress').getByTestId('polling-text')).toContainText(
      'paused while this tab is hidden',
    );
    const hiddenAt = requests.count();
    await page.clock.runFor(60_000);
    expect(requests.count()).toBe(hiddenAt);

    advanceLiveRun(requiredEnv(ENV.liveDb), 'run_e2e_live', 3);
    await setVisibility('visible');
    await expect.poll(() => requests.count()).toBeGreaterThan(hiddenAt); // refreshes right away
    await expect(page.locator('#progress').getByTestId('polling-text')).toContainText('every 2 s');
  });

  test('a finished run is polled every 10 s, not every 2 s', async ({ page }) => {
    await installFrozenClock(page);
    const requests = countStateRequests(page);
    await page.goto(urls.demo);
    await expect(heading(page, 'Verification report')).toBeVisible();
    const before = requests.count();
    await page.clock.runFor(9_000);
    expect(requests.count()).toBe(before);
    await page.clock.runFor(1_500);
    await expect.poll(() => requests.count()).toBe(before + 1);
  });
});

// ---- the dashboard's vocabulary, stage tracker, approval panel and friendlier details ----------

type Task = ApiState['plan']['actions'][number];

function findTask(api: ApiState, name: string): Task {
  const task = api.plan.actions.find(
    (a) => a.kind === 'clickup.create_task' && (a.payload.body as { name?: string }).name === name,
  );
  if (!task) throw new Error(`demo task not found: ${name}`);
  return task;
}

/** What the plan says about one task, counted from the API document (not from the page). */
function taskCounts(api: ApiState, task: Task) {
  const keys = new Set<string>();
  for (const f of task.findings) if (f.collection) keys.add(f.collection);
  for (const c of api.plan.collections) if (c.target?.id === task.payload.listId) keys.add(c.key);
  const occurrences = (outcome: string): number =>
    task.findings.filter((f) => f.outcome === outcome).reduce((sum, f) => sum + (f.count ?? 1), 0);
  return {
    preserved: api.plan.mappings.filter((m) => keys.has(m.collection) && m.outcome === 'supported')
      .length,
    transformed: occurrences('transformed'),
    lossy: occurrences('lossy'),
    unsupported: occurrences('unsupported'),
  };
}

/** The plan's actions that would be written, as the approval panel words them. */
function expectedCreateRows(api: ApiState): string[] {
  const noun: Record<string, [string, string]> = {
    'clickup.create_task': ['task', 'tasks'],
    'clickup.link_tasks': ['link between tasks', 'links between tasks'],
    'clickup.create_doc': ['Doc', 'Docs'],
    'clickup.create_doc_page': ['Doc page', 'Doc pages'],
  };
  const rows = new Map<string, { kind: string; target: string | null; count: number }>();
  for (const action of api.plan.actions) {
    if (action.disposition !== 'execute') continue;
    const target =
      api.plan.destination.targets.find((t) => action.scope.endsWith(`:${t.kind}:${t.id}`))?.name ??
      null;
    const key = `${action.kind}|${target ?? ''}`;
    const row = rows.get(key) ?? { kind: action.kind, target, count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => {
    const words = noun[row.kind] ?? [row.kind, row.kind];
    const experimental = row.kind.includes('doc') ? ' experimental' : '';
    return `${row.count} ${row.count === 1 ? words[0] : words[1]}${row.target ? ` in ${row.target}` : ''}${experimental}`;
  });
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Number of elements whose text is lower than 4.5:1 against its effective background. */
async function lowContrastText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
    const parse = (value: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m?.[1]) return null;
      const parts = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const lum = ([r, g, b]: [number, number, number, number]): number => {
      const c = (v: number): number => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const background = (el: Element): [number, number, number, number] => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg[3] > 0.99) return bg;
      }
      return parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    };
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main *, header *')) {
      if (el.closest('svg, [aria-hidden="true"], :disabled')) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
      );
      if (!hasText) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 3 || rect.height < 3) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden') continue;
      const fg = parse(style.color);
      if (!fg) continue;
      const a = lum(fg);
      const b = lum(background(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) {
        offenders.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 30)} "${(el.textContent ?? '').trim().slice(0, 30)}" ${ratio.toFixed(2)}`,
        );
      }
    }
    return offenders.slice(0, 8);
  });
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Elements that stick out of the viewport without a scrolling ancestor to hold them. */
async function overflowOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main *, header *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= width + 1) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
          clipped = true;
          break;
        }
      }
      if (!clipped) {
        offenders.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)} right=${Math.round(r.right)}`,
        );
      }
    }
    return offenders.slice(0, 5);
  });
}

test.describe('outcome vocabulary and legend', () => {
  test('explains all six states once, with icon, word and plain sub-label', async ({ page }) => {
    await openDemo(page);
    const legend = page.locator('#compatibility').getByTestId('outcome-legend');
    const items = legend.locator('[data-state]');
    await expect(items).toHaveCount(6);
    expect(
      await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-state'))),
    ).toEqual(['supported', 'transformed', 'lossy', 'unsupported', 'failed', 'verified']);
    const words = [
      ['Preserved', 'Moves as-is'],
      ['Transformed', 'Changes shape'],
      ['Requires review', 'Loses detail'],
      ['Unsupported', 'Cannot move'],
      ['Failed', 'Write or check failed'],
      ['Verified', 'Checked in the destination'],
    ] as const;
    for (const [i, [name, plain]] of words.entries()) {
      const item = items.nth(i);
      await expect(item.locator('.chip')).toHaveText(name);
      await expect(item).toContainText(plain);
      await expect(item.locator('.chip svg[aria-hidden="true"]')).toHaveCount(1);
      // the full legend adds one sentence per state
      expect((await item.locator('dd').innerText()).length).toBeGreaterThan(20);
    }
    // the two run-level states say what they are about
    await expect(items.nth(4)).toContainText('about the run');
    await expect(items.nth(5)).toContainText('about the run');
    await expect(items.nth(0)).not.toContainText('about the run');

    // a compact legend sits in the overview, with the same six names
    const compact = page.locator('#overview').getByTestId('overview-legend');
    await expect(compact.locator('[data-state]')).toHaveCount(6);
    await expect(compact.locator('.chip')).toHaveText(words.map(([name]) => name));
  });

  test('no state is told apart by colour alone: six icons and six distinct fills', async ({
    page,
  }) => {
    await openDemo(page);
    const items = page
      .locator('#compatibility')
      .getByTestId('outcome-legend')
      .locator('[data-state]');
    const look = await items.evaluateAll((els) =>
      els.map((el) => {
        const chip = el.querySelector('.chip') as HTMLElement;
        return {
          icon: el.querySelector('.chip svg')?.innerHTML ?? '',
          fill: getComputedStyle(chip).backgroundColor,
        };
      }),
    );
    expect(new Set(look.map((l) => l.icon)).size).toBe(6);
    expect(new Set(look.map((l) => l.fill)).size).toBe(6);
  });

  test('uses the new names everywhere an outcome is shown', async ({ page }) => {
    const api = await openDemo(page);
    const chipTexts = await page.locator('main .chip').allInnerTexts();
    expect(chipTexts).toContain('Preserved');
    expect(chipTexts).toContain('Requires review');
    expect(chipTexts).not.toContain('Lossy');
    expect(chipTexts).not.toContain('Supported');

    // filters, headings and labels in the unsupported section
    const section = page.locator('#unsupported');
    const options = await section.getByTestId('outcome-filter').locator('option').allInnerTexts();
    expect(options).toEqual([
      'All outcomes',
      'Unsupported (cannot move)',
      'Requires review (loses detail)',
      'Transformed (changes shape)',
    ]);
    await expect(section.getByTestId('finding-group-lossy').locator('h3')).toContainText(
      'Requires review',
    );
    await expect(section.getByTestId('finding-group-lossy').locator('h3')).toContainText(
      'Loses detail',
    );
    // the bar says the same in its accessible name
    const bar = page.locator('#compatibility').getByRole('img', { name: /Items by outcome/ });
    await expect(bar).toHaveAttribute(
      'aria-label',
      new RegExp(`Preserved ${api.plan.summary.items.supported} \\(moves as-is\\)`),
    );
    await expect(bar).toHaveAttribute('aria-label', /Requires review \d+ \(loses detail\)/);
  });

  test('verification uses Verified and Failed, never the item words', async ({ page }) => {
    await page.goto(urls.xss);
    const section = page.locator('#verification');
    await expect(section.getByTestId('verification-banner').locator('.chip')).toHaveText('Failed');
    const row = section.getByTestId('unverified-row').first();
    await expect(row.locator('.chip')).toHaveText('Failed: mismatched');
    await expect(section.getByTestId('vcount-verified')).toBeVisible();

    await page.goto(urls.demo);
    await expect(
      page.locator('#verification').getByTestId('verification-banner').locator('.chip'),
    ).toHaveText('Verified');
  });
});

test.describe('stage tracker', () => {
  const tracker = (page: Page): Locator => page.getByTestId('stage-tracker');
  const current = (page: Page): Locator => tracker(page).locator('[aria-current="step"]');

  test('demo: an ordered list, four stages done and the last one Verified', async ({ page }) => {
    await openDemo(page);
    const list = tracker(page).getByRole('list', { name: 'Migration stages' });
    await expect(list).toBeVisible();
    expect(await list.evaluate((el) => el.tagName)).toBe('OL');
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(5);
    const names = await items.evaluateAll((els) =>
      els.map((el) => el.querySelector('p')?.firstChild?.textContent?.trim() ?? ''),
    );
    expect(names).toEqual(['Inspect', 'Plan', 'Approve', 'Apply', 'Verify']);

    await expect(tracker(page)).toHaveAttribute('data-phase', 'verified');
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveAttribute('data-stage', 'verify');
    await expect(current(page)).toHaveAttribute('data-result', 'verified');
    await expect(current(page)).toContainText('Verified');
    const done = list.locator('li[data-status="done"]');
    await expect(done).toHaveCount(4);
    for (const li of await done.all()) {
      await expect(li.locator('.stage-marker svg')).toHaveCount(1); // the check
      await expect(li).toContainText('(done)');
    }
    await expect(page.getByTestId('stage-summary')).toContainText('All five stages are done');
    await expect(page.getByTestId('stage-summary')).not.toContainText(/\bcomplete(d)?\b/i);
  });

  test('plan only: says "waiting for approval", honestly, and nothing else is current', async ({
    page,
  }) => {
    const api = await fetchState(urls.planned);
    expect(api.run).toBeNull();
    await page.goto(urls.planned);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    await expect(tracker(page)).toHaveAttribute('data-phase', 'planned');
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveAttribute('data-stage', 'approve');
    await expect(current(page)).toHaveAttribute('data-result', 'waiting');
    await expect(current(page)).toContainText('Waiting for approval');
    await expect(current(page)).toContainText('there is no run');
    await expect(page.getByTestId('stage-summary')).toHaveText(
      'Current stage: Approve. Waiting for approval.',
    );
    for (const stage of ['apply', 'verify']) {
      const li = tracker(page).locator(`li[data-stage="${stage}"]`);
      await expect(li).toHaveAttribute('data-status', 'upcoming');
      await expect(li).toContainText('not started yet');
    }
    await expect(tracker(page).locator('li[data-status="done"]')).toHaveCount(2);
    // the numbers in the first two stages are the plan's
    const rows = api.plan.collections.reduce((n, c) => n + c.recordCount, 0);
    await expect(tracker(page).locator('li[data-stage="inspect"]')).toContainText(
      `${api.plan.collections.length} collections and ${fmt(rows)} rows`,
    );
    await expect(tracker(page).locator('li[data-stage="plan"]')).toContainText(
      `${fmt(api.plan.summary.actions.total)} actions planned`,
    );
  });

  test('applied but never verified: waiting for verification, not a success', async ({ page }) => {
    await page.goto(urls.applied);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    await expect(tracker(page)).toHaveAttribute('data-phase', 'applied');
    await expect(current(page)).toHaveAttribute('data-stage', 'verify');
    await expect(current(page)).toHaveAttribute('data-result', 'waiting');
    await expect(current(page)).toContainText('Waiting for verification');
    await expect(tracker(page).locator('li[data-stage="apply"]')).toHaveAttribute(
      'data-status',
      'done',
    );
    await expect(page.getByTestId('state-title')).toContainText('NOT verified');
    await expect(page.locator('#verification').getByTestId('not-verified')).toBeVisible();
  });

  test('a stopped run with failures: the apply stage is marked Failed, verify has not started', async ({
    page,
  }) => {
    await page.goto(urls.failed);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    await expect(tracker(page)).toHaveAttribute('data-phase', 'failed');
    await expect(current(page)).toHaveAttribute('data-stage', 'apply');
    await expect(current(page)).toHaveAttribute('data-result', 'failed');
    await expect(current(page)).toContainText('Failed');
    await expect(current(page)).toContainText('Stopped after 2 consecutive failures.');
    await expect(current(page).locator('.stage-marker svg')).toHaveCount(1);
    await expect(tracker(page).locator('li[data-stage="verify"]')).toHaveAttribute(
      'data-status',
      'upcoming',
    );
  });

  test('verification failed: apply is done and verify is Failed', async ({ page }) => {
    await page.goto(urls.xss);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    await expect(tracker(page)).toHaveAttribute('data-phase', 'verification_failed');
    await expect(current(page)).toHaveAttribute('data-stage', 'verify');
    await expect(current(page)).toHaveAttribute('data-result', 'failed');
    await expect(current(page)).toContainText('Verification failed');
    await expect(tracker(page).locator('li[data-stage="apply"]')).toHaveAttribute(
      'data-status',
      'done',
    );
  });

  test('no plan, no tracker (empty state)', async ({ page }) => {
    await page.goto(urls.empty);
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(tracker(page)).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Migration stages' })).toHaveCount(0);
  });

  test('other run statuses are worded honestly (approved, stopped, verifying, incomplete)', async ({
    page,
  }) => {
    const counts = { pending: 0, in_flight: 0, succeeded: 0, failed: 0, ambiguous: 0, blocked: 0 };
    const cases = [
      {
        status: 'approved',
        phase: 'approved',
        stage: 'apply',
        text: 'Approved, not started',
        counts: { ...counts, pending: 175, skipped: 0 },
      },
      {
        status: 'stopped',
        phase: 'stopped',
        stage: 'apply',
        text: 'Stopped early',
        counts: { ...counts, succeeded: 40, pending: 135, skipped: 0 },
      },
      {
        status: 'verifying',
        phase: 'verifying',
        stage: 'verify',
        text: 'Verifying',
        counts: { ...counts, succeeded: 175, skipped: 0 },
      },
    ] as const;
    for (const c of cases) {
      await page.unroute('**/api/state');
      await mockState(page, urls.demo, (state) => {
        if (!state.run) throw new Error('no run');
        state.run.status = c.status;
        state.run.counts = { ...c.counts };
        state.verification = null;
        state.report = null;
      });
      await page.goto(urls.demo);
      await expect(heading(page, 'Migration overview')).toBeVisible();
      await expect(tracker(page)).toHaveAttribute('data-phase', c.phase);
      await expect(current(page)).toHaveAttribute('data-stage', c.stage);
      await expect(current(page)).toContainText(c.text);
    }

    await page.unroute('**/api/state');
    await mockState(page, urls.demo, (state) => {
      if (!state.run || !state.verification) throw new Error('no run');
      state.run.status = 'applied';
      state.verification.status = 'incomplete';
      state.verification.counts = { verified: 170, mismatched: 0, missing: 0, unverified: 5 };
    });
    await page.goto(urls.demo);
    await expect(tracker(page)).toHaveAttribute('data-phase', 'verification_incomplete');
    await expect(current(page)).toContainText('Verification incomplete');
    await expect(current(page)).toContainText('5 items could not be checked.');
  });
});

test.describe('approval panel', () => {
  const panel = (page: Page): Locator => page.getByTestId('approval-panel');

  test('a plan nobody approved: what would be created, per kind and target, from the plan', async ({
    page,
  }) => {
    const api = await fetchState(urls.planned);
    await page.goto(urls.planned);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    const p = panel(page);
    await expect(p).toHaveAttribute('data-has-run', 'false');
    await expect(p.getByRole('heading', { name: 'If you approve this plan' })).toBeVisible();
    await expect(p).toContainText('Nothing has been written yet');
    await expect(p).toContainText(api.plan.destination.workspace.name);

    const rows = await p.getByTestId('approval-create-row').allInnerTexts();
    expect(rows.map(squash).sort()).toEqual(expectedCreateRows(api).sort());
    await expect(p.getByTestId('approval-totals')).toContainText(
      `${api.plan.summary.actions.toExecute} actions to write`,
    );

    // what would not happen
    await expect(p.getByTestId('approval-source-untouched')).toContainText('is never modified');
    await expect(p.getByTestId('approval-source-untouched')).toContainText('only read');
    await expect(p.getByTestId('approval-no-delete')).toContainText(
      'Nothing in the destination is deleted or overwritten',
    );
    const notify = api.plan.users.assignmentsThatNotify;
    expect(notify).toBeGreaterThan(0);
    await expect(p.getByTestId('approval-notify')).toContainText(
      `${notify} assignments would notify people`,
    );
    await expect(p.getByTestId('approval-blocking')).toContainText('No blocking errors');
    // docs migration is labelled experimental wherever it is listed
    const docRows = p.getByTestId('approval-create-row').filter({ hasText: /Docs?\b/ });
    await expect(docRows.first()).toContainText('experimental');
  });

  test('says plainly that the dashboard cannot approve, and keeps the copy button', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const api = await fetchState(urls.planned);
    await page.goto(urls.planned);
    const p = panel(page);
    await expect(p.getByTestId('approval-readonly')).toContainText(
      'This dashboard cannot approve anything',
    );
    await expect(p.getByTestId('approval-readonly')).toContainText('read-only');
    const command = `exitos apply --plan migration-plan.json --approve ${api.plan.planId}`;
    await expect(p.locator('pre code')).toHaveText(command);
    await p.getByTestId('copy-approve').click();
    await expect(p.getByTestId('copy-approve-status')).toContainText('Copied to clipboard');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);

    // no control anywhere that could start, stop or approve anything
    await expect(
      page.getByRole('button', { name: /^(approve|apply|start|resume|stop|cancel|run)\b/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy approve command' })).toHaveCount(1);
  });

  test('a plan with blocking errors says apply will refuse it, and approval is blocked', async ({
    page,
  }) => {
    await mockState(page, urls.demo, (state) => {
      state.run = null;
      state.events = [];
      state.verification = null;
      state.report = null;
      state.plan.summary.blockingErrors = 2;
    });
    await page.goto(urls.demo);
    await expect(heading(page, 'Migration overview')).toBeVisible();
    const blocking = panel(page).getByTestId('approval-blocking');
    await expect(blocking).toContainText('2 blocking errors');
    await expect(blocking).toContainText('apply will refuse');
    await expect(blocking.getByRole('link')).toHaveAttribute('href', '#unsupported');
    // the tracker agrees: the approve stage is blocked, not "waiting"
    const tracker = page.getByTestId('stage-tracker');
    await expect(tracker).toHaveAttribute('data-phase', 'blocked');
    await expect(tracker.locator('[aria-current="step"]')).toHaveAttribute('data-stage', 'approve');
    await expect(tracker.locator('[aria-current="step"]')).toHaveAttribute(
      'data-result',
      'attention',
    );
    await expect(tracker.locator('[aria-current="step"]')).toContainText('Blocked by errors');
    await expect(tracker.locator('[aria-current="step"]')).toContainText('2 blocking errors');
  });

  test('demo: same numbers, worded for a plan that already has a run', async ({ page }) => {
    const api = await openDemo(page);
    const p = panel(page);
    await expect(p).toHaveAttribute('data-has-run', 'true');
    await expect(p.getByRole('heading', { name: 'What this plan writes' })).toBeVisible();
    const rows = await p.getByTestId('approval-create-row').allInnerTexts();
    expect(rows.map(squash).sort()).toEqual(expectedCreateRows(api).sort());
    // how the items arrive: the plan's own summary
    const fidelity = p.getByTestId('approval-fidelity');
    for (const outcome of OUTCOMES) {
      const count = api.plan.summary.items[outcome];
      if (count > 0) {
        await expect(fidelity).toContainText(
          new RegExp(`${OUTCOME_LABEL[outcome]}\\s*${count}(?!\\d)`),
        );
      }
    }
  });
});

test.describe('task findings grouped by outcome', () => {
  async function openGripper(page: Page): Promise<{ api: ApiState; section: Locator }> {
    const api = await openDemo(page);
    const section = page.locator('#mapping');
    await section.getByLabel('Filter tasks').fill('gripper v2');
    await section.getByTestId('task-select').selectOption({ index: 0 });
    await expect(section.getByTestId('task-name')).toHaveText('Design robot arm v2 gripper');
    return { api, section };
  }

  test('one-line summary at the top, computed from the data', async ({ page }) => {
    const { api, section } = await openGripper(page);
    const task = findTask(api, 'Design robot arm v2 gripper');
    const c = taskCounts(api, task);
    for (const n of Object.values(c)) expect(n).toBeGreaterThan(1);
    await expect(section.getByTestId('task-summary-line')).toHaveText(
      `${c.preserved} parts move as-is, ${c.transformed} change shape, ${c.lossy} lose detail, ${c.unsupported} cannot move.`,
    );
    await expect(section.getByTestId('task-summary')).toContainText('Product Roadmap');
    // the summary sits above the facts and the description
    const order = await section
      .getByTestId('task-preview')
      .evaluate((el) =>
        [
          ...el.querySelectorAll('[data-testid="task-summary"], [data-testid="task-description"]'),
        ].map((n) => n.getAttribute('data-testid')),
      );
    expect(order).toEqual(['task-summary', 'task-description']);
  });

  test('findings are grouped Unsupported, Requires review, Transformed, with counts in the headers', async ({
    page,
  }) => {
    const { api, section } = await openGripper(page);
    const task = findTask(api, 'Design robot arm v2 gripper');
    const ids = await section
      .locator('details[data-testid^="task-group-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(ids).toEqual(['task-group-unsupported', 'task-group-lossy', 'task-group-transformed']);

    for (const outcome of ['unsupported', 'lossy', 'transformed'] as const) {
      const findings = task.findings.filter((f) => f.outcome === outcome);
      expect(findings.length).toBeGreaterThan(0);
      const summary = section.getByTestId(`task-group-${outcome}-summary`);
      await expect(summary).toContainText(OUTCOME_LABEL[outcome]);
      await expect(summary).toContainText(OUTCOME_PLAIN[outcome]);
      await expect(summary).toContainText(`${findings.length} findings`);
      await expect(summary.locator('.chip svg[aria-hidden="true"]')).toHaveCount(1);
    }
    // the flat "Findings for this task" list is gone
    await expect(section.getByText('Findings for this task', { exact: true })).toHaveCount(0);
  });

  test('Unsupported and Requires review start open, Transformed collapsed; all can be toggled', async ({
    page,
  }) => {
    const { section } = await openGripper(page);
    const group = (o: string): Locator => section.getByTestId(`task-group-${o}`);
    await expect(group('unsupported')).toHaveJSProperty('open', true);
    await expect(group('lossy')).toHaveJSProperty('open', true);
    await expect(group('transformed')).toHaveJSProperty('open', false);
    await expect(group('transformed').getByTestId('task-finding').first()).toBeHidden();

    await section.getByTestId('task-group-transformed-summary').click();
    await expect(group('transformed')).toHaveJSProperty('open', true);
    await expect(group('transformed').getByTestId('task-finding').first()).toBeVisible();

    await section.getByTestId('task-group-unsupported-summary').click();
    await expect(group('unsupported')).toHaveJSProperty('open', false);
    await expect(group('unsupported').getByTestId('task-finding').first()).toBeHidden();
    await section.getByTestId('task-group-unsupported-summary').click();
    await expect(group('unsupported')).toHaveJSProperty('open', true);

    // keyboard: the summary is focusable and Enter toggles it
    await section.getByTestId('task-group-unsupported-summary').focus();
    await page.keyboard.press('Enter');
    await expect(group('unsupported')).toHaveJSProperty('open', false);
  });

  test('a long group shows the first few findings and "Show N more"', async ({ page }) => {
    const { api, section } = await openGripper(page);
    const task = findTask(api, 'Design robot arm v2 gripper');
    const lossy = task.findings.filter((f) => f.outcome === 'lossy').length;
    expect(lossy).toBeGreaterThan(8);
    const group = section.getByTestId('task-group-lossy');
    await expect(group.getByTestId('task-finding')).toHaveCount(8);
    const more = section.getByTestId('task-group-lossy-more');
    await expect(more).toHaveText(`Show ${lossy - 8} more`);
    await more.click();
    await expect(group.getByTestId('task-finding')).toHaveCount(lossy);
    await expect(more).toHaveCount(0);
    // short groups have no such button
    await expect(section.getByTestId('task-group-unsupported-more')).toHaveCount(0);
  });

  test('switching task starts again from the defaults', async ({ page }) => {
    const { section } = await openGripper(page);
    await section.getByTestId('task-group-lossy-more').click();
    await section.getByTestId('task-group-transformed-summary').click();
    await section.getByLabel('Filter tasks').fill('');
    await section.getByTestId('task-select').selectOption({ index: 1 });
    await expect(section.getByTestId('task-name')).not.toHaveText('Design robot arm v2 gripper');
    for (const group of await section.locator('details[data-testid^="task-group-"]').all()) {
      const outcome = (await group.getAttribute('data-testid'))?.replace('task-group-', '');
      await expect(group).toHaveJSProperty('open', outcome !== 'transformed');
      expect(await group.getByTestId('task-finding').count()).toBeLessThanOrEqual(8);
    }
  });

  test('a task with no findings says so instead of showing empty groups', async ({ page }) => {
    await mockState(page, urls.demo, (state) => {
      for (const action of state.plan.actions) action.findings = [];
    });
    await page.goto(urls.demo);
    const section = page.locator('#mapping');
    await expect(section.getByTestId('task-findings-empty')).toContainText(
      'No findings are recorded for this task',
    );
    await expect(section.locator('details[data-testid^="task-group-"]')).toHaveCount(0);
    await expect(section.getByTestId('task-summary-line')).toContainText(/parts? moves? as-is/);
  });
});

test.describe('mapping table: outcome chips and paging', () => {
  test('chips show a count per outcome, filter on press and combine with the other filters', async ({
    page,
  }) => {
    const api = await openDemo(page);
    const section = page.locator('#mapping');
    const total = api.plan.mappings.length;
    const count = (o: string, list = api.plan.mappings): number =>
      list.filter((m) => m.outcome === o).length;
    const chips = section.getByRole('group', { name: 'Filter mappings by outcome' });
    const rows = section.getByTestId('mapping-row');
    await expect(chips.getByRole('button')).toHaveCount(5);
    const all = chips.getByTestId('mapping-chip-all');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toContainText(String(total));
    for (const outcome of OUTCOMES) {
      const chip = chips.getByTestId(`mapping-chip-${outcome}`);
      await expect(chip).toContainText(OUTCOME_LABEL[outcome]);
      await expect(chip).toContainText(String(count(outcome)));
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(chip).toHaveAttribute(
        'aria-label',
        `${OUTCOME_LABEL[outcome]} (${OUTCOME_PLAIN[outcome].toLowerCase()}): ${count(outcome)}`,
      );
    }

    // press one: only those rows, pressed state moves, the count line says "filtered"
    const lossy = chips.getByTestId('mapping-chip-lossy');
    await lossy.click();
    await expect(lossy).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(rows).toHaveCount(count('lossy'));
    for (const text of await rows.locator('td:nth-child(5)').allInnerTexts()) {
      expect(text).toBe('Requires review');
    }
    await expect(section.getByTestId('mapping-count')).toHaveText(
      `Showing ${count('lossy')} of ${total} mappings (filtered)`,
    );

    // press again: back to everything
    await lossy.click();
    await expect(lossy).toHaveAttribute('aria-pressed', 'false');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(total);

    // the counts follow the collection filter; a chip with no rows is disabled
    const target = api.plan.collections[0];
    if (!target) throw new Error('no collection');
    await section.getByLabel('Collection').selectOption(target.key);
    const inCollection = api.plan.mappings.filter((m) => m.collection === target.key);
    await expect(all).toContainText(String(inCollection.length));
    for (const outcome of OUTCOMES) {
      const n = count(outcome, inCollection);
      await expect(chips.getByTestId(`mapping-chip-${outcome}`)).toContainText(String(n));
      if (n === 0) await expect(chips.getByTestId(`mapping-chip-${outcome}`)).toBeDisabled();
      else await expect(chips.getByTestId(`mapping-chip-${outcome}`)).toBeEnabled();
    }
    await expect(rows).toHaveCount(inCollection.length);

    // ... and the search: the chips always add up to the All chip, which equals the rows shown
    await section.getByLabel('Search mappings').fill('date');
    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    await expect(all).toContainText(String(shown));
    const parts = await Promise.all(
      OUTCOMES.map(async (o) =>
        Number(
          (await chips
            .getByTestId(`mapping-chip-${o}`)
            .locator('.filter-chip-count')
            .innerText()) || 0,
        ),
      ),
    );
    expect(parts.reduce((a, b) => a + b, 0)).toBe(shown);

    // Clear filters resets everything, chips included
    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(total);
  });

  test('search finds an outcome by the words people see', async ({ page }) => {
    const api = await openDemo(page);
    const section = page.locator('#mapping');
    const rows = section.getByTestId('mapping-row');
    const lossy = api.plan.mappings.filter((m) => m.outcome === 'lossy').length;
    await section.getByLabel('Search mappings').fill('requires review');
    expect(await rows.count()).toBeGreaterThanOrEqual(lossy);
    await expect(rows.first()).toContainText('Requires review');
    await section.getByLabel('Search mappings').fill('cannot move');
    expect(await rows.count()).toBeGreaterThanOrEqual(
      api.plan.mappings.filter((m) => m.outcome === 'unsupported').length,
    );
  });

  test('chips are reachable and show a focus ring when tabbed to', async ({ page }) => {
    await openDemo(page);
    const section = page.locator('#mapping');
    await section.getByLabel('Search mappings').focus();
    await page.keyboard.press('Tab'); // Clear filters is disabled, so this lands on the first chip
    const first = section.getByTestId('mapping-chip-all');
    await expect(first).toBeFocused();
    const ring = await first.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth };
    });
    expect(ring.style).not.toBe('none');
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Tab');
    await expect(section.getByTestId('mapping-chip-supported')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(section.getByTestId('mapping-chip-supported')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('"Show more" pages 25 rows at a time and "Showing X of Y" stays honest', async ({
    page,
  }) => {
    const extra = 40;
    let collection = '';
    await mockState(page, urls.demo, (state) => {
      const first = state.plan.mappings[0];
      if (!first) throw new Error('no mapping');
      collection = first.collection;
      for (let i = 0; i < extra; i += 1) {
        state.plan.mappings.push({ ...first, id: `map_extra_${i}` });
      }
    });
    await page.goto(urls.demo);
    const section = page.locator('#mapping');
    const rows = section.getByTestId('mapping-row');
    const count = section.getByTestId('mapping-count');
    const more = section.getByTestId('mapping-show-more');
    const total = 25 + extra;

    await expect(rows).toHaveCount(25);
    await expect(count).toHaveText(`Showing 25 of ${total} mappings`);
    await expect(more).toHaveText(`Show 25 more (${total - 25} not shown)`);
    await more.click();
    await expect(rows).toHaveCount(50);
    await expect(count).toHaveText(`Showing 50 of ${total} mappings`);
    await expect(more).toHaveText(`Show ${total - 50} more (${total - 50} not shown)`);
    await more.click();
    await expect(rows).toHaveCount(total);
    await expect(count).toHaveText(`Showing ${total} of ${total} mappings`);
    await expect(more).toHaveCount(0);

    // a filter that still matches more than a page: honest about both numbers, back on page one
    await section.getByLabel('Collection').selectOption(collection);
    await expect(rows).toHaveCount(25);
    await expect(count).toContainText(`Showing 25 of ${total} mappings (`);
    await expect(count).toContainText(' match the filters)');
    await expect(more).toBeVisible();
    await section.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(25); // not 65: clearing starts again from the first page
    await expect(more).toBeVisible();

    // a filter with few rows has no button, and says "(filtered)"
    await section.getByLabel('Search mappings').fill('zzz no such mapping zzz');
    await expect(rows).toHaveCount(0);
    await expect(more).toHaveCount(0);
    await expect(count).toHaveText(`Showing 0 of ${total} mappings (filtered)`);
  });

  test('a plan with no mappings says so, in place of an empty table', async ({ page }) => {
    await mockState(page, urls.demo, (state) => {
      state.plan.mappings = [];
    });
    await page.goto(urls.demo);
    const section = page.locator('#mapping');
    await expect(section.getByTestId('mapping-empty')).toContainText(
      'This plan maps no source properties',
    );
    await expect(section.getByTestId('mapping-row')).toHaveCount(0);
  });
});

test.describe('progress: friendly events and failed counts', () => {
  test('demo: human labels with icons, no raw event names, no coloured chip for plain progress', async ({
    page,
  }) => {
    const api = await openDemo(page);
    const log = page.locator('#progress').getByTestId('event-log');
    const labels = await log.getByTestId('event-label').allInnerTexts();
    expect(labels).toHaveLength(api.events.length);
    expect(labels[0]).toBe('Plan approved');
    expect(labels).toContain('Run started');
    expect(labels).toContain('Run finished');
    expect(labels[labels.length - 1]).toBe('Verification passed');
    const created = api.events.filter(
      (e) => e.type === 'action_succeeded' && e.message.startsWith('Create'),
    ).length;
    const linked = api.events.filter(
      (e) => e.type === 'action_succeeded' && e.message.startsWith('Link'),
    ).length;
    expect(created).toBeGreaterThan(0);
    expect(linked).toBeGreaterThan(0);
    expect(labels.filter((l) => l === 'Created')).toHaveLength(created);
    expect(labels.filter((l) => l === 'Linked')).toHaveLength(linked);
    for (const label of labels) expect(label).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
    await expect(log).not.toContainText('action_succeeded');
    await expect(log.locator('svg[aria-hidden="true"]')).toHaveCount(api.events.length);

    // the blanket "info" chip is gone: nothing here is a warning or an error, so no chip at all
    await expect(log.locator('.chip')).toHaveCount(0);
    await expect(log.getByRole('columnheader')).toHaveText(['Time', 'Event', 'Message']);

    // the raw event type is still there for debugging: in a title and behind a toggle
    await expect(log.locator('[title="Event type: run_finished"]')).toHaveCount(1);
    await expect(log.getByTestId('event-type')).toHaveCount(0);
    await page.locator('#progress').getByTestId('event-technical').check();
    await expect(log.getByTestId('event-type')).toHaveCount(api.events.length);
    await expect(log.getByTestId('event-type').first()).toHaveText('approved');
    await page.locator('#progress').getByTestId('event-technical').uncheck();
    await expect(log.getByTestId('event-type')).toHaveCount(0);
  });

  test('a stopped run: errors and warnings get a chip, recoveries are named, and so is the stop', async ({
    page,
  }) => {
    const api = await fetchState(urls.failed);
    await page.goto(urls.failed);
    await expect(heading(page, 'Migration progress')).toBeVisible();
    const log = page.locator('#progress').getByTestId('event-log');
    const labels = await log.getByTestId('event-label').allInnerTexts();
    expect(labels).toContain('Recovered after a lost reply');
    expect(labels).toContain('Write failed');
    expect(labels).toContain('Run stopped');
    expect(labels).toContain('Created');

    const errors = api.events.filter((e) => e.level === 'error').length;
    expect(errors).toBeGreaterThan(0);
    await expect(log.locator('.chip-bad')).toHaveCount(errors);
    for (const chip of await log.locator('.chip-bad').allInnerTexts()) expect(chip).toBe('Error');
    await expect(log.locator('.chip-warn')).toHaveCount(0);
    // the row of a failed write keeps its message
    const failedRow = log.locator('tr[data-event-type="action_failed"]').first();
    await expect(failedRow).toContainText('HTTP 500');
    await expect(failedRow).toContainText('Error');
  });

  test('hostile event types and messages stay plain text', async ({ page, monitor }) => {
    await page.goto(urls.xss);
    const log = page.locator('#progress').getByTestId('event-log');
    await expect(log).toBeVisible();
    // an unknown type is shown as itself (tidied), never given a meaning, never parsed as HTML
    await expect(log.locator('tr[data-event-type^="<img"]')).toHaveCount(1);
    await expect(log.locator('img')).toHaveCount(0);
    await expect(log.locator('.chip-warn')).toHaveCount(1); // the hostile warn event
    await expect(log.locator('.chip-bad')).toHaveCount(1); // the hostile error event
    const labels = await log.getByTestId('event-label').allInnerTexts();
    expect(labels).toContain('Plan approved');
    expect(labels.some((l) => l.includes('onerror'))).toBe(true);
    expect(monitor.pageErrors).toEqual([]);
    expect(monitor.dialogs).toEqual([]);
  });

  test('Failed, Blocked and Ambiguous stand out when above zero and are quiet at zero', async ({
    page,
  }) => {
    const api = await fetchState(urls.failed);
    const counts = api.run?.counts ?? {};
    expect(counts.failed).toBeGreaterThan(0);
    expect(counts.blocked).toBeGreaterThan(0);
    expect(counts.ambiguous).toBeGreaterThan(0);
    await page.goto(urls.failed);
    await expect(heading(page, 'Migration progress')).toBeVisible();
    const section = page.locator('#progress');
    const row = (key: string): Locator => section.getByTestId(`status-row-${key}`);

    await expect(row('failed')).toHaveAttribute('data-attention', 'bad');
    await expect(row('failed').locator('.chip-solid-bad')).toHaveText('Failed');
    await expect(row('failed')).toContainText('needs attention');
    await expect(section.getByTestId('count-failed')).toHaveText(String(counts.failed));
    for (const key of ['blocked', 'ambiguous']) {
      await expect(row(key)).toHaveAttribute('data-attention', 'warn');
      await expect(row(key).locator('svg[aria-hidden="true"]')).toHaveCount(1);
      await expect(row(key)).toContainText('needs attention');
    }
    await expect(row('succeeded')).toHaveAttribute('data-attention', 'none');
    // the tint is a second signal; the icon, the word and the sr-only note are the first
    const tint = await row('failed')
      .locator('td')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const plain = await row('succeeded')
      .locator('td')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(tint).not.toBe(plain);

    // the overview agrees: the run is Failed, in the strong style
    await expect(
      page.locator('#overview').getByTestId('run-counts').locator('.chip-solid-bad'),
    ).toHaveText(`${counts.failed} failed`);

    // and in a run where they are zero the same rows are quiet
    await page.goto(urls.demo);
    await expect(heading(page, 'Migration progress')).toBeVisible();
    for (const key of ['failed', 'blocked', 'ambiguous']) {
      const quiet = page.locator('#progress').getByTestId(`status-row-${key}`);
      await expect(quiet).toHaveAttribute('data-attention', 'none');
      await expect(quiet).toHaveClass(/row-quiet/);
      await expect(quiet.locator('.chip')).toHaveCount(0);
      await expect(quiet).not.toContainText('needs attention');
      await expect(page.locator('#progress').getByTestId(`count-${key}`)).toHaveText('0');
    }
  });
});

test.describe('loading, empty and error states', () => {
  test('loading shows skeleton placeholders, announced as status, not bare text', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/state', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(urls.demo, { waitUntil: 'domcontentloaded' });
    const loading = page.getByTestId('loading');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toContainText('Loading the dashboard state');
    await expect(page.getByTestId('mode-badge')).toContainText('LOADING');
    const blocks = page.getByTestId('loading-skeleton').locator('.skeleton');
    expect(await blocks.count()).toBeGreaterThanOrEqual(6);
    // decorative: hidden from assistive technology, so the words above are what is announced
    for (const block of await blocks.all())
      await expect(block).toHaveAttribute('aria-hidden', 'true');
    // no horizontal scroll while loading, and no data yet
    expect(await pageOverflow(page)).toBe(0);
    await expect(page.getByTestId('count-actions-total')).toHaveCount(0);

    // reduced motion (the suite's default) switches the pulse off; otherwise it pulses
    const duration = (): Promise<number> =>
      blocks.first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
    expect(await duration()).toBeLessThan(0.01);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await duration()).toBeGreaterThan(0.5);

    release();
    await expect(heading(page, 'Migration overview')).toBeVisible();
    await expect(loading).toHaveCount(0);
  });

  test('empty state: the two commands to try, each with a working copy button', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(urls.empty);
    const empty = page.getByTestId('empty-state');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('heading', { name: 'Two ways to get started' })).toBeVisible();
    for (const [testId, command] of [
      ['copy-demo', 'exitos demo'],
      ['copy-plan', 'exitos plan notion clickup --config migration.yaml'],
    ] as const) {
      await expect(empty.locator('pre code', { hasText: command }).first()).toBeVisible();
      await empty.getByTestId(testId).click();
      await expect(empty.getByTestId(`${testId}-status`)).toContainText('Copied to clipboard');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
    }
  });

  test('every section that can be empty says what is missing and what to do', async ({ page }) => {
    const zero = { supported: 0, transformed: 0, lossy: 0, unsupported: 0, skipped: 0, failed: 0 };
    await mockState(page, urls.demo, (state) => {
      state.run = null;
      state.events = [];
      state.verification = null;
      state.report = null;
      const plan = state.plan;
      plan.mappings = [];
      plan.inventory = [];
      plan.findings = [];
      plan.collections = [];
      plan.actions = [];
      plan.users.assignmentsThatNotify = 0;
      plan.summary.items = { ...zero };
      plan.summary.fields = { ...zero };
      plan.summary.notPreserved = { unsupported: 0, lossy: 0 };
      plan.summary.blockingErrors = 0;
      plan.summary.warnings = 0;
      plan.summary.actions = { total: 0, toExecute: 0, toSkip: 0, byKind: {} };
    });
    await page.goto(urls.demo);
    await expect(heading(page, 'Verification report')).toBeVisible();

    await expect(page.getByTestId('stage-tracker')).toHaveAttribute('data-phase', 'planned');
    await expect(page.getByTestId('approval-creates-empty')).toContainText('no action');
    await expect(
      page.locator('#source-destination').getByTestId('collections-empty'),
    ).toContainText('The plan has no collections');
    const compat = page.locator('#compatibility');
    await expect(compat.getByTestId('items-empty')).toContainText('No items in this plan');
    await expect(compat.getByTestId('fields-empty')).toContainText('No mapped fields');
    await expect(page.locator('#mapping').getByTestId('mapping-empty')).toBeVisible();
    await expect(page.locator('#mapping')).toContainText('no task-creating actions');
    await expect(page.locator('#unsupported').getByTestId('findings-empty')).toContainText(
      'The plan recorded no findings',
    );
    const progress = page.locator('#progress');
    await expect(progress).toContainText('No run yet');
    await expect(progress.getByTestId('events-empty')).toContainText('No events yet');
    await expect(page.locator('#verification').getByTestId('not-verified')).toContainText(
      'Nothing has been compared with the destination',
    );
    await expect(page.locator('#verification').getByTestId('copy-verify')).toBeVisible();
    // and nothing in the page made up a number
    expect(await number(page.getByTestId('count-actions-total'))).toBe(0);
  });

  test('an error stays actionable: message, what to try and Retry', async ({ page }) => {
    await page.route('**/api/state', (route) => route.abort('connectionrefused'));
    await page.goto(urls.demo);
    const screen = page.getByTestId('error-screen');
    await expect(screen).toContainText('could not be reached');
    await expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect(screen.getByRole('alert')).toBeVisible();
  });
});

test.describe('responsive layout and accessibility polish', () => {
  for (const width of [360, 768, 1280, 1920]) {
    test(`${width}px: no horizontal page scroll in any state`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 500 ? 740 : 900 });
      const states = [
        ['demo', urls.demo],
        ['planned', urls.planned],
        ['failed', urls.failed],
        ['hostile', urls.xss],
        ['empty', urls.empty],
      ] as const;
      for (const [name, url] of states) {
        await page.goto(url);
        // wait for the data (or the empty state), not just the header
        await expect(page.locator('#overview, [data-testid="empty-state"]').first()).toBeVisible();
        expect({
          name,
          page: await pageOverflow(page),
          offenders: await overflowOffenders(page),
        }).toEqual({ name, page: 0, offenders: [] });
      }
    });
  }

  test('360px: wide tables scroll inside their own region, which the keyboard can reach', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openDemo(page);
    const regions = page.locator('.table-wrap');
    expect(await regions.count()).toBeGreaterThan(5);
    for (const region of await regions.all()) {
      await expect(region).toHaveAttribute('tabindex', '0');
      await expect(region).toHaveAttribute('role', 'region');
    }
    const mapping = page.getByRole('region', { name: 'Property mappings' });
    const sizes = await mapping.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    expect(await pageOverflow(page)).toBe(0);
  });

  for (const width of [360, 768]) {
    test(`${width}px: the sticky header never covers the heading a nav link jumps to`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await openDemo(page);
      const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
      for (const section of SECTIONS) {
        await nav.getByRole('link', { name: section.nav, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#${section.id}$`));
        const h = heading(page, section.heading);
        await expect(h).toBeInViewport({ ratio: 1 });
        const headerBottom = await page
          .locator('header.app-header')
          .evaluate((el) => el.getBoundingClientRect().bottom);
        const top = await h.evaluate((el) => el.getBoundingClientRect().top);
        expect(top, section.id).toBeGreaterThanOrEqual(headerBottom - 1);
      }
      // the header is no taller than a third of a phone screen
      const height = await page
        .locator('header.app-header')
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBeLessThan(740 / 3);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: every piece of rendered text has at least 4.5:1 contrast`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const url of [urls.demo, urls.planned, urls.failed, urls.xss]) {
        await page.goto(url);
        await expect(page.getByTestId('mode-badge')).toBeVisible();
        await expect(heading(page, 'Verification report')).toBeVisible();
        expect(await lowContrastText(page), url).toEqual([]);
      }
    });
  }

  test('the mode badge stays unmistakable: demo is amber, live is blue, in both schemes', async ({
    page,
  }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(urls.demo);
      const demo = page.getByTestId('mode-badge');
      await expect(demo).toContainText('OFFLINE DEMO');
      const demoBg = await demo.evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(urls.xss);
      const live = page.getByTestId('mode-badge');
      await expect(live).toContainText('LIVE');
      const liveBg = await live.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(demoBg).toBe('rgb(251, 191, 36)');
      expect(liveBg).not.toBe(demoBg);
      await expect(live).not.toContainText('OFFLINE DEMO');
    }
  });
});
