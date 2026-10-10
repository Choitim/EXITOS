import type { DashboardState, MigrationPlan, PlanTarget } from '@exitos/core/schema';
import {
  Callout,
  Card,
  Chip,
  Empty,
  Facts,
  JsonBlock,
  SectionShell,
  TableWrap,
} from '../components/ui';
import { formatNumber, pluralize } from '../lib/format';

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

function TargetLine({ target }: { target: PlanTarget }) {
  return (
    <>
      <span className="font-medium">{target.name}</span>{' '}
      <span className="text-muted">
        ({target.kind} <code>{target.id}</code>)
      </span>
      {target.path ? <span className="block text-sm text-muted">{target.path}</span> : null}
    </>
  );
}

export function SourceDestination({ plan }: { state: DashboardState; plan: MigrationPlan }) {
  const { source, destination, users, options, collections } = plan;
  const totalRows = collections.reduce((sum, c) => sum + c.recordCount, 0);
  const optionRows = Object.entries(options);

  return (
    <SectionShell
      id="source-destination"
      number={2}
      title="Source and destination"
      intro="What is read, where it would be written, and how people are matched. The source is only ever read."
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Source (read-only)">
          <Facts
            rows={[
              [
                'Connector',
                <code key="c">
                  {source.connector.id}@{source.connector.version}
                </code>,
              ],
              ['Workspace', source.workspace.name],
              ['System', source.workspace.system],
              [
                'Workspace id',
                <code key="i" className="break-all">
                  {source.workspace.id}
                </code>,
              ],
            ]}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">
              What was selected (from the config)
            </summary>
            <div className="mt-2">
              <JsonBlock value={source.selection} label="Source selection (JSON)" />
            </div>
          </details>
        </Card>

        <Card title="Destination (the only place that is written)">
          <Facts
            rows={[
              [
                'Connector',
                <code key="c">
                  {destination.connector.id}@{destination.connector.version}
                </code>,
              ],
              ['Workspace', destination.workspace.name],
              ['System', destination.workspace.system],
              [
                'Workspace id',
                <code key="i" className="break-all">
                  {destination.workspace.id}
                </code>,
              ],
              [
                'Targets',
                destination.targets.length === 0 ? (
                  'None'
                ) : (
                  <ul key="t" className="space-y-2">
                    {destination.targets.map((target) => (
                      <li key={`${target.kind}:${target.id}`}>
                        <TargetLine target={target} />
                      </li>
                    ))}
                  </ul>
                ),
              ],
            ]}
          />
        </Card>
      </div>

      {collections.length === 0 ? (
        <Empty title="The plan has no collections" testId="collections-empty">
          Nothing in the source was selected for migration, so there are no rows to move.
        </Empty>
      ) : (
        <TableWrap label="Collections and their destination targets">
          <table className="data-table">
            <caption>Collections to migrate</caption>
            <thead>
              <tr>
                <th scope="col">Source collection</th>
                <th scope="col">Destination target</th>
                <th scope="col" className="num">
                  Rows
                </th>
              </tr>
            </thead>
            <tbody>
              {collections.map((collection) => (
                <tr key={collection.key}>
                  <th scope="row">
                    {collection.name}
                    {collection.incomplete ? (
                      <span className="mt-1 block">
                        <Chip
                          tone="warn"
                          icon="warning"
                          title="The source could not be read completely (for example a documented API cap)."
                        >
                          may be incomplete
                        </Chip>
                      </span>
                    ) : null}
                  </th>
                  <td>
                    {collection.target ? (
                      <TargetLine target={collection.target} />
                    ) : (
                      <span className="text-muted">No target (not written)</span>
                    )}
                  </td>
                  <td className="num" data-testid={`rows-${collection.name}`}>
                    {formatNumber(collection.recordCount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total rows
                </th>
                <td className="num">{formatNumber(totalRows)}</td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      )}

      <Card title="People mapping">
        <dl className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">Mapped</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="users-mapped">
              {formatNumber(users.mapped.length)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Not mapped</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="users-unmapped">
              {formatNumber(users.unmapped.length)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Assignments that notify a person</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="users-notify">
              {formatNumber(users.assignmentsThatNotify)}
            </dd>
          </div>
        </dl>
        {users.assignmentsThatNotify > 0 ? (
          <Callout
            tone="warn"
            title={`${pluralize(users.assignmentsThatNotify, 'assignment')} will notify people in the destination.`}
          >
            <p className="text-sm">
              The destination notifies assignees of tasks created through its API. Check the mapping
              below before approving.
            </p>
          </Callout>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
          <TableWrap label="Mapped people">
            <table className="data-table">
              <caption>Mapped ({users.mapped.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Destination user id</th>
                  <th scope="col">Matched by</th>
                </tr>
              </thead>
              <tbody>
                {users.mapped.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-muted">
                      Nobody is mapped.
                    </td>
                  </tr>
                ) : (
                  users.mapped.map((user) => (
                    <tr key={user.source}>
                      <th scope="row">{user.name ?? user.source}</th>
                      <td>
                        <code>{user.destinationId}</code>
                      </td>
                      <td>{user.via === 'explicit' ? 'explicit mapping' : 'e-mail address'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
          <TableWrap label="People who are not mapped">
            <table className="data-table">
              <caption>
                Not mapped ({users.unmapped.length}): never assigned in the destination
              </caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                </tr>
              </thead>
              <tbody>
                {users.unmapped.length === 0 ? (
                  <tr>
                    <td className="text-muted">Everybody found is mapped.</td>
                  </tr>
                ) : (
                  users.unmapped.map((user) => (
                    <tr key={user.source}>
                      <th scope="row">{user.name ?? user.source}</th>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </div>
      </Card>

      <Card title="Options in effect">
        {optionRows.length === 0 ? (
          <p className="text-muted">No options were recorded.</p>
        ) : (
          <Facts
            rows={optionRows.map(([key, value]) => [
              key,
              <code key={key}>{formatValue(value)}</code>,
            ])}
          />
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Destination settings stored with the plan (no credentials)
          </summary>
          <div className="mt-2">
            <JsonBlock value={destination.config} label="Destination settings (JSON)" />
          </div>
        </details>
      </Card>
    </SectionShell>
  );
}
