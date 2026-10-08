import { ApprovalError, ConfigError, PlanIntegrityError } from '@exitos/shared';
import { describe, expect, it } from 'vitest';
import {
  approveAndCreateRun,
  buildReport,
  deriveReportState,
  parseMigrationConfig,
  redactReport,
  renderReportMarkdown,
  type RunSummary,
  type VerificationResult,
} from '../src/index.js';
import { finding, makeAction, makePlan, memoryStore } from './helpers.js';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('approval gate', () => {
  it('refuses to start without approval and tells the user exactly what to pass', () => {
    const store = memoryStore();
    const plan = makePlan([makeAction(1)]);
    expect(() => approveAndCreateRun({ plan, store, approvedPlanId: undefined, now: NOW })).toThrow(
      ApprovalError,
    );
    expect(() => approveAndCreateRun({ plan, store, approvedPlanId: undefined, now: NOW })).toThrow(
      plan.planId,
    );
    expect(store.listRuns()).toHaveLength(0);
  });

  it('refuses an approval for a different plan', () => {
    const store = memoryStore();
    const plan = makePlan([makeAction(1)]);
    expect(() =>
      approveAndCreateRun({ plan, store, approvedPlanId: 'plan_deadbeef0000', now: NOW }),
    ).toThrow(/does not match/);
  });

  it('refuses a tampered plan before creating any state', () => {
    const store = memoryStore();
    const plan = makePlan([makeAction(1)]);
    const evil = JSON.parse(JSON.stringify(plan)) as typeof plan;
    evil.actions[0]!.payload = { n: 'evil' };
    expect(() =>
      approveAndCreateRun({ plan: evil, store, approvedPlanId: plan.planId, now: NOW }),
    ).toThrow(PlanIntegrityError);
    expect(store.listRuns()).toHaveLength(0);
  });

  it('refuses plans with blocking errors', () => {
    const store = memoryStore();
    const plan = makePlan([makeAction(1)], {
      findings: [
        finding({
          code: 'DEST_LIST_NOT_FOUND',
          outcome: 'unsupported',
          severity: 'error',
          message: 'List 123 not found',
        }),
      ],
    });
    expect(() =>
      approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: NOW }),
    ).toThrow(/blocking error/);
    expect(() =>
      approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: NOW }),
    ).toThrow(ConfigError);
  });

  it('refuses to run the same plan twice', () => {
    const store = memoryStore();
    const plan = makePlan([makeAction(1)]);
    approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: NOW });
    expect(() =>
      approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: NOW }),
    ).toThrow(/already has run/);
  });
});

describe('migration config', () => {
  const valid = `
version: 1
source: { type: notion, dataSources: [{ id: abc }] }
destination: { type: clickup, workspaceId: "1" }
`;

  it('parses and applies safe defaults', () => {
    const cfg = parseMigrationConfig(valid);
    expect(cfg.users.matchByEmail).toBe(false);
    expect(cfg.users.unmapped).toBe('description');
    expect(cfg.options).toMatchObject({
      timezone: 'UTC',
      provenance: 'footer',
      unmappedFields: 'description',
      concurrency: 4,
    });
    expect(cfg.options.experimental.docs).toBe(false);
  });

  it('rejects credentials in the config file', () => {
    expect(() => parseMigrationConfig(`${valid}\nsource_token: abc`)).toThrow();
    expect(() =>
      parseMigrationConfig(valid.replace('type: notion', 'type: notion, token: ntn_x')),
    ).toThrow(/credentials/);
    expect(() =>
      parseMigrationConfig(valid.replace('workspaceId: "1"', 'workspaceId: "1", apiKey: pk_1')),
    ).toThrow(/environment variables/);
  });

  it('rejects unknown top-level keys and bad option values', () => {
    expect(() => parseMigrationConfig(`${valid}\nsurprise: true`)).toThrow(ConfigError);
    expect(() => parseMigrationConfig(`${valid}\noptions: { timezone: Mars/Base }`)).toThrow(
      /time zone/i,
    );
    expect(() => parseMigrationConfig(`${valid}\noptions: { concurrency: 500 }`)).toThrow(
      ConfigError,
    );
  });

  it('gives a friendly error for broken YAML and wrong shapes', () => {
    expect(() => parseMigrationConfig('version: [unclosed')).toThrow(/Could not parse/);
    expect(() => parseMigrationConfig('- just\n- a list')).toThrow(ConfigError);
    expect(() => parseMigrationConfig('')).toThrow(ConfigError);
  });

  it('accepts JSON configs', () => {
    const cfg = parseMigrationConfig(
      JSON.stringify({ version: 1, source: { type: 'notion' }, destination: { type: 'clickup' } }),
      'migration.json',
    );
    expect(cfg.destination.type).toBe('clickup');
  });
});

