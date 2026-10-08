# Live validation log

This file records **real-world validation** of ExitOS against live Notion and ClickUp workspaces, run
by people following [live-sandbox-testing.md](live-sandbox-testing.md). It is the only evidence in this
repository that the connectors work against the real services.

## Current status

**No live validation has been recorded.** The maintainers have not run ExitOS against real Notion or
ClickUp workspaces. Everything in the automated test suite uses API-shaped fakes (see
[architecture.md](architecture.md#9-testing-strategy)).

## How to add an entry

Add one row per run. Do not include workspace names, URLs, ids, titles or tokens.

| Date       | ExitOS version | Notion plan | ClickUp plan | Rows / pages | What was migrated | Result | Deviations from the docs | Run by |
| ---------- | -------------- | ----------- | ------------ | ------------ | ----------------- | ------ | ------------------------ | ------ |
| _none yet_ |                |             |              |              |                   |        |                          |        |

## Checklist for calling a release "live-validated"

- [ ] ≥ 2 independent runs on different workspaces
- [ ] each of: tasks with all mapped field types, > 100 rows, relations → links, Ctrl-C resume, `kill -9` resume
- [ ] date/time-zone handling confirmed visually in ClickUp
- [ ] Docs migration confirmed (or left experimental)
- [ ] `docs/api-verification.md` "Not verified" items resolved or still marked
