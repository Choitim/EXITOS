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
- Documentation: product spec, architecture, 12 ADRs, API verification record, competitive landscape,
  reliability model, security review, finding-code reference, live sandbox guide, launch plan, market
  thesis hypotheses.

### Verification of this candidate (2026-10-08, local)

- `pnpm check` (format, lint, strict typecheck incl. the dashboard, tests, build): passed — 33 test
  files, 582 tests. The same suite also passes on Node 22.13.0.
- `pnpm test:e2e` (Chromium): 28 tests passed.
- Secret scan clean; `pnpm audit`: no known vulnerabilities.
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
