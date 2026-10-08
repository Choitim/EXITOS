# Implementation plan

Status legend: ✅ done · 🟡 partial · ⬜ not started. Updated at the end of each phase; the final
state is mirrored in the README and `CHANGELOG.md`. **Do not read a ✅ as "validated against live
APIs"** — nothing here has been run against real Notion/ClickUp workspaces by the maintainers.

## Phase 0 — Research, specification, API verification, architecture

- ✅ Repository inspection (greenfield)
- ✅ Name check → [naming.md](naming.md)
- ✅ Competitive landscape → [competitive-landscape.md](competitive-landscape.md)
- ✅ Official API verification → [api-verification.md](api-verification.md)
- ✅ Product spec, architecture, ADRs 0001–0012

## Phase 1 — Normalized model, offline demo, CLI, tests

- ✅ Workspace scaffold (pnpm, strict TS, ESLint, Prettier, Vitest)
- ✅ `@exitos/shared`: errors, redaction, clock, canonical JSON, time zones, guarded fetch, scheduler
- ✅ `@exitos/core`: schemas, SDK interfaces, Markdown renderer, state store, planner, executor, verifier, reports
- ✅ Notion connector (SDK, Zod boundary, normalizer) + fake Notion API + synthetic fixture
- ✅ ClickUp connector (client, mapping, plan, apply, reconcile, verify) + fake ClickUp API
- ✅ `exitos demo` end-to-end (plan → apply → verify) with `OFFLINE DEMO` labelling
- ✅ CLI commands: demo, inspect, plan, apply, status, resume, verify, report

## Phase 2 — Live Notion → ClickUp path

- ✅ Credential loading (env / `.env`), config schema, user mapping
- ✅ Pagination >100, 10 000-row windows, property-item pagination, nested blocks
- ✅ Retry/backoff, `Retry-After`, `X-RateLimit-Reset`
- ✅ Apply with checkpoints, resume, reconciliation, duplicate adoption
- ✅ Verification (list-based) and reports
- ✅ Loopback mock-server CLI tests (spawned process, real HTTP on 127.0.0.1)
- ✅ Live sandbox guide ([live-sandbox-testing.md](live-sandbox-testing.md)) — **written, not yet executed against real workspaces**

## Phase 3 — Dashboard and Docs migration

- ✅ Local dashboard server (loopback, read-only, strict CSP) + `DashboardState` schema
- ✅ React dashboard (7 sections; read-only; sanitised Markdown; DEMO vs LIVE badge) — 194 unit tests
- ✅ Playwright dashboard tests (28, hermetic, including a hostile-plan XSS test); reproducible screenshots via `pnpm docs:screenshots`
- ✅ Notion pages → ClickUp Docs (experimental flag), Markdown renderer policy — mock-tested only; endpoints not live-validated

## Phase 4 — Reliability, security, CI, release

- ✅ Security review ([security-review.md](security-review.md))
- ✅ CI, Dependabot, templates, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, ROADMAP, CHANGELOG
- ✅ Launch plan, market thesis, [release notes draft](release-notes-v0.1.0.md)
- ✅ Lint + typecheck + test + build, with real results recorded in [release-notes-v0.1.0.md](release-notes-v0.1.0.md)
- ⬜ **Live validation against real Notion/ClickUp test workspaces** — not done; required before a responsible public release
