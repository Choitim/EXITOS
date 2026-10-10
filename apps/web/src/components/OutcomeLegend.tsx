import { STATE_META, STATE_ORDER } from '../lib/outcomes';
import { StateChip } from './ui';

function RunLevelNote() {
  return <span className="ml-2 text-xs text-muted">(about the run)</span>;
}

/**
 * Explains the six states in one place: four describe content (from the plan), two describe the
 * run (from the run and the verification). `compact` lists just the names with their plain-language
 * sub-labels; `full` adds one sentence each.
 */
export function OutcomeLegend({
  variant = 'full',
  testId = 'outcome-legend',
  label = 'How to read the outcomes',
}: {
  variant?: 'full' | 'compact';
  testId?: string;
  label?: string;
}) {
  return (
    <div data-testid={testId}>
      <p className="mb-2 text-sm font-medium">{label}</p>
      {variant === 'compact' ? (
        <ul className="legend-list-compact">
          {STATE_ORDER.map((state) => (
            <li key={state} className="legend-item" data-state={state}>
              <StateChip state={state} withPlain />
              {STATE_META[state].level === 'run' ? <RunLevelNote /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <dl className="legend-list">
          {STATE_ORDER.map((state) => (
            <div key={state} className="legend-item" data-state={state}>
              <dt>
                <StateChip state={state} withPlain />
                {STATE_META[state].level === 'run' ? <RunLevelNote /> : null}
              </dt>
              <dd>{STATE_META[state].description}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
