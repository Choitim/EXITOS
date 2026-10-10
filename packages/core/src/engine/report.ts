import { VERSION, sha256Hex } from '@exitos/shared';
import {
  MigrationReportSchema,
  aggregateFindings,
  type Finding,
  type IdMapping,
  type MigrationCheckpoint,
  type MigrationPlan,
  type MigrationReport,
  type ReportItem,
  type ReportState,
  type RunSummary,
  type VerificationResult,
} from '../schema/index.js';

export interface BuildReportInput {
  plan: MigrationPlan;
  run: RunSummary | null;
  checkpoints: readonly MigrationCheckpoint[];
  verification: VerificationResult | null;
  mappings: readonly IdMapping[];
  requests?: MigrationReport['requests'];
  now: Date;
}

export function deriveReportState(
  run: RunSummary | null,
  verification: VerificationResult | null,
): ReportState {
  if (run === null) return 'planned_only';
  switch (run.status) {
    case 'approved':
    case 'applying':
    case 'verifying':
      return 'in_progress';
    case 'stopped':
      return 'partial';
    case 'failed':
      return 'failed';
    case 'applied':
      return 'applied_unverified';
    case 'verification_failed':
      return 'verification_failed';
    case 'verified':
      return verification?.status === 'passed' ? 'verified' : 'applied_unverified';
  }
}

function headline(
  state: ReportState,
  plan: MigrationPlan,
  run: RunSummary | null,
  verification: VerificationResult | null,
): string {
  const total = plan.summary.actions.toExecute;
  const skipped = plan.summary.actions.toSkip;
  const notPreserved = plan.summary.notPreserved.unsupported + plan.summary.notPreserved.lossy;
  switch (state) {
    case 'planned_only':
      return `PLAN ONLY — nothing has been written. ${total} action(s) would run${skipped > 0 ? `, ${skipped} skipped (already present)` : ''}; ${notPreserved} finding(s) require review or are unsupported.`;
    case 'in_progress':
      return `IN PROGRESS — ${run?.counts.succeeded ?? 0} of ${total} action(s) done. Not verified.`;
    case 'partial':
      return `PARTIAL — stopped after ${run?.counts.succeeded ?? 0} of ${total} action(s). ${run?.stopReason ?? ''} Resume with \`exitos resume\`.`.trim();
    case 'failed':
      return `FAILED — ${run?.counts.failed ?? 0} action(s) failed and ${run?.counts.blocked ?? 0} were blocked. This migration is NOT complete.`;
    case 'applied_unverified':
      return `APPLIED — NOT VERIFIED. All ${total} action(s) ran, but the result has not been checked against the destination. Run \`exitos verify\`.`;
    case 'verification_failed':
      return `VERIFICATION FAILED — ${verification?.counts.mismatched ?? 0} mismatched, ${verification?.counts.missing ?? 0} missing. This migration is NOT complete.`;
    case 'verified':
      return `VERIFIED — ${verification?.counts.verified ?? 0} planned item(s) match the plan within the declared scope. ${notPreserved} finding(s) require review or are unsupported and are listed below.`;
  }
}

export function buildReport(input: BuildReportInput): MigrationReport {
  const { plan, run, verification } = input;
  const byAction = new Map(input.checkpoints.map((c) => [c.actionId, c]));
  const state = deriveReportState(run, verification);

  const items: ReportItem[] = plan.actions.map((action) => {
    const cp = byAction.get(action.id);
    const status = cp?.status ?? (action.disposition === 'skip' ? 'skipped' : 'pending');
    const outcome = status === 'failed' || status === 'blocked' ? 'failed' : action.outcome;
    return {
      actionId: action.id,
      label: action.label,
      source: action.source,
      status,
      outcome,
      ...(cp?.destinationId === undefined
        ? action.existingDestinationId === undefined
          ? {}
          : { destinationId: action.existingDestinationId }
        : { destinationId: cp.destinationId }),
      ...(cp?.destinationUrl === undefined ? {} : { destinationUrl: cp.destinationUrl }),
      ...(cp?.lastError === undefined
        ? {}
        : { error: `${cp.lastError.code}: ${cp.lastError.message}` }),
      findings: action.findings,
    };
  });

  const failedFindings: Finding[] = items
    .filter((i) => i.status === 'failed' || i.status === 'blocked')
    .map((i) => ({
      code: i.status === 'failed' ? 'ACTION_FAILED' : 'ACTION_BLOCKED',
      outcome: 'failed' as const,
      severity: 'error' as const,
      category: 'destination' as const,
      message:
        i.status === 'failed'
          ? 'The destination rejected this item; it was not created.'
          : 'Not attempted because a prerequisite item failed.',
      ...(i.source === null ? {} : { entity: i.source }),
    }));

  const notPreserved = aggregateFindings([
    ...plan.inventory.filter((f) => f.outcome === 'lossy' || f.outcome === 'unsupported'),
    ...failedFindings,
  ]);

  const disclaimers = [
    'ExitOS verifies only the declared supported scope. It makes no claim of "zero data loss"; everything outside that scope is listed under "Not preserved".',
    ...(plan.mode === 'demo'
      ? [
          'OFFLINE DEMO: all content is synthetic and was processed by an in-process fake API. No real system was contacted, and this result says nothing about real workspaces.',
        ]
      : [
          'Verification compares the plan with what the destination API returned. It does not prove that every feature behaves identically in the destination.',
        ]),
  ];

  return MigrationReportSchema.parse({
    schemaVersion: 1,
    generatedAt: input.now.toISOString(),
    exitosVersion: VERSION,
    mode: plan.mode,
    redacted: false,
    state,
    headline: headline(state, plan, run, verification),
    plan: {
      planId: plan.planId,
      hash: plan.hash,
      source: { system: plan.source.workspace.system, workspace: plan.source.workspace.name },
      destination: {
        system: plan.destination.workspace.system,
        workspace: plan.destination.workspace.name,
      },
      summary: plan.summary,
    },
    run,
    items,
    notPreserved,
    verification,
    mappings: input.mappings,
    requests: input.requests ?? null,
    disclaimers,
  });
}

