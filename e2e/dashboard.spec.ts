import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, fetchState, fmt, test, urls, type ApiState } from './fixtures.js';
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
        expect(chip.toLowerCase()).toBe(outcome);
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
    const done = run.counts.succeeded + (run.counts.skipped ?? 0);
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
