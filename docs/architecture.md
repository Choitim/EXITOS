# Architecture

## Overview for contributors

The pipeline is `inspect → plan → approve → apply → verify → report`. Everything before `apply` is
read-only. Where each stage lives in the code:

| Stage                          | Where                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Read the source                | `SourceConnector` in `packages/connector-notion` (`extract`, then the pure `normalize`)                    |
| The shared language            | normalized model: Zod schemas in `packages/core/src/schema`                                                |
| Plan                           | `buildPlan` in `packages/core/src/engine/planner.ts`; the destination's pure `plan()` declares the actions |
| Seal and approve               | `sealPlan` and `verifyPlanIntegrity` in `engine/plan.ts`; `approveAndCreateRun` in `engine/run.ts`         |
| Apply                          | `executePlan` in `engine/executor.ts`; the destination's `apply` is the only writer                        |
| Verify                         | `verifyRun` in `engine/verifier.ts`; the destination's `verify`                                            |
| Report                         | pure functions in `engine/report.ts`                                                                       |
| State                          | SQLite `StateStore` in `packages/core/src/state`                                                           |
| Command line and dashboard API | `apps/cli/src/main.ts` (command tree), `apps/cli/src/commands`, `apps/cli/src/server`                      |
| Dashboard                      | `apps/web` (React), a static build served by `exitos ui`                                                   |

Four ideas explain most design choices:

1. **The normalized model is the only contract** between a source and a destination; neither knows the other.
2. **A plan is data**: self-contained, hashed, approved by its id. `apply` executes a plan; it never
   re-derives one ([ADR 0005](decisions/0005-self-contained-plan-and-approval.md)).
3. **Safety is structural**: sources are created with a read-only guarded `fetch` that classifies each
   endpoint and fails closed ([ADR 0006](decisions/0006-endpoint-classified-write-guard.md)); the executor
   writes a checkpoint before each write and reconciles writes whose outcome is unknown
   ([ADR 0007](decisions/0007-provenance-marker-and-reconciliation.md)).
4. **Nothing is dropped silently**: every loss is a finding with a stable code
   ([finding-codes.md](finding-codes.md)).

Good places to start reading: `buildProgram` in `apps/cli/src/main.ts`, then `buildPlan`, `executePlan`
and `verifyRun`. The connector interfaces are in section 4 below (the source of truth is
[`packages/core/src/sdk/types.ts`](../packages/core/src/sdk/types.ts); the walkthrough is
[connector-sdk.md](connector-sdk.md)). For setup and tests see
[development.md](development.md) and [testing.md](testing.md).

## 1. Shape

```
                 ┌──────────────────────────────── @exitos/core ───────────────────────────────┐
 Notion API ──►  │ SourceConnector            normalized model              DestinationConnector │ ──► ClickUp API
 (read-only)     │ discover/inspect/          Workspace · Collection ·       discover/inspect/     │     (writes only
                 │ extract/normalize  ──────► FieldDefinition · DataRecord · plan/validate/apply/  │      in apply)
                 │                            Document · DocumentBlock ·     reconcile/verify      │
                 │                            Relationship · Attachment ·                          │
                 │                            UserReference                                        │
                 │                                   │                                             │
                 │   planner ──► MigrationPlan (hashed, self-contained) ──► executor ──► verifier │
                 │                                   │                         │           │       │
                 │                              plan.json               StateStore   VerificationResult
                 │                                                      (SQLite)         │       │
                 │                                       reports (terminal · Markdown · JSON)     │
                 └────────────────────────────────────────┬────────────────────────────────────────┘
                                                          │ read-only JSON
                                       @exitos/cli ───────┴──► local HTTP server (127.0.0.1) ──► @exitos/web
```

The **normalized model is the only contract between a source and a destination.** A source never
learns what the destination is, and vice versa.

## 2. Packages and dependency rule

