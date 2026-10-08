# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [Unreleased]

## [0.1.0] — unreleased (pre-release candidate)

First release candidate. **Not yet validated against live Notion/ClickUp workspaces** — see
[docs/validation-log.md](docs/validation-log.md).

### Added

- `exitos demo`: a complete offline plan → approve → apply → verify cycle on synthetic data, running
  the real connectors against in-process fake APIs (no credentials, no network).
- CLI: `demo`, `inspect`, `plan`, `apply`, `status`, `resume`, `verify`, `report`, `ui`, `connectors`.
- Safety model: read-only by default; hash-sealed, self-contained plans; approval by plan id;
  `apply` is the only write path; the source connection can never write.
- **Notion source** (official SDK, `Notion-Version 2026-03-11`, data-source model): data sources and
  databases, pagination, the 10 000-row query cap worked around with `created_time` windows,
  truncated relation/people properties, nested blocks, synced blocks, child pages, user directory,
  permission findings.
- **ClickUp destination** (API v2 tasks, v3 Docs): tasks with name, Markdown description, status,
  priority, start/due dates (time-zone aware), explicit user mapping, existing tags, existing Custom
  Fields, linked tasks for relations; Docs and nested pages (experimental).
- Reliability: bounded concurrency, token-bucket pacing, `Retry-After` / `X-RateLimit-Reset`, jittered
  backoff, write-ahead checkpoints in SQLite, reconciliation of ambiguous writes via a provenance
  marker, adoption of already-migrated items, resume after crash or Ctrl-C.
- Verification and reports (terminal, Markdown, JSON, `--redact`) that always list what was _not_
  preserved; a run is "verified" only after verification passes.
- Local read-only dashboard with seven sections; strict CSP; loopback only.
- Connector SDK (`@exitos/core/sdk`), conformance kit (`@exitos/core/testing`), example connector.
- Documentation: product spec, architecture, 13 ADRs, API verification record, competitive landscape,
  reliability model, security review, finding-code reference, live sandbox guide, launch plan, market
  thesis hypotheses, and an honest [enterprise-readiness assessment](docs/enterprise-readiness.md).
- **Corporate networks:** `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` support (via `undici`, process
  environment only, credentials never printed) and `NODE_EXTRA_CA_CERTS` guidance
  ([ADR 0013](docs/decisions/0013-proxy-support-via-undici.md)).
- Network failures now name the real cause (proxy refused, DNS, untrusted certificate) and what to
  check, instead of a bare "fetch failed".
- **Supply-chain and quality gates in CI:** production licence allow-list (`pnpm check:licenses`),
  CycloneDX SBOM (`pnpm sbom:generate`), coverage with an enforced floor (`pnpm test:coverage`), CodeQL,
  dependency review on pull requests, `CODEOWNERS`.
- Tests that pin the safety-critical "adopt, re-send or stop and ask" branches of reconciliation, and an
  opt-in scale test (`EXITOS_SCALE=1`).

### Fixed

- **Quadratic work on large migrations:** several places copied an array on every iteration while
  grouping actions (verification, planning, the executor's dependency index) and the time-zone check built
  an `Intl.DateTimeFormat` for every row. At 100 000 rows (against fakes) verification dropped from about
  19 s to 10 s. The in-process fake Notion API had the same pattern, which had inflated early
  measurements.
- CI failed on a clean checkout: `apps/web` and `e2e` lacked a TypeScript project reference to
  `@exitos/core`, so the linter could not resolve its types until `dist/` existed.

### Verification of this candidate (2026-10-08, local)

- `pnpm check` (format, lint, strict typecheck incl. the dashboard, tests, build): passed — 38 test
  files, 628 tests (plus one opt-in scale test, skipped by default). The same suite also passes on
  Node 22.13.0.
- `pnpm test:coverage`: 88.2 % statements, 76.1 % branches, 89.5 % functions, 89.7 % lines (floor
  enforced).
- `pnpm test:e2e` (Chromium): 28 tests passed.
- Secret scan clean; `pnpm check:licenses`: 8 production dependencies, all MIT or ISC; `pnpm audit`: no
  known vulnerabilities.
- GitHub Actions (Ubuntu Node 22 and 24, macOS Node 22, dashboard browser job): passed. The first run
  had failed in lint because `apps/web` and `e2e` lacked a TypeScript project reference to
  `@exitos/core`; fixed.
- **Not done:** any run against live Notion/ClickUp; Windows.

### Known limitations

- Attachment bytes, comments, permissions, views, icons/covers are not migrated.
- ClickUp's API cannot create Custom Fields; only existing ones are filled.
- Docs migration is experimental. List-consistency behaviour of ClickUp after a create is undocumented,
  so exactly-once delivery is not claimed ([docs/reliability.md](docs/reliability.md)).
- State is held in memory during extraction; tuned for tens of thousands of rows, not millions.
