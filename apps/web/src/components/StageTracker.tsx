import type { DashboardState, MigrationPlan } from '@exitos/core/schema';
import { useMemo } from 'react';
import { deriveStages, type Stage } from '../lib/stages';
import type { IconName } from '../lib/outcomes';
import { Icon } from './ui';

const STATUS_WORDS: Record<Stage['status'], string> = {
  done: 'done',
  current: 'current stage',
  upcoming: 'not started yet',
};

/** Marker class and icon for one stage: a check when done, the state's own icon when current. */
function marker(stage: Stage): { className: string; icon: IconName | null } {
  if (stage.status === 'done') return { className: 'stage-marker-done', icon: 'check' };
  if (stage.status === 'upcoming') return { className: 'stage-marker-upcoming', icon: null };
  switch (stage.result) {
    case 'verified':
      return { className: 'stage-marker-verified', icon: 'verified' };
    case 'failed':
      return { className: 'stage-marker-failed', icon: 'failed' };
    case 'attention':
      return { className: 'stage-marker-attention', icon: 'warning' };
    case 'active':
      return { className: 'stage-marker-active', icon: 'transform' };
    case 'waiting':
      return { className: 'stage-marker-waiting', icon: 'clock' };
    default:
      return { className: 'stage-marker-current', icon: null };
  }
}

/**
 * Inspect, Plan, Approve, Apply, Verify. An ordered list; the current stage carries
 * `aria-current="step"`, finished stages a check. Read-only: it only reports where the state is.
 */
export function StageTracker({
  state,
  plan,
}: {
  state: Pick<DashboardState, 'run' | 'verification'>;
  plan: MigrationPlan;
}) {
  const tracker = useMemo(
    () => deriveStages({ plan, run: state.run, verification: state.verification }),
    [plan, state.run, state.verification],
  );
  return (
    <div data-testid="stage-tracker" data-phase={tracker.phase}>
      <p className="mb-3 font-medium" data-testid="stage-summary">
        {tracker.summary}
      </p>
      <ol className="stages" aria-label="Migration stages">
        {tracker.stages.map((stage, index) => {
          const m = marker(stage);
          return (
            <li
              key={stage.id}
              className={`stage stage-${stage.status}`}
              aria-current={stage.status === 'current' ? 'step' : undefined}
              data-stage={stage.id}
              data-status={stage.status}
              data-result={stage.result ?? undefined}
            >
              <span className={`stage-marker ${m.className}`} aria-hidden="true">
                {m.icon ? <Icon name={m.icon} className="size-4" /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-semibold">
                  {stage.label}
                  <span className="sr-only"> ({STATUS_WORDS[stage.status]})</span>
                </p>
                <p
                  className={
                    stage.status === 'upcoming' ? 'text-sm text-muted' : 'text-sm font-medium'
                  }
                >
                  {stage.headline}
                </p>
                {stage.detail !== '' ? (
                  <p className="mt-0.5 text-xs text-muted">{stage.detail}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
