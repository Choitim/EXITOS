<div align="center">

# ExitOS

**See what survives before you switch apps.**

[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-lightgrey)](.github/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933)](package.json)

</div>

Moving between tools is a leap of faith: you learn what was lost _after_ the import. ExitOS turns
migration into **plan → approve → apply → verify** and tells you the truth at every step:

1. **A read-only plan** lists everything that **moves as-is**, **changes shape**, **loses detail**, or
   **cannot move** — before anything is written anywhere.
2. **You approve that exact plan** (by its id). The source is never modified; nothing is ever deleted or
   overwritten.
3. **Apply is resumable** and survives rate limits, crashes and lost replies without creating duplicates.
4. **Verification** compares the plan with what the destination actually holds — and the report still
   lists what did _not_ survive. A run is only "complete" once it verifies.

Open source (Apache-2.0), local-first, no account. **v0.1 migrates Notion → ClickUp.**

![ExitOS demo: the plan lists what moves, what changes and what cannot move; apply recovers from injected failures; verification passes; the report lists what was not preserved](docs/assets/demo.svg)

<sub>↑ Real output of `pnpm exitos demo` (an excerpt; synthetic data; fully offline). Regenerate with
`pnpm docs:assets`.</sub>

> **Status: v0.1 pre-release.** The offline demo, the engine, and both connectors work and are
> extensively tested **against API-shaped fakes** (in-process and over real loopback HTTP). **They
> have not yet been validated against live Notion or ClickUp workspaces** — see
> [docs/live-sandbox-testing.md](docs/live-sandbox-testing.md) and
> [docs/validation-log.md](docs/validation-log.md). Page → ClickUp **Docs** migration is
> **experimental**. ClickUp's own importer is free and may be all you need
> ([honest comparison](docs/competitive-landscape.md)).

## Quick start

**Try it offline — no account, no network, no credentials (about a minute):**

```bash
git clone <this-repo> exitos && cd exitos     # Node >= 22.13 and pnpm required
pnpm install
pnpm build
pnpm exitos demo          # plan → approve → apply → verify on a synthetic workspace (~1 s)
pnpm exitos ui --demo     # explore the same run in the local, read-only dashboard
```

The demo runs the **real** Notion and ClickUp connectors against in-process fake APIs
([ADR 0008](docs/decisions/0008-demo-runs-real-connectors-on-fakes.md)). It injects rate limits and a
lost reply on purpose so you can watch recovery. Try `pnpm exitos demo --interrupt-after 40` and then
`pnpm exitos resume --demo`.

**A real migration** (use **test workspaces** first — the [sandbox guide](docs/live-sandbox-testing.md)
walks through it):

```bash
cp .env.example .env && chmod 600 .env             # add NOTION_TOKEN and CLICKUP_API_TOKEN
cp migration.example.yaml migration.yaml           # fill in your ids

pnpm exitos inspect notion                         # what is shared with your Notion connection
pnpm exitos inspect clickup                        # your Workspaces and List ids
pnpm exitos plan notion clickup --config migration.yaml     # READ-ONLY; writes migration-plan.json
pnpm exitos apply --plan migration-plan.json --approve <planId>   # or omit --approve to be prompted
pnpm exitos verify                                 # a migration is not complete until this passes
pnpm exitos report --format markdown --out report.md   # add --redact before sharing it
```

Other commands: `status` · `resume` · `ui` · `connectors`. Run `pnpm exitos --help`.

**Behind a corporate proxy?** Set the standard variables before running: `HTTPS_PROXY`
(`http://user:password@host:port`), `NO_PROXY` for hosts that must skip it, and `NODE_EXTRA_CA_CERTS`
if your proxy inspects HTTPS. Credentials are never printed. ExitOS contacts exactly two hosts,
`api.notion.com` and `api.clickup.com`. Details: [enterprise readiness](docs/enterprise-readiness.md).

## Example output

