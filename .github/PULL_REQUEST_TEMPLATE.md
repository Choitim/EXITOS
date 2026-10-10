## What and why

<!-- What does this change, and why? Link the issue: Fixes #123 -->

## How I checked it

<!-- Say what kind of evidence you have: unit test, fake API, ran by hand on my own test workspace. -->

- [ ] I added or updated tests (a bug fix has a test that failed before the fix; synthetic data only)
- [ ] `pnpm check` passes locally (format, lint, typecheck, test, build)
- [ ] I ran `pnpm test:e2e` if I touched `apps/web` or the dashboard server
- [ ] Docs are updated; for user-facing changes **both** `README.md` and `README.ko.md`, and `CHANGELOG.md`

## Safety

- [ ] No secrets, tokens, signed URLs, real workspace content or plan files in code, fixtures, logs or docs
- [ ] Safety properties are untouched: nothing writes to a source, nothing deletes or overwrites destination content, `apply` still needs approval of the exact plan, "verified" still only comes from verification
- [ ] Anything lossy or unsupported produces a finding, and new finding codes are in `docs/finding-codes.md`
- [ ] I do not claim live validation or support that does not exist

<!-- Connector PR? Also: the conformance kit passes, and docs/connector-sdk.md "Add a new platform in 10 steps" is followed. -->
