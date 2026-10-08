# ExitOS product specification (v0.1)

> **See what survives before you switch apps.**

ExitOS is an open-source, local-first software portability and migration platform. It moves
supported content, structure and relationships from one product to another, and **explicitly lists
everything that cannot move**. v0.1 ships one end-to-end path: **Notion → ClickUp**.

## 1. Problem

Switching tools is risky mostly because users cannot see what will be lost until after the move.
Vendor importers are black boxes: no preview, no per-item loss report, no resume. ExitOS makes the
loss visible _before_ any write and proves the result _after_. See
[competitive-landscape.md](competitive-landscape.md) for an honest comparison.

## 2. Users and jobs-to-be-done

| User                                                      | Job                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Team lead moving a roadmap/tracker from Notion to ClickUp | "Tell me exactly what moves, what changes, what cannot move — then move it and prove it." |
| Consultant migrating several clients                      | "Repeatable, resumable, reviewable runs with a report I can hand to the client."          |
| Connector author / contributor                            | "A small, typed contract so I can add the next source or destination."                    |

## 3. Principles (non-negotiable)

1. **Read-only by default.** `inspect`, `plan`, `verify`, `report`, `ui` and `demo` never write to a real system.
2. **Never destroy.** v0.1 never deletes or modifies the source and never overwrites destination content.
3. **Never silently discard.** Every unsupported or lossy item is a recorded finding.
4. **Explicit approval.** `apply` requires the plan's ID (typed or via `--approve`).
5. **Verified or not complete.** A run is "verified" only after verification succeeds.
6. **Honest scope.** No "zero data loss" claim; reports state the declared supported scope.
7. **No secrets on disk.** Tokens come from the environment; plans, state and reports never contain them.

## 4. Scope of v0.1

### 4.1 Pipeline

`inspect → plan (dry run, read-only) → review → approve → apply (checkpointed) → verify → report`

### 4.2 Supported migration matrix

**Notion database rows (data source) → ClickUp tasks in a chosen List**

| Notion                                                                              | ClickUp                                                                                | Outcome                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Title                                                                               | Task name                                                                              | **supported**                                                                                                                                                                  |
| Page body (blocks)                                                                  | Task description (`markdown_content`)                                                  | **transformed** (see block table)                                                                                                                                              |
| `status` property                                                                   | Task status (by name or explicit `valueMap`)                                           | supported if the status exists; otherwise **lossy** (default status + original kept in description)                                                                            |
| `select` named as priority                                                          | Task priority 1–4 (explicit `valueMap` or auto by name)                                | **transformed**                                                                                                                                                                |
| `date` (single)                                                                     | `due_date` (or `start_date`)                                                           | **transformed** — ClickUp stores UTC instants; the Notion time-zone _name_ is not preserved; date-only values use ClickUp's 04:00-local convention in the configured time zone |
| `date` range                                                                        | `start_date` + `due_date`                                                              | **transformed**                                                                                                                                                                |
| `people`                                                                            | Assignees via explicit user map                                                        | **transformed**; unmapped people are not assigned and are listed                                                                                                               |
| `multi_select`                                                                      | ClickUp **tags that already exist** in the Space; or an existing `labels` Custom Field | **transformed**; missing tags are reported                                                                                                                                     |
| `number`, `checkbox`, `url`, `email`, `phone_number`, `rich_text`, `select`, `date` | An **existing**, type-compatible Custom Field when mapped                              | **supported** when mapped and compatible; otherwise preserved in the description table                                                                                         |
| `relation` (target also migrated)                                                   | Linked tasks (`POST /task/{id}/link/{id}`)                                             | **transformed** (ClickUp links are symmetric; direction lost)                                                                                                                  |
| `relation` (target outside scope)                                                   | —                                                                                      | **unsupported**; page title/ID kept as text                                                                                                                                    |
| `formula`, `rollup`                                                                 | Static snapshot of the last value in the description                                   | **lossy** (logic not preserved)                                                                                                                                                |
| `unique_id`                                                                         | Text in description                                                                    | **transformed**                                                                                                                                                                |
| `created_time`, `created_by`                                                        | Provenance footer text                                                                 | **lossy** (ClickUp cannot set creation metadata)                                                                                                                               |
| `last_edited_*`                                                                     | —                                                                                      | **unsupported** (reported once per collection)                                                                                                                                 |
| `files`                                                                             | External URLs kept as links                                                            | **unsupported** for Notion-hosted files (not downloaded)                                                                                                                       |
| `verification`, `button`, `place`, unknown future types                             | —                                                                                      | **unsupported**                                                                                                                                                                |

**Notion pages → ClickUp Docs (experimental, behind `experimental.docs: true`)**

