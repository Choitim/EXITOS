import type { MigrationPlan } from '@exitos/core/schema';
import { OutcomeBar, OutcomeTable } from '../components/OutcomeBar';
import { Callout, Card, Chip, SectionShell } from '../components/ui';
import { formatNumber } from '../lib/format';

export function Compatibility({ plan }: { plan: MigrationPlan }) {
  const { items, fields, notPreserved } = plan.summary;
  return (
    <SectionShell
      id="compatibility"
      number={3}
      title="Compatibility summary"
      intro="What moves as-is, what changes shape, what loses detail and what cannot move. Every number comes from the plan."
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Items (planned tasks, docs and links)">
          <p className="mb-3 text-sm text-muted">
            Each item gets the worst outcome of its parts, except that an item with an unsupported
            part is still created and therefore counts as <em>loses detail</em>.
          </p>
          <OutcomeBar tally={items} label="Items by outcome" />
          <div className="mt-4">
            <OutcomeTable
              tally={items}
              caption="Items by outcome"
              unit="Items"
              testIdPrefix="items"
            />
          </div>
        </Card>

        <Card title="Mapped fields (source properties)">
          <p className="mb-3 text-sm text-muted">
            How each source property is mapped, counted once per collection. See the mapping preview
            for the property-by-property detail.
          </p>
          <OutcomeBar tally={fields} label="Mapped fields by outcome" />
          <div className="mt-4">
            <OutcomeTable
              tally={fields}
              caption="Mapped fields by outcome"
              unit="Fields"
              testIdPrefix="fields"
            />
          </div>
        </Card>
      </div>

      <Card title="Content that does not fully move">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-2 text-sm text-muted">
              <Chip tone="bad" icon="cross">
                Cannot move
              </Chip>
              unsupported findings
            </dt>
            <dd
              className="text-2xl font-semibold tabular-nums"
              data-testid="notpreserved-unsupported"
            >
              {formatNumber(notPreserved.unsupported)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-sm text-muted">
              <Chip tone="warn" icon="warning">
                Loses detail
              </Chip>
              lossy findings
            </dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="notpreserved-lossy">
              {formatNumber(notPreserved.lossy)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">
          These are individual findings (a property, a block, a file), not items. Each is listed in
          Unsupported content below; none is silently dropped.
        </p>
        {plan.summary.blockingErrors > 0 ? (
          <div className="mt-3">
            <Callout
              tone="bad"
              title={`${formatNumber(plan.summary.blockingErrors)} blocking error(s) in this plan`}
              role="alert"
            />
          </div>
        ) : null}
      </Card>
    </SectionShell>
  );
}
