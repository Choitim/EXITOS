# 0011 — Unmappable field values are preserved visibly, not dropped

**Status:** accepted

## Context

ClickUp's API cannot create Custom Fields, so many Notion properties have no first-class
destination. Silently dropping them would violate "never silently discard unsupported content";
creating fields is impossible.

## Decision

Property values with no mapping are rendered into a "Properties from Notion" table appended to the
task description (`unmappedFields: "description"`, default). Each such field is classed
**transformed** (value preserved as text, type/behaviour lost) or **lossy** (e.g. formula/rollup:
a static snapshot). `unmappedFields: "skip"` drops them, and each dropped field is then an
**unsupported** finding.

## Consequences

Descriptions grow; users who prefer clean tasks choose `skip` and see the explicit loss list.
Nothing disappears without a record.