| Notion block                                                                                                                         | Markdown in ClickUp                             | Outcome                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| paragraph, headings 1–3, bulleted/numbered lists (nested), quote, divider, code, table, bold/italic/strikethrough/inline code, links | Standard Markdown                               | **supported** (tables/code: **transformed** — ClickUp loses formatting) |
| heading 4                                                                                                                            | rendered as level 3                             | **lossy**                                                               |
| underline, text/background colour                                                                                                    | dropped                                         | **lossy** (not supported by ClickUp Docs)                               |
| to-do                                                                                                                                | `- [ ]` / `- [x]` text                          | **lossy** (ClickUp Docs has no checklists)                              |
| toggle                                                                                                                               | bold line + indented children                   | **lossy** (collapsing lost)                                             |
| callout                                                                                                                              | blockquote with icon                            | **lossy** (banner unsupported)                                          |
| equation                                                                                                                             | inline code with the LaTeX source               | **lossy**                                                               |
| column list / column                                                                                                                 | children flattened in order                     | **lossy** (layout lost)                                                 |
| synced block                                                                                                                         | copied content                                  | **lossy** (sync relationship lost)                                      |
| bookmark, embed, link preview, video/audio/pdf/file with external URL                                                                | link                                            | **transformed**                                                         |
| image (external URL)                                                                                                                 | image link                                      | **transformed**                                                         |
| Notion-hosted image/file/pdf/video/audio                                                                                             | visible placeholder                             | **unsupported**                                                         |
| child page                                                                                                                           | Doc sub-page                                    | **supported** (when accessible and selected)                            |
| child database                                                                                                                       | placeholder (migrate it as its own data source) | **unsupported** inline                                                  |
| table of contents, breadcrumb                                                                                                        | omitted                                         | **lossy**                                                               |
| template, meeting notes, unknown/`unsupported`                                                                                       | placeholder                                     | **unsupported**                                                         |

### 4.3 What does NOT migrate in v0.1

Attachment bytes · comments and discussions · page/database permissions and sharing · version
history · database views, filters, sorts, grouping · database templates and buttons · automations ·
page icons and covers · custom field _creation_ (ClickUp's API cannot create them) · task
dependencies/subtasks as such · time tracking · two-way sync · anything not explicitly listed
as supported. The plan prints this list for every run.

### 4.4 Non-goals

Hosted service, authentication/accounts, OAuth flows, deleting anything, ClickUp→Notion, scheduled
sync, AI features.

## 5. Safety model

```
inspect  ──►  plan  ──►  review  ──►  approve  ──►  apply  ──►  verify  ──►  report
(read)       (read)     (human)     (plan ID)    (writes to   (read)       (read)
                                                  destination
                                                  only)
```

- The source connector is constructed read-only in every command.
- `apply` needs `--plan <file>` and approval; it validates the plan hash and re-checks the
  destination (list exists, statuses exist, users exist) before the first write.
- Run state machine: `approved → applying → applied (unverified) | stopped | failed → verifying → verified | verification_failed`. Only `verified` is shown as complete.

## 6. CLI

```
exitos demo [--fast] [--interrupt-after <n>] [--state-dir <dir>] [--no-color] [--json]
exitos inspect notion|clickup [--config <file>] [--json]
exitos plan notion clickup --config <file> [--out <plan.json>] [--json]
exitos apply --plan <plan.json> [--approve <planId>] [--concurrency <n>] [--state-dir <dir>]
exitos status [--demo | --state-dir <dir>] [--json]
exitos resume [--run <id>] [--assume-not-created <actionId>]
exitos verify [--run <id>] [--json]
exitos report [--run <id>] [--format terminal|markdown|json] [--out <file>] [--redact]
exitos ui [--port <n>] [--demo | --state-dir <dir>]
```

Exit codes: `0` success · `1` unexpected error · `2` usage/config error · `3` run stopped/partial ·
`4` verification found mismatches/missing items · `5` approval missing/mismatched.

## 7. Success criteria

| #   | Criterion                               | How we check it                                                                                                               |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Value understood in 10 s                | README top section + `docs/assets/demo.svg` show "moves / changes / cannot move"                                              |
| 2   | Offline demo < 1 min from install       | `pnpm install && pnpm build && pnpm exitos demo`; CI smoke test with the network blocked                                      |
| 3   | Real Notion→ClickUp plan/execute        | Implemented; **mock-tested**, live-sandbox guide provided; live validation by the maintainers is _pending_ and stated as such |
| 4   | Inspect what transfers/transforms/fails | Plan file + terminal + dashboard                                                                                              |
| 5   | Pluggable connectors                    | `@exitos/core/sdk`, example connector, conformance kit                                                                        |
| 6   | Contributor-ready repo                  | CI, templates, CONTRIBUTING, ADRs, good-first-issues                                                                          |

## 8. Open questions (tracked in the roadmap)

- Should relations default to links, or to "report only"? (v0.1: links, shown in the plan.)
- Notion → ClickUp subtasks from "sub-item" relations.
- An opt-in, allow-listed attachment transfer.
