import type { Outcome } from '@exitos/core/schema';
import { formatNumber, formatPercent } from '../lib/format';
import { OUTCOME_META, OUTCOME_ORDER } from '../lib/outcomes';
import { Icon, OutcomeChip, TableWrap } from './ui';

export type OutcomeTally = Record<Outcome, number>;

const BAR_CLASS = {
  ok: 'bar-ok',
  info: 'bar-info',
  warn: 'bar-warn',
  bad: 'bar-bad',
  neutral: 'bar-neutral',
} as const;

/** Stacked proportional bar. Decorative: the table next to it carries every number as text. */
export function OutcomeBar({ tally, label }: { tally: OutcomeTally; label: string }) {
  const total = OUTCOME_ORDER.reduce((sum, outcome) => sum + tally[outcome], 0);
  const present = OUTCOME_ORDER.filter((outcome) => tally[outcome] > 0);
  const description = `${label}: ${
    present.length === 0
      ? 'no data'
      : present
          .map((o) => `${formatNumber(tally[o])} ${OUTCOME_META[o].label.toLowerCase()}`)
          .join(', ')
  }`;
  return (
    <div role="img" aria-label={description} className="bar" data-testid="outcome-bar">
      {present.map((outcome) => {
        const meta = OUTCOME_META[outcome];
        const share = tally[outcome] / total;
        return (
          <div
            key={outcome}
            className={`bar-seg ${BAR_CLASS[meta.tone]}`}
            style={{ flexGrow: tally[outcome], flexBasis: 0 }}
            title={`${meta.label}: ${formatNumber(tally[outcome])} (${formatPercent(tally[outcome], total)})`}
          >
            {share >= 0.07 ? <Icon name={meta.icon} className="size-4 drop-shadow" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** The same numbers as text: outcome (icon + word), meaning, count, share. */
export function OutcomeTable({
  tally,
  caption,
  unit,
  testIdPrefix,
}: {
  tally: OutcomeTally;
  caption: string;
  unit: string;
  testIdPrefix: string;
}) {
  const total = OUTCOME_ORDER.reduce((sum, outcome) => sum + tally[outcome], 0);
  // The four headline buckets are always listed; skipped/failed only when they occur.
  const rows = OUTCOME_ORDER.filter(
    (o) =>
      o === 'supported' ||
      o === 'transformed' ||
      o === 'lossy' ||
      o === 'unsupported' ||
      tally[o] > 0,
  );
  return (
    <TableWrap label={caption}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col" className="hidden sm:table-cell">
              What it means
            </th>
            <th scope="col" className="num">
              {unit}
            </th>
            <th scope="col" className="num">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((outcome) => (
            <tr key={outcome}>
              <th scope="row">
                <OutcomeChip outcome={outcome} />
                <span className="mt-1 block text-xs font-normal text-muted sm:hidden">
                  {OUTCOME_META[outcome].plain}
                </span>
              </th>
              <td className="hidden sm:table-cell">{OUTCOME_META[outcome].plain}</td>
              <td className="num" data-testid={`${testIdPrefix}-${outcome}`}>
                {formatNumber(tally[outcome])}
              </td>
              <td className="num">{formatPercent(tally[outcome], total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="hidden sm:table-cell" />
            <td className="num" data-testid={`${testIdPrefix}-total`}>
              {formatNumber(total)}
            </td>
            <td className="num">{total > 0 ? '100%' : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  );
}
