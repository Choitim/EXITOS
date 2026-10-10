# Development guide

How to build, run, debug and change ExitOS from a source checkout. For the contribution flow see
[CONTRIBUTING.md](../CONTRIBUTING.md); for how to test see [testing.md](testing.md); for how the pieces
fit together see [architecture.md](architecture.md).

The build, test and dashboard commands below were run on macOS with Node 26 and pnpm 12.10.1. CI covers
Ubuntu and macOS. **Windows is documented below but has not been tested by the maintainers**; use WSL2 if
you can.

## Prerequisites

| Tool    | Version  | Notes                                                                                                                                      |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js | >= 22.13 | `engines` in `package.json`; `.nvmrc` says `22`. CI runs Node 22 and 24 on Ubuntu and Node 22 on macOS; maintainers have also run Node 26. |
| pnpm    | 12       | `package.json` pins `pnpm@12.10.1` in `packageManager`. `.npmrc` sets `engine-strict=true`, so `pnpm install` refuses an unsupported Node. |
| Git     | any      |                                                                                                                                            |

Check what you have:

```bash
node --version    # v22.13.0 or newer
pnpm --version    # 12.x
```

### Install the prerequisites

**macOS** (Homebrew; `brew info node pnpm` shows both formulas):

```bash
brew install node pnpm
```