`shared ← core ← connector-notion, connector-clickup`. `demo-workspace` (synthetic fixtures) builds on the two
real connectors, and `cli` depends on core, both connectors and `demo-workspace`. `example-connector` is a
standalone template that nothing else depends on. `web` imports only types from `@exitos/core` at build
time. Rule: **connectors depend on core; core never imports a connector.** The CLI is the composition
root that registers connectors in a `ConnectorRegistry`.

## 3. Domain model (`@exitos/core/schema`, Zod)

| Entity                                      | Purpose                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Workspace`                                 | Identity of a system instance (system, id, name).                                                                                                                                                                                                                          |
| `Collection`                                | A set of records with a schema (Notion data source / ClickUp list).                                                                                                                                                                                                        |
| `FieldDefinition`                           | Normalized field kind (`title`, `text`, `number`, `select`, `multiSelect`, `status`, `date`, `checkbox`, `url`, `email`, `phone`, `person`, `relation`, `files`, `computed`, `timestamp`, `userStamp`, `uniqueId`, `unsupported`) + options + source type + support level. |
| `DataRecord`                                | One row: typed `FieldValue`s, optional body `Document`, stable `EntityKey`. (Named `DataRecord` in code to avoid TypeScript's `Record<K,V>`.)                                                                                                                              |
| `Document`, `DocumentBlock`, `RichTextSpan` | Page content as a tree; `sourceType` always retained.                                                                                                                                                                                                                      |
| `Relationship`                              | `from → to` between records or documents, with `resolved` / `inScope` flags.                                                                                                                                                                                               |
| `AttachmentReference`                       | Name, hosting kind, optional expiry — **no signed URLs stored**.                                                                                                                                                                                                           |
| `UserReference`                             | Source identity (id, name, optional e-mail).                                                                                                                                                                                                                               |
| `Finding`, `Outcome`                        | `supported · transformed · lossy · unsupported · skipped · failed`, with a stable `code`.                                                                                                                                                                                  |
| `MappingRule`                               | Source field → destination target, transform, `valueMap`, outcome, reason.                                                                                                                                                                                                 |
| `MigrationAction`                           | One idempotent unit of work with a destination-shaped payload, `dependsOn`, request estimate.                                                                                                                                                                              |
| `MigrationPlan`                             | Everything above + summary + hash. Self-contained (ADR 0005).                                                                                                                                                                                                              |
| `MigrationCheckpoint`                       | Per-action execution record (status, attempts, destination ID, error).                                                                                                                                                                                                     |
| `VerificationResult`                        | Per-item `verified · mismatched · missing · unverified` + field checks.                                                                                                                                                                                                    |
| `MigrationReport`                           | Plan + run + verification + the "not preserved" list.                                                                                                                                                                                                                      |

Stable identifiers: every entity has an `EntityKey = "<system>:<kind>:<id>"` (e.g.
`notion:page:0f1e…`). Keys are never rewritten, so mappings survive re-planning.

## 4. Connector contracts (`@exitos/core/sdk`)

Source and destination are **separate interfaces**; a connector implements only what is relevant.

```ts
interface SourceConnector<TRaw> {
  manifest: ConnectorManifest; // id, name, version, capabilities
  discover(): Promise<SourceDiscovery>; // what is reachable with this credential
  inspect(): Promise<SourceInspection>; // schema + support analysis, no bulk read
  extract(options?: ExtractOptions): Promise<TRaw>; // ALL source I/O; read-only
  normalize(raw: TRaw): SourceSnapshot; // PURE
}

