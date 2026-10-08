# Contributing to ExitOS

Thanks for helping people move between tools without losing track of what moved. This is a
safety-critical kind of software (it copies people's data between systems), so the bar for changes is
"correct and explainable" before "fast". Everyone is welcome, including first-time contributors.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree your
work is licensed under the [Apache License 2.0](LICENSE).

## Quick start

```bash
node --version          # >= 22.13
npm install -g pnpm     # or any way you install pnpm 12
pnpm install
pnpm build
pnpm exitos demo        # the offline demo — no credentials, no network
pnpm test               # unit + integration + CLI tests
pnpm check              # format, lint, typecheck, test, build — what CI runs
```

Other useful commands: `pnpm test:watch` · `pnpm test:e2e` (dashboard, needs
`pnpm exec playwright install chromium`) · `pnpm docs:assets` (regenerate the README demo image) ·
`pnpm clean`.

## Repository tour

| Path                         | What lives there                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `packages/shared`            | errors, redaction, clock, time zones, guarded `fetch`, request scheduler               |
| `packages/core`              | domain schemas (Zod), connector SDK, planner, executor, verifier, state store, reports |
| `packages/connector-notion`  | source connector (+ fake Notion API in `src/testing`)                                  |
| `packages/connector-clickup` | destination connector (+ fake ClickUp API in `src/testing`)                            |
| `apps/cli`                   | the `exitos` command and the local dashboard server                                    |
| `apps/web`                   | the dashboard (React + Vite + Tailwind)                                                |
| `examples/demo-workspace`    | the synthetic data behind `exitos demo`                                                |
| `examples/example-connector` | the minimal connector template                                                         |
| `docs/`                      | spec, architecture, ADRs, reliability, security review, guides                         |

Read [docs/architecture.md](docs/architecture.md) first, then the ADRs in
[docs/decisions](docs/decisions/README.md) for _why_ things are the way they are.

## Ground rules

1. **TypeScript strict, no `any`** (ESLint enforces it). Validate external data with Zod.
2. **Tests with every change.** New behaviour → new tests; a bug fix → a test that failed before. Tests
   use **isolated, synthetic fixtures** — never real workspace content or real tokens.
3. **Safety invariants are not negotiable** (see the product spec's principles): read-only until
   `apply`; explicit approval; never delete or overwrite; never silently discard unsupported content;
   never report "complete" without verification; no secrets in output.
4. **Honest claims.** Do not claim support that is not implemented, or live validation that has not
   happened. Mocked tests prove consistency with _our reading_ of an API, not real-world success —
   say which one you did.
5. **Docs are part of the change.** If you add a finding code, add it to
   [docs/finding-codes.md](docs/finding-codes.md) (a test fails otherwise). If you change behaviour,
   update the relevant doc and `CHANGELOG.md`.
6. **Small, focused PRs** with a description of what changed and how you verified it.

## Making a change

1. Open (or find) an issue to discuss anything non-trivial. For a new connector use the _Connector
   proposal_ template first.
2. Branch, change, add tests.
3. Run `pnpm check`. CI runs the same plus the browser test.
4. Open a PR using the template. Link the issue; list what you ran.

### Commit messages

Imperative, present tense, explain _why_ in the body when it is not obvious
(`Reconcile lost task creations by provenance marker`).

## Writing a connector

See [docs/connector-sdk.md](docs/connector-sdk.md) and copy
[examples/example-connector](examples/example-connector). The conformance kit
(`@exitos/core/testing`) checks the contract; you add connector-specific tests, a fake API for the
service, and docs on what can and cannot migrate.

## Good first issues

Look for the `good first issue` label. Suggested starter tasks are listed in
[docs/launch-plan.md](docs/launch-plan.md#contributor-onboarding-good-first-issues) — for example:
new Notion block fixtures, additional date/time-zone test cases, translating finding messages,
improving the Markdown escaping tests, or a dashboard accessibility pass.

## Validating against real services

If you have a test Notion and ClickUp workspace, the most valuable contribution right now is a
validation run: [docs/live-sandbox-testing.md](docs/live-sandbox-testing.md). Report results with
`exitos report --redact`; **never post plan files, `.env` files or unredacted reports**.

## Reporting bugs and security issues

Bugs: use the bug template and include the output of `exitos --version`, your Node version, and a
redacted report if relevant. **Security issues: do not open an issue** — see [SECURITY.md](SECURITY.md).
