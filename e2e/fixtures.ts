import { test as base, expect, type Page } from '@playwright/test';
import { ENV, requiredEnv } from './support/paths.js';

export { expect };

export const urls = {
  get demo(): string {
    return requiredEnv(ENV.demo);
  },
  get xss(): string {
    return requiredEnv(ENV.xss);
  },
  get live(): string {
    return requiredEnv(ENV.live);
  },
  get empty(): string {
    return requiredEnv(ENV.empty);
  },
};

export interface Monitor {
  /** Console messages of type error or warning. */
  problems: string[];
  /** Uncaught exceptions in the page. */
  pageErrors: string[];
  /** Messages of JavaScript dialogs (alert/confirm/prompt) that opened. */
  dialogs: string[];
  /** Failed network requests. */
  failedRequests: string[];
  /** `securitypolicyviolation` events seen by the page. */
  cspViolations(): Promise<string[]>;
}

interface CspWindow {
  __cspViolations?: string[];
}

/** Collects everything that must stay empty in a healthy dashboard. */
async function attachMonitor(page: Page): Promise<Monitor> {
  const problems: string[] = [];
  const pageErrors: string[] = [];
  const dialogs: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => {
    const type = message.type();
    if (type === 'error' || type === 'warning') problems.push(`${type}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });
  await page.addInitScript(() => {
    const w = window as unknown as CspWindow;
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return {
    problems,
    pageErrors,
    dialogs,
    failedRequests,
    cspViolations: () =>
      page.evaluate(() => (window as unknown as CspWindow).__cspViolations ?? []),
  };
}

export const test = base.extend<{ monitor: Monitor }>({
  monitor: async ({ page }, use) => {
    await use(await attachMonitor(page));
  },
});

/** Subset of `GET /api/state` the tests compare against (the page must agree with the API). */
export interface ApiState {
  mode: string;
  plan: {
    planId: string;
    mappings: Array<{ collection: string; source: { name: string }; outcome: string }>;
    collections: Array<{ key: string; name: string; recordCount: number }>;
    inventory: Array<{
      code: string;
      outcome: string;
      count?: number;
      message: string;
      field?: string;
    }>;
    knownLimits: string[];
    actions: Array<{ id: string; kind: string; payload: Record<string, unknown> }>;
    summary: {
      actions: { total: number; toExecute: number; toSkip: number };
      items: Record<
        'supported' | 'transformed' | 'lossy' | 'unsupported' | 'skipped' | 'failed',
        number
      >;
      fields: Record<
        'supported' | 'transformed' | 'lossy' | 'unsupported' | 'skipped' | 'failed',
        number
      >;
      notPreserved: { unsupported: number; lossy: number };
    };
    users: { mapped: unknown[]; unmapped: unknown[]; assignmentsThatNotify: number };
  };
  run: { runId: string; status: string; counts: Record<string, number> } | null;
  verification: {
    status: string;
    counts: { verified: number; mismatched: number; missing: number; unverified: number };
    targets: Array<{ target: string; expected: number; found: number }>;
    scope: string;
  } | null;
  report: { state: string; headline: string } | null;
  events: Array<{ id: number; message: string }>;
}

export async function fetchState(baseUrl: string): Promise<ApiState> {
  const response = await fetch(`${baseUrl}api/state`);
  if (!response.ok) throw new Error(`GET /api/state failed: ${response.status}`);
  return (await response.json()) as ApiState;
}

/** Thousands separators exactly as the dashboard prints them. */
export const fmt = (n: number): string => n.toLocaleString('en-US');