interface DestinationConnector {
  manifest: ConnectorManifest;
  discover(): Promise<DestinationDiscovery>;
  inspect(): Promise<DestinationInspection>; // statuses, fields, members (read-only)
  plan(input: PlanInput): PlanFragment; // PURE: snapshot + config + inspection
  validate(plan: MigrationPlan): Promise<ValidationResult>; // read-only checks, duplicate adoption
  apply(action: MigrationAction, context: ApplyContext): Promise<ApplyResult>; // ONE action; throws AmbiguousWriteError when unsure
  reconcile?(action: MigrationAction, request: ReconcileRequest): Promise<ReconcileResult>;
  verify(input: VerifyInput): Promise<VerifyOutput>;
}
```

A connector is registered as a **definition** (`SourceConnectorDefinition` / `DestinationConnectorDefinition`): its
`manifest`, its `network` policy (the hosts its token may reach, and which endpoints are reads), its
`credentials`, a Zod `configSchema` for its section of `migration.yaml`, and
`create(context, config, migration)`. The host builds the `ConnectorContext` and hands it to `create`, which is
why the methods above take no context argument.

`ConnectorContext` carries a guarded `fetch` (ADR 0006), `Logger`, `Clock`, abort `signal`, and
resolved secrets — connectors never read `process.env` themselves.

## 5. Engine

- **Planner** — `extract → normalize → destination.inspect → destination.plan → destination.validate`
  then canonical-sort, assign stable action IDs, compute summary and hash. Deterministic: identical
  inputs yield a byte-identical plan body.
- **Executor** — dependency-ordered scheduling with bounded concurrency, write-ahead checkpoints,
  retry/backoff (shared scheduler), reconciliation of ambiguous writes, circuit breaker
  (`maxConsecutiveFailures`), cooperative cancellation, `interruptAfter` hook for deterministic
  crash tests. Item-level 4xx errors fail only that item and block its dependents.
- **Verifier** — list-based reads (100 tasks/request), per-field comparison against the plan's
  intended payloads, results classed `verified | mismatched | missing | unverified`.
- **Reporter** — pure functions from `(plan, run, verification)` to terminal text, Markdown, JSON,
  and a `--redact` form that replaces content with salted-hash placeholders.

## 6. State (`StateStore`, SQLite)

Tables: `plans` (the sealed plan each run was approved from), `runs`, `actions` (the checkpoint table), `id_map` (source key → destination ID, scoped by
destination; survives across runs and powers duplicate prevention), `events` (append-only,
secret-free progress log), `verifications`, `meta` (schema version). WAL mode; the dashboard
server opens the same file read-only.

## 7. Reliability model

See [reliability.md](reliability.md): token-bucket pacing, `Retry-After`/`X-RateLimit-Reset`, jittered
exponential backoff, ambiguous-write reconciliation, what _cannot_ be guaranteed.

## 8. Security model

See [security-review.md](security-review.md) and `SECURITY.md`. Highlights: env-only credentials,
fail-closed write guard + host allow-list, redaction of tokens and signed URLs in every log/error,
Zod at every trust boundary (API responses, config, plan files, state rows),
path-segment validation before URL interpolation, no HTML rendering in the dashboard (React text
nodes + an allow-listed Markdown subset), loopback-only server with Host-header checks.

## 9. Testing strategy

| Layer                                                                  | Approach                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure logic (normalizers, mapping, markdown, dates/time zones, hashing) | Vitest unit tests, Unicode and time-zone cases                                                                                                                |
| Connectors                                                             | Run against `createFakeNotionApi` / `createFakeClickUpApi` (API-shaped JSON), including 429s, 5xx, timeouts-after-write, >100-item pagination, 10 000-row cap |
| Engine                                                                 | In-memory store + fake destination: partial failure, resume, duplicate prevention, crash-after-write reconcile                                                |
| Dry-run guarantee                                                      | Request spies assert zero writes for `inspect`, `plan`, `verify`, `report`                                                                                    |
| CLI                                                                    | Spawned process tests against the demo and against a loopback mock server                                                                                     |
| Dashboard                                                              | Playwright smoke test over the real local server                                                                                                              |
| **Live**                                                               | Not automated; [live-sandbox-testing.md](live-sandbox-testing.md)                                                                                             |

Mocked tests prove consistency with _our reading_ of the documented contracts, not that real
workspaces migrate correctly.
