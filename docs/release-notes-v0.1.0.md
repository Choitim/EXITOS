# ExitOS v0.1.0 — release notes (draft)

> **Status: pre-release candidate. Not tagged, not published.** These notes are for the maintainer to
> review. The tag, the GitHub release and any package publication happen only on the maintainer's
> explicit approval. See the [pre-release checklist](#before-this-can-be-tagged).

**See what survives before you switch apps.**

ExitOS is an open-source (Apache-2.0), local-first tool that turns an app-to-app migration into
**plan → approve → apply → verify**. v0.1 migrates **Notion database rows → ClickUp tasks**, with an
experimental path for **Notion pages → ClickUp Docs**.

## Read this first

- **Not validated against live services.** Everything below was tested against API-shaped fakes —
  in-process and over real loopback HTTP. **No run against a real Notion or ClickUp workspace has been
  recorded** ([validation log](validation-log.md)). Mocked tests prove the engine's logic and its
  handling of the documented API behaviour; they are _not_ proof that a real migration works.
- **It cannot move everything, and says so.** Every plan lists what moves as-is, what changes shape,
  what loses detail and what cannot move; the final report lists what was _not preserved_. ExitOS makes
  no "zero data loss" claim.
- **Use test workspaces first.** Follow the [live sandbox guide](live-sandbox-testing.md).
- **ClickUp's own importer is free** and may be all you need
  ([honest comparison](competitive-landscape.md)).

## Try it in a minute (offline)

```bash
pnpm install
pnpm build
pnpm exitos demo          # synthetic workspace, no account, no network
pnpm exitos ui --demo     # the same run in the local, read-only dashboard
```

## What is in v0.1.0

**Safety**

- Read-only by default: `inspect`, `plan`, `verify`, `report`, `ui` and `demo` never write to a real
  system; dry-run is proved with request spies (zero write requests).
- Plans are hash-sealed and self-contained; `apply` requires `--approve <planId>` (or typing it) and
  refuses an edited plan.
- The source connection is read-only in every command. Nothing is deleted or overwritten in the
  destination; writes are limited to four ClickUp create endpoints and everything else is blocked by
  code.
- Tokens come from the environment, are redacted from all output, and are never written to plans,
  state or reports.

**Reliability**

- Bounded concurrency, token-bucket pacing, `Retry-After` / `X-RateLimit-Reset`, jittered backoff.
- Write-ahead checkpoints in SQLite; resume after a crash or Ctrl-C.
- Duplicate prevention: lost replies are reconciled through a visible provenance marker, and
  already-migrated items are adopted instead of re-created. **Exactly-once delivery is not claimed**
  ([reliability model](reliability.md)).

**Verification and reporting**

- Each item ends `verified`, `mismatched`, `missing` or `unverified`; a run is "complete" only when
  verification passes.
- Reports in terminal, Markdown and JSON (with `--redact` for sharing).

**Interfaces and extensibility**

- CLI: `demo`, `inspect`, `plan`, `apply`, `status`, `resume`, `verify`, `report`, `ui`, `connectors`.
- Local dashboard (loopback only, strict CSP, no credentials in the browser).
- Connector SDK, conformance kit and a tested example connector ([guide](connector-sdk.md)).

## What is not in v0.1.0

Attachment and image bytes · comments · permissions · version history · views, templates, automations ·
icons and covers · ClickUp Custom Field _creation_ (the API cannot create them) · subtasks and task
dependencies · original timestamps and authors (kept as text) · formula/rollup logic · any connector
other than Notion → ClickUp. Details: [finding codes](finding-codes.md) and the
[product spec](product-spec.md).

## Verification of this candidate

Recorded on 2026-10-08 from a local run on macOS (Apple silicon). The numbers are the output of the
commands shown, not estimates.

| Check                                                         | Command                          | Result                                                                                                       |
| ------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Format, lint, strict typecheck, unit/integration tests, build | `pnpm check`                     | passed — **33 test files, 582 tests, 0 failures** (about 13 s)                                               |
| Same test suite on the minimum supported Node                 | Node 22.13.0                     | passed — 33 files, 582 tests; the offline demo also runs with an empty stderr                                |
| Dashboard browser tests (Chromium)                            | `pnpm test:e2e`                  | passed — **28 tests** (about 8 s)                                                                            |
| Secret scan                                                   | `node scripts/check-secrets.mjs` | no credential-shaped strings (tests, e2e files and the lockfile are excluded by design)                      |
| Dependency audit                                              | `pnpm audit`                     | no known vulnerabilities                                                                                     |
| Node versions exercised                                       | local                            | 22.13.0 and 26.0.0. The CI matrix (Node 22 and 24, Ubuntu and macOS) **has not run yet**: there is no remote |

What these results do **not** show: any run against live Notion or ClickUp, Windows, or Node 24.
Mocked and fake-API tests demonstrate the engine's behaviour against the documented API contracts; they
are not evidence that a real migration works.

## Before this can be tagged

These are open and block a responsible public release:

1. **Live validation** by someone with real test workspaces, recorded in
   [validation-log.md](validation-log.md).
2. **A real contact address** in [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) (currently a placeholder).
3. **Private vulnerability reporting enabled** on the GitHub repository ([SECURITY.md](../SECURITY.md)).
4. **A name decision.** "ExitOS" has not been trademark-cleared ([naming](naming.md)).
5. The maintainer's explicit approval to make the repository public, push, tag and publish.
