# Roadmap

Directional, not a promise. Ordering reflects risk first (validating what exists), then breadth.
Everything marked **✅ v0.1** is implemented and tested against API-shaped fakes — see
[docs/validation-log.md](docs/validation-log.md) for what has (not) been validated live.

## v0.1 — Notion → ClickUp, end to end ✅ (pre-release)

- ✅ Offline demo; read-only `inspect` / `plan`; hash-sealed plans; approval by plan id
- ✅ Checkpointed `apply`, `resume`, reconciliation of ambiguous writes, duplicate prevention
- ✅ `verify` and reports (terminal, Markdown, JSON, redacted); local read-only dashboard
- ✅ Notion data sources → ClickUp tasks (status, priority, dates, assignees, tags, existing Custom Fields, linked tasks, Markdown bodies)
- ✅ Notion pages → ClickUp Docs — **experimental**, behind a flag
- ✅ Connector SDK, conformance kit, example connector
- ✅ Corporate proxy and custom-CA support; license allow-list, SBOM, coverage floor, CodeQL and
  dependency review in CI ([enterprise readiness](docs/enterprise-readiness.md))
- ⏳ **Live validation by maintainers/contributors** (blocking a "stable" label — [guide](docs/live-sandbox-testing.md))

## v0.2 — Harden what exists

- Live-validation fixes from the sandbox runs (Docs rendering, date handling, list consistency)
- **Enterprise track:** an independent security review, signed releases with build provenance, Actions
  pinned by hash, Windows support with a CI job, and a support/compatibility policy (the full list is in
  [docs/enterprise-readiness.md](docs/enterprise-readiness.md#what-it-would-take))
- Streaming extraction + incremental plan building for very large workspaces
- Opt-in, allow-listed **attachment transfer** with the security requirements in ADR 0009 written down
- `exitos plan --diff` against a previous plan; `exitos resume` summaries; richer `--json` everywhere
- Notion: comments (read capability), Notion `place`/`verification`/`button` reporting detail, markdown-endpoint fast path for pages with no unsupported content
- ClickUp: OAuth (not just personal tokens); subtasks from "sub-item" relations; task dependencies (opt-in)
- Dashboard: compare two plans; filter by finding code; keyboard shortcuts

## v0.3 — A second pair

Pick by demand and by how well the API supports an honest plan/verify cycle. Candidates: **ClickUp →
Notion** (reverse), **Trello / Asana → ClickUp**, **Notion → Markdown folder** (the example connector,
promoted). Each needs: a fake API, a conformance run, a documented support matrix, and an honest
"cannot migrate" list.

## Later (unscheduled)

- A packaged npm release (`exitos` is unclaimed on npm at the time of the name check — see [docs/naming.md](docs/naming.md)) and prebuilt dashboard in the package
- Pluggable user-mapping helpers (CSV import of id/e-mail maps)
- A "dry-run diff" report suitable for review in pull requests
- Optional encrypted state at rest
- A hosted offering — only if the open-source tool earns real usage ([market thesis](docs/market-thesis.md), hypotheses only)

## Explicitly not planned

Deleting or modifying source data; silent best-effort guessing; scraping private/internal APIs;
anything that sends your content to a third party.

## How to influence this

Open an issue with the _Feature request_ or _Connector proposal_ template. The most valuable input is a
**live validation run** and a **concrete migration you need**.
