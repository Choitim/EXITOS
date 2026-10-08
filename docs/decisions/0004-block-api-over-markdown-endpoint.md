# 0004 — Read Notion through the block API, not the markdown endpoint

**Status:** accepted

## Context

Notion now offers `GET /v1/pages/{id}/markdown` ("enhanced markdown"). It would shorten the code
for page → Doc migration. But: it caps at ≈20,000 blocks, emits `<unknown>` for bookmarks, embeds
and link previews, and returns one opaque string — we could not say _which_ block was lost or
classify it as supported / transformed / lossy / unsupported.

## Decision

Traverse `GET /v1/blocks/{id}/children` recursively (paginated, bounded concurrency, depth limit) and
normalise to our own `DocumentBlock` tree. A destination-aware renderer then produces Markdown and a
per-block list of findings.

## Consequences

- More requests per page (one per block parent) — reflected in the plan's request estimate.
- Per-block loss reporting, which is the product's core promise.
- The markdown endpoint remains a candidate for a future "fast path" for pages with no unsupported
  content; it is documented in the roadmap.
