/**
 * Regenerates the dashboard images in docs/assets. Opt-in:
 *   pnpm exec playwright test --project=screenshots      (pnpm docs:screenshots)
 * They come from the offline demo, so they contain only synthetic data.
 *
 * The desktop images show the page from the top down to the end of the Compatibility summary
 * (header with the mode badge, overview, source and destination, compatibility): the whole page is
 * ~14,000 px tall and a 2+ MB image of it is neither readable in a README nor "reasonably small".
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test, urls } from './fixtures.js';

const ASSETS = fileURLToPath(new URL('../docs/assets/', import.meta.url));

/**
 * Make the viewport as tall as the page is down to the end of `sectionId`, so that an ordinary
 * screenshot shows exactly that part (the sticky header stays at the top, once).
 */
async function showThrough(page: Page, sectionId: string): Promise<void> {
  const height = await page.evaluate(
    (id) =>
      Math.ceil(
        (document.getElementById(id)?.getBoundingClientRect().bottom ?? 0) + window.scrollY,
      ),
    sectionId,
  );
  await page.setViewportSize({ width: 1440, height });
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function settle(page: Page): Promise<void> {
  await page.goto(urls.demo);
  await expect(page.getByTestId('mode-badge')).toContainText('OFFLINE DEMO');
  await expect(page.getByRole('heading', { level: 2, name: 'Verification report' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.beforeAll(() => {
  mkdirSync(ASSETS, { recursive: true });
});

test('dashboard-overview.png (desktop, light, top of the page)', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await settle(page);
  await showThrough(page, 'compatibility');
  await page.screenshot({ path: `${ASSETS}dashboard-overview.png`, animations: 'disabled' });
  await context.close();
});

test('dashboard-dark.png (desktop, dark, top of the page)', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await settle(page);
  await showThrough(page, 'compatibility');
  await page.screenshot({ path: `${ASSETS}dashboard-dark.png`, animations: 'disabled' });
  await context.close();
});

test('dashboard-mobile.png (390x844)', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await settle(page);
  await page.screenshot({
    path: `${ASSETS}dashboard-mobile.png`,
    fullPage: false,
    animations: 'disabled',
  });
  await context.close();
});
