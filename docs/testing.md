# Testing guide

ExitOS copies people's data between systems, so the test suite is its safety net. This page explains the
layers, the commands, the fakes, how to add a test, and what a green run does and does not tell you. For
setup see [development.md](development.md); for the design behind the layers see
[architecture.md](architecture.md#9-testing-strategy).

## What a green test run proves, and what it does not

**Mocked tests are not proof of a live migration.** Every automated test runs on synthetic data against
in-process or loopback fakes. A green run shows that the engine's logic is right and that the connectors
behave consistently with _our reading_ of the Notion and ClickUp documentation
([api-verification.md](api-verification.md)). It does not show that a real workspace migrates correctly:
nobody has run ExitOS against live Notion or ClickUp yet ([validation-log.md](validation-log.md)). When
you open a PR, say which kind of evidence you have ("unit test", "fake API", "ran by hand against my own
test workspace") and never describe fake-backed results as live validation. The only path to the latter is
[live-sandbox-testing.md](live-sandbox-testing.md).

## Which command runs what

| Command                                     | What it runs                                                                                                                 | Needs first                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm test`                                 | `vitest run`: every unit, in-process, CLI, spawned-process and loopback test (several hundred, about 15 seconds on a laptop) | `pnpm install` only; no build                            |
| `pnpm test:watch`                           | the same, re-running on change                                                                                               | `pnpm install`                                           |
| `pnpm exec vitest run <file> -t "<name>"`   | one file, or the tests whose name contains the text                                                                          | `pnpm install`                                           |
| `pnpm test:coverage`                        | `vitest run --coverage` (V8); **fails below the coverage floor**                                                             | `pnpm install`                                           |
| `pnpm test:e2e`                             | Playwright: the dashboard in Chromium against real `exitos ui` servers                                                       | `pnpm build` and `pnpm exec playwright install chromium` |
| the opt-in scale test                       | one full plan, apply, verify cycle on thousands of rows against the fakes; see [below](#the-opt-in-scale-test)               | `pnpm install`                                           |
| `pnpm check`                                | format check, lint, typecheck, `pnpm test`, build: what CI runs first                                                        | `pnpm install`                                           |
| `pnpm check:secrets`, `pnpm check:licenses` | repository hygiene gates that CI also runs (credential-shaped strings; production licence allow-list)                        | `pnpm install`                                           |

CI runs `pnpm check`, the offline demo and the secret scan on Ubuntu (Node 22 and 24) and macOS (Node 22);
`pnpm audit`, the licence check, coverage and the SBOM on Ubuntu with Node 22; and `pnpm test:e2e` in a
separate job ([ci.yml](../.github/workflows/ci.yml)).

`pnpm docs:screenshots` and `pnpm docs:assets` regenerate documentation images; they are not tests.

Tests live next to the code they cover: `packages/*/test`, `apps/*/test`, `examples/*/test`, and `e2e/`
for the browser tests. Vitest picks up any `*.test.ts` file in those folders.

## The layers

| Layer                 | Where                                                                                       | How it works                                                                                                                                                                                                 | What it is good for                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Unit               | `packages/shared/test`, `packages/core/test`, `apps/web/test`, connector `ids-text`/`units` | Pure functions with fixed inputs: time zones and DST, canonical JSON and hashing, redaction, the Markdown renderer, the dashboard's state derivation and safe Markdown parser                                | Edge cases (Unicode, DST gaps, hostile text) cheaply and exhaustively                                                                                                           |
| 2. In-process fakes   | `packages/connector-*/test`, `packages/core/test/executor.test.ts`                          | The real connector or engine runs against `createFakeNotionApi`, `createFakeClickUpApi` or `createMemoryDestination`; `VirtualClock` makes waits instant                                                     | Pagination, rate limits, lost replies, resume, duplicate prevention, the dry-run guarantee                                                                                      |
| 3. CLI, in process    | `apps/cli/test/commands.test.ts`, `harness.ts`                                              | `makeCli()` builds a `CliContext` with captured stdout/stderr and a temporary working directory; `run([...])` calls `runCli` and returns the exit code                                                       | Command behaviour, exit codes, the approval gate, report and plan files                                                                                                         |
| 4. Spawned process    | `apps/cli/test/spawn.test.ts`, `spawn-proxy.test.ts`                                        | The built `apps/cli/dist/bin.js` runs as a child process with a scrubbed environment. `block-network.cjs` is preloaded to kill the process on any socket, DNS or `fetch` call                                | "The offline demo makes zero network attempts", real argv/env/exit-code handling, `.env` loading, proxies                                                                       |
| 5. Loopback HTTP      | `serveFake()` in `apps/cli/test/harness.ts`, `server.test.ts`, `proxy.test.ts`              | A fake API is served over real HTTP on `127.0.0.1`, so the real `fetch`/undici stack, headers and base-URL override run; a local CONNECT proxy tests proxy support; the dashboard server is tested over HTTP | Anything the in-process fakes skip: the HTTP layer, the proxy, the dashboard server's Host check and CSP                                                                        |
| 6. Browser            | `e2e/dashboard.spec.ts`, `e2e/global-setup.ts`                                              | Playwright drives Chromium against `exitos ui` servers started with the real built CLI on four throwaway states: the demo, hostile content, a run still applying, and an empty directory                     | Rendering, keyboard operation, narrow screens, colour schemes, live polling, no script injection                                                                                |
| 7. Repository hygiene | `apps/cli/test/docs.test.ts`, `check-*.test.ts`, `apps/web/test/source-hygiene.test.ts`     | Reads the repository itself                                                                                                                                                                                  | Relative links resolve, documented commands exist, every finding code is in `docs/finding-codes.md`, `.env.example` matches the code, no "zero data loss" claim, versions agree |
| 8. Live               | not automated                                                                               | [live-sandbox-testing.md](live-sandbox-testing.md)                                                                                                                                                           | The only evidence about real Notion and ClickUp                                                                                                                                 |

Pick the lowest layer that can show the behaviour. A bug in a date calculation is a layer-1 test, not a
browser test.

## The fakes

### `createFakeNotionApi` and `createFakeClickUpApi`

Both are plain `fetch` functions (`FetchLike`); no socket is opened. They serve API-shaped JSON from a
fixture and are what `exitos demo` runs the real connectors against
([ADR 0008](decisions/0008-demo-runs-real-connectors-on-fakes.md)).

- **Notion** (`@exitos/connector-notion/testing`): `createFakeNotionApi(fixture, { validTokens?, queryResultCap? })`.
  The fixture lists users, databases, data sources, pages, and blocks by parent id; `hidden` ids answer 404
  (not shared with the integration) and `forbidden` ids answer 403. It requires a Bearer token and
  `Notion-Version`, paginates at 100 with cursors, and caps queries at 10 000 rows (lower
  `queryResultCap` to test the windowing). Build fixtures with the helpers in
  `packages/connector-notion/src/testing/builders.ts`: `uid`, `rt`, `richTexts`, `value.*`, `schema.*`,
  `block.*`, `pageObj`, `dataSourceObj`.
- **ClickUp** (`@exitos/connector-clickup/testing`): `createFakeClickUpApi(state, { now?, rateLimitPerMinute?, validTokens?, onChange? })`
  with `basicClickUpState()` as a starting point. It validates status, priority, assignees and custom
  fields on create, returns list pages of 100, supports linked tasks and Docs, and enforces a per-minute
  limit with `429` and `X-RateLimit-*` headers using the clock you pass in (`rateLimitPerMinute: 0`
  disables it). `tasksIn(listId)` and `state` let you assert on what was created.
- **Fault injection** (both): `fake.fault({ match, times, respond })` answers matching requests with a
  response you choose, `fake.rateLimit(times, ...)` answers with `429`, and `fake.requests` records every
  request. The ClickUp fake adds `throw` (a dropped connection) and **`failAfterCommit`**: process the
  request, change the state, _then_ fail. That is how "the write happened but the reply was lost" is
  tested, which is the case the reconciliation code exists for.
- **`createMemoryDestination`** (`@exitos/core/testing`): an in-memory destination for engine tests.
  `script(key, 'ok' | { fail: 500 } | { ambiguous: 'created' } | { ambiguous: 'not_created' })` decides what the next
  `apply` for that idempotency key does; `items`, `applyCalls` and `duplicates` expose what happened (a
  correct engine leaves `duplicates` empty); `corrupt` and `remove()` make `verify` see a mismatch or a
  missing item.

### `VirtualClock`

`VirtualClock` (from `@exitos/shared`) implements the `Clock` interface: `sleep(ms)` advances virtual time
instantly and records it in `slept` and `sleeps`, `advance(ms)` moves time by hand. Pass it as `clock` to
`createConnectorContext`, `executePlan` and `verifyRun`, and as the fake ClickUp's `now`, so a test that
"waits 60 seconds for a rate limit" finishes in milliseconds and is deterministic. The demo uses it too.

### Request recorder

`RequestRecorder` (from `@exitos/shared`) is passed to `createConnectorContext` as `recorder`. It records
method, host, path and class (never headers, bodies or query strings) for every request that passes the
guard, and exposes `reads`, `writes` and `blocked`. "A dry run sent zero writes" is
`expect(recorder.writes).toHaveLength(0)`.

## Write a connector test with the conformance kit

`@exitos/core/testing` exports `checkSourceConnector` and `checkDestinationPlan`. Both return
`{ passed, checks: [{ name, ok, detail? }] }`; assert that no check failed so the failure message names it:

```ts
import { checkDestinationPlan, checkSourceConnector } from '@exitos/core/testing';

const report = await checkSourceConnector(source, { secrets: [TOKEN], recorder });
expect(report.checks.filter((c) => !c.ok)).toEqual([]);

const plan = checkDestinationPlan(destination, {
  snapshot,
  inspection,
  config,
  mode: 'live',
  existing: new Map(),
});
expect(plan.checks.filter((c) => !c.ok)).toEqual([]);
```

What they check:

- **Source:** the manifest says `source` with a kebab-case id; `extract` and `normalize` succeed; the
  snapshot matches its schema, record keys are unique, every record has a known collection, body document
  and declared fields, relationships start at known records; `normalize` is deterministic; no value in
  `secrets` appears in the snapshot; and (with `recorder`) the source sent zero write requests.
- **Destination plan:** the manifest says `destination`; `plan()` succeeds and is deterministic; actions and
  mappings match their schemas; the action graph has unique ids, known dependencies and no cycle;
  idempotency keys are unique within a scope; every `lossy` or `unsupported` action has a finding.

The kit checks the contract, not your connector's behaviour: it replaces none of the tests above. Real
examples: [`examples/example-connector/test/example.test.ts`](../examples/example-connector/test/example.test.ts)
(file based), `packages/connector-notion/test/extract.test.ts` (`checkSourceConnector` with a recorder and
the token) and `packages/connector-clickup/test/plan.test.ts` (`checkDestinationPlan`). The full
walkthrough, including the engine cycle `buildPlan`, `approveAndCreateRun`, `executePlan`, `verifyRun`, is
in [connector-sdk.md](connector-sdk.md).

## Add a regression test

1. **Reproduce at the lowest layer that shows the bug.** A wrong date is a unit test; a lost reply is a
   fake with `failAfterCommit`; a wrong exit code is a CLI test with `makeCli()`.
2. **Write the test first and watch it fail** for the right reason (`pnpm exec vitest run <file> -t
"<name>"`). A test that never failed has not shown it can catch the bug.
3. **Use synthetic data only**: invented titles, `example.com` addresses, fake tokens such as
   `ntn_` + 36 letters. Never paste content from a real workspace or a real plan file into a fixture.
   (`pnpm check:secrets` scans documentation and `.env.example`, not test files, so the care is yours.)
4. **Use `VirtualClock`** instead of real timers, and `SqliteStateStore.open(':memory:')` instead of a file.
5. **Fix the code**, see the test pass, then run `pnpm check`.
6. **For safety-critical code, prove the test bites**: temporarily break the fix (for example make
   reconciliation adopt the first of several matches) and confirm the test fails. The reconciliation and
   write-guard tests were checked this way.
7. If the bug came from a real API behaving differently than the docs, add that behaviour to the fake,
   note it in [api-verification.md](api-verification.md), and mention the live-validation issue.

The engine tests show the useful seams: `executePlan({ interruptAfter })` stops abruptly after _n_ new
successes, as if the process died; `afterWrite` runs after the destination write and before the checkpoint
is saved, which is where "crash after the write" is simulated; `assumeNotCreated` is the operator
override. See `packages/core/test/executor.test.ts`.

## What must never be mocked away

Tests that replace these with a stub can pass while the product is unsafe:

- **The write guard.** Connectors must get their `fetch` from `createConnectorContext(definition, access,
{ transport: fake.fetch, ... })`, which wraps the transport in `createGuardedFetch`. Never pass a fake's
  raw `fetch` to a connector. Create sources and the planning/verifying destination with `'read-only'`
  and only the applying destination with `'read-write'`, as the CLI does. Assert on the `RequestRecorder`
  (`writes`, `blocked`). Extraction, planning, validation and verification each have a "zero writes" test
  (for example in `packages/connector-notion/test/extract.test.ts` and
  `packages/connector-clickup/test/reliability.test.ts`); cover any new read-only path the same way.
- **Approval.** A run starts only through `approveAndCreateRun`, which checks plan integrity, blocking
  findings and that the approved id equals the plan id. Do not insert runs or checkpoints by hand to
  save a few lines, and do not skip `verifyPlanIntegrity`. CLI tests must go through `--approve` or the
  typed prompt.
- **Verification.** A run is `verified` only through `verifyRun`. Do not set the status yourself.
- **The state store.** Use the real `SqliteStateStore` (in memory); the id map and the checkpoint
  transaction are part of what is being tested.
- **Redaction and plan validation.** Do not stub `redact*`, `registerSecret` or the Zod schemas to get a
  fixture through; fix the fixture.
- **The network block in spawned tests.** `block-network.cjs` is what makes "the demo needs no network"
  a tested claim; do not remove it from those tests.

## Coverage

`pnpm test:coverage` uses V8 coverage and fails if a total drops below the floor in `vitest.config.ts`:
**86 % statements, 74 % branches, 87 % functions, 87 % lines.** The floor sits just under what is
measured, to stop quiet regressions without failing on noise. Raise it as coverage improves; never lower it
to make a build pass.

What counts: `packages/*/src`, `apps/cli/src`, `apps/web/src` and the example connector. What does not: the
`testing/` fakes and fixtures, type-only files, `packages/*/src/index.ts`, `apps/cli/src/bin.ts` and
`apps/web/src/main.tsx`. Tests in spawned child processes do not contribute, so the CLI's own figure
understates how well it is tested. Treat the number as a smoke alarm: a new feature with no test is the
failure to avoid, and a test that executes code without asserting anything raises coverage while proving
nothing. The report is written to `coverage/` (git-ignored).

## The browser tests

`pnpm test:e2e` runs `e2e/dashboard.spec.ts` in Chromium only. Before any test runs, `e2e/global-setup.ts`
checks that `apps/cli/dist/bin.js`, `packages/core/dist/index.js` and `apps/web/dist/index.html` exist
(otherwise it names the command to run), then starts four `exitos ui` servers with the real built CLI in
temporary directories and a scrubbed environment (no tokens): the demo run, a plan whose text fields carry
hostile payloads, a run that is still `applying`, and an empty directory. The tests read the same JSON the
dashboard reads and compare it with what is on screen. The config fixes the time zone to UTC, the locale to
`en-US` and reduced motion on.

Useful options: `pnpm exec playwright test -g "<title>"` runs matching tests, `--headed` shows the
browser, `--ui` opens Playwright's interactive mode, `--debug` opens the inspector. On failure a trace is
kept in `test-results/` (git-ignored).

`pnpm docs:screenshots` is a separate, opt-in Playwright project that rewrites the images in `docs/assets`.

## The opt-in scale test

`packages/connector-clickup/test/scale.test.ts` is skipped unless `EXITOS_SCALE=1`. It runs plan, approve,
apply and verify on `EXITOS_SCALE_ROWS` rows (default 5 000) against the fakes and prints one `SCALE {...}`
line with timings and peak memory:

```bash
EXITOS_SCALE=1 EXITOS_SCALE_ROWS=20000 pnpm exec vitest run packages/connector-clickup/test/scale.test.ts --reporter=verbose
```

```powershell
$env:EXITOS_SCALE = "1"; $env:EXITOS_SCALE_ROWS = "20000"
pnpm exec vitest run packages/connector-clickup/test/scale.test.ts --reporter=verbose
```

(The PowerShell form is untested.) The numbers show ExitOS's own cost with no network latency and the fakes
in the same process; a real migration is paced by the destination's rate limit. See
[enterprise-readiness.md](enterprise-readiness.md#scale-and-sizing) for how to read them.

## Checklist for a change

- [ ] New behaviour has a test; a bug fix has a test that failed before the fix.
- [ ] The test is at the lowest layer that can show it, uses synthetic data and `VirtualClock`.
- [ ] Nothing in the write guard, approval or verification path was stubbed.
- [ ] `pnpm check` passes; `pnpm test:e2e` passes if you touched `apps/web` or the dashboard server.
- [ ] The PR says what kind of evidence it has (fake, loopback, hand-run), and does not claim live validation.
