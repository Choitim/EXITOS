# Good first contributions

Small, well-scoped ways to help, each checked against the current code. Pick one, say so on the issue (or
open one with the matching template) so two people do not do the same work, and ask questions early: a
half-finished draft PR with a question is welcome.

**Before you start**

1. Follow [development.md](development.md) up to `pnpm build`, then run `pnpm test` once so you know the
   suite is green before you change anything.
2. Read the file(s) named in the task and the test next to them. Copy the style of the existing tests.
3. Use synthetic data only. Never paste real workspace content, tokens or plan files into a fixture or an
   issue ([CONTRIBUTING.md](../CONTRIBUTING.md)).
4. When you are done run `pnpm check` and open a PR with the template.

None of these has an issue number yet. If you want one assigned, open an issue that links to the task here.

## 1. Test more Notion page-body blocks

- **Why it helps.** `packages/connector-notion/src/normalize-blocks.ts` turns Notion blocks into the
  normalized model. Callouts, code blocks, quotes, dividers, equations, to-dos, bookmarks and embeds are
  exercised by the demo but their normalized output is not asserted anywhere in
  `packages/connector-notion/test`, so a regression would only show up as a changed demo.
- **Files.** Add `packages/connector-notion/test/blocks.test.ts` (or a new `describe` in
  `extract.test.ts` next to "page bodies"). Fixtures come from the `block.*` builders in
  `packages/connector-notion/src/testing/builders.ts` and `connect`, `extractAll`, `roadmapFixture` in
  `packages/connector-notion/test/fixtures.ts`.
- **A starting point** (this passes today):

  ```ts
  import { describe, expect, it } from 'vitest';
  import { normalizeNotion } from '../src/index.js';
  import { block, uid } from '../src/testing/index.js';
  import { connect, extractAll, roadmapFixture } from './fixtures.js';

  const rowId = uid('row:1');

  async function bodyOf(blocks: ReturnType<typeof block.callout>[]) {
    const fixture = roadmapFixture(1);
    fixture.blocks[rowId] = blocks;
    return normalizeNotion(await extractAll(connect(fixture))).documents[0]!;
  }

  describe('simple page-body blocks', () => {
    it('keeps a callout icon and a code block language and caption', async () => {
      const doc = await bodyOf([
        block.callout(uid('c'), rowId, 'Heads up', '📌'),
        block.code(uid('k'), rowId, 'echo hi', 'shell', 'Run this'),
      ]);
      expect(doc.blocks[0]).toMatchObject({ kind: 'callout', icon: '📌' });
      expect(doc.blocks[1]).toMatchObject({ kind: 'code', language: 'shell', title: 'Run this' });
    });
  });
  ```

  Then add `quote`, `divider`, `equation` (`expression`), `todo` (`checked`), `bookmark`/`embed` (`url`),
  and a bookmark with a `javascript:` URL, which keeps no `url` (`validExternalUrl` accepts only
  `http:` and `https:` URLs).

- **Test command.** `pnpm exec vitest run packages/connector-notion/test/blocks.test.ts`
- **Done looks like.** At least six new tests, each asserting the block `kind` and the one field specific
  to it; they pass; `pnpm check` is green. No source file changed (if a test shows a bug, open a bug
  report instead).

## 2. Test malformed Notion property values for more types

- **Why it helps.** One odd value must never abort an extraction: `valueFromProperty` in
  `packages/connector-notion/src/normalize-properties.ts` turns a value with an unexpected shape into an
  `unsupported` value plus a `PROPERTY_VALUE_MALFORMED` finding. Only the `number` case is tested today
  ("turns a malformed value into an explicit finding instead of throwing").
- **Files.** `packages/connector-notion/test/properties.test.ts`, next to that test. It already has
  `everyTypeSnapshot(overrides)` and `valueOf(snapshot, fieldName)`. Pass a bad value as a row override,
  for example `{ Done: { id: 'cb', type: 'checkbox', checkbox: 'yes' } }`.
- **Cases that behave as described today.** A `checkbox` holding a string, a `select` holding a string
  instead of an object, a `multi_select` holding an object, a `url` holding a number, a `files` holding a
  string. Each should give `{ kind: 'unsupported' }` and a finding whose `field` is the property name.
  `it.each` keeps it short.
