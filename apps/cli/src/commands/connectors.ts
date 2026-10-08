import { ExitCode } from '@exitos/shared';
import { println, type CliContext } from '../context.js';
import { createRegistry } from '../runtime/runtime.js';
import { table } from '../ui/layout.js';

/** List the connectors compiled into this build and the environment variables they need. */
export function connectorsCommand(
  ctx: CliContext,
  options: { json?: boolean | undefined },
): number {
  const registry = createRegistry();
  const rows = [
    ...registry.sources().map((d) => ({ kind: 'source', def: d })),
    ...registry.destinations().map((d) => ({ kind: 'destination', def: d })),
  ].map(({ kind, def }) => ({
    kind,
    id: def.manifest.id,
    name: def.manifest.name,
    version: def.manifest.version,
    api: def.manifest.vendorApiVersion ?? '',
    env: def.credentials.map((c) => c.env).join(', '),
    capabilities: def.manifest.capabilities,
  }));
  if (options.json === true) {
    println(ctx, JSON.stringify(rows, null, 2));
    return ExitCode.Ok;
  }
  println(
    ctx,
    table(
      [
        { header: 'Kind', value: (r: (typeof rows)[number]) => r.kind },
        { header: 'Id', value: (r) => r.id },
        { header: 'Name', value: (r) => `${r.name} ${r.version}` },
        { header: 'API', value: (r) => r.api },
        { header: 'Credentials (env)', value: (r) => r.env },
      ],
      rows,
      ctx.style,
      ctx.width,
    ),
  );
  println(ctx, ctx.style.gray('\nWrite your own: see docs/connector-sdk.md'));
  return ExitCode.Ok;
}
