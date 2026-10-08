## What and why

<!-- What does this change, and why? Link the issue: Fixes #123 -->

## How I verified it

- [ ] `pnpm check` passes locally (format, lint, typecheck, test, build)
- [ ] I added or updated tests (synthetic fixtures only — no real workspace content or tokens)
- [ ] I ran `pnpm exitos demo` if I touched planning/apply/verify/reporting

<!-- Paste the relevant command output or describe the manual check. -->

## Safety checklist

- [ ] Nothing here can write to a **source** system
- [ ] Nothing here deletes, overwrites or updates existing **destination** content
- [ ] Unsupported or lossy cases produce a **finding** (and it is in `docs/finding-codes.md`)
- [ ] No secrets, tokens, signed URLs or private content in code, fixtures, logs or docs
- [ ] Claims in docs/README are true: I did not claim live validation or support that does not exist

## Docs

- [ ] `CHANGELOG.md` updated (user-visible change)
- [ ] Relevant docs / ADR updated
