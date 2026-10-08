# 0012 — Pin `Notion-Version` to 2026-03-11 and parse tolerantly

**Status:** accepted

## Context

`@notionhq/client@5.27.0` defaults to `2025-09-03`; the current documented version is `2026-03-11`
(renames `archived`→`in_trash`, `transcription`→`meeting_notes`, `after`→`position`). Only the first
two affect read paths.

## Decision

The connector sets `notionVersion: "2026-03-11"` explicitly (overridable via config) and its Zod
schemas accept **both** `archived`/`is_archived`/`in_trash` and both `transcription`/`meeting_notes`.
SDK retries are disabled (`retry: false`); retry/pacing is done once, in the shared scheduler that
wraps `fetch`.

## Consequences

We exercise the version Notion documents today while remaining readable if a user pins the older
one. The SDK's compile-time response types are not trusted — every response is Zod-parsed.
