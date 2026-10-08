# Architecture decision records

Short records of decisions that are costly to reverse or easy to misunderstand.
Format: context → decision → consequences. Add a new numbered file rather than rewriting history;
mark superseded records as such.

| #                                                        | Decision                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [0001](0001-monorepo-and-package-boundaries.md)          | Monorepo; where package boundaries are drawn                           |
| [0002](0002-typescript-6-toolchain-pin.md)               | Pin TypeScript 6.0 (typescript-eslint compatibility)                   |
| [0003](0003-node-sqlite-for-state.md)                    | Use built-in `node:sqlite` for local state                             |
| [0004](0004-block-api-over-markdown-endpoint.md)         | Read Notion via the block API, not the markdown endpoint               |
| [0005](0005-self-contained-plan-and-approval.md)         | Plans are self-contained, hashed, and approved by hash                 |
| [0006](0006-endpoint-classified-write-guard.md)          | Read-only mode is enforced by endpoint classification                  |
| [0007](0007-provenance-marker-and-reconciliation.md)     | Provenance marker + write-ahead log instead of "exactly once"          |
| [0008](0008-demo-runs-real-connectors-on-fakes.md)       | The offline demo runs the real connectors against in-process fake APIs |
| [0009](0009-attachments-not-transferred.md)              | Attachment bytes are not transferred in v0.1                           |
| [0010](0010-explicit-user-mapping.md)                    | User mapping is explicit; assignment is opt-in                         |
| [0011](0011-unmapped-fields-preserved-in-description.md) | Unmappable field values are preserved visibly, not dropped             |
| [0012](0012-notion-version-pin.md)                       | Pin `Notion-Version` to 2026-03-11 and parse tolerantly                |
| [0013](0013-proxy-support-via-undici.md)                 | Corporate proxy support through `undici`, from the standard env vars   |
