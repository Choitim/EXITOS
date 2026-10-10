import type { OutcomeCounts, OutcomeFilter } from '../lib/derive';
import { chipOutcomes } from '../lib/derive';
import { formatNumber } from '../lib/format';
import { outcomeMeta, outcomeWithPlain } from '../lib/outcomes';
import { Icon, TONE_TEXT } from './ui';

/**
 * Outcome filter as a row of toggle buttons with counts. Exactly one is pressed; pressing the
 * pressed one again goes back to "All". A chip with no rows is disabled so it never leads nowhere,
 * unless it is the pressed one (so it can always be switched off).
 */
export function OutcomeFilterChips({
  counts,
  value,
  onChange,
  label = 'Filter by outcome',
  testIdPrefix = 'outcome-chip',
}: {
  counts: OutcomeCounts;
  value: OutcomeFilter;
  onChange: (value: OutcomeFilter) => void;
  label?: string;
  testIdPrefix?: string;
}) {
  const outcomes = chipOutcomes(counts, value);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      <button
        type="button"
        className="filter-chip"
        aria-pressed={value === 'all'}
        onClick={() => {
          onChange('all');
        }}
        data-testid={`${testIdPrefix}-all`}
        aria-label={`All outcomes: ${formatNumber(counts.all)}`}
      >
        <span>All</span>
        <span className="filter-chip-count">{formatNumber(counts.all)}</span>
      </button>
      {outcomes.map((outcome) => {
        const meta = outcomeMeta(outcome);
        const pressed = value === outcome;
        return (
          <button
            key={outcome}
            type="button"
            className="filter-chip"
            aria-pressed={pressed}
            disabled={counts[outcome] === 0 && !pressed}
            title={meta.plain}
            onClick={() => {
              onChange(pressed ? 'all' : outcome);
            }}
            data-testid={`${testIdPrefix}-${outcome}`}
            aria-label={`${outcomeWithPlain(outcome)}: ${formatNumber(counts[outcome])}`}
          >
            <Icon name={meta.icon} className={pressed ? '' : TONE_TEXT[meta.tone]} />
            <span>{meta.label}</span>
            <span className="filter-chip-count">{formatNumber(counts[outcome])}</span>
          </button>
        );
      })}
    </div>
  );
}
