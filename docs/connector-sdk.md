# Writing a connector

A connector teaches ExitOS to **read from** one product (a _source_) or **write to** one product (a
_destination_). Sources and destinations are separate interfaces: you implement only what applies, and
neither knows the other exists. They meet at the **normalized model** (`@exitos/core/sdk`).

The smallest complete example is [`examples/example-connector`](../examples/example-connector/src/index.ts):
a JSON-file source and a Markdown-folder destination, about 370 lines, no HTTP. The real thing,
[`packages/connector-notion`](../packages/connector-notion) and
[`packages/connector-clickup`](../packages/connector-clickup), shows the HTTP, rate-limit and
reconciliation patterns. This page first lists the contract and then walks through the example; every
snippet comes from files that exist and are tested.

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

The authoritative definitions, with every field, are in
[`packages/core/src/sdk/types.ts`](../packages/core/src/sdk/types.ts). A connector instance gets its
context (guarded `fetch`, logger, clock, credentials, base URL, mode) when it is created, not on each call.

## Walkthrough: the example connector

Open [`examples/example-connector/src/index.ts`](../examples/example-connector/src/index.ts) next to this
section. The test that exercises it is
[`example.test.ts`](../examples/example-connector/test/example.test.ts).

### 1. A definition describes a connector

Each side is exported as one object. This is the whole source definition:

```ts
export const jsonFileSource: SourceConnectorDefinition<SourceConfig, RawFile> = {
  manifest: jsonFileManifest, // id 'json-file', name, version, kind 'source', capabilities
  network: NO_NETWORK, // which hosts the credential may reach, and which requests are reads
  credentials: [], // environment variables the connector needs (none here)
  configSchema: SourceConfigSchema, // Zod schema of the `source:` block in the migration config
  create: (_context, config) => new JsonFileSource(config),
};
```

- `manifest.id` is what users write as `type:` in their migration config and what `exitos plan <source>
<destination>` takes. It must be kebab-case (the conformance kit checks `/^[a-z][a-z0-9-]*$/`).
- `configSchema` validates the connector's block of the config. Use `z.strictObject` with a `type` literal
  equal to the manifest id, so a typo is an error instead of being ignored.
- `network` is mandatory. This example touches no network, so it allows no host and classifies every
  request as `unknown` (refused). A network connector returns `allowedHosts(baseUrl)` and a `classify`
  function; see `packages/connector-clickup/src/network.ts`, which allow-lists exactly four POST endpoints
  and treats everything else that is not a `GET` as `unknown`.
- `create(context, config, migration)` receives the `ConnectorContext` (guarded `fetch`, `logger`,
  `clock`, `credentials`, `baseUrl`, `mode`, `recorder`, `concurrency`). The example ignores it because it
  reads and writes local files; a network connector keeps it and does all its requests through
  `context.fetch`.

### 2. A source: `extract` reads, `normalize` is pure

- **`extract()`** is the only place that reads the outside world. The example reads the file and parses it
  with a Zod schema (`FileSchema`), so an item with a malformed `id` makes `extract` throw instead of being
  guessed at. A network source would page through the API here.
- **`normalize(raw)`** turns the raw data into a `SourceSnapshot`: a workspace, `collections` with their
  `fields`, `records` (each with a stable `key` built by `entityKey('json-file', 'item', item.id)` and
  `values` keyed by field id), `documents`, `relationships`, `attachments`, `users` and `findings`. It
  does no I/O and returns identical output for identical input, so the same source always produces the
  same plan.
- **Nothing is dropped silently.** An item with an `attachmentUrl`, which this example cannot migrate, adds
  a finding (excerpt of `normalize`):

  ```ts
  findings.push({
    code: 'ATTACHMENT_NOT_SUPPORTED',
    outcome: 'unsupported',
    severity: 'warning',
    category: 'attachment',
    message: 'This example connector cannot migrate attachments; the URL is not carried over.',
    entity: key,
    field: 'attachmentUrl',
  });
  ```

  The planner attaches it to the action that migrates that entity. (`ATTACHMENT_NOT_SUPPORTED` is
  illustrative and is not in [finding-codes.md](finding-codes.md); the codes of a real connector must be.)

- `discover()` and `inspect()` are read-only look-ahead calls (they back `exitos inspect` for Notion and
  ClickUp). The example's `inspect()` just extracts and normalizes.

### 3. A destination: `plan` declares actions

`plan(input)` is pure. It receives the snapshot, the destination inspection, the config, the mode and
`existing` (what earlier runs already created) and returns a `PlanFragment`. Its core is one
`MigrationAction` per record:

