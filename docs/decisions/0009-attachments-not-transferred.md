# 0009 — Attachment bytes are not transferred in v0.1

**Status:** accepted

## Context

Notion-hosted file URLs are temporary signed URLs (valid one hour). Downloading from them and
re-uploading to ClickUp means following URLs from untrusted content, handling large binaries, and
storing bearer-style URLs. The brief says not to follow arbitrary attachment URLs without explicit
validation and authorization.

## Decision

v0.1 records attachments as `AttachmentReference` (name, kind, expiry) **without storing signed
URLs**, never downloads them, and reports every one as **not preserved**:

- `external` URLs that pass validation (https, no credentials in URL) are kept as links in Markdown;
- Notion-hosted files get a visible placeholder and an `unsupported` finding.

## Consequences

Users see exactly which files stay behind. A future release can add an opt-in, allow-listed
downloader; it is on the roadmap with the security requirements written down.
