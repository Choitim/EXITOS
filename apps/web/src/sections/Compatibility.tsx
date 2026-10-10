import type { MigrationPlan } from '@exitos/core/schema';
import { OutcomeBar, OutcomeTable, tallyTotal } from '../components/OutcomeBar';
import { OutcomeLegend } from '../components/OutcomeLegend';
import { Callout, Card, Empty, OutcomeChip, SectionShell } from '../components/ui';
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
      <Card title="How to read the outcomes">
        <OutcomeLegend variant="full" label="Four words describe content; two describe the run." />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Items (planned tasks, docs and links)">
          <p className="mb-3 text-sm text-muted">
            Each item gets the worst outcome of its parts, except that an item with an unsupported
            part is still created and therefore counts as <em>requires review</em> (loses detail).
          </p>
          {tallyTotal(items) === 0 ? (
            <Empty title="No items in this plan" testId="items-empty">
              The plan contains no tasks, docs or links, so there is nothing to classify.
            </Empty>
          ) : (
            <>
              <OutcomeBar tally={items} label="Items by outcome" />
              <div className="mt-4">
                <OutcomeTable
                  tally={items}
                  caption="Items by outcome"
                  unit="Items"
                  testIdPrefix="items"
                />
              </div>
            </>
          )}
        </Card>

        <Card title="Mapped fields (source properties)">
          <p className="mb-3 text-sm text-muted">
            How each source property is mapped, counted once per collection. See the mapping preview
            for the property-by-property detail.
          </p>
          {tallyTotal(fields) === 0 ? (
            <Empty title="No mapped fields" testId="fields-empty">
              The plan maps no source properties. Items are still created, but none of their
              properties has a destination.
            </Empty>
          ) : (
            <>
              <OutcomeBar tally={fields} label="Mapped fields by outcome" />
              <div className="mt-4">
                <OutcomeTable
                  tally={fields}
                  caption="Mapped fields by outcome"
                  unit="Fields"
                  testIdPrefix="fields"
                />
              </div>
            </>
          )}
        </Card>
      </div>

      <Card title="Content that does not fully move">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <OutcomeChip outcome="unsupported" withPlain />
              findings
            </dt>
            <dd
              className="text-2xl font-semibold tabular-nums"
              data-testid="notpreserved-unsupported"
            >
              {formatNumber(notPreserved.unsupported)}
            </dd>
          </div>
          <div>
            <dt className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <OutcomeChip outcome="lossy" withPlain />
              findings
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
