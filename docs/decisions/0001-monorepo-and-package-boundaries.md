# 0001 — Monorepo and package boundaries

**Status:** accepted

## Context

ExitOS must support future source and destination connectors, a CLI, and a local dashboard, while
staying easy for a contributor to clone and run. The brief says "a modular monorepo only where
the package separation is justified".

## Decision

A pnpm workspace with these packages, each justified by a hard dependency boundary:

| Package                     | Why it is separate                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@exitos/shared`            | HTTP guard/scheduler, errors, redaction, time, hashing. Reused by every connector; no domain knowledge.                                                                                                                                                                   |
| `@exitos/core`              | Domain schemas (Zod), connector SDK interfaces, engine (plan/apply/verify), state store, report rendering. **Connectors depend on core; core never depends on a connector.** `@exitos/core/schema` is browser-safe (no `node:` imports) so the dashboard can share types. |
| `@exitos/connector-notion`  | Source. Owns the Notion SDK dependency.                                                                                                                                                                                                                                   |
| `@exitos/connector-clickup` | Destination. No third-party SDK (ClickUp's REST API is called with an instrumented `fetch`).                                                                                                                                                                              |
| `@exitos/cli`               | Commander CLI + the local API server for the dashboard.                                                                                                                                                                                                                   |
| `@exitos/web`               | React/Vite/Tailwind dashboard; talks only to the local server.                                                                                                                                                                                                            |
| `@exitos/demo-workspace`    | Synthetic Notion fixture + demo config. Separate so it can never be mistaken for product code.                                                                                                                                                                            |
| `@exitos/example-connector` | Minimal connector used by the SDK docs and conformance tests.                                                                                                                                                                                                             |

## Consequences

- Adding a connector = adding one package that depends on `@exitos/core/sdk`.
- The engine can be tested with no network and no connector SDKs.
- More `package.json` files to maintain; mitigated by a shared `tsconfig.base.json` and root scripts.
