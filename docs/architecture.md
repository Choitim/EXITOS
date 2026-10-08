# Architecture

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

`shared ← core ← connector-notion, connector-clickup, example-connector ← demo-workspace ← cli`; `web` depends only on
`@exitos/core/schema` (types). Rule: **connectors depend on core; core never imports a connector.**
The CLI is the composition root that registers connectors in a `ConnectorRegistry`.

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
  discover(ctx): Promise<SourceDiscovery>; // what is reachable with this credential
  inspect(ctx, selection): Promise<SourceInspection>; // schema + support analysis, no bulk read
  extract(ctx, selection, opts): Promise<TRaw>; // all I/O; read-only
  normalize(raw: TRaw, opts): SourceSnapshot; // PURE
}

interface DestinationConnector {
  manifest: ConnectorManifest;
  discover(ctx): Promise<DestinationDiscovery>;
  inspect(ctx, target): Promise<DestinationInspection>; // statuses, fields, members (read-only)
  plan(input: PlanInput): PlanFragment; // PURE: snapshot + config + inspection
  validate(ctx, plan): Promise<ValidationResult>; // read-only checks, duplicate adoption
  apply(ctx, action, deps): Promise<ApplyResult>; // one action, throws AmbiguousWriteError when unsure
  reconcile?(ctx, action, attempt): Promise<ReconcileResult>;
  verify(ctx, plan, mappings): Promise<VerificationResult>;
}
```

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

Tables: `runs`, `actions` (the checkpoint table), `id_map` (source key → destination ID, scoped by
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