describe('reports never over-claim', () => {
  const plan = makePlan([
    makeAction(1, {
      findings: [finding({ code: 'FIELD_ROLLUP_SNAPSHOT', outcome: 'lossy', field: 'Open deps' })],
      outcome: 'lossy',
    }),
    makeAction(2, {
      findings: [finding({ code: 'ATTACHMENT_HOSTED', outcome: 'unsupported', field: 'Files' })],
      outcome: 'unsupported',
    }),
  ]);
  const baseRun: RunSummary = {
    runId: 'run_1',
    planId: plan.planId,
    planHash: plan.hash,
    mode: 'live',
    status: 'applied',
    approvedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    counts: {
      pending: 0,
      in_flight: 0,
      succeeded: 2,
      failed: 0,
      ambiguous: 0,
      blocked: 0,
      skipped: 0,
    },
  };
  const passed: VerificationResult = {
    runId: 'run_1',
    planId: plan.planId,
    verifiedAt: NOW.toISOString(),
    status: 'passed',
    counts: { verified: 2, mismatched: 0, missing: 0, unverified: 0 },
    targets: [{ target: 'list 1', expected: 2, found: 2 }],
    items: [],
    scope: 'Names and statuses of planned tasks.',
    notes: [],
  };
  const report = (run: RunSummary | null, verification: VerificationResult | null) =>
    buildReport({ plan, run, checkpoints: [], verification, mappings: [], now: NOW });

  it('plan only → says nothing was written', () => {
    const r = report(null, null);
    expect(r.state).toBe('planned_only');
    expect(r.headline).toMatch(/nothing has been written/i);
  });

  it('applied but unverified is NEVER presented as complete', () => {
    const r = report(baseRun, null);
    expect(r.state).toBe('applied_unverified');
    expect(r.headline).toMatch(/NOT VERIFIED/);
    expect(r.headline).not.toMatch(/verified —/i);
  });

  it('only a passed verification on a verified run is "verified"', () => {
    expect(deriveReportState({ ...baseRun, status: 'verified' }, passed)).toBe('verified');
    // run says verified but the verification record is not "passed" → do not trust it
    expect(
      deriveReportState({ ...baseRun, status: 'verified' }, { ...passed, status: 'failed' }),
    ).toBe('applied_unverified');
    expect(
      deriveReportState(
        { ...baseRun, status: 'verification_failed' },
        { ...passed, status: 'failed' },
      ),
    ).toBe('verification_failed');
  });

  it('partial runs say so and how to continue', () => {
    const r = report(
      {
        ...baseRun,
        status: 'stopped',
        stopReason: 'Auth rejected.',
        counts: { ...baseRun.counts, succeeded: 1, pending: 1 },
      },
      null,
    );
    expect(r.state).toBe('partial');
    expect(r.headline).toContain('exitos resume');
  });

  it('lists every lossy and unsupported finding under "Not preserved"', () => {
    const r = report({ ...baseRun, status: 'verified' }, passed);
    expect(r.notPreserved.map((f) => f.code).sort()).toEqual([
      'ATTACHMENT_HOSTED',
      'FIELD_ROLLUP_SNAPSHOT',
    ]);
    const md = renderReportMarkdown(r);
    expect(md).toContain('## Not preserved');
    expect(md).toContain('ATTACHMENT_HOSTED');
    expect(md).toContain('FIELD_ROLLUP_SNAPSHOT');
  });

  it('never contains a "zero data loss" claim, and always states the scope caveat', () => {
    const md = renderReportMarkdown(report({ ...baseRun, status: 'verified' }, passed));
    expect(md.toLowerCase()).not.toMatch(/(?<!no claim of ")zero data loss(?!")/);
    expect(md).toMatch(/no claim of "zero data loss"/);
    expect(md).toContain('Scope: Names and statuses');
  });

  it('labels demo reports as synthetic', () => {
    const demoPlan = makePlan([makeAction(1)], { mode: 'demo' });
    const r = buildReport({
      plan: demoPlan,
      run: null,
      checkpoints: [],
      verification: null,
      mappings: [],
      now: NOW,
    });
    expect(renderReportMarkdown(r)).toMatch(/OFFLINE DEMO/);
    expect(r.disclaimers.join(' ')).toMatch(/synthetic/);
  });

  it('redaction removes titles, URLs, field values and identifiers of private content', () => {
    const secretTitle = 'Q3 acquisition of Globex (confidential)';
    const p = makePlan([{ ...makeAction(1), label: `Create task "${secretTitle}"` }]);
    const r = buildReport({
      plan: p,
      run: { ...baseRun, planId: p.planId, planHash: p.hash },
      checkpoints: [
        {
          runId: 'run_1',
          actionId: p.actions[0]!.id,
          status: 'succeeded',
          attempts: 1,
          destinationId: 'abc123',
          destinationUrl: 'https://app.clickup.com/t/abc123',
          updatedAt: NOW.toISOString(),
        },
      ],
      verification: {
        ...passed,
        planId: p.planId,
        items: [
          {
            actionId: p.actions[0]!.id,
            source: 'test:item:1',
            destinationId: 'abc123',
            status: 'verified',
            checks: [
              { field: 'name', status: 'verified', expected: secretTitle, actual: secretTitle },
            ],
          },
        ],
      },
      mappings: [
        {
          sourceKey: 'test:item:1',
          scope: 'test:scope',
          destinationId: 'abc123',
          destinationUrl: 'https://app.clickup.com/t/abc123',
          runId: 'run_1',
          createdAt: NOW.toISOString(),
        },
      ],
      now: NOW,
    });
    expect(JSON.stringify(r)).toContain(secretTitle);
    const red = redactReport(r);
    const blob = JSON.stringify(red) + renderReportMarkdown(red);
    expect(blob).not.toContain('Globex');
    expect(blob).not.toContain('app.clickup.com');
    expect(blob).not.toContain('abc123');
    expect(red.redacted).toBe(true);
    expect(renderReportMarkdown(red)).toMatch(/Redacted/);
  });
});
