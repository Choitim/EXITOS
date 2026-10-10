# Roadmap

Directional, not a promise. There are **no dates**: ExitOS has one maintainer, and the order below
reflects risk first (validating what exists), then breadth. Everything marked **✅ v0.1** is implemented
and tested against API-shaped fakes. See [docs/validation-log.md](docs/validation-log.md) for what has
(not) been validated live: at the time of writing, nothing has.

The honest self-assessment this roadmap is built on is
[docs/enterprise-readiness.md](docs/enterprise-readiness.md); its list of what blocks calling ExitOS
"enterprise-ready" is reproduced as the v0.2 enterprise track below.

## v0.1: Notion → ClickUp, end to end ✅ (pre-release)

- ✅ Offline demo; read-only `inspect` / `plan`; hash-sealed plans; approval by plan id
- ✅ Checkpointed `apply`, `resume`, reconciliation of ambiguous writes, duplicate prevention
- ✅ `verify` and reports (terminal, Markdown, JSON, redacted); local read-only dashboard
- ✅ Notion data sources → ClickUp tasks (status, priority, dates, assignees, tags, existing Custom Fields, linked tasks, Markdown bodies)
- ✅ Notion pages → ClickUp Docs, **experimental**, behind a flag
- ✅ Connector SDK, conformance kit, example connector
- ✅ Corporate proxy and custom-CA support; license allow-list, SBOM, coverage floor, CodeQL and
  dependency review in CI ([enterprise readiness](docs/enterprise-readiness.md))
- ✅ `exitos doctor`, a stage-by-stage dashboard, English and Korean README, and a static browser demo (built, not yet published)
- ⏳ **Live validation by maintainers/contributors**, which blocks a "stable" label
  ([guide](docs/live-sandbox-testing.md))

Documentation, not code, but part of being usable: contribution guides, issue and pull-request
templates, a testing guide and a connector walkthrough ([CONTRIBUTING.md](CONTRIBUTING.md)).

## v0.2: Harden what exists

- Fixes for whatever live validation turns up. The likely areas are Docs rendering, date handling and
  ClickUp list read-after-write consistency, which the fakes cannot prove
- **Enterprise track**, in the order of
  [what it would take](docs/enterprise-readiness.md#what-it-would-take):
  - an independent security review, and a vulnerability-disclosure channel enabled on the repository
  - signed releases with build provenance and a published SBOM; GitHub Actions pinned by hash
  - Windows support, with a CI job that proves it (today Windows is untested; use WSL2)
  - attachments and comments behind an explicit opt-in (see below)
  - streaming extraction, so memory stays flat on very large sources
  - a support commitment: more than one maintainer, a response-time policy, and a compatibility and
    deprecation policy for plans and reports
- Opt-in, allow-listed **attachment transfer**, with the security requirements in
  [ADR 0009](docs/decisions/0009-attachments-not-transferred.md) written down first
- Incremental plan building for very large workspaces
- `exitos plan --diff` against a previous plan; `exitos resume` summaries; richer `--json` everywhere
- Notion: comments (read capability), `place` / `verification` / `button` reporting detail,
  markdown-endpoint fast path for pages with no unsupported content
- ClickUp: OAuth (not just personal tokens); subtasks from "sub-item" relations; task dependencies (opt-in)
- Dashboard: compare two plans; filter by finding code; keyboard shortcuts

## v0.3: A second pair

Pick by demand and by how well the API supports an honest plan/verify cycle. Candidates: **ClickUp →
Notion** (reverse), **Trello / Asana → ClickUp**, **Notion → Markdown folder** (the example connector,
promoted). Each needs: a fake API, a conformance run, a documented support matrix, and an honest
"cannot migrate" list ([docs/connector-sdk.md](docs/connector-sdk.md)). None of these names is a
commitment, and none is supported today.

## Later (unscheduled)

- A packaged npm release (`exitos` was unclaimed on npm at the time of the name check; see
  [docs/naming.md](docs/naming.md)) and a prebuilt dashboard in the package
- Pluggable user-mapping helpers (CSV import of id/e-mail maps)
- A "dry-run diff" report suitable for review in pull requests
- Optional encrypted state at rest
- A hosted offering, only if the open-source tool earns real usage
  ([market thesis](docs/market-thesis.md), hypotheses only)

## Explicitly not planned

Deleting or modifying source data; silent best-effort guessing; scraping private/internal APIs;
anything that sends your content to a third party.

## Where help is most useful now

1. **A live validation run** on test workspaces you own: the single most valuable contribution
   ([docs/live-sandbox-testing.md](docs/live-sandbox-testing.md)).
2. **Trying the setup on Windows and other platforms** and fixing
   [docs/development.md](docs/development.md) where it is wrong.
3. **Small, scoped tasks** with tests: [docs/good-first-contributions.md](docs/good-first-contributions.md).
4. **A connector proposal** for a platform you know well, with an honest support matrix.

## How to influence this

Open an issue with the _Feature request_ or _Connector proposal_ template, or start a discussion. The most
valuable input is a **live validation run** and a **concrete migration you need**.