- **Test command.** `pnpm exec vitest run packages/connector-notion/test/properties.test.ts`
- **Done looks like.** One test per type above, all passing, the rest of the file untouched.

## 3. Extend the DST and time-zone checks

- **Why it helps.** Notion dates with a time but no offset are interpreted in a time zone, and wrong
  handling shifts a due date by an hour. `zonedLocalToEpochMs` once resolved gaps and overlaps backwards
  in every zone east of UTC; that was found in review, fixed, and is now pinned in
  `packages/shared/test/time.test.ts` (named cases for Berlin, London, Sydney, Lord Howe, Auckland, New
  York and Los Angeles, plus a brute-force comparison over every 2026 change in seven zones). Finding the
  next one of these is exactly the kind of contribution that matters.
- **Files.** `packages/shared/test/time.test.ts`; the code under test is `packages/shared/src/time.ts`.
- **What to add.** The brute-force test only knows seven zones and the year 2026. Extend it, or add named
  cases, for zones with unusual rules: `Pacific/Chatham` (+12:45 / +13:45, with DST), `America/St_Johns`
  (-03:30), `Africa/Casablanca` (clocks go back for Ramadan), `America/Havana`, `Asia/Kathmandu` (+05:45,
  no DST); for other years (2030, 2038, 2000); and for the year boundary with `epochToZonedDate` (for
  example `Pacific/Auckland` against `Pacific/Honolulu` at 2026-12-31T11:30:00Z).
- **How to get the expected values.** The policy is in the comment on `zonedLocalToEpochMs`: a local time
  inside a DST gap moves forward, a local time that happens twice resolves to the earlier instant. Work out
  each expected instant **independently of the function**, as the existing brute-force test does: search
  every instant with `Intl.DateTimeFormat` and take the one that matches the policy. Do not copy the
  function's own output into `expect`.
- **If a case disagrees with the policy**, you have found a bug. Open a _Bug report_ with the zone, the
  local time, the expected and actual instant. A fix with a failing test that now passes is even better.
- **Test command.** `pnpm exec vitest run packages/shared/test/time.test.ts`
- **Done looks like.** New cases for at least three of the zones above that pass, each with a comment
  saying where the expected value came from, and a bug report (or fix) for any that did not.

## 4. Extend the Markdown escaping tests

- **Why it helps.** `escapeMarkdown` in `packages/core/src/markdown/render.ts` is what stops page text
  from changing the structure of the Markdown written to ClickUp. Its tests cover the control characters
  and line-start `#`, `-` and `1.`; they do not cover line-start `+ ` and `1)`, a leading `>`, a literal
  backslash, or multi-code-point emoji.
- **Files.** `packages/core/test/markdown.test.ts`, in "inline formatting" next to the existing
  "escapes Markdown control characters" test (it uses the local `render` and `para` helpers).
- **Cases that behave as described today.** `escapeMarkdown('+ item')` gives `\+ item`, `'1) item'` gives
  `1\) item`, `'> quote'` gives `\> quote`, a literal backslash is doubled (`\already` becomes
  `\\already`), and a family emoji built with zero-width joiners (`👨‍👩‍👧‍👦`) comes back unchanged.
- **Cases to investigate, not to "fix".** At the time of writing `escapeMarkdown` returns `~~x~~`, a line
  `---`, a line `===` under text, and `&amp;` unchanged. Whether that matters depends on how the
  destination renders Markdown. Describe what you see in a _Bug report_ with an example; do not change
  `escapeMarkdown` in a first PR.
- **Test command.** `pnpm exec vitest run packages/core/test/markdown.test.ts`
- **Done looks like.** New tests for the "behaves today" cases, passing, plus a short bug report (or a
  note in the PR) for anything you think is a gap.

## 5. Make the example connector reject duplicate ids

- **Why it helps.** The example connector is the template people copy
  ([connector-sdk.md](connector-sdk.md)). Today a JSON file with two items of the same `id` is accepted by
  `extract()`, the conformance kit then reports "record keys are unique" as failed, and planning stops
  with `Duplicate action id act_...`. A copied template should fail early with a clear message.
- **Files.** `examples/example-connector/src/index.ts` (`JsonFileSource.extract`) and
  `examples/example-connector/test/example.test.ts`. Throw a `ConfigError` (already imported from
  `@exitos/shared`) that names the duplicated id.
