# 0003 — Built-in `node:sqlite` for local state

**Status:** accepted

## Context

The brief requires SQLite for migration state, checkpoints and source→destination ID mappings, and
a "run the demo in under a minute" install. Native addons such as `better-sqlite3` need a prebuilt
binary or a compiler toolchain for each Node ABI and are blocked by default build-script policies
in recent pnpm versions.

## Decision

Use `node:sqlite` (`DatabaseSync`), available without a flag from Node 22.13. The state module
silences only the specific `ExperimentalWarning` for sqlite. All SQL is isolated behind a
`StateStore` interface (`SqliteStateStore`, `MemoryStateStore`) so the engine does not know about
SQLite.

## Consequences

- Zero native dependencies; installs on any supported Node.
- The Node API is still marked experimental upstream; the `StateStore` interface limits blast
  radius if it changes. Minimum supported Node is therefore 22.13, not 22.0.
- WAL mode and a `busy_timeout` are set so the dashboard server can read while `apply` writes.