**Linux**: use a Node version manager such as [nvm](https://github.com/nvm-sh/nvm) or
[fnm](https://github.com/Schniz/fnm) (`nvm install 22` / `fnm install 22`), or your distribution's
package if it ships Node 22.13 or newer. Then install pnpm with `npm install -g pnpm` or one of the
methods on <https://pnpm.io/installation>.

**Windows (PowerShell) — documented, not tested by the maintainers.** WSL2 with the Linux steps is the
recommended route. If you stay on native Windows:

```powershell
winget install OpenJS.NodeJS.LTS      # then open a new terminal
npm install -g pnpm
node --version
```

Things that differ on Windows (all untested, please report what you find):

- Use `Copy-Item .env.example .env` instead of `cp`; there is no `chmod 600` (ExitOS only warns about
  group/world-readable `.env` files on systems that have file modes).
- Set an environment variable for one command with `$env:NAME = "value"` (see the scale test in
  [testing.md](testing.md#the-opt-in-scale-test)).
- Git for Windows may check files out with CRLF line endings, while Prettier expects LF
  (`.editorconfig` says `end_of_line = lf`), so `pnpm format:check` could fail on every file. If it does,
  run `git config core.autocrlf false` and check the repository out again.

## Get the code and build it

```bash
git clone https://github.com/Choitim/EXITOS.git exitos
cd exitos
pnpm install
pnpm build
```

`pnpm build` is `tsc -b && pnpm --filter @exitos/web build`: it compiles every workspace package into its
`dist/` folder and then builds the dashboard into `apps/web/dist`.

Try it:

```bash
pnpm exitos doctor        # is this machine ready? (Node, build, SQLite; sends nothing anywhere)
pnpm exitos demo          # offline demo on synthetic data: plan, approve, apply, verify
pnpm exitos --help        # every command
pnpm exitos connectors    # the connectors compiled into this build
```

## The edit, build, run loop

- **Tests do not need a build.** `vitest.config.ts` aliases `@exitos/*` to the TypeScript sources, so
  `pnpm test` works on a fresh checkout. Two kinds of tests do build or need a build: the spawned-process
  tests run `tsc -b` themselves, and the Playwright tests need `pnpm build` first.
- **`pnpm exitos <command>` runs the compiled CLI.** The script (`scripts/exitos.mjs`) first checks your
  Node version and that the project is built, with a plain message if not, and then loads
  `apps/cli/dist/bin.js`. It does not rebuild. After changing TypeScript run `pnpm build`, or, when you did
  not touch `apps/web`, the faster incremental `pnpm exec tsc -b`. `pnpm exec tsc -b --watch` rebuilds on
  every save.
- **Before you push:** `pnpm check` runs what CI runs (format, lint, typecheck, tests, build).
  `pnpm format` rewrites files with Prettier, which also checks Markdown, so run
  `pnpm exec prettier --write <file>` on any doc you edit.

### Where state and files go

ExitOS writes only inside the directory you run it in, unless you say otherwise:

| Path                    | What                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `./.exitos/`            | state directory (SQLite `state.db`, plans); `--state-dir <dir>` or `EXITOS_STATE_DIR` moves it |
| `./.exitos/demo/`       | the offline demo's state, its fake ClickUp world and `migration-plan.json`                     |
| `./migration-plan.json` | the plan written by `exitos plan` (a real plan contains your content)                          |
| `./.env`                | optional tokens; copy from `.env.example`                                                      |

All of these are git-ignored. **`pnpm clean` deletes build output _and_ `.exitos/`** (the state of any run
you made from this checkout), so do not run it between `apply` and `verify` of a real migration.

## The dashboard loop

`exitos ui` serves the **built** dashboard (`apps/web/dist`) and a read-only JSON API on `127.0.0.1:4173`.
To work on the React app with hot reload, run two processes from the repository root:

```bash
# terminal 1: state for the dashboard to show, and the API it talks to
pnpm exitos demo
pnpm exitos ui --demo                  # http://127.0.0.1:4173

# terminal 2: the Vite dev server with hot reload
pnpm --filter @exitos/web dev          # http://127.0.0.1:5173
```

Open <http://127.0.0.1:5173>. `apps/web/vite.config.ts` proxies `/api` to `http://127.0.0.1:4173` with
`changeOrigin: true`, because the API server rejects any `Host` header other than its own (DNS-rebinding
defence). If you start `exitos ui` on another port with `--port`, change the proxy target in
`vite.config.ts` to match, or the page will say "The dashboard cannot show anything yet".

The dashboard is served under a strict Content-Security-Policy (no inline scripts or styles, no remote
assets), so the production build emits only external files. After a UI change run `pnpm build` and look
at it through `pnpm exitos ui --demo`, and run `pnpm test:e2e` ([testing.md](testing.md)).

## Repository tour

| Path                         | What lives there                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared`            | errors, redaction, `Clock`/`VirtualClock`, time zones, the guarded `fetch`, request scheduler, `stableId`                                              |
| `packages/core`              | Zod schemas, the connector SDK (`/sdk`), planner, executor, verifier, SQLite state store, reports, Markdown renderer, the conformance kit (`/testing`) |
| `packages/connector-notion`  | source connector, plus a fake Notion API in `src/testing` (exported as `@exitos/connector-notion/testing`)                                             |
| `packages/connector-clickup` | destination connector, plus a fake ClickUp API in `src/testing`                                                                                        |
| `apps/cli`                   | the `exitos` command, the terminal views, and the local dashboard server                                                                               |
| `apps/web`                   | the dashboard (React, Vite, Tailwind), a static build served by `exitos ui`                                                                            |
| `examples/demo-workspace`    | synthetic Notion data and ClickUp state behind `exitos demo`                                                                                           |
| `examples/example-connector` | the small connector pair used as a template ([connector-sdk.md](connector-sdk.md))                                                                     |
| `e2e`                        | Playwright tests for the dashboard                                                                                                                     |
| `scripts`                    | `clean`, `check-secrets`, `check-licenses`, `generate-sbom`, demo asset generation                                                                     |
| `docs`                       | specification, architecture, ADRs in `docs/decisions`, reliability, security review, guides                                                            |
| `.github`                    | CI workflows, issue and PR templates, `labels.yml`, CODEOWNERS, Dependabot                                                                             |

The dependency rule is one-way: `shared` <- `core` <- connectors <- `cli`; connectors depend on core,
core never imports a connector ([architecture.md](architecture.md#2-packages-and-dependency-rule)).

## Debugging

- **`--verbose`** is a global flag (`pnpm exitos --verbose plan ...`). It prints debug lines to stderr:
  the proxy in use (credentials hidden), each retried request with its reason and wait time, and the stack
  trace of an unexpected error. Secrets are always redacted, but still read the output before pasting it anywhere.
- **`pnpm exitos doctor`** checks Node, the build, SQLite, the state directory, credentials, proxy and a
  config file (`--config <file>` validates one without contacting any API). `--online` adds read-only
  calls to the Notion and ClickUp APIs, `--live` treats missing credentials as problems.
- **Look at the data, not just the text:** `exitos status --json`, `exitos verify --json` and
  `exitos report --format json` print machine-readable results; `exitos ui` shows the same run in a
  browser. Add `--redact` to a report before sharing it.
- **Reproduce without credentials.** The offline demo and the in-process fakes run the real connectors,
  so most bugs can be reproduced with `pnpm exitos demo` or a test ([testing.md](testing.md)). Run a
  single test with `pnpm exec vitest run <file> -t "<part of the test name>"`.
- **Demo crash and resume:** `pnpm exitos demo --interrupt-after 40` simulates a crash after 40 actions;
  `pnpm exitos resume --demo` finishes the run.
- **Proxy problems:** proxy settings come from the process environment only (`HTTPS_PROXY`,
  `HTTP_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`); see
  [enterprise-readiness.md](enterprise-readiness.md#network-and-proxy).

## Common problems

| Symptom                                                                                                            | Cause and fix                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` fails with an unsupported engine error, or `pnpm exitos` says "ExitOS needs Node.js 22.13 or newer" | Your Node is older than 22.13 (`engine-strict` is on, and the launcher checks too). Install a newer Node, open a new terminal, check `node --version`.                                             |
| `pnpm exitos ...` says "ExitOS has not been built yet"                                                             | The project is not built. Run `pnpm install` once if you have not, then `pnpm build`.                                                                                                              |
| `exitos ui` says "The dashboard has not been built yet"                                                            | `apps/web/dist` is missing. Run `pnpm build` from the repository root.                                                                                                                             |
| `pnpm test:e2e` says `Missing .../dist/...` in global setup                                                        | The e2e tests start the built CLI and dashboard. Run `pnpm build` first.                                                                                                                           |
| `pnpm test:e2e` fails because the browser executable does not exist                                                | Playwright downloads one browser build per Playwright version. Run `pnpm exec playwright install chromium` (on a fresh Linux machine CI uses `pnpm exec playwright install --with-deps chromium`). |
| `exitos ui` fails with `EADDRINUSE`                                                                                | Port 4173 is taken (often by an earlier `exitos ui`). Stop that process or pass `--port <n>`; with the Vite loop, update the proxy target too.                                                     |
| The Vite page says "The dashboard cannot show anything yet"                                                        | `exitos ui` is not running on port 4173 (or the proxy in `vite.config.ts` points elsewhere). Start it and press Retry.                                                                             |
| The Vite page says "There is no plan or run to show yet"                                                           | `exitos ui --demo` found no demo state in the directory it was started from. Run `pnpm exitos demo` there first (see [the dashboard loop](#the-dashboard-loop)).                                   |
| `pnpm install` or a dependency update refuses a version (release age)                                              | See below.                                                                                                                                                                                         |
| `pnpm format:check` fails on files you did not touch                                                               | On Windows the usual cause is line endings (see the note above). Run `pnpm exec prettier --write <file>` for a single file.                                                                        |
| After a `git pull`, `pnpm exitos` behaves like the old code                                                        | It runs compiled output. Rebuild with `pnpm build` (or `pnpm exec tsc -b`).                                                                                                                        |

### pnpm's minimum release age

pnpm 12 enforces a **minimum release age** (24 hours by default) on dependency versions, and this
repository keeps it enforced with no exclusions ([security-review.md](security-review.md)). In practice:

- A normal `pnpm install` follows the committed `pnpm-lock.yaml` (pnpm also reports that the lockfile passes
  the supply-chain policies) and is not affected.
- If you add or update a dependency and the newest version was published less than 24 hours ago, pnpm
  refuses it with an error that mentions `minimumReleaseAge` (the error code in pnpm's changelog is
  `ERR_PNPM_NO_MATURE_MATCHING_VERSION`). **Pin the previous release instead of adding an exclusion**;
  Dependabot proposes the newer version once it has aged. Say in the PR which version you pinned and why.
- Commit the resulting `pnpm-lock.yaml` change together with the `package.json` change. Adding a new
  workspace package or a workspace dependency also changes the lockfile.

## Editor setup

Only what the repository itself configures:

- `.editorconfig`: UTF-8, LF line endings, two-space indent, final newline.
- Prettier (`.prettierrc.json`): 100 columns, single quotes, trailing commas. It also formats Markdown.
- ESLint (`eslint.config.js`) is type-aware and uses `projectService`, so run your editor's ESLint from the
  repository root. `no-explicit-any`, `no-floating-promises` and `no-console` (outside the CLI) are errors.
- TypeScript is `~6.0.3` from `node_modules` ([ADR 0002](decisions/0002-typescript-6-toolchain-pin.md));
  point your editor at the workspace copy rather than a global one.

## Maintainer notes

Only maintainers can do these; they are written down, not automated.

**Labels.** `.github/labels.yml` lists the labels the issue templates and the contribution guides refer
to. Nothing syncs it automatically. To create or update them on the repository (the `--force` flag
updates a label that already exists):

```bash
gh label create "good first issue" --color 7057ff --description "Good for newcomers" --force
gh label create "help wanted"      --color 008672 --description "Extra attention is needed" --force
gh label create "bug"              --color d73a4a --description "Something isn't working" --force
gh label create "enhancement"      --color a2eeef --description "New feature or request" --force
gh label create "documentation"    --color 0075ca --description "Improvements or additions to documentation" --force
gh label create "connector"        --color 0e8a16 --description "A new or changed source or destination connector" --force
gh label create "validation"       --color fbca04 --description "Result of a run against real Notion and ClickUp test workspaces" --force
```

**Repository settings the links depend on.** The issue chooser links to Discussions and to the security
policy, and `SECURITY.md` names GitHub private vulnerability reporting. Turn on _Discussions_ and
_Private vulnerability reporting_ in the repository settings, and replace the TODO contact placeholders in
`SECURITY.md` and `CODE_OF_CONDUCT.md`; until then those links lead nowhere.