- **Test command.** `pnpm exec vitest run examples/example-connector/test/example.test.ts`
- **Done looks like.** A new test next to "rejects a source file with a malformed item instead of
  guessing" that writes a file with a duplicate id and expects `extract()` to reject with a message
  containing the id; the old tests still pass; `pnpm check` is green.

## 6. Keyboard and screen-reader pass on the dashboard

- **Why it helps.** The dashboard already has a skip link, landmarks, labelled filters and live regions,
  and `e2e/dashboard.spec.ts` checks the skip link, the navigation, focus visibility, narrow screens and
  colour schemes. It does not tab through the filters and toggles inside the sections or check what a
  screen reader announces, and a person using one is the best judge.
- **How.** `pnpm build`, `pnpm exitos demo`, `pnpm exitos ui --demo`, then open
  <http://127.0.0.1:4173>. Use only the keyboard, then a screen reader (VoiceOver on macOS, NVDA on
  Windows, Orca on Linux). For **one section** (for example "Mapping preview" or "Unsupported content")
  note: the tab order, whether every control has an accessible name, whether focus is always visible,
  whether the result count is announced when you filter, and whether tables are navigable.
- **Files.** Findings go in an issue (use the _Feature request_ template). Fixes live in
  `apps/web/src/sections/` and `apps/web/src/components/`; a regression test would go in
  `e2e/dashboard.spec.ts`.
- **Test command.** `pnpm build && pnpm test:e2e` (needs
  `pnpm exec playwright install chromium` once; see [testing.md](testing.md#the-browser-tests)).
- **Done looks like.** An issue listing what you checked and what you found (an honest "nothing wrong
  here, this is what I tested" is useful), and for any fix a Playwright assertion that fails without it.

## 7. Check the documented flags against `--help`

- **Why it helps.** `apps/cli/test/docs.test.ts` verifies that every `exitos <command>` named in the
  README and guides is a real command, but not that the _flags_ are. Documentation drifts here first.
- **Files.** `README.md`, `docs/live-sandbox-testing.md`, `docs/reliability.md`, `docs/demo-recording.md`,
  `docs/enterprise-readiness.md`. Compare each flag with `pnpm exitos <command> --help`. If you change
  `README.md`, change `README.ko.md` in the same way.
- **Test command.** `pnpm exec prettier --check <files you changed>` and
  `pnpm exec vitest run apps/cli/test/docs.test.ts`
- **Done looks like.** A PR that fixes every mismatch, or a comment on the issue saying you checked these
  files and found none. A follow-up that extends `docs.test.ts` to check flags is a good second step.

## 8. Try the setup guide on a clean machine and fix it

- **Why it helps.** [development.md](development.md) documents Windows PowerShell and several Linux set-ups
  that the maintainers have not tested. A person following it for the first time finds what we cannot.
- **How.** On a fresh WSL2, native Windows, or Linux machine, follow `development.md` from the top without
  skipping steps: install, `pnpm install`, `pnpm build`, `pnpm exitos demo`, `pnpm test`, and the
  dashboard loop. Write down every command that failed or was unclear, with your OS, Node and pnpm
  versions.
- **Files.** `docs/development.md`, and `docs/testing.md` if a test command differs.
- **Test command.** `pnpm exec prettier --check docs/development.md` and
  `pnpm exec vitest run apps/cli/test/docs.test.ts`
- **Done looks like.** A PR with the corrections and, in its description, the exact environment you
  tested, so the guide can say "tested on ..." for the first time.

## Not good first tasks (yet)

- **Translating finding messages.** The messages are English strings written inline where each finding is
  created, and there is no message catalogue to translate. If you want this, open a _Feature request_ to
  discuss a design before writing code. (The finding _codes_ are stable and documented in
  [finding-codes.md](finding-codes.md).)
- **A new connector.** It needs a proposal first and is a larger piece of work; see
  [connector-sdk.md](connector-sdk.md#add-a-new-platform-in-10-steps).
- **Live validation.** The most valuable contribution of all, but it needs your own Notion and ClickUp
  test workspaces and care with what you share: see [live-sandbox-testing.md](live-sandbox-testing.md) and
  the _Live validation result_ issue template.
