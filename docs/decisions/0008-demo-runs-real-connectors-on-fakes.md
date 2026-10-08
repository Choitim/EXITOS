# 0008 — The offline demo runs the real connectors against in-process fake APIs

**Status:** accepted

## Context

The demo must need no credentials, no login and no network, yet must not be "a fake demo
masquerading as a live integration".

## Decision

`exitos demo` runs the _same_ Notion source connector (through the official SDK) and the _same_
ClickUp destination connector used for live runs. Their `fetch` is replaced by an in-process
handler (`createFakeNotionApi`, `createFakeClickUpApi`) that serves a synthetic fixture with
API-shaped JSON, real pagination, auth checks, rate limiting and failure injection. The guarded
fetch additionally refuses any request that is not routed to the fake (no real DNS, no sockets).

The UI, CLI and reports label this mode **OFFLINE DEMO**. The fake ClickUp state is persisted as a
JSON file in the demo state directory so `exitos resume`, `verify` and `ui` work across processes.

## Consequences

- A green demo proves our code is consistent with _our reading_ of the documented API contracts —
  **not** that real workspaces migrate correctly. The README and the live-sandbox guide say so.
- The fakes are maintained alongside the connectors and double as the integration-test servers.
