import type { DashboardState, MigrationPlan } from '@exitos/core/schema';
import { useMemo, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  Chip,
  CommandLine,
  CopyButton,
  Icon,
  SectionShell,
  StateChip,
  Stat,
  TONE_TEXT,
  TableWrap,
} from '../components/ui';
import { downloadJson } from '../lib/browser';
import { nonVerifiedItems } from '../lib/derive';
import {
  VERIFY_COMMAND,
  describeVerification,
  formatDateTime,
  formatNumber,
  pluralize,
  timeZoneLabel,
  type Tone,
} from '../lib/format';
import { STATE_META, type IconName } from '../lib/outcomes';
import { sanitizeUrl, EXTERNAL_LINK_PROPS } from '../lib/url';

/**
 * Item and check statuses in the dashboard's vocabulary: a matching item is Verified; one that
 * differs or is missing is Failed (with the reason beside it); one that could not be checked
 * "requires review" in the sense that nothing is known about it either way.
 */
const ITEM_STATUS: Record<string, { tone: Tone; icon: IconName; label: string; solid: boolean }> = {
  verified: {
    tone: STATE_META.verified.tone,
    icon: STATE_META.verified.icon,
    label: STATE_META.verified.label,
    solid: true,
  },
  mismatched: {
    tone: STATE_META.failed.tone,
    icon: STATE_META.failed.icon,
    label: 'Failed: mismatched',
    solid: true,
  },
  missing: {
    tone: STATE_META.failed.tone,
    icon: STATE_META.failed.icon,
    label: 'Failed: missing',
    solid: true,
  },
  unverified: { tone: 'warn', icon: 'warning', label: 'Not verified', solid: false },
};

function StatusChip({ status }: { status: string }) {
  const meta = ITEM_STATUS[status] ?? {
    tone: 'neutral' as const,
    icon: 'info' as const,
    label: status,
    solid: false,
  };
  return (
    <Chip tone={meta.tone} icon={meta.icon} solid={meta.solid}>
      {meta.label}
    </Chip>
  );
}

const PAGE = 100;

function Downloads({ state, plan }: { state: DashboardState; plan: MigrationPlan }) {
  return (
    <Card title="Download">
      <p className="mb-3 text-sm text-muted">
        Files are created in your browser from the data already on this page. Nothing is uploaded.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={state.report === null}
          title={state.report === null ? 'The server did not include a report' : undefined}
          onClick={() => {
            if (state.report) downloadJson(`migration-report-${plan.planId}.json`, state.report);
          }}
          testId="download-report"
        >
          Download report (JSON)
        </Button>
        <Button
          onClick={() => {
            downloadJson('migration-plan.json', plan);
          }}
          testId="download-plan"
        >
          Download plan (JSON)
        </Button>
      </div>
      {state.report === null ? (
        <p className="mt-2 text-sm text-muted">No report is available to download.</p>
      ) : null}
    </Card>
  );
}

