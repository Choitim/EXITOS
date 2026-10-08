# 0002 — Pin TypeScript 6.0

**Status:** accepted (revisit when typescript-eslint supports TypeScript 7)

## Context

`npm view typescript` reports `latest = 7.0.2` on 2026-10-08, but `typescript-eslint@8.71.1` declares
`peerDependencies.typescript: ">=4.8.4 <6.1.0"`. Using TypeScript 7 would make type-aware linting
unsupported.

## Decision

Use `typescript@~6.0.3`. `strict` mode plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, and an ESLint `no-explicit-any` error rule
(the brief forbids `any`). `@types/node@^22` is used so code cannot accidentally depend on Node
APIs newer than the supported floor (**Node ≥ 22.13**).

## Consequences

We do not get TypeScript 7 speed-ups yet. Moving later should be a version bump plus fixing new
diagnostics.
