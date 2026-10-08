import { TAGLINE, VERSION } from '@exitos/shared';
import type {
  Finding,
  MigrationPlan,
  MigrationReport,
  Outcome,
  RunSummary,
  VerificationResult,
} from '@exitos/core';
import { bar, box, keyValues, number, rule, table } from './layout.js';
import { displayWidth, padEnd, wrap, type Style } from './style.js';

export const ICON: Record<Outcome, string> = {
  supported: '✔',
  transformed: '↻',
  lossy: '⚠',
  unsupported: '✖',
  skipped: '○',
  failed: '✖',
};

export const OUTCOME_WORD: Record<Outcome, string> = {
  supported: 'moves as-is',
  transformed: 'changes shape',
  lossy: 'loses detail',
  unsupported: 'cannot move',
  skipped: 'skipped',
  failed: 'failed',
};

export function colourFor(style: Style, outcome: Outcome): (s: string) => string {
  switch (outcome) {
    case 'supported':
      return style.green;
    case 'transformed':
      return style.cyan;
    case 'lossy':
      return style.yellow;
    case 'unsupported':
    case 'failed':
      return style.red;
    case 'skipped':
      return style.gray;
  }
}

export const outcomeTag = (style: Style, o: Outcome): string =>
  colourFor(style, o)(`${ICON[o]} ${o}`);

