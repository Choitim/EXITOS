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
  /** A plan that exists but was never approved: no run. */
  get planned(): string {
    return requiredEnv(ENV.planned);
  },
  /** A run that applied every action but was never verified. */
  get applied(): string {
    return requiredEnv(ENV.applied);
  },
  /** A run that stopped with failed, blocked and ambiguous actions. */
  get failed(): string {
    return requiredEnv(ENV.failed);
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

export interface ApiFinding {
  code: string;
  outcome: string;
  severity: string;
  message: string;
  count?: number;
  field?: string;
  collection?: string;
}

type OutcomeTally = Record<
  'supported' | 'transformed' | 'lossy' | 'unsupported' | 'skipped' | 'failed',
  number
>;

/** Subset of `GET /api/state` the tests compare against (the page must agree with the API). */
export interface ApiState {
  mode: string;
  plan: {
    planId: string;
    mappings: Array<{ id: string; collection: string; source: { name: string }; outcome: string }>;
    collections: Array<{
      key: string;
      name: string;
      recordCount: number;
      target: { id: string; name: string } | null;
    }>;
    inventory: ApiFinding[];
    findings: ApiFinding[];
    knownLimits: string[];
    actions: Array<{
      id: string;
      kind: string;
      scope: string;
      disposition: string;
      outcome: string;
      findings: ApiFinding[];
      payload: Record<string, unknown>;
    }>;
    destination: {
      workspace: { name: string };
      targets: Array<{ kind: string; id: string; name: string }>;
    };
    summary: {
      actions: {
        total: number;
        toExecute: number;
        toSkip: number;
        byKind: Record<string, number>;
      };
      items: OutcomeTally;
      fields: OutcomeTally;
      notPreserved: { unsupported: number; lossy: number };
      blockingErrors: number;
      warnings: number;
    };
    users: { mapped: unknown[]; unmapped: unknown[]; assignmentsThatNotify: number };
  };
  run: {
    runId: string;
    status: string;
    counts: Record<string, number>;
    stopReason?: string;
  } | null;
  verification: {
    status: string;
    counts: { verified: number; mismatched: number; missing: number; unverified: number };
    targets: Array<{ target: string; expected: number; found: number }>;
    scope: string;
  } | null;
  report: { state: string; headline: string; notPreserved: ApiFinding[] } | null;
  events: Array<{ id: number; message: string; type: string; level: string }>;
}

export async function fetchState(baseUrl: string): Promise<ApiState> {
  const response = await fetch(`${baseUrl}api/state`);
  if (!response.ok) throw new Error(`GET /api/state failed: ${response.status}`);
  return (await response.json()) as ApiState;
}

/** Thousands separators exactly as the dashboard prints them. */
export const fmt = (n: number): string => n.toLocaleString('en-US');

/**
 * Serve a changed copy of the real `/api/state` to the page: fetch the live document, let `mutate`
 * edit a deep copy in place, and answer every page request with the result. The edits only reshape
 * what the real server returned (drop the run, repeat a mapping, ...); nothing here is shown by
 * the dashboard unless the state says so.
 */
export async function mockState(
  page: Page,
  baseUrl: string,
  mutate: (state: ApiState) => void,
): Promise<ApiState> {
  const state = structuredClone(await fetchState(baseUrl));
  mutate(state);
  await page.route('**/api/state', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }),
  );
  return state;
}