```text
HERE IS EVERYTHING THAT MOVES, CHANGES, AND CANNOT MOVE
  ✔ MOVES AS-IS     3 of 175 actions      7 field mapping(s) are exact
  ↻ CHANGES SHAPE   115 of 175 actions    8 mapping(s) store the value differently
  ⚠ LOSES DETAIL    57 of 175 actions     9 mapping(s) lose information
  ✖ CANNOT MOVE     12 finding(s)         1 property type(s) never move

  ✖ unsupported      2  Attachments: Files hosted by Notion are not downloaded or re-uploaded…
  ✖ unsupported      1  child_database: An inline database inside a page body is not migrated here…
  ⚠ lossy           28  Open dependencies: Formula/rollup logic is not migrated; only the last…
  ⚠ lossy           26  State: Status "Won't fix" has no equivalent on the ClickUp list…
  ↻ transformed      9  Depends on: Relation becomes a ClickUp linked task (symmetric…

  ↺ "Calibrate joint encoders": reply lost → checked ClickUp: it WAS created — adopted, not re-sent
  Duplicates      0 — every Notion row exists in ClickUp exactly once

  ✔ VERIFIED    175 verified · 0 mismatched · 0 missing · 0 unverified
```

That is the _synthetic demo workspace_ (28 roadmap rows, 130 bugs, 5 pages), not a real result. A
real run's numbers come from your workspace; [docs/finding-codes.md](docs/finding-codes.md) explains
every line.

![Dashboard](docs/assets/dashboard-overview.png)

## Supported migration matrix

| Source → destination                                   | Status                                        | Notes                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notion database (data source) rows → ClickUp tasks** | ✅ implemented, mock-tested                   | name, Markdown body, status, priority, start/due dates (time-zone aware), assignees (explicit map), existing tags, existing Custom Fields, linked tasks for relations |
| **Notion pages → ClickUp Docs** (nested pages)         | 🧪 experimental (`options.experimental.docs`) | documented v3 endpoints; not live-validated; lossy for several block types                                                                                            |
| Anything else                                          | ❌ not implemented                            | no other connectors ship in v0.1                                                                                                                                      |