// ---------------------------------------------------------------------------------------------
// Redaction: a version safe to attach to a public bug report.
// ---------------------------------------------------------------------------------------------

const tag = (prefix: string, value: string): string =>
  `[${prefix}:${sha256Hex(value).slice(0, 8)}]`;

/** Opaque identifier-safe stand-in, e.g. `dst-1a2b3c4d`. */
const idTag = (prefix: string, value: string): string =>
  `${prefix}-${sha256Hex(value).slice(0, 8)}`;

/** `notion:page:<id>` → `notion:page:<hash>`: keeps system and kind, hides which object it was. */
function hashKey(key: string): string {
  const [system, kind, ...rest] = key.split(':');
  if (system === undefined || kind === undefined || rest.length === 0) return tag('key', key);
  return `${system}:${kind}:${sha256Hex(rest.join(':')).slice(0, 12)}`;
}

export function redactReport(report: MigrationReport): MigrationReport {
  return MigrationReportSchema.parse({
    ...report,
    redacted: true,
    plan: {
      ...report.plan,
      source: { ...report.plan.source, workspace: '[redacted]' },
      destination: { ...report.plan.destination, workspace: '[redacted]' },
    },
    items: report.items.map((item) => {
      const { destinationUrl: _url, destinationId, error, source, ...rest } = item;
      return {
        ...rest,
        source: source === null ? null : hashKey(source),
        ...(destinationId === undefined ? {} : { destinationId: idTag('dst', destinationId) }),
        label: tag('item', item.actionId),
        ...(error === undefined ? {} : { error: error.split(':')[0] ?? 'ERROR' }),
      };
    }),
    verification:
      report.verification === null
        ? null
        : {
            ...report.verification,
            targets: report.verification.targets.map((t) => ({
              ...t,
              target: tag('target', t.target),
            })),
            items: report.verification.items.map((i) => ({
              ...i,
              source: i.source === null ? null : hashKey(i.source),
              ...(i.destinationId === undefined
                ? {}
                : { destinationId: idTag('dst', i.destinationId) }),
              checks: i.checks.map(({ expected: _e, actual: _a, note: _n, ...c }) => c),
            })),
          },
    mappings: report.mappings.map((m) => ({
      ...m,
      sourceKey: hashKey(m.sourceKey),
      destinationId: idTag('dst', m.destinationId),
      scope: tag('scope', m.scope),
      ...(m.destinationUrl === undefined ? {} : { destinationUrl: '[redacted]' }),
    })),
    notPreserved: report.notPreserved.map(({ entity: _entity, field, ...f }) => ({
      ...f,
      ...(field === undefined ? {} : { field: tag('field', field) }),
    })),
    headline: report.headline,
  });
}

// ---------------------------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------------------------

// The words people read, the same in the terminal, the dashboard and the docs. Data values keep their
// names (supported / lossy ...); only what is printed changes.
const OUTCOME_LABEL: Record<string, string> = {
  supported: 'Preserved',
  transformed: 'Transformed',
  lossy: 'Requires review',
  unsupported: 'Unsupported',
  skipped: 'Skipped',
  failed: 'Failed',
};

