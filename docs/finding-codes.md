# Finding codes

Every observation about fidelity is a **finding** with a stable `code`, an **outcome**, a
**severity** and a human message. This page is the reference for the codes ExitOS 0.1 can emit.
A unit test (`apps/cli/test/docs.test.ts`) fails if a code exists in the source but not here.

**Outcomes**

| Outcome       | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `supported`   | arrives intact (used for advisory warnings that are not about loss) |
| `transformed` | arrives in a different representation; the information is preserved |
| `lossy`       | arrives, but some information is lost                               |
| `unsupported` | cannot be migrated; reported, never silently dropped                |
| `skipped`     | intentionally not migrated (already present, excluded, disabled)    |
| `failed`      | attempted and failed (apply time)                                   |

**Severities:** `info` (FYI) · `warning` (read before approving) · `error` (**blocks `apply`**).

## Reading Notion (source)

| Code                                 | Outcome     | Severity        | Meaning / what to do                                                                                                                                                            |
| ------------------------------------ | ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOURCE_NOT_ACCESSIBLE`              | unsupported | error           | A configured data source/database was not found or is not shared with your integration. In Notion: ••• → Connections → add the integration.                                     |
| `SOURCE_DATABASE_HAS_NO_DATA_SOURCE` | unsupported | error           | The database exposes no data source to this integration.                                                                                                                        |
| `SOURCE_PAGE_NOT_ACCESSIBLE`         | unsupported | error / warning | A configured page (error) or a nested page (warning) is not shared with the integration.                                                                                        |
| `SOURCE_ROWS_INCOMPLETE`             | unsupported | error           | Not every row could be read (Notion's 10 000-row query cap could not be worked around, or `limits.maxRecordsPerDataSource` was hit). Raise the limit or narrow the data source. |
| `SOURCE_NON_PAGE_RESULTS_SKIPPED`    | skipped     | info            | Non-page query results (e.g. wiki data sources) were skipped.                                                                                                                   |
| `SOURCE_FIELD_UNREADABLE`            | unsupported | warning         | A property type (button, verification, place, or a type Notion adds later) has no portable representation, so its values are not read.                                          |
| `PROPERTY_VALUE_MALFORMED`           | unsupported | warning         | A single value had an unexpected shape and was not read. The row is still migrated.                                                                                             |
| `RELATION_TRUNCATED`                 | lossy       | warning         | Notion returned only part of a relation and the rest could not be fetched.                                                                                                      |
| `USER_INFO_UNAVAILABLE`              | lossy       | info            | The integration cannot read user names/e-mails (missing the "Read user information" capability). People can only be mapped by Notion user id.                                   |
| `PAGE_BODY_INACCESSIBLE`             | unsupported | warning         | A page's content could not be read (not shared, or missing the _read content_ capability). The row is still migrated without a body.                                            |
| `PAGE_BLOCK_BUDGET`                  | lossy       | warning         | The page has more blocks than `limits.maxBlocksPerPage`; the rest was not read.                                                                                                 |
| `BLOCK_DEPTH_LIMIT`                  | lossy       | warning         | Content nested deeper than `limits.maxBlockDepth` was not read.                                                                                                                 |
| `BLOCK_CHILDREN_INACCESSIBLE`        | unsupported | warning         | Nested content under a block is not shared with the integration.                                                                                                                |
| `PAGE_LIMIT_REACHED`                 | lossy       | warning         | Page crawl stopped at `limits.maxPages`.                                                                                                                                        |
| `PAGE_ICON_NOT_MIGRATED`             | unsupported | info            | Page icons are not migrated.                                                                                                                                                    |
| `PAGE_COVER_NOT_MIGRATED`            | unsupported | info            | Page covers are not migrated.                                                                                                                                                   |

## Mapping fields (Notion → ClickUp)

| Code                                            | Outcome     | Severity | Meaning / what to do                                                                                                                                          |
| ----------------------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATUS_VALUE_UNMAPPED`                         | lossy       | warning  | A status value has no matching ClickUp status. The task gets the list's default status and keeps the original value in its description. Add it to `valueMap`. |
| `PRIORITY_VALUE_UNMAPPED`                       | lossy       | warning  | A value has no ClickUp priority (urgent/high/normal/low).                                                                                                     |
| `OPTION_VALUE_UNMAPPED`                         | lossy       | warning  | An option is not in the ClickUp dropdown/labels field (ExitOS cannot add options). Kept as text.                                                              |
| `TAG_NOT_IN_SPACE`                              | lossy       | warning  | The tag does not exist in the ClickUp Space, so it was not applied (ExitOS never creates tags). Kept as text.                                                 |
| `CUSTOM_FIELD_VALUE_INVALID`                    | lossy       | warning  | A value is not valid for the typed ClickUp field (e.g. a phone number without a country code). Kept as text.                                                  |
| `USER_UNMAPPED`                                 | lossy       | warning  | A person has no entry in `users.map`, so they are **not assigned**. Their name is kept as text.                                                               |
| `ASSIGNEES_WILL_BE_NOTIFIED`                    | supported   | warning  | ClickUp notifies assignees of API-created tasks. The count is shown so nobody is surprised.                                                                   |
| `FIELD_PRESERVED_AS_TEXT`                       | transformed | info     | No ClickUp field is mapped; the value is kept as text in the description.                                                                                     |
| `FIELD_SNAPSHOT_ONLY`                           | lossy       | warning  | Formula/rollup: only the last computed value is kept, as static text.                                                                                         |
| `METADATA_AS_TEXT`                              | lossy       | warning  | Created/edited time and author cannot be set in ClickUp; kept as text.                                                                                        |
| `FIELD_DROPPED`                                 | unsupported | warning  | `unmappedFields: skip` and no ClickUp field is mapped, so the value is not migrated.                                                                          |
| `FIELD_EXPLICITLY_SKIPPED`                      | skipped     | info     | You set `to: skip` for the property.                                                                                                                          |
| `RELATION_AS_LINK`                              | transformed | info     | A relation becomes a ClickUp linked task (symmetric; direction not kept).                                                                                     |
| `RELATION_AS_TEXT`                              | transformed | info     | `relations: skip`; related titles are kept as text.                                                                                                           |
| `RELATION_TARGET_OUT_OF_SCOPE`                  | unsupported | warning  | A related item is not part of this migration, so no link is possible. Its identifier is kept as text.                                                         |
| `NAME_NORMALIZED`                               | transformed | info     | Line breaks in a title were replaced by spaces (task names are one line).                                                                                     |
| `DATE_TIMEZONE_NAME_NOT_PRESERVED`              | transformed | info     | ClickUp stores UTC instants; the zone _name_ is not kept (the moment in time is).                                                                             |
| `DATE_ASSUMED_TIMEZONE`                         | transformed | info     | A date-time without a zone was interpreted in `options.timezone`.                                                                                             |
| `DATE_UNPARSEABLE`                              | unsupported | warning  | A date was not valid ISO 8601 and was not set. Kept as text.                                                                                                  |
| `DATE_RANGE_START_LOST` / `DATE_RANGE_END_LOST` | lossy       | warning  | Another property already provides the start/due date, so one end of the range was dropped.                                                                    |

