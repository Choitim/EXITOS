# Reliability model

What ExitOS guarantees when an API is slow, rude, or the process dies mid-migration — and, just as
importantly, what it does **not** guarantee. See also [ADR 0007](decisions/0007-provenance-marker-and-reconciliation.md).

## 1. Pacing and rate limits

| Source of limit        | Documented value                                                                                                                     | What ExitOS does                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ClickUp, per token     | 100 req/min (Free, Unlimited, Business) · 1 000 (Business Plus) · 10 000 (Enterprise); `429` + `X-RateLimit-Limit/Remaining/Reset`   | Default budget **90/min** (`destination.requestsPerMinute`), token bucket with a burst of 5. Honours `X-RateLimit-Reset` (a Unix timestamp) and, if ever sent, `Retry-After`. |
| Notion, per connection | 180 req/min (3/s average), 600/min on Business+; a separate per-workspace limit; `429` + `Retry-After` (integer seconds); also `529` | Default budget **150/min** (`source.requestsPerMinute`, max 600). Honours `Retry-After`; retries 429 and 529.                                                                 |

- **One 429 pauses everything.** A rate-limit response sets a global "blocked until" gate, so every
  queued request waits instead of each rediscovering the limit.
- **Backoff** is exponential with full jitter (500 ms base, 60 s cap, ≤ 6 attempts) _only when the
  server gives no wait hint_. A server hint always wins, up to 15 minutes; a longer hint is surfaced
  as the original 429 rather than stalling a run for hours.
- **Bounded concurrency** (`options.concurrency`, 1–16, default 4) and a bounded number of in-flight
  requests per connector.
- The Notion SDK's own retries are disabled so pacing is decided in one place.

## 2. What is retried, and what is not

| Failure                                   | Read (`GET`, Notion `search`/`query`) | Write (`POST` create)                                 |
| ----------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `429` / `529` (request rejected)          | retried after the wait                | retried after the wait — the write did **not** happen |
| `500/502/503/504`                         | retried                               | **not retried**: outcome unknown → _ambiguous_        |
| Timeout / connection reset / DNS failure  | retried                               | **not retried**: outcome unknown → _ambiguous_        |
| `2xx` with an unreadable body             | validation error                      | _ambiguous_ (the write may have happened)             |
| `4xx` (validation, not found, permission) | surfaced                              | the item **fails**; its dependents are _blocked_      |
| `401` / `403`                             | run stops (credential problem)        | run stops                                             |

## 3. Write-ahead checkpoints

Before each destination write the executor persists the action as `in_flight` (with the attempt
number and first-attempt time) in SQLite. After the write, the checkpoint **and** the
source→destination id mapping are committed in a single transaction. A second, _different_
destination for the same source is refused (`DUPLICATE_DETECTED`) and stops the run.

Run states: `approved → applying → applied → verifying → verified | verification_failed`, with
`stopped` and `failed` for runs that did not finish. **Only `verified` is presented as complete.**

## 4. Ambiguous writes and reconciliation

A write is _ambiguous_ when ExitOS cannot know whether it took effect (see table above), or when the
process died while it was `in_flight`. ExitOS never blindly re-sends. It asks the destination:

| Action          | How the destination is asked                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create task     | list the tasks created since the attempt (with a 60 s clock-skew allowance) and look for the item's **provenance marker** `exitos-key:<source key>` in its description |
| link tasks      | read the first task's `linked_tasks`                                                                                                                                   |
| create Doc      | search Docs under the parent by name and creation time (a Doc has no content to carry a marker)                                                                        |
| create Doc page | read the Doc's pages and look for the marker in their content                                                                                                          |

Outcomes: **found** → recorded as done, not re-sent · **not found, listing complete** → safe to send
again (max 3 attempts) · **cannot tell** (several matches, listing incomplete, no marker) → the run
**stops** and tells you exactly what to check, then `exitos resume --assume-not-created <actionId>`
once you have confirmed the item does not exist.

Before planning, `validate` also scans each target list for markers of planned items. Matches become
`skipped (already present)`, so **losing the local database does not cause duplicates**.

## 5. What is not guaranteed (exactly-once is not claimed)

ClickUp documents no idempotency keys and no transactions, so exactly-once delivery is impossible to
promise. Residual risks, all documented rather than hidden:

1. **List consistency.** ClickUp does not document how quickly a created task appears in list
   endpoints. If a task is created and the process dies _before_ it is listable, reconciliation can
   report "not found" and a retry could create a second copy. Mitigation: marker search covers all
   tasks since the attempt; resume re-checks before sending; verification reports duplicates by name
   collisions only as warnings — **inspect the list after an unclean crash.**
2. **`provenance: none`.** With no marker, reconciliation falls back to "same name, created since the
   attempt". Two identically named tasks become undecidable and stop the run.
3. **Docs** carry no marker on the Doc itself; reconciliation is by name and creation time. Two Docs
   with the same name under the same parent stop the run.
4. **Someone edits the migrated description** (removing the footer) before a reconcile that needed it.
5. **Two machines applying the same plan at once.** The local state database prevents a second run of
   the same plan on one machine; it cannot coordinate across machines. Do not do this.
6. **Clock skew** larger than the 60 s allowance between this machine and ClickUp.

## 6. Stopping safely

- Item-level `4xx` errors fail only that item; items that depend on it are `blocked`; everything else
  continues.
- Five consecutive item failures, an authentication failure, exhausted 429 retries, or an unresolved
  ambiguous write **stop the whole run**. The state is saved; `exitos status` and `exitos report` show
  exactly what is done, failed, blocked and pending, and `exitos resume` continues.
- **Ctrl-C** aborts in-flight requests, marks an interrupted write ambiguous, and exits cleanly. A
  second Ctrl-C exits immediately; the write-ahead log is crash-safe.
- A run is **never** reported complete unless `exitos verify` passed.

## 7. Tested, and not tested

Covered by automated tests against API-shaped fakes (and, for the CLI, real loopback HTTP): >100-item
pagination, the 10 000-row cap, 429 with `Retry-After` / `X-RateLimit-Reset`, transient 5xx, dropped
connections before and after commit, crash after commit before checkpoint, partial failure and
resume, duplicate prevention, adoption after state loss, auth failure, and cancellation.

**Not tested against the real services.** Real-API behaviour (consistency of list endpoints, exact
rate-limit headers, Docs Markdown rendering) is exactly what
[live-sandbox-testing.md](live-sandbox-testing.md) exists to check.

## 8. Scale

Extraction is held in memory (normalized records, documents and the plan). Tests cover hundreds of
rows; the design target for v0.1 is tens of thousands of rows per run. Streaming extraction is on the
[roadmap](../ROADMAP.md).