export function VerificationReport({
  state,
  plan,
}: {
  state: DashboardState;
  plan: MigrationPlan;
}) {
  const { verification, report } = state;
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(
    () => (verification ? nonVerifiedItems(verification, plan) : []),
    [verification, plan],
  );
  const destinationUrls = useMemo(
    () => new Map((report?.items ?? []).map((item) => [item.actionId, item.destinationUrl])),
    [report],
  );

  return (
    <SectionShell
      id="verification"
      number={7}
      title="Verification report"
      intro="Verification compares the plan with what the destination actually holds. Until it passes, the migration is not verified."
    >
      {verification === null ? (
        <Callout tone="warn" title="Not verified" testId="not-verified">
          <p>
            No verification has been recorded for {state.run ? 'this run' : 'this plan'}. Nothing
            has been compared with the destination.
          </p>
          <p className="text-sm">After applying, run:</p>
          <CommandLine command={VERIFY_COMMAND} />
          <CopyButton text={VERIFY_COMMAND} label="Copy verify command" testId="copy-verify" />
        </Callout>
      ) : (
        <>
          {(() => {
            const d = describeVerification(verification);
            return (
              <Callout
                tone={d.tone}
                title={<span data-testid="verification-status">{d.label}</span>}
                testId="verification-banner"
                tourTarget="result"
              >
                <p className="flex flex-wrap items-center gap-2">
                  {verification.status === 'passed' ? <StateChip state="verified" /> : null}
                  {verification.status === 'failed' ? <StateChip state="failed" /> : null}
                  <span>{d.summary}</span>
                </p>
                <p className="text-sm">
                  Verified at{' '}
                  <time dateTime={verification.verifiedAt}>
                    {formatDateTime(verification.verifiedAt)} {timeZoneLabel()}
                  </time>{' '}
                  for run <code>{verification.runId}</code>.
                </p>
              </Callout>
            );
          })()}

          <Card title="Counts">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Verified"
                icon={STATE_META.verified.icon}
                iconTone="ok"
                value={formatNumber(verification.counts.verified)}
                testId="vcount-verified"
              />
              <Stat
                label="Mismatched"
                icon={verification.counts.mismatched > 0 ? STATE_META.failed.icon : 'minus'}
                iconTone={verification.counts.mismatched > 0 ? 'bad' : 'neutral'}
                value={formatNumber(verification.counts.mismatched)}
                hint={verification.counts.mismatched > 0 ? 'counted as Failed' : undefined}
                testId="vcount-mismatched"
              />
              <Stat
                label="Missing"
                icon={verification.counts.missing > 0 ? STATE_META.failed.icon : 'minus'}
                iconTone={verification.counts.missing > 0 ? 'bad' : 'neutral'}
                value={formatNumber(verification.counts.missing)}
                hint={verification.counts.missing > 0 ? 'counted as Failed' : undefined}
                testId="vcount-missing"
              />
              <Stat
                label="Not verified"
                icon={verification.counts.unverified > 0 ? 'warning' : 'minus'}
                iconTone={verification.counts.unverified > 0 ? 'warn' : 'neutral'}
                value={formatNumber(verification.counts.unverified)}
                testId="vcount-unverified"
              />
            </dl>
          </Card>

          <TableWrap label="Expected versus found per destination target">
            <table className="data-table">
              <caption>Expected versus found, per destination target</caption>
              <thead>
                <tr>
                  <th scope="col">Target</th>
                  <th scope="col" className="num">
                    Expected
                  </th>
                  <th scope="col" className="num">
                    Found
                  </th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {verification.targets.map((t) => {
                  const ok = t.found === t.expected;
                  return (
                    <tr key={t.target} data-testid="verification-target">
                      <th scope="row">{t.target}</th>
                      <td className="num">{formatNumber(t.expected)}</td>
                      <td className="num">{formatNumber(t.found)}</td>
                      <td>
                        <Chip tone={ok ? 'ok' : 'bad'} icon={ok ? 'check' : 'cross'}>
                          {ok
                            ? 'Equal'
                            : t.found < t.expected
                              ? `${formatNumber(t.expected - t.found)} fewer than expected`
                              : `${formatNumber(t.found - t.expected)} more than expected`}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>

          <Card title="Scope: what was and was not checked">
            <blockquote className="border-l-4 border-line pl-4" data-testid="verification-scope">
              {verification.scope}
            </blockquote>
            {verification.notes.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {verification.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </Card>

          {rows.length === 0 ? (
            <Callout tone="ok" title="No item failed verification." testId="no-failures">
              <p className="text-sm">
                Every planned item is verified within the scope above. That is not a claim that
                nothing was lost: see Unsupported content.
              </p>
            </Callout>
          ) : (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">
                Items that are not verified ({pluralize(rows.length, 'item')})
              </h3>
              <TableWrap label="Items that did not verify, with their failing checks">
                <table className="data-table">
                  <caption className="sr-only">
                    Items that did not verify, with the field checks that failed
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Status</th>
                      <th scope="col">Failing check</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).flatMap(({ item, label, failing }) => {
                      const url =
                        state.mode === 'live'
                          ? sanitizeUrl(destinationUrls.get(item.actionId))
                          : null;
                      const checks = failing.length > 0 ? failing : [null];
                      return checks.map((check, index) => (
                        <tr
                          key={`${item.actionId}-${check?.field ?? 'none'}-${index}`}
                          data-testid="unverified-row"
                        >
                          {index === 0 ? (
                            <th scope="row" rowSpan={checks.length} className="min-w-56">
                              {label}
                              <span className="block text-xs font-normal text-muted">
                                <code>{item.actionId}</code>
                                {item.destinationId ? (
                                  <>
                                    {' '}
                                    →{' '}
                                    {url ? (
                                      <a href={url} {...EXTERNAL_LINK_PROPS}>
                                        destination {item.destinationId}
                                      </a>
                                    ) : (
                                      <>
                                        destination <code>{item.destinationId}</code>
                                      </>
                                    )}
                                  </>
                                ) : null}
                              </span>
                            </th>
                          ) : null}
                          {index === 0 ? (
                            <td rowSpan={checks.length}>
                              <StatusChip status={item.status} />
                            </td>
                          ) : null}
                          {check ? (
                            <>
                              <td>
                                <code>{check.field}</code>{' '}
                                <span
                                  className={`inline-flex items-center gap-1 text-xs ${TONE_TEXT[ITEM_STATUS[check.status]?.tone ?? 'neutral']}`}
                                >
                                  <Icon name={ITEM_STATUS[check.status]?.icon ?? 'info'} />
                                  {ITEM_STATUS[check.status]?.label ?? check.status}
                                </span>
                                {check.note ? (
                                  <span className="block text-xs text-muted">{check.note}</span>
                                ) : null}
                              </td>
                              <td className="min-w-40 break-words">
                                {check.expected ?? <span className="text-muted">–</span>}
                              </td>
                              <td className="min-w-40 break-words">
                                {check.actual ?? <span className="text-muted">–</span>}
                              </td>
                            </>
                          ) : (
                            <td colSpan={3} className="text-muted">
                              No field-level detail was recorded for this item.
                            </td>
                          )}
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </TableWrap>
              {rows.length > shown ? (
                <Button
                  onClick={() => {
                    setShown((n) => n + PAGE);
                  }}
                >
                  Show {formatNumber(Math.min(PAGE, rows.length - shown))} more (
                  {formatNumber(rows.length - shown)} not shown)
                </Button>
              ) : null}
            </div>
          )}
        </>
      )}

      <Downloads state={state} plan={plan} />
    </SectionShell>
  );
}