/** `notion` → `Notion`, `clickup` → `ClickUp` (display only). */
export function prettyConnector(id: string): string {
  const known: Record<string, string> = { notion: 'Notion', clickup: 'ClickUp' };
  return known[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export interface ViewOptions {
  style: Style;
  width: number;
}

export function banner(mode: 'demo' | 'live', { style, width }: ViewOptions): string[] {
  if (mode === 'demo') {
    return [
      '',
      ...box(
        [
          `${style.badge('OFFLINE DEMO', 'yellow')} ${style.bold('ExitOS')} ${style.gray(`v${VERSION}`)} — ${TAGLINE}`,
          'Synthetic data · in-process fake APIs · no network · no credentials',
        ],
        style,
        Math.min(width, 100),
        style.yellow,
      ),
      '',
    ];
  }
  return ['', `${style.bold('ExitOS')} ${style.gray(`v${VERSION}`)} — ${TAGLINE}`, ''];
}

export function step(n: number, total: number, title: string, { style }: ViewOptions): string {
  return `\n${style.bold(style.cyan(`▌ Step ${n}/${total}`))} ${style.bold(title)}`;
}

// ---- plan ---------------------------------------------------------------------------------------
export function planView(
  plan: MigrationPlan,
  opts: ViewOptions & { savedTo?: string; full?: boolean; inventoryLimit?: number },
): string[] {
  const { style, width } = opts;
  const s = plan.summary;
  const out: string[] = [];
  const demo = plan.mode === 'demo';

  out.push(rule(`PLAN ${plan.planId}`, style, width));
  out.push(
    ...keyValues(
      [
        ['Source', `${prettyConnector(plan.source.connector.id)} · ${plan.source.workspace.name}`],
        [
          'Destination',
          `${prettyConnector(plan.destination.connector.id)} · ${plan.destination.workspace.name}`,
        ],
        ['Mode', demo ? style.badge('OFFLINE DEMO', 'yellow') : style.badge('LIVE', 'blue')],
        ['Status', style.green('READ-ONLY — nothing has been written anywhere')],
        ...(opts.savedTo ? ([['Saved to', opts.savedTo]] as const) : []),
      ],
      style,
    ),
  );
  out.push('');

  // The headline: moves / changes / cannot move
  const itemsTotal = s.actions.total;
  const changes = s.items.transformed;
  const loses = s.items.lossy;
  const cannot = s.notPreserved.unsupported;
  out.push(style.bold('HERE IS EVERYTHING THAT MOVES, CHANGES, AND CANNOT MOVE'));
  const row = (
    icon: string,
    label: string,
    colour: (x: string) => string,
    left: string,
    right: string,
  ): string =>
    `  ${colour(icon)} ${colour(padEnd(label, 16))}${padEnd(left, 22)}${style.gray(right)}`;
  out.push(
    row(
      '✔',
      'MOVES AS-IS',
      style.green,
      `${number(s.items.supported)} of ${number(itemsTotal)} actions`,
      `${number(s.fields.supported)} field mapping(s) are exact`,
    ),
  );
  out.push(
    row(
      '↻',
      'CHANGES SHAPE',
      style.cyan,
      `${number(changes)} of ${number(itemsTotal)} actions`,
      `${number(s.fields.transformed)} mapping(s) store the value differently`,
    ),
  );
  out.push(
    row(
      '⚠',
      'LOSES DETAIL',
      style.yellow,
      `${number(loses)} of ${number(itemsTotal)} actions`,
      `${number(s.fields.lossy)} mapping(s) lose information`,
    ),
  );
  out.push(
    row(
      '✖',
      'CANNOT MOVE',
      style.red,
      `${number(cannot)} finding(s)`,
      `${number(s.fields.unsupported)} property type(s) never move`,
    ),
  );
  if (s.actions.toSkip > 0)
    out.push(
      row(
        '○',
        'ALREADY THERE',
        style.gray,
        `${number(s.actions.toSkip)} action(s)`,
        'skipped, never duplicated',
      ),
    );
  out.push('');

  // Where things go
  out.push(style.bold('Where things go'));
  out.push(
    ...table(
      [
        { header: 'From', value: (c: MigrationPlan['collections'][number]) => c.name },
        { header: 'Rows', value: (c) => number(c.recordCount), align: 'right' },
        {
          header: 'To',
          value: (c) =>
            c.target ? `${c.target.name} (${c.target.kind} ${c.target.id})` : '— not migrated —',
        },
      ],
      plan.collections,
      style,
      width,
    ).map((l) => `  ${l}`),
  );
  const docs = plan.actions.filter((a) => a.kind.endsWith('create_doc')).length;
  const pages = plan.actions.filter((a) => a.kind.endsWith('create_doc_page')).length;
  const links = plan.actions.filter((a) => a.kind.endsWith('link_tasks')).length;
  out.push(
    `  ${style.gray(`+ ${number(links)} task link(s), ${number(docs)} Doc(s) with ${number(pages)} page(s)`)}`,
  );
  out.push('');

  if (opts.full !== false) {
    out.push(style.bold('Field mapping'));
    out.push(
      ...table(
        [
          {
            header: 'Source',
            value: (m: MigrationPlan['mappings'][number]) =>
              collectionShortName(plan, m.collection),
          },
          { header: 'Property', value: (m) => m.source.name, max: 26 },
          { header: '→ ClickUp', value: (m) => targetLabel(m), max: 28 },
          {
            header: 'Outcome',
            value: (m) => `${ICON[m.outcome]} ${m.outcome}`,
            colour: (m, cell) => colourFor(style, m.outcome)(cell),
          },
        ],
        plan.mappings,
        style,
        width,
      ).map((l) => `  ${l}`),
    );
    out.push('');
  }

  // Inventory: everything that is not a clean "supported", grouped by how bad it is
  const inv = sortFindings(plan.inventory);
  out.push(
    style.bold('Everything that changes or cannot move') + style.gray(`  (${inv.length} kinds)`),
  );
  if (inv.length === 0) out.push('  Nothing: every selected item moves as-is.');
  else out.push(...findingsTable(inv, opts, opts.inventoryLimit));
  out.push('');

  // People
  if (plan.users.mapped.length + plan.users.unmapped.length > 0) {
    out.push(style.bold('People'));
    out.push(
      `  ${style.green(`${plan.users.mapped.length} mapped`)} ${style.gray('(' + (plan.users.mapped.map((u) => u.name ?? u.source).join(', ') || '—') + ')')}`,
    );
    out.push(
      `  ${style.yellow(`${plan.users.unmapped.length} not mapped`)} ${style.gray('(' + (plan.users.unmapped.map((u) => u.name ?? u.source).join(', ') || '—') + ') — never assigned; names kept as text')}`,
    );
    out.push(
      `  ${plan.users.assignmentsThatNotify > 0 ? style.yellow('!') : style.gray('·')} ${number(plan.users.assignmentsThatNotify)} assignment(s) will notify people in ClickUp`,
    );
    out.push('');
  }

  // Plan-level warnings and errors
  const attention = plan.findings.filter(
    (f) =>
      f.severity !== 'info' &&
      (f.severity === 'error' ||
        f.outcome === 'supported' ||
        f.outcome === 'skipped' ||
        f.category === 'destination' ||
        f.category === 'scope' ||
        f.category === 'permission'),
  );
  if (attention.length > 0) {
    out.push(style.bold('Needs your attention'));
    for (const f of attention) {
      const tag = f.severity === 'error' ? style.red('ERROR  ') : style.yellow('WARNING');
      out.push(`  ${tag} ${style.gray(`[${f.code}]`)} ${f.message}`);
    }
    out.push('');
  }

  // Estimate
  out.push(style.bold('Estimated API operations'));
  out.push(
    `  ${number(plan.estimate.writeRequests)} write request(s) to ClickUp ≈ ${plan.estimate.minutesAtRateLimit} min at ${plan.estimate.requestsPerMinute}/min · ${number(plan.estimate.readRequests)} read request(s) used to plan`,
  );
  out.push('');

  out.push(style.bold('Never migrated by this version'));
  for (const limit of plan.knownLimits) out.push(`  ${style.gray('·')} ${limit}`);
  out.push('');
  return out;
}

const rank = (o: Outcome): number =>
  ({ failed: 5, unsupported: 4, lossy: 3, transformed: 2, skipped: 1, supported: 0 })[o];

function collectionShortName(plan: MigrationPlan, key: string): string {
  return plan.collections.find((c) => c.key === key)?.name ?? key;
}

function targetLabel(m: MigrationPlan['mappings'][number]): string {
  const t = m.target;
  if (t.kind === 'custom_field') return `custom field "${t.customField?.name ?? '?'}"`;
  if (t.kind === 'description_table') return 'description (as text)';
  if (t.kind === 'dropped')
    return m.outcome === 'skipped' ? '(skipped by config)' : '(not migrated)';
  if (t.kind === 'link') return 'linked task';
  if (t.kind === 'name') return 'task name';
  return t.kind.replace('_', ' ');
}

// ---- approval --------------------------------------------------------------------------------------
export function approvalView(plan: MigrationPlan, { style }: ViewOptions): string[] {
  return [
    style.bold('Approval required'),
    `  This will create ${style.bold(String(plan.summary.actions.toExecute))} item(s) in ${prettyConnector(plan.destination.connector.id)} (${plan.destination.workspace.name}).`,
    '  It never deletes or modifies anything in the source, and never overwrites existing destination content.',
  ];
}

// ---- progress ---------------------------------------------------------------------------------------
export function progressLine(counts: RunSummary['counts'], style: Style, barWidth = 28): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = counts.succeeded + counts.skipped;
  const problems = counts.failed + counts.blocked + counts.ambiguous;
  return `${bar(done, total, barWidth, style)} ${style.gray(`${number(done)}/${number(total)}`)}${problems > 0 ? ' ' + style.red(`${problems} problem(s)`) : ''}`;
}

// ---- verification -----------------------------------------------------------------------------------
export function verificationView(v: VerificationResult, { style, width }: ViewOptions): string[] {
  const out: string[] = [];
  const headline =
    v.status === 'passed'
      ? style.green('✔ VERIFIED')
      : v.status === 'failed'
        ? style.red('✖ VERIFICATION FAILED')
        : style.yellow('⚠ INCOMPLETE — some items could not be checked');
  out.push(rule('Verification', style, width));
  out.push(`  ${headline}`);
  out.push(
    `  ${style.green(`${number(v.counts.verified)} verified`)} · ${v.counts.mismatched > 0 ? style.red(`${v.counts.mismatched} mismatched`) : style.gray('0 mismatched')} · ${v.counts.missing > 0 ? style.red(`${v.counts.missing} missing`) : style.gray('0 missing')} · ${v.counts.unverified > 0 ? style.yellow(`${v.counts.unverified} unverified`) : style.gray('0 unverified')}`,
  );
  for (const t of v.targets)
    out.push(
      `  ${style.gray('·')} ${t.target}: expected ${number(t.expected)}, found ${number(t.found)}`,
    );
  const problems = v.items.filter((i) => i.status !== 'verified');
  if (problems.length > 0) {
    out.push('');
    out.push(
      ...table(
        [
          {
            header: 'Item',
            value: (i: (typeof problems)[number]) => i.source ?? i.actionId,
            max: 40,
          },
          { header: 'Result', value: (i) => i.status, colour: (_i, c) => style.red(c) },
          {
            header: 'Detail',
            value: (i) =>
              i.checks
                .filter((c) => c.status !== 'verified')
                .map(
                  (c) =>
                    `${c.field}${c.expected !== undefined ? ` expected "${c.expected}"` : ''}${c.actual !== undefined ? ` got "${c.actual}"` : ''}${c.note && !c.expected ? ` (${c.note})` : ''}`,
                )
                .join('; '),
          },
        ],
        problems.slice(0, 15),
        style,
        width,
      ).map((l) => `  ${l}`),
    );
    if (problems.length > 15)
      out.push(style.gray(`  … and ${problems.length - 15} more (see exitos report)`));
  }
  for (const line of wrap('Scope: ' + v.scope, width - 4)) out.push(`  ${style.gray(line)}`);
  return out;
}

// ---- status -------------------------------------------------------------------------------------------
export function statusView(
  run: RunSummary,
  plan: MigrationPlan | undefined,
  verification: VerificationResult | undefined,
  { style, width }: ViewOptions,
): string[] {
  const out: string[] = [];
  const label: Record<RunSummary['status'], string> = {
    approved: style.yellow('APPROVED — not started'),
    applying: style.yellow('APPLYING (or interrupted — use `exitos resume`)'),
    stopped: style.red('STOPPED — partial; resume with `exitos resume`'),
    failed: style.red('FAILED — some items did not migrate'),
    applied: style.yellow('APPLIED — NOT VERIFIED'),
    verifying: style.yellow('VERIFYING'),
    verified: style.green('VERIFIED'),
    verification_failed: style.red('VERIFICATION FAILED'),
  };
  out.push(rule(`Run ${run.runId}`, style, width));
  out.push(
    ...keyValues(
      [
        ['Plan', run.planId],
        [
          'Mode',
          run.mode === 'demo' ? style.badge('OFFLINE DEMO', 'yellow') : style.badge('LIVE', 'blue'),
        ],
        ['Status', label[run.status]],
        ['Progress', progressLine(run.counts, style)],
        ['Approved', run.approvedAt],
        ...(run.finishedAt ? ([['Finished', run.finishedAt]] as const) : []),
        ...(run.stopReason ? ([['Reason', style.red(run.stopReason)]] as const) : []),
      ],
      style,
    ),
  );
  if (plan)
    out.push(`  ${style.gray(`${plan.source.connector.id} → ${plan.destination.connector.id}`)}`);
  const c = run.counts;
  out.push(
    `  ${style.gray(`succeeded ${c.succeeded} · skipped ${c.skipped} · pending ${c.pending} · failed ${c.failed} · blocked ${c.blocked} · ambiguous ${c.ambiguous}`)}`,
  );
  if (verification)
    out.push(
      `  ${style.gray(`last verification: ${verification.status} (${verification.counts.verified} verified, ${verification.counts.mismatched} mismatched, ${verification.counts.missing} missing)`)}`,
    );
  out.push('');
  out.push(style.bold('Next'));
  const next: Partial<Record<RunSummary['status'], string>> = {
    approved: 'exitos resume',
    applying: 'exitos resume',
    stopped: 'exitos resume',
    failed: 'exitos resume   (retries only the items that failed)',
    applied: 'exitos verify   (a migration is not complete until it is verified)',
    verification_failed: 'exitos report   (see what differs), fix, then exitos verify',
    verified: 'exitos report   (the full list of what was not preserved)',
  };
  out.push(`  ${next[run.status] ?? 'exitos report'}`);
  return out;
}

// ---- report ----------------------------------------------------------------------------------------------
export function reportView(
  report: MigrationReport,
  { style, width }: ViewOptions,
  options: { limitPerGroup?: number } = {},
): string[] {
  const out: string[] = [];
  out.push(rule(`REPORT${report.mode === 'demo' ? ' · OFFLINE DEMO' : ''}`, style, width));
  const colour =
    report.state === 'verified'
      ? style.green
      : report.state === 'planned_only' ||
          report.state === 'applied_unverified' ||
          report.state === 'in_progress'
        ? style.yellow
        : style.red;
  out.push(`  ${colour(style.bold(report.headline))}`);
  out.push('');
  const s = report.plan.summary;
  out.push(
    `  ${style.green('✔')} ${s.items.supported} as-is   ${style.cyan('↻')} ${s.items.transformed} reshaped   ${style.yellow('⚠')} ${s.items.lossy} lose detail   ${style.gray('○')} ${s.items.skipped} skipped   ${style.red('✖')} ${s.notPreserved.unsupported} cannot move`,
  );
  if (report.run) {
    const c = report.run.counts;
    out.push(
      `  ${style.gray(`apply: ${c.succeeded} succeeded · ${c.failed} failed · ${c.blocked} blocked · ${c.pending} pending`)}`,
    );
  }
  if (report.verification) {
    const v = report.verification;
    out.push(
      `  ${style.gray(`verify: ${v.status} — ${v.counts.verified} verified · ${v.counts.mismatched} mismatched · ${v.counts.missing} missing · ${v.counts.unverified} unverified`)}`,
    );
  }
  out.push('');
  out.push(
    style.bold('NOT PRESERVED') + style.gray('  (lossy and unsupported — never silently dropped)'),
  );
  const np = report.notPreserved;
  if (np.length === 0) out.push('  Nothing in the declared scope.');
  else out.push(...findingsTable(np, { style, width }, opts_limit(options)));
  out.push('');
  for (const d of report.disclaimers) out.push(`  ${style.gray('·')} ${style.gray(d)}`);
  return out;
}

export const widthOf = (lines: readonly string[]): number =>
  Math.max(0, ...lines.map((l) => displayWidth(l)));

const sortFindings = (list: readonly Finding[]): Finding[] =>
  [...list].sort(
    (a, b) =>
      rank(b.outcome) - rank(a.outcome) ||
      (b.count ?? 1) - (a.count ?? 1) ||
      a.code.localeCompare(b.code),
  );

/** Findings as a table, optionally capped per outcome group (the full list is always in `exitos report`). */
export function findingsTable(
  list: readonly Finding[],
  { style, width }: ViewOptions,
  limitPerGroup?: number,
): string[] {
  const sorted = sortFindings(list);
  let rows = sorted;
  let hidden = 0;
  if (limitPerGroup !== undefined) {
    const seen = new Map<string, number>();
    rows = sorted.filter((f) => {
      const n = (seen.get(f.outcome) ?? 0) + 1;
      seen.set(f.outcome, n);
      return n <= limitPerGroup;
    });
    hidden = sorted.length - rows.length;
  }
  const lines = table(
    [
      {
        header: 'Outcome',
        value: (f: Finding) => `${ICON[f.outcome]} ${f.outcome}`,
        colour: (f, cell) => colourFor(style, f.outcome)(cell),
      },
      { header: 'Count', value: (f) => number(f.count ?? 1), align: 'right' },
      { header: 'What', value: (f) => `${f.field ? `${f.field}: ` : ''}${f.message}`, min: 24 },
    ],
    rows,
    style,
    width,
  ).map((l) => `  ${l}`);
  if (hidden > 0)
    lines.push(
      style.gray(
        `  … and ${hidden} more kind(s) — the complete list is in the report and the dashboard`,
      ),
    );
  return lines;
}

function opts_limit(options: { limitPerGroup?: number }): number | undefined {
  return options.limitPerGroup;
}
