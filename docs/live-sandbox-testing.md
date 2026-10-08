# Live sandbox testing guide

> **Status of this project: no live validation has been performed by the maintainers.** ExitOS's
> Notion and ClickUp connectors are implemented against the _documented_ API contracts
> ([api-verification.md](api-verification.md)) and tested with API-shaped fakes — in-process and over
> real loopback HTTP. That proves the engine and our reading of the contracts. It does **not** prove
> that real workspaces migrate correctly. This guide is how you (or a contributor) find out.
> Record what you learn in [validation-log.md](validation-log.md).

Use **test workspaces that you own**. Do not point a first run at production data, a colleague's
workspace, or anything you cannot afford to clean up by hand. ExitOS never deletes anything — which
also means _you_ clean up the ClickUp tasks a test created.

## 0. What you need

|         |                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Notion  | A test workspace where you are a **Workspace Owner** (required to create an internal connection).                  |
| ClickUp | A test Workspace with a Space and (ideally) two Lists. A free plan is fine for ≤ 60 Custom Field uses (see below). |
| Tools   | Node ≥ 22.13, pnpm, this repo built (`pnpm install && pnpm build`).                                                |

## 1. Create a Notion connection with the _least_ permission

Follow Notion's official guide: <https://developers.notion.com/guides/get-started/internal-connections>.

1. Developer portal → **Internal connections** → _Create a new connection_ in your **test** workspace.
2. **Configuration** tab → copy the API token. Set capabilities to **Read content** only
   (ExitOS never writes to Notion). Add **Read user information** only if you want names/e-mails.
3. Share **only** the test data with it (database/page → ••• → Connections, or the _Content access_
   tab). Access is inherited by child pages. Anything not shared is invisible to ExitOS — by design.

Avoid a _personal access token_ here: it acts as you and inherits all your page permissions.

## 2. Create a ClickUp token

See <https://developer.clickup.com/docs/authentication> ("Personal token", starts with `pk_`). It acts
as you. Use a token that belongs to a test Workspace.

## 3. Configure credentials

```bash
cp .env.example .env && chmod 600 .env     # .env is gitignored
# edit .env: NOTION_TOKEN=…  CLICKUP_API_TOKEN=…
```

Or `export` them in your shell (real environment variables always win over `.env`).

## 4. Seed a small, representative Notion test set

Build something like this by hand (about 15 minutes):

- a database with **10–15 rows**: Name, Status (include a value that will _not_ match a ClickUp status),
  Priority, Due date (one date-only, one with a time and a time zone, one range), People, Tags,
  Number, URL, Checkbox, a Relation to another row, a Files property (one hosted upload, one external
  link), a Formula, a Rollup;
- one row whose **page body** contains: headings, nested bullets, a to-do list, a toggle, a callout,
  a code block, a table, an image, an equation;
- optionally a second database with **> 100 rows** to exercise pagination and rate-limit pacing;
- optionally a small page tree for the experimental Docs migration.

## 5. Create the destination side

In ClickUp create a Space and a List whose statuses _partly_ match your Notion statuses. Add Custom
Fields you want filled (number, dropdown, URL, checkbox). Note: ExitOS can only **fill existing**
Custom Fields; the API cannot create them. Free Forever workspaces have a limited number of Custom
Field "uses" ([docs](https://developer.clickup.com/docs/customfields)).

## 6. Discover ids

```bash
pnpm exitos inspect notion                 # lists data sources/pages shared with your connection
pnpm exitos inspect clickup                # lists Workspaces and Lists with their ids
```

Copy `migration.example.yaml` to `migration.yaml` and fill in the ids. Start small: one data source,
one list.

## 7. Plan (read-only) and read it

```bash
pnpm exitos inspect notion --config migration.yaml     # per-property portability
pnpm exitos plan notion clickup --config migration.yaml
```

Check the plan against your expectations: every "cannot move" / "loses detail" line should match what
you know about your test data. Look for surprises — a property you expected to map but didn't, a
status that fell back to the default. Fix with `valueMap`/`fields` in the config and re-plan. The plan
file contains your content; keep it private.

Confirm read-only behaviour yourself: the output ends with `Requests so far: N read · 0 write`.

## 8. Apply a _small_ run, then verify

```bash
pnpm exitos apply --plan migration-plan.json            # prompts: type the plan id to approve
pnpm exitos verify
pnpm exitos report --format markdown --out report.md
```

Now **open ClickUp and look**. `verify` compares API values, which is necessary but not sufficient.
Check by eye:

- [ ] Names, statuses, priorities, tags, custom-field values
- [ ] **Dates and time zones**: date-only values show the right calendar day; date-times show the right
      local time for you (ClickUp stores UTC)
- [ ] **Descriptions**: Markdown renders as expected — headings, lists, tables, code, links; the
      "Properties from Notion" table; the provenance footer
- [ ] Which people were **notified** (use a Workspace where that is harmless, or leave `users.map` empty)
- [ ] Linked tasks (relations) exist and point at the right tasks
- [ ] Nothing was changed in Notion

## 9. Break it on purpose

- **Interrupt:** start `apply`, press **Ctrl-C** after a few tasks. `exitos status`, then
  `exitos resume`. Count tasks in ClickUp: no duplicates, none missing.
- **Kill it:** `kill -9` the process mid-run, then `exitos resume` — this exercises reconciliation of
  a write that was in flight. Look in ClickUp for duplicates of the task that was being created.
- **Rate limits:** migrate the > 100-row database. Watch for `429` handling; confirm the total time is
  close to the plan's estimate.
- **Bad mapping:** point a `valueMap` at a non-existent status → the plan must refuse to apply.
- **Re-plan after a successful run:** every action should be `skipped (already present)`.
- **Lose the local state** (move `.exitos/` away) and re-plan: items are adopted via their marker, not
  duplicated.

## 10. Experimental Docs migration

Set `options.experimental.docs: true` and `destination.docs.parent`. Check that Docs and nested pages
exist, content renders, and that the plan listed every lossy construct (toggles, columns, callouts).

## 11. Report what you found

Run `exitos report --redact --format markdown` (titles, names and URLs become hashes) and attach it to
a GitHub issue using the _Live validation result_ template. Never attach plan files, `.env` or raw
reports — they contain your content or credentials. Please also record:

- your Notion plan and ClickUp plan (rate limits depend on them);
- anything the docs said that the API did not do, or the reverse.

## 12. Clean up

Delete the test tasks/Docs in ClickUp yourself. Revoke the Notion connection and rotate the ClickUp
token when you are done:

```bash
rm -rf .exitos migration-plan.json report.md .env
```