## Rendering page content (Notion blocks → Markdown)

| Code                                                 | Outcome     | Meaning                                                                                                                                              |
| ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCK_UNSUPPORTED`                                  | unsupported | A block type (AI blocks, meeting notes, templates, anything new) cannot be migrated; a visible placeholder is left unless `unsupportedBlocks: omit`. |
| `BLOCK_CHILD_DATABASE_NOT_INLINED`                   | unsupported | An inline database inside a page is not migrated there; select it as its own data source.                                                            |
| `BLOCK_SYNCED_UNAVAILABLE`                           | unsupported | A synced block's original is not accessible.                                                                                                         |
| `BLOCK_EMBED_NO_URL`                                 | unsupported | An embed/bookmark without a usable URL.                                                                                                              |
| `ATTACHMENT_HOSTED_NOT_MIGRATED`                     | unsupported | Notion-hosted files are not downloaded or re-uploaded ([ADR 0009](decisions/0009-attachments-not-transferred.md)).                                   |
| `ATTACHMENT_URL_REJECTED`                            | unsupported | A file URL that is not plain http(s) was rejected.                                                                                                   |
| `BLOCK_AUTO_GENERATED_OMITTED`                       | lossy       | Table of contents / breadcrumb omitted (ClickUp builds its own outline).                                                                             |
| `BLOCK_CALLOUT_AS_QUOTE`                             | lossy       | Callouts become block quotes.                                                                                                                        |
| `BLOCK_COLUMNS_FLATTENED`                            | lossy       | Column layout is lost; columns are written one after another.                                                                                        |
| `BLOCK_EQUATION_AS_CODE` / `INLINE_EQUATION_AS_CODE` | lossy       | Equations are written as LaTeX source in code.                                                                                                       |
| `BLOCK_HEADING_LEVEL_FLATTENED`                      | lossy       | Heading level 4 written as level 3.                                                                                                                  |
| `BLOCK_SYNCED_COPIED`                                | lossy       | Synced blocks become ordinary copies.                                                                                                                |
| `BLOCK_TODO_AS_TEXT`                                 | lossy       | To-do items become `- [ ]` text; ClickUp Docs has no interactive checklist.                                                                          |
| `BLOCK_TOGGLE_FLATTENED`                             | lossy       | Toggles become a bold title with always-visible content.                                                                                             |
| `BLOCK_NESTING_FLATTENED`                            | lossy       | Indented children of a paragraph/heading are written at the same level.                                                                              |
| `FORMAT_UNDERLINE_DROPPED` / `FORMAT_COLOR_DROPPED`  | lossy       | Underline and text/background colours are not supported by ClickUp.                                                                                  |
| `BLOCK_CHILD_PAGE_AS_LINK`                           | transformed | A nested page becomes a link back to the original.                                                                                                   |
| `BLOCK_CODE_FORMATTING`                              | transformed | Code arrives as fenced code; highlighting is not kept.                                                                                               |
| `BLOCK_TABLE_FORMATTING`                             | transformed | Tables arrive as plain Markdown tables.                                                                                                              |
| `BLOCK_EMBED_AS_LINK`                                | transformed | Bookmarks/embeds/link previews become links.                                                                                                         |
| `ATTACHMENT_EXTERNAL_AS_LINK`                        | transformed | Externally hosted files stay as links; nothing is copied.                                                                                            |
| `MENTION_USER_AS_TEXT`                               | transformed | User mentions become plain text.                                                                                                                     |

## Destination checks

| Code                                              | Outcome     | Severity | Meaning / what to do                                                                                             |
| ------------------------------------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `DEST_WORKSPACE_NOT_FOUND`                        | unsupported | error    | The workspace id is not available to this token.                                                                 |
| `DEST_LIST_NOT_FOUND` / `DEST_LIST_FORBIDDEN`     | unsupported | error    | The list id does not exist / this token may not access it.                                                       |
| `CONFIG_SOURCE_NOT_SELECTED`                      | unsupported | error    | `destination.lists[].source` names a data source that was not read.                                              |
| `COLLECTION_NOT_MAPPED`                           | skipped     | warning  | A data source has no entry in `destination.lists`, so none of its rows are migrated.                             |
| `DEST_NAME_COLLISION` / `DEST_DOC_NAME_COLLISION` | supported   | warning  | Planned items share a name with unrelated existing ones. ExitOS never overwrites; duplicates by name will exist. |
| `ALREADY_PRESENT`                                 | skipped     | info     | Items already exist (found via their provenance marker) and will be skipped, not duplicated.                     |
| `LIST_SCAN_INCOMPLETE`                            | lossy       | warning  | Existing tasks could not be read completely, so earlier migrations may not have been detected.                   |
| `PROVENANCE_DISABLED`                             | supported   | warning  | `options.provenance: none`: reconciliation of interrupted writes is weaker.                                      |
| `DOCS_EXPERIMENTAL_DISABLED`                      | skipped     | warning  | Pages were read but Docs migration is experimental and off. Set `options.experimental.docs: true`.               |
| `DOC_PARENT_MISSING`                              | lossy       | warning  | A sub-page's parent was not migrated; it becomes a top-level Doc.                                                |

## Configuration problems (all `error`, all block `apply`)

| Code                           | Meaning                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| `MAPPING_UNKNOWN_FIELD`        | A mapped property does not exist in the data source.                  |
| `MAPPING_INCOMPATIBLE`         | The property type cannot be mapped to that target.                    |
| `MAPPING_TARGET_CONFLICT`      | Two properties map to the same single-valued target.                  |
| `MAPPING_STATUS_UNKNOWN`       | `valueMap` points at a status that does not exist on the list.        |
| `MAPPING_PRIORITY_UNKNOWN`     | `valueMap` points at an invalid priority.                             |
| `MAPPING_CUSTOM_FIELD_UNKNOWN` | The custom field does not exist (ClickUp's API cannot create fields). |
| `MAPPING_CUSTOM_FIELD_TYPE`    | The custom field type cannot hold that property type.                 |
| `USER_MAP_UNKNOWN_TARGET`      | `users.map` points at a ClickUp user who is not a Workspace member.   |

## Run codes (recorded on checkpoints, not findings)

| Code                                   | Meaning                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ACTION_FAILED` / `HTTP_<status>`      | The destination rejected the item; it was not created.                                                    |
| `ACTION_BLOCKED` / `DEPENDENCY_FAILED` | Not attempted because a prerequisite item failed.                                                         |
| `INTERRUPTED`                          | The process stopped while the write was in flight; resolved by reconciliation on resume.                  |
| `ABORTED`                              | The operator pressed Ctrl-C during a write.                                                               |
| `DUPLICATE_DETECTED`                   | The source was already mapped to a _different_ destination item; the run stopped rather than create more. |
