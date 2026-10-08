/**
 * Facts about how Playwright was started, read from the process. Kept here (not in
 * playwright.config.ts) because that file is linted without Node's global types.
 */

/** True on CI: enables the HTML report and forbids `test.only`. */
export const isCi: boolean = process.env.CI !== undefined;

/**
 * The `screenshots` project regenerates docs/assets and must never run by accident, so it only
 * exists when asked for (`--project=screenshots`, a path containing "screenshots", or
 * EXITOS_SCREENSHOTS=1). Worker processes inherit the variable, so they build the same project list.
 */
export const wantsScreenshots: boolean =
  process.env.EXITOS_SCREENSHOTS === '1' || process.argv.some((arg) => arg.includes('screenshots'));

if (wantsScreenshots) process.env.EXITOS_SCREENSHOTS = '1';
