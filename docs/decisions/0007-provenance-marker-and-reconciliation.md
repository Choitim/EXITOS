# 0007 — Provenance marker + write-ahead log, not "exactly once"

**Status:** accepted

## Context

ClickUp documents no idempotency keys and no transactions. A `POST` that times out may or may not
have created the task. Retrying blindly can duplicate; never retrying loses data.

## Decision

1. **Write-ahead:** before each create, persist `in_flight` (attempt number, timestamp) in SQLite.
2. **Provenance marker:** every created task/page carries a stable key
   (`exitos-key:<system>:<kind>:<id>`) in a visible footer (configurable; default on).
3. **Reconcile before retry:** for any action left `in_flight` or `ambiguous` (crash, timeout,
   5xx, network error on a write), the destination connector searches for the marker among items
   created since the attempt started. Found → record the mapping, mark succeeded. Not found and the
   listing was complete → safe to retry. Cannot decide (marker disabled, listing incomplete) →
   stop and ask the user (`exitos resume --assume-not-created <actionId>` is deliberately explicit).
4. **Adopt on plan:** `validate` scans the target for markers of planned keys; matches become
   `skipped (already present)` actions, so losing the local database does not cause duplicates.
5. **`429` is never ambiguous** (the request was rejected) and is retried after `Retry-After`.

## Consequences

- We never claim exactly-once delivery. The residual risk window (a task created, then the process
  killed, then the destination list not yet showing it) is documented in
  [reliability.md](../reliability.md).
- The footer is visible in ClickUp. Users who disable it accept weaker reconciliation, and the plan
  says so.
