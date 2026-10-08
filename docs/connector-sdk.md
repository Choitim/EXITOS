# Writing a connector

A connector teaches ExitOS to **read from** one product (a _source_) or **write to** one product (a
_destination_). Sources and destinations are separate interfaces: you implement only what applies, and
neither knows the other exists. They meet at the **normalized model** (`@exitos/core/sdk`).

The smallest complete example lives in [`examples/example-connector`](../examples/example-connector/src/index.ts)
(a JSON-file source and a Markdown-folder destination, ~300 lines, no HTTP). The real thing —
[`packages/connector-notion`](../packages/connector-notion) and
[`packages/connector-clickup`](../packages/connector-clickup) — shows the HTTP, rate-limit and
reconciliation patterns.

```ts
import type { SourceConnectorDefinition, DestinationConnectorDefinition } from '@exitos/core/sdk';
```

## The contracts

```ts
interface SourceConnector<TRaw> {
  manifest: ConnectorManifest;
  discover(): Promise<SourceDiscovery>; // what can this credential see?        (read-only)
  inspect(): Promise<SourceInspection>; // schema + support analysis, no bulk read (read-only)
  extract(opts?): Promise<TRaw>; // ALL source I/O                        (read-only)
  normalize(raw: TRaw): SourceSnapshot; // PURE: no I/O, deterministic
}

interface DestinationConnector {
  manifest: ConnectorManifest;
  discover(): Promise<DestinationDiscovery>;
  inspect(): Promise<DestinationInspection>; // facts planning needs (read-only)
  plan(input: PlanInput): PlanFragment; // PURE: snapshot + config → actions
  validate(plan): Promise<ValidationResult>; // read-only checks, adoption of existing items
  apply(action, ctx): Promise<ApplyResult>; // exactly ONE action; the only writer
  reconcile?(action, request): Promise<ReconcileResult>; // did an ambiguous write happen?
  verify(input): Promise<VerifyOutput>; // compare plan with reality (read-only)
}
```

Register a definition (manifest + network policy + credential specs + config schema + `create`) and
the engine does the rest:

```ts
registry.registerSource(myDefinition).registerDestination(otherDefinition);
```

## The rules (these are what the conformance kit checks)

1. **Do all I/O through `context.fetch`.** It is already wrapped by a guard that enforces a host
   allow-list and (for sources, always) read-only access _before the network is touched_. Never read
   `process.env`; credentials arrive in `context.credentials`.
2. **Declare your network policy.** `allowedHosts(baseUrl)` and `classify(request) → read | write |
unknown`. Classify by _endpoint_, not just HTTP method (Notion's `search` and `query` are POST
   reads). Anything you do not classify is refused — fail closed.
3. **`normalize` and `plan` are pure and deterministic.** Same input → byte-identical output, stable
   ids (`stableId(...)`). This is what makes plans hashable and approvable.
4. **A source never writes. A destination writes only in `apply`,** one action per call, and **never
   overwrites or deletes** existing content in v0.x.
5. **Every action carries an `idempotencyKey`** (stable per source item) and a `scope` (where the
   mapping is valid). The engine stores `(scope, idempotencyKey) → destinationId` in the same
   transaction as the checkpoint.
6. **Throw `AmbiguousWriteError` whenever you do not know whether a write happened** (timeout, 5xx,
   dropped connection, unreadable 2xx). Implement `reconcile` to find out. Prefer writing a
   provenance marker you can search for.
7. **Never drop anything silently.** If something cannot be preserved, emit a `Finding`
   (`supported | transformed | lossy | unsupported | skipped`) with a stable `code` and add it to
   [finding-codes.md](finding-codes.md). Findings about _reading_ belong to the source; findings about
   _writing_ belong to the destination.
8. **Validate every external input with Zod** — API responses, config, plan payloads. Plan payloads are
   untrusted (users can edit plan files): use strict schemas and check ids with
   `assertSafePathSegment` before putting them in a path.
9. **No secrets in output.** Errors and logs are redacted automatically, but do not put credentials,
   signed URLs or tokens into snapshots, findings or payloads.
10. **Keep `apply` constructible from the plan alone.** Return a credential-free `destinationConfig`
    from `plan()`; `apply`, `resume` and `verify` rebuild your connector from it.

## Normalized model cheat sheet

| Type                                          | Use it for                                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SourceSnapshot`                              | everything `normalize` returns                                                                                                                                                                                 |
| `Collection` + `FieldDefinition`              | a table/database and its columns (`kind`: title, text, number, select, multiSelect, status, date, checkbox, url, email, phone, person, relation, files, computed, timestamp, userStamp, uniqueId, unsupported) |
| `DataRecord` + `FieldValue`                   | a row                                                                                                                                                                                                          |
| `Document` + `DocumentBlock` + `RichTextSpan` | page content as a tree                                                                                                                                                                                         |
| `Relationship`                                | links between records                                                                                                                                                                                          |
| `AttachmentReference`                         | a file reference (**never** a signed URL)                                                                                                                                                                      |
| `UserReference`                               | a person in the source system                                                                                                                                                                                  |
| `MigrationAction`                             | one idempotent write, with a destination-shaped `payload`                                                                                                                                                      |
| `MappingRule`                                 | how a source field maps to a destination target, with its outcome                                                                                                                                              |

Keep `FieldDefinition.sourceType` set to the original type name even when you map to `unsupported`, so
reports can say what was there.

## Testing your connector

```ts
import {
  checkSourceConnector,
  checkDestinationPlan,
  createMemoryDestination,
} from '@exitos/core/testing';

const report = await checkSourceConnector(source, { secrets: [token], recorder });
expect(report.checks.filter((c) => !c.ok)).toEqual([]); // referential integrity, determinism, no leaks, zero writes

const planReport = checkDestinationPlan(destination, {
  snapshot,
  inspection,
  config,
  mode: 'live',
  existing: new Map(),
});
```

Then run your connector through the real engine like [`example.test.ts`](../examples/example-connector/test/example.test.ts)
does: `buildPlan → approveAndCreateRun → executePlan → verifyRun`. Test the unhappy paths that matter:
a rejected item, a lost reply after commit, a crash before the checkpoint, and resume. The Notion and
ClickUp packages each ship an in-process **fake API** (`/testing`) you can copy as a pattern: a `fetch`
function that serves API-shaped JSON, enforces auth and pagination, and can inject faults.

## Checklist before opening a PR

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] conformance kit passes; zero writes during plan/inspect/verify (request-recorder test)
- [ ] unsupported/lossy cases produce findings, documented in `docs/finding-codes.md`
- [ ] no `any`, no `process.env` reads, no secrets in fixtures
- [ ] fixtures are synthetic (no real workspace content)
- [ ] docs: what it can and cannot migrate, required credentials/permissions
- [ ] an ADR if you made a decision that is costly to reverse