Field-level detail: [docs/product-spec.md](docs/product-spec.md#42-supported-migration-matrix).

## What does NOT migrate

Attachment and image **bytes** (Notion-hosted files; external links are kept) · comments and
discussions · page and database **permissions** · version history · database **views**, filters,
templates, buttons, automations · page icons and covers · ClickUp **Custom Field creation** (the
ClickUp API cannot create them — only existing ones are filled) · subtasks and task dependencies ·
original creation/edit timestamps and authors (kept as text) · formula/rollup _logic_ (last value kept
as text) · Notion-only block types (toggles, columns, synced blocks, callouts, colours, underline
arrive simplified). The plan prints this list for every run, and each affected item is a finding — see
[docs/finding-codes.md](docs/finding-codes.md).

## Safety model

```
inspect  →  plan  →  approve  →  apply  →  verify  →  report
(read)     (read)    (you, by    (writes to  (read)     (read)
                      plan id)   destination
                                 ONLY)
```

- **Read-only by default.** `inspect`, `plan`, `verify`, `report`, `ui`, `demo` never write to a real
  system. Dry-run is proved in tests with request spies (zero write requests), and the source
  connection is read-only in _every_ command.
- **Explicit approval.** `apply` needs `--approve <planId>` (or typing it). Plans are hash-sealed;
  an edited plan is refused.
- **Never destructive.** Nothing in the source is modified; nothing in the destination is deleted or
  overwritten. Writes are limited to four ClickUp create endpoints; everything else is blocked by code.
- **Never silent.** Unsupported and lossy content is always reported. No "zero data loss" claims.
- **Verified or not complete.** `applied` ≠ `verified`; only a passing `verify` completes a run.
- **No secrets on disk.** Tokens come from the environment; they are redacted from output and never
  written to plans, state or reports.
- **No telemetry.** Nothing is sent anywhere except to the two APIs you configure; there is no
  analytics code. State and plans stay in a local `0700` directory with `0600` files.
- **People are never guessed.** Notion and ClickUp user ids are unrelated; assignment is opt-in via an
  explicit map (ClickUp notifies assignees of API-created tasks).

Details: [reliability model](docs/reliability.md) (what is and is **not** guaranteed — exactly-once is
not claimed) · [security review](docs/security-review.md) · [SECURITY.md](SECURITY.md).

## Enterprise readiness

ExitOS is built to be evaluated by a company, but it is **not yet enterprise-ready**: nobody has run it
against live Notion or ClickUp, and it has had no independent security review. The
[full self-assessment](docs/enterprise-readiness.md) gives the evidence and the gaps for every area.
In short:

| Area                  |     | State                                                                                                                              |
| --------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Safe by construction  | ✅  | Read-only source, nothing deleted or overwritten, approval by plan id, verification, no telemetry.                                 |
| Corporate networks    | ✅  | Proxy, `NO_PROXY` and custom-CA support, tested against a real local proxy (not yet a real corporate one).                         |
| Supply chain          | ✅  | 5 third-party runtime packages, all MIT/ISC; license allow-list, SBOM, `pnpm audit`, CodeQL and dependency review run in CI.       |
| Tests                 | ✅  | 628 tests plus 28 browser tests; 88 % statement coverage with an enforced floor. Safety-critical tests are mutation-checked.       |
| Scale                 | 🟡  | Measured to 100 000 rows under fakes (about 2.7 GB of memory); a real run is paced by the destination's rate limit, not by ExitOS. |
| Live validation       | ❌  | Never run against real Notion or ClickUp. This is the main blocker.                                                                |
| Assurance and support | ❌  | No independent audit, signed releases, Windows support, SSO/roles or support commitment.                                           |

## Architecture

```
 Notion API ──► SourceConnector ──► normalized model ──► DestinationConnector ──► ClickUp API
 (read-only)    discover/inspect/    Collection · Record · plan/validate/apply/    (writes only
                extract/normalize    Document · Block ·    reconcile/verify        in apply)
                                     Relationship · …
                                            │
              planner ► hash-sealed plan ► executor (checkpoints, resume) ► verifier ► reports
                                   SQLite state · local read-only dashboard
```

TypeScript (strict, no `any`) · Zod at every trust boundary · SQLite via built-in `node:sqlite` ·
Vitest · React + Vite + Tailwind dashboard. Packages: `shared`, `core`, `connector-notion`,
`connector-clickup`, `apps/cli`, `apps/web`. Read [docs/architecture.md](docs/architecture.md) and the
[decision records](docs/decisions/README.md).

## Connector SDK

A connector is an object implementing `SourceConnector` (read) or `DestinationConnector`
(plan/apply/verify) from `@exitos/core/sdk`. A conformance kit (`@exitos/core/testing`) checks the
contract, and [`examples/example-connector`](examples/example-connector/src/index.ts) is a complete,
tested template. Guide: [docs/connector-sdk.md](docs/connector-sdk.md).

## Project status and checks

`pnpm check` runs formatting, lint, strict typecheck, tests and build; CI runs them on Node 22 and 24
and macOS, plus the dashboard browser test, a license allow-list (`pnpm check:licenses`), coverage with a
floor (`pnpm test:coverage`), an SBOM (`pnpm sbom:generate`), `pnpm audit`, CodeQL, and a dependency
review on pull requests. Results of the last full local run are recorded in
[CHANGELOG.md](CHANGELOG.md) and the release notes — not inflated, and not a substitute for live
validation. Documentation tests keep these docs honest (every finding code documented, every link and
CLI command real).

## Roadmap

Live validation and hardening → streaming extraction and opt-in attachment transfer → a second
connector pair. See [ROADMAP.md](ROADMAP.md). Market and launch thinking (hypotheses only):
[docs/market-thesis.md](docs/market-thesis.md), [docs/launch-plan.md](docs/launch-plan.md).

## Contributing

Contributions are very welcome — especially **live validation reports** from test workspaces, new
fixtures, and connectors. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). If ExitOS saves you from a painful migration, a star helps
others find it.

## License

[Apache License 2.0](LICENSE). "ExitOS" is a working title that has not been trademark-cleared
([docs/naming.md](docs/naming.md)).
