# 0005 — Self-contained, hashed plans; approval by hash

**Status:** accepted

## Context

"Dry run", "inspectable plan file", "explicit approval" and "deterministic" all point at the same
artifact. If `apply` re-read the source it could do something different from what the user
reviewed.

## Decision

A plan file contains every destination-shaped payload that `apply` will send (names, Markdown
bodies, mapped statuses, IDs). `apply` **never reads the source**. The plan carries
`hash = sha256(canonical JSON of the body)` and `planId = plan_<first 12 hex>`. Volatile data
(`generatedAt`) is outside the hashed body.

Approval requires either an interactive prompt where the user types the plan ID, or
`--approve <planId>` for non-interactive use. A mismatched or edited plan is rejected before any
network call.

## Consequences

- Plans contain the user's content (task titles, descriptions). They are gitignored by default and
  `exitos report --redact` produces a shareable version. Plans never contain credentials.
- Plans can go stale (the source changes after planning). This is documented; re-plan to refresh,
  and the planner skips items already mapped, so re-planning is cheap.
- Plan files are an _input trust boundary_: they are Zod-validated, IDs are pattern-checked before
  being interpolated into URL paths, and the hash is re-computed.
