# Contributing to ExitOS

Thanks for helping people move between tools without losing track of what moved. ExitOS copies people's
data between systems, so the bar for a change is "correct and explainable" before "fast". Everyone is
welcome, including first-time contributors, and a small fix is as good as a big feature.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree that
your work is licensed under the [Apache License 2.0](LICENSE).

## Where to start

| I want to...                          | Read                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| find something small to do            | [docs/good-first-contributions.md](docs/good-first-contributions.md)                 |
| build and run ExitOS locally          | [docs/development.md](docs/development.md)                                           |
| write or run tests                    | [docs/testing.md](docs/testing.md)                                                   |
| understand how it works and why       | [docs/architecture.md](docs/architecture.md), [ADRs](docs/decisions/README.md)       |
| add a source or destination connector | [docs/connector-sdk.md](docs/connector-sdk.md)                                       |
| see what is planned (and what is not) | [ROADMAP.md](ROADMAP.md)                                                             |
| help prove it works on real services  | [docs/live-sandbox-testing.md](docs/live-sandbox-testing.md) (see "Live validation") |

Questions and ideas are welcome in [Discussions](https://github.com/Choitim/EXITOS/discussions); bugs,
proposals and validation results go in issues, using the templates.

## Quick start

```bash
node --version          # 22.13 or newer
pnpm --version          # 12.x (see docs/development.md for installing it)
pnpm install
pnpm build
pnpm exitos doctor      # is this machine ready? sends nothing anywhere
pnpm exitos demo        # the offline demo: no credentials, no network
pnpm test               # unit, integration and CLI tests
pnpm check              # format, lint, typecheck, test, build: what CI runs
```

Windows users: [docs/development.md](docs/development.md) has PowerShell notes, but the maintainers have
not tested Windows; WSL2 is the safer route. Dashboard tests need `pnpm exec playwright install chromium`
once, then `pnpm test:e2e`.

## How a contribution flows

1. **Find or open an issue** for anything bigger than a typo or a one-line fix, so we can agree on the
   approach before you spend time. A new connector starts with the _Connector proposal_ template.
2. **Fork, branch from `main`**, and keep the change small and focused.
3. **Change the code, add tests, update the docs** (see the ground rules below).
4. **Run `pnpm check`** (and `pnpm test:e2e` if you touched the dashboard). CI runs the same checks on
   Ubuntu and macOS, plus the dashboard browser test.
5. **Open a pull request** with the template: what changed, why, and what you ran. Link the issue.
6. **Review.** [CODEOWNERS](.github/CODEOWNERS) routes every change to the maintainer and lists the paths
   that guard the write path and the HTTP layer explicitly. Expect questions about safety.

### Commit and PR conventions

Taken from the project history: a short, imperative, present-tense subject without a trailing period
(`Remove quadratic work on large migrations; pin reconciliation safety branches`), a `Docs:` prefix for documentation-only changes, and,
when it is not obvious, a body that says _why_ and what you measured or checked. There is no
Conventional Commits prefix and no required branch naming. One logical change per PR; unrelated clean-ups
go in their own PR. User-visible changes get a line under `## [Unreleased]` in `CHANGELOG.md`.

## Ground rules

1. **TypeScript strict, no `any`** (ESLint enforces it). Validate external data with Zod.
2. **Tests with every change.** New behaviour gets new tests; a bug fix gets a test that failed before the
   fix. Use isolated, **synthetic** fixtures: never real workspace content or real tokens.
3. **The safety properties are not negotiable:** read-only until `apply`; explicit approval of the exact
   plan; never delete or overwrite; never silently discard unsupported content; never report "complete"
   without verification; no secrets in output. Do not stub them out in tests either
   ([docs/testing.md](docs/testing.md#what-must-never-be-mocked-away)).
4. **Honest claims.** Do not claim support that is not implemented, or live validation that has not
   happened. Mocked tests prove consistency with _our reading_ of an API, not real-world success; say
   which one you have.
5. **Docs are part of the change.** A new finding code goes in
   [docs/finding-codes.md](docs/finding-codes.md) (a test fails otherwise). A behaviour change updates the
   relevant doc and `CHANGELOG.md`.
6. **Small PRs, explained.** Say what changed and how you verified it.

### The README is bilingual

`README.md` (English) and `README.ko.md` (Korean) must stay in sync. If you change user-facing behaviour,
commands, the support matrix or the quick start in one, change the other in the same PR. If you do not
write Korean, say so in the PR description and describe exactly what changed in `README.md`, so a
Korean-speaking reviewer can update `README.ko.md`; the two should not be merged out of step. The rest of
the documentation is English only.

## Reporting bugs safely

Open a _Bug report_. Include the output of `pnpm exitos --version` (or `exitos --version`), your Node.js
version and OS, the exact commands, and, if relevant, `exitos report --redact --format markdown`. Try to
reproduce with `exitos demo` or a synthetic fixture first; that is the easiest report to act on.

**Never paste** tokens, `.env` files, plan files (`migration-plan.json` contains your content),
`.exitos/` state, or unredacted reports. `--verbose` output is redacted by ExitOS, but read it before you
share it. **Security problems are not public issues**: follow [SECURITY.md](SECURITY.md).

## Live validation

No automated test touches real Notion or ClickUp, and nobody has yet recorded a live run
([docs/validation-log.md](docs/validation-log.md)), so a validation run is the most valuable contribution
right now. Use **test workspaces that you own**, follow
[docs/live-sandbox-testing.md](docs/live-sandbox-testing.md), and report with the _Live validation result_
template and `exitos report --redact`. Say exactly what verified and what did not; do not describe a run as
a success unless `exitos verify` passed.

## Writing a connector

Start with the _Connector proposal_ template, then follow
[docs/connector-sdk.md](docs/connector-sdk.md): it walks through
[examples/example-connector](examples/example-connector) and ends with a checklist for adding a platform.
The conformance kit (`@exitos/core/testing`) checks the contract; you add connector-specific tests, a fake
API for the service, and a document saying what can and cannot migrate.

## Maintainers

Repository-level tasks (creating the labels in `.github/labels.yml`, enabling Discussions and private
vulnerability reporting) are in [docs/development.md](docs/development.md#maintainer-notes).