```ts
return {
  id: stableId('act', 'example.write_markdown', record.key),
  kind: 'example.write_markdown',
  label: `Write ${file}`,
  source: record.key,
  idempotencyKey: record.key,
  scope,
  dependsOn: [],
  disposition: input.existing.has(`${scope}|${record.key}`) ? 'skip' : 'execute',
  outcome: 'supported',
  findings: [],
  estimatedRequests: 1,
  payload: { file, content },
};
```

| Field               | Meaning                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Stable and unique: `stableId(prefix, ...parts)` from `@exitos/shared`. Plans are hashed, so ids must not depend on time or order.                   |
| `kind`              | Connector-qualified, matching `^[a-z0-9-]+\.[a-z0-9_]+$` (`clickup.create_task`).                                                                   |
| `label`             | Shown to people in the plan, progress and errors.                                                                                                   |
| `source`            | The `EntityKey` this action migrates (or `null`).                                                                                                   |
| `idempotencyKey`    | Stable per source item. Used for the provenance marker and the id map; this is what prevents duplicates after a retry or a re-plan.                 |
| `scope`             | Where the mapping is valid (a folder, a list). The engine stores `(scope, idempotencyKey)` to the destination id.                                   |
| `dependsOn`         | Action ids that must succeed first. At apply time `context.resolveDependency(id)` returns their destination ids (ClickUp's `link_tasks` does this). |
| `disposition`       | `execute`, or `skip` for items that already exist (found in `existing`, or adopted by `validate`).                                                  |
| `outcome`           | `supported`, `transformed`, `lossy`, `unsupported`, `skipped`: how faithfully this item arrives. Anything `lossy` or `unsupported` needs a finding. |
| `findings`          | What is lost or changed, with stable codes.                                                                                                         |
| `estimatedRequests` | Feeds the plan's time estimate.                                                                                                                     |
| `payload`           | Destination-shaped data. It ends up in a plan file that users can edit, so `apply` must re-validate it.                                             |

The fragment also carries `collections`, `mappings`, `users`, `findings`, `targets`, `knownLimits`,
`options`, `requestsPerMinute`, and a **credential-free `destinationConfig`** from which `apply`, `resume`
and `verify` rebuild the connector.

### 4. `apply`, `reconcile` and `verify`

- **`apply(action, context)` executes exactly one action** and returns `{ destinationId, destinationUrl? }`.
  The example parses the payload with a strict Zod schema (`PayloadSchema`), resolves the path inside its
  folder only, and writes with the `'wx'` flag so it can never overwrite. If the file already exists with
  the same content it reports success (so a retry is harmless); with different content it throws and the
  item fails.
- **How failures are handled** (`packages/core/src/engine/executor.ts`): an error from `apply` fails that
  item and blocks the actions that depend on it; an API `401`/`403` or an exhausted `429` stops the run;
  five consecutive failures stop it. **If you cannot tell whether a write happened** (timeout, 5xx,
  dropped connection, an unreadable 2xx) **throw `AmbiguousWriteError`** (from `@exitos/shared`). The
  executor then calls `reconcile` instead of re-sending.
- **`reconcile(action, request)`** answers "did it happen?" with one of:

  | Result                                      | What the engine does                                                                                |
  | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
  | `{ status: 'found', destinationId }`        | records the item as created; nothing is sent again                                                  |
  | `{ status: 'not_found', confident: true }`  | sends the action again (at most three attempts)                                                     |
  | `{ status: 'not_found', confident: false }` | stops the run: the listing may be incomplete                                                        |
  | `{ status: 'undecidable', reason }`         | stops the run and tells the operator to check, then `exitos resume --assume-not-created <actionId>` |

  Without a `reconcile` method every ambiguous write stops the run. A network destination reconciles by
  searching for the provenance marker it wrote into the item; the example looks for the file and compares
  its content. Never guess: a wrong "not found" creates a duplicate.

- **`verify({ plan, mappings })`** is read-only. For each succeeded action it compares reality with the
  plan and returns one `ItemVerification` per item (`verified`, `mismatched`, `missing` or `unverified`,
  with per-field `checks`), the counts per target, a plain-language `scope` sentence saying what was
  checked, `notes` and `readRequests`. A run only becomes `verified` after `verifyRun` passes; applying
  alone ends at `applied`.

### 5. Run it through the real engine

[`example.test.ts`](../examples/example-connector/test/example.test.ts) builds both sides from their
definitions and runs the complete cycle, with no network and no mocks of the engine:

```ts
const config = MigrationConfigSchema.parse({
  version: 1,
  source: { type: 'json-file', path: input },
  destination: { type: 'markdown-folder', directory: out },
});
const transport = async (): Promise<Response> => {
  throw new Error('the example connectors must never use the network');
};
const clock = new VirtualClock();
const host = { transport, mode: 'live' as const, env: {}, clock };
const source = jsonFileSource.create(
  createConnectorContext(jsonFileSource, 'read-only', host),
  jsonFileSource.configSchema.parse(config.source),
  config,
);
const destination = markdownFolderDestination.create(
  createConnectorContext(markdownFolderDestination, 'read-write', host),
  markdownFolderDestination.configSchema.parse(config.destination),
  config,
);
const store = SqliteStateStore.open(':memory:');

const { plan } = await buildPlan({
  source,
  destination,
  config,
  mode: 'live',
  store,
  now: () => new Date(),
});
const run = approveAndCreateRun({ plan, store, approvedPlanId: plan.planId, now: new Date() });
await executePlan({ plan, destination, store, runId: run.runId, concurrency: 2, clock });
const verification = await verifyRun({ plan, destination, store, runId: run.runId, clock });
// verification.status === 'passed' and store.getRun(run.runId)?.status === 'verified'
```

`createConnectorContext(definition, 'read-only' | 'read-write', host)` is what applies the write guard:
sources are always created read-only. (The test's `transport` throws, which proves the example never uses
the network.) The same test file covers the unhappy paths worth copying: planning writes nothing, an
existing file with different content is never overwritten, resuming a finished plan writes nothing new, a
plan cannot make the connector write outside its folder, and a malformed source item is rejected.

### 6. Run the conformance kit

```ts
import { checkSourceConnector, checkDestinationPlan } from '@exitos/core/testing';

const sourceReport = await checkSourceConnector(source, { secrets: [token], recorder });
expect(sourceReport.checks.filter((c) => !c.ok)).toEqual([]);

const planReport = checkDestinationPlan(destination, {
  snapshot: source.normalize(await source.extract()),
  inspection: await destination.inspect(),
  config,
  mode: 'live',
  existing: new Map(),
});
expect(planReport.checks.filter((c) => !c.ok)).toEqual([]);
```

Each returns `{ passed, checks: [{ name, ok, detail? }] }`. The source checks cover the manifest, extract and
normalize, a valid and referentially sound snapshot (unique record keys, known collections, declared
fields, relationships from known records), deterministic `normalize`, no credential in the data
(`secrets`) and zero writes (`recorder`). The destination checks cover the manifest, `plan()` succeeding
and being deterministic, valid actions and mappings, a sound action graph (unique ids, known
dependencies, no cycles), unique idempotency keys per scope, and a finding for every `lossy` or
`unsupported` action. Run the example's tests with:

```bash
pnpm exec vitest run examples/example-connector/test/example.test.ts
```

`createMemoryDestination` (also in `@exitos/core/testing`) is an in-memory destination with fault
injection, for testing a source or the engine without a real destination. See [testing.md](testing.md).

### 7. Register it

`ConnectorRegistry` maps ids to definitions:

```ts
registry.registerSource(myDefinition).registerDestination(otherDefinition);
```

The CLI is the composition root: `createRegistry()` in
[`apps/cli/src/runtime/runtime.ts`](../apps/cli/src/runtime/runtime.ts) registers the connectors that
ship (today `notionSource` and `clickupDestination`). **The example connectors are deliberately not
registered**; the test registers them in its own `ConnectorRegistry`. To use a connector from the
command line, add it to `createRegistry()` (and wire the package in; see step 3 of
[Add a new platform in 10 steps](#add-a-new-platform-in-10-steps)). This was checked
in a scratch copy of the repository with the example added: `exitos connectors` listed it, and
`exitos plan json-file markdown-folder --config migration.yaml`, `apply --plan ... --approve <planId>`,
`verify`, `status` and `report` all worked (and `exitos doctor --config migration.yaml` validated the config
against the registered connectors), with `migration.yaml` like this:

```yaml
version: 1
source: { type: json-file, path: ./tasks.json }
destination: { type: markdown-folder, directory: ./out }
```

What the CLI still assumes about the one shipped pair, so expect it for a new connector:

- `exitos inspect` accepts only `notion` and `clickup`, and `exitos demo` runs only Notion to ClickUp.
- Some terminal text (for example the plan's field-mapping heading) still says "ClickUp".
- Only `NOTION_TOKEN`, `CLICKUP_API_TOKEN`, `EXITOS_STATE_DIR` and the two `*_API_BASE_URL` variables are
  read from a `.env` file (`ENV_KEYS` in `apps/cli/src/runtime/env.ts`); credentials of your connector must
  come from the real environment unless you add them there and to `.env.example` (a test checks the two
  agree).
- For a network connector, the base-URL override variable is `<ID>_API_BASE_URL` (derived from the
  manifest id) and accepts only loopback addresses or the connector's own host, so a stray variable cannot
  redirect a token.

## The rules (these are what the conformance kit checks)

1. **Do all network I/O through `context.fetch`.** It is already wrapped by a guard that enforces a host
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
   `assertSafePathSegment` (from `@exitos/shared`) before putting them in a path.
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

The conformance kit and the engine cycle above are the minimum. Then test what matters for your service:
a rejected item, a lost reply after the write committed (and that `reconcile` adopts it), a crash before
the checkpoint and resume, pagination, rate limits, and that planning, inspecting and verifying send zero
writes (a `RequestRecorder` passed to `createConnectorContext`). The Notion and ClickUp packages each ship
an in-process **fake API** (`/testing`) you can copy as a pattern: a `fetch` function that serves
API-shaped JSON, enforces auth and pagination, and can inject faults. [testing.md](testing.md) explains
the fakes, `VirtualClock`, and what must never be mocked away.

## Add a new platform in 10 steps

1. **Propose it.** Open a _Connector proposal_ issue: the official API, auth, rate limits, an honest
   support matrix, how duplicates are avoided and how results are verified.
2. **Create the package.** Copy `examples/example-connector` to `packages/connector-<name>`, rename it
   `@exitos/connector-<name>` in `package.json`, and keep its `tsconfig.json` and `test/tsconfig.json`. If
   you ship a fake API, export it as `./testing` the way `packages/connector-clickup/package.json` does.
3. **Wire the workspace.** (a) Add `{ "path": "packages/connector-<name>" }` and
   `{ "path": "packages/connector-<name>/test" }` to `references` in the root `tsconfig.json`. (b) Add
   `vitest.config.ts` aliases for `@exitos/connector-<name>` (and `/testing`) pointing at the `src` files,
   like the existing ones, so tests run without a build. (c) Add `"@exitos/connector-<name>":
"workspace:*"` to `apps/cli/package.json` and a reference in `apps/cli/tsconfig.json`. (d) Run
   `pnpm install` once to link it, and commit the resulting `pnpm-lock.yaml` change.
4. **Describe it.** Write the manifest, the network policy, the `CredentialSpec`s (environment variable
   names, never config values; the optional `helpUrl` is shown when a credential is missing), the Zod
   `configSchema` and `create`.
5. **Implement the interface.** Source: `discover`, `inspect`, `extract`, `normalize`. Destination:
   `discover`, `inspect`, `plan`, `validate`, `apply`, `reconcile`, `verify`. Emit a finding with a stable
   code for everything that is lost or unsupported.
6. **Write a fake API** for the service in `src/testing/`: a `fetch` function with auth, pagination and
   fault injection ([testing.md](testing.md#the-fakes)).
7. **Test it.** The conformance kit, the full engine cycle, and the unhappy paths listed above.
8. **Register it.** Add it to `createRegistry()` in `apps/cli/src/runtime/runtime.ts`. If its credentials
   should be readable from `.env`, add them to `ENV_KEYS` and `.env.example`. Run `pnpm build`; then
   `pnpm exitos connectors` must list it.
9. **Document it.** Add every finding code to [finding-codes.md](finding-codes.md) and add your package's
   `src` folder to the `sourceFiles` list in `apps/cli/test/docs.test.ts` so a missing code fails a test
   (it currently scans only the four existing packages). Write what the connector can and cannot migrate
   and which permissions it needs. Update `README.md` and `README.ko.md` together, and `CHANGELOG.md`. Add
   an ADR for any decision that is costly to reverse.
10. **Check and open the PR.** `pnpm check` (production dependencies must pass the licence allow-list:
    `pnpm check:licenses`), then the PR template. Say exactly what was validated: against your fake only,
    or against a test workspace you own. Do not claim live validation you did not do
    ([live-sandbox-testing.md](live-sandbox-testing.md)).

## Checklist before opening a PR

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass (`pnpm check` runs them all)
- [ ] conformance kit passes; zero writes during plan/inspect/verify (request-recorder test)
- [ ] unsupported/lossy cases produce findings, documented in `docs/finding-codes.md`
- [ ] no `any`, no `process.env` reads, no secrets in fixtures
- [ ] fixtures are synthetic (no real workspace content)
- [ ] docs: what it can and cannot migrate, required credentials/permissions
- [ ] an ADR if you made a decision that is costly to reverse