function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderReportMarkdown(report: MigrationReport): string {
  const out: string[] = [];
  const demo = report.mode === 'demo';
  out.push(`# ExitOS migration report${demo ? ' — OFFLINE DEMO' : ''}`, '');
  out.push(`> **${report.headline}**`, '');
  if (demo)
    out.push('_Synthetic data, in-process fake APIs, no network. Not a real migration._', '');
  if (report.redacted)
    out.push('_Redacted: titles, names, URLs and values have been replaced by hashes._', '');

  out.push('| | |', '|---|---|');
  out.push(`| Plan | \`${report.plan.planId}\` |`);
  out.push(
    `| Source | ${mdCell(report.plan.source.system)} — ${mdCell(report.plan.source.workspace)} |`,
  );
  out.push(
    `| Destination | ${mdCell(report.plan.destination.system)} — ${mdCell(report.plan.destination.workspace)} |`,
  );
  out.push(
    `| Run | ${report.run ? `\`${report.run.runId}\` (${report.run.status})` : 'none (plan only)'} |`,
  );
  out.push(`| Generated | ${report.generatedAt} · ExitOS ${report.exitosVersion} |`, '');

  const s = report.plan.summary;
  out.push('## What happens to your content', '');
  out.push('| Outcome | Items |', '|---|---:|');
  for (const key of ['supported', 'transformed', 'lossy', 'unsupported', 'skipped'] as const) {
    out.push(`| ${OUTCOME_LABEL[key]} | ${s.items[key]} |`);
  }
  out.push('');

  const lossy = report.notPreserved.filter(
    (f) => f.outcome === 'lossy' || f.outcome === 'unsupported' || f.outcome === 'failed',
  );
  out.push('## Not preserved', '');
  if (lossy.length === 0) {
    out.push('Nothing in the declared scope was found to require review or to be unsupported.', '');
  } else {
    out.push('| Outcome | Code | Count | What happens |', '|---|---|---:|---|');
    for (const f of lossy) {
      out.push(
        `| ${OUTCOME_LABEL[f.outcome]} | \`${f.code}\` | ${f.count ?? 1} | ${mdCell(f.message)}${f.field ? ` _(${mdCell(f.field)})_` : ''} |`,
      );
    }
    out.push('');
  }

  const changed = report.plan ? s.items.transformed : 0;
  if (changed > 0) {
    out.push('## Changed but preserved', '');
    out.push(
      `${changed} item(s) are migrated in a different representation (see the plan inventory for details).`,
      '',
    );
  }

  if (report.run) {
    const c = report.run.counts;
    out.push('## Apply', '');
    out.push(
      `Succeeded **${c.succeeded}** · skipped ${c.skipped} · failed ${c.failed} · blocked ${c.blocked} · ambiguous ${c.ambiguous} · pending ${c.pending}`,
      '',
    );
    if (report.run.stopReason) out.push(`Stop reason: ${mdCell(report.run.stopReason)}`, '');
    const failed = report.items.filter(
      (i) => i.status === 'failed' || i.status === 'blocked' || i.status === 'ambiguous',
    );
    if (failed.length > 0) {
      out.push('| Item | Status | Detail |', '|---|---|---|');
      for (const i of failed)
        out.push(`| ${mdCell(i.label)} | ${i.status} | ${mdCell(i.error ?? '')} |`);
      out.push('');
    }
  }

  out.push('## Verification', '');
  if (report.verification === null) {
    out.push('**Not verified.** Run `exitos verify` after applying.', '');
  } else {
    const v = report.verification;
    out.push(
      `Result: **${v.status.toUpperCase()}** — verified ${v.counts.verified}, mismatched ${v.counts.mismatched}, missing ${v.counts.missing}, unverified ${v.counts.unverified}.`,
      '',
      `Scope: ${v.scope}`,
      '',
    );
    for (const t of v.targets)
      out.push(`- ${mdCell(t.target)}: expected ${t.expected}, found ${t.found}`);
    if (v.targets.length > 0) out.push('');
    const problems = v.items.filter((i) => i.status !== 'verified');
    if (problems.length > 0) {
      out.push('| Item | Status | Detail |', '|---|---|---|');
      for (const i of problems.slice(0, 200)) {
        const detail = i.checks
          .filter((c) => c.status !== 'verified')
          .map((c) => `${c.field}: ${c.status}${c.note ? ` (${c.note})` : ''}`)
          .join('; ');
        out.push(`| ${mdCell(i.source ?? i.actionId)} | ${i.status} | ${mdCell(detail)} |`);
      }
      out.push('');
    }
    for (const n of v.notes) out.push(`- ${n}`);
    if (v.notes.length > 0) out.push('');
  }

  out.push('## Notes', '');
  for (const d of report.disclaimers) out.push(`- ${d}`);
  out.push('');
  return out.join('\n');
}
