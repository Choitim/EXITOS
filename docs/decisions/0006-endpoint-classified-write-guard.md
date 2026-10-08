# 0006 — Read-only mode is enforced by endpoint classification

**Status:** accepted

## Context

The brief demands that dry runs "MUST NOT send any write requests" and that this be provable with
request spies. A rule such as "block everything except `GET`" would wrongly block Notion's read
endpoints: `POST /v1/search` and `POST /v1/data_sources/{id}/query` are reads.

## Decision

Each connector supplies a `classify(method, url) → "read" | "write" | "unknown"` function. The
shared `createGuardedFetch` wraps every outbound request:

- in **read-only** mode, anything not classified `read` throws `WriteBlockedError` _before_ the
  network is touched (unknown endpoints are blocked, i.e. fail-closed);
- a host allow-list prevents tokens being sent to unexpected hosts;
- a `RequestRecorder` records `(method, host, path, class)` — never headers or bodies.

The source connector is **always** constructed read-only, in every command, including `apply`.
Destination write access exists only inside `apply`/`resume`.

## Consequences

- Tests assert `recorder.writes.length === 0` after plan/inspect/verify, both against the fake APIs
  and (via the recorder) through the real CLI against a local mock server.
- Adding a new connector endpoint requires classifying it — a deliberate speed bump.
