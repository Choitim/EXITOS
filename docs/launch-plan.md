# Launch plan

> Nothing here has been executed. **No repository has been made public, nothing has been published,
> and no post has been sent.** These are drafts for the maintainer to review, edit and send
> themselves. Do not automate stars, fake users, mass unsolicited messages, or fabricate adoption.

## Preconditions (do not launch before these)

See the checklist in the final section. The honest minimum: the repository is public with working CI,
the README's claims are all true, the live-validation status is stated plainly, and at least one
person other than the author has run the live sandbox guide.

## Positioning (what we can truthfully say)

- **One sentence:** ExitOS shows you exactly what survives a migration — before you write anything — and
  proves it afterwards. v0.1 does Notion → ClickUp.
- **Why it exists:** vendor importers are black boxes: no preview, no per-run list of what was lost, no
  resume. ([competitive landscape](competitive-landscape.md))
- **What it is not (yet):** a universal migration engine; a replacement for ClickUp's free importer
  when that is good enough; live-validated.

## GitHub repository

**Description (≤ 350 chars):**

> See what survives before you switch apps. Open-source, local-first migration with a read-only plan,
> explicit approval, resumable apply and a verification report listing everything that did NOT move.
> v0.1: Notion → ClickUp. Offline demo, no account needed.

**Topics:** `migration` `data-portability` `notion` `clickup` `cli` `typescript` `open-source`
`dry-run` `etl` `productivity` `data-migration` `local-first`

**Social preview image:** `docs/assets/dashboard-overview.png` (1280×640 crop).

**Settings to enable before going public:** private vulnerability reporting · Discussions · branch
protection on `main` (require CI) · Dependabot alerts · secret scanning + push protection.

## 30-second demo video — storyboard

Record with [VHS](https://github.com/charmbracelet/vhs) (`docs/demo.tape`) or asciinema; see
[demo-recording.md](demo-recording.md). Terminal 100×30, dark theme, font ≥ 18 px. All data is the
built-in synthetic workspace.

| Time      | On screen                                                                              | Voice-over / caption                                                                                            |
| --------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0:00–0:03 | Black screen → `$ pnpm exitos demo` typed                                              | "Switching apps is risky because you can't see what you'll lose."                                               |
| 0:03–0:08 | The OFFLINE DEMO banner; step 1 inspect                                                | "Here's a synthetic Notion workspace. No account. No network."                                                  |
| 0:08–0:15 | The plan screen: **MOVES / CHANGES / CANNOT MOVE** with real numbers                   | "Before anything is written: everything that moves, everything that changes, everything that can't." (hold 3 s) |
| 0:15–0:19 | Scroll the "cannot move" table; highlight _Notify team: button_ and _hosted files_     | "Nothing is silently dropped."                                                                                  |
| 0:19–0:24 | Apply: progress bar; the line "reply was lost — it WAS created (adopted, not re-sent)" | "It survives rate limits and lost replies — without duplicating."                                               |
| 0:24–0:28 | Verify: `175 verified · 0 mismatched · 0 missing` then **NOT PRESERVED** table         | "Then it proves the result — and still tells you what didn't make it."                                          |
| 0:28–0:30 | `exitos ui --demo` dashboard screenshot; repo URL                                      | "ExitOS. See what survives before you switch."                                                                  |

## Show HN — technical draft

**Title:** `Show HN: ExitOS – see what survives a migration before you switch apps (Notion→ClickUp)`

> I kept seeing the same failure mode with app-to-app migrations: you only find out what got lost
> after the import ran, and the vendor tool can't tell you. ExitOS is an open-source (Apache-2.0),
> local-first CLI that treats migration as plan → approve → apply → verify.
>
> What it does today (v0.1, Notion → ClickUp only):
>
> - `exitos demo` runs the whole cycle offline on synthetic data – no account, no network (I test that
>   by running the demo in a process where any socket/DNS/fetch call kills it).
> - `exitos plan` is read-only and produces a hash-sealed, inspectable plan: field mappings, and every
>   item that moves / changes shape / loses detail / can't move. You approve a specific plan id.
> - `apply` is checkpointed in SQLite. ClickUp has no idempotency keys, so each created task carries a
>   provenance marker; after a timeout or crash we look for the marker before ever re-sending, and
>   we stop and ask when we genuinely can't tell. I wrote down what is _not_ guaranteed
>   (docs/reliability.md) rather than claiming exactly-once.
> - `verify` compares the plan with what ClickUp actually returns; the run only reads as complete after
>   that passes, and the report always lists what wasn't preserved.
>
> Honest status: the connectors are tested against API-shaped fakes (in-process and over loopback
> HTTP), not against real workspaces yet – there's a sandbox guide, and validation reports are the most
> useful thing anyone could send me. ClickUp's own importer is free and may be good enough for many
> teams; this is for people who want a preview, typed field mapping, resumability and a loss report
> (docs/competitive-landscape.md has the unflattering comparison).
>
> Interesting engineering bits: the 10k-row Notion query cap workaround, endpoint-classified write
> guard (Notion reads use POST), a connector SDK with a conformance kit, and a Markdown renderer that
> classifies every Notion block as supported/transformed/lossy/unsupported.
>
> Repo: <URL>. Happy to answer anything, and to be told what I got wrong.

Be present for the first hours; answer with specifics; accept criticism; do not ask for upvotes.

## Reddit draft (adapt to each community's rules; read them first)

Candidate communities: r/Notion, r/ClickUp, r/opensource, r/SideProject, r/typescript, r/selfhosted
(only where self-promotion is allowed, with a clear disclosure that you are the author).

> **I built an open-source CLI that shows what a Notion → ClickUp migration will lose _before_ you
> do it** (disclosure: I'm the author)
>
> You can try it with no account: `pnpm exitos demo` (synthetic data, runs offline). It makes a
> read-only plan listing what moves as-is, what changes shape, what loses detail and what can't move
> (e.g. Notion-hosted files, formula logic, inline databases); you approve a plan id; it applies with
> resume/retry; then it verifies against ClickUp and prints what did _not_ survive.
>
> Limits up front: Notion → ClickUp only; tested against mocks, not yet against real workspaces (sandbox
> guide in the repo – I'd love validation reports); ClickUp's built-in importer is free and might be
> enough for you. Feedback on what you'd need from a migration preview is very welcome.

## X / LinkedIn

**X (thread opener):**

> Migrating tools shouldn't be a leap of faith.
> ExitOS (open source) shows what survives a Notion → ClickUp move _before_ anything is written, then
> proves the result. Try the offline demo – no account: <repo> 🧵

**LinkedIn:**

> Every team that has switched project tools has asked the same question: "what will we lose?" —
> usually answered after the import. I've open-sourced ExitOS, a local-first migration tool built around
> one idea: see everything that moves, changes and can't move _first_, approve a specific plan, then
> verify the result. v0.1 covers Notion → ClickUp, with an offline demo you can run in a minute.
> It's early and honest about its limits (mocked tests, live validation wanted). Repo and docs in the
> comments.

## Dev.to article outline — "Designing a migration tool that admits what it can't move"

1. The problem: importers that can't show their work.
2. Principles: read-only until approval, never delete/overwrite, report every loss, "verified" ≠ "applied".
3. Plans as artifacts: canonical JSON, hash, approval by id, why `apply` never re-reads the source.
4. Making loss a first-class type: supported / transformed / lossy / unsupported (+ example output).
5. Reliability without idempotency keys: write-ahead log, provenance markers, reconciliation, what
   isn't guaranteed.
6. Rate limits done once: a scheduler shared by every request, `Retry-After` and `X-RateLimit-Reset`.
7. Testing a connector without the service: in-process fakes, fault injection, proving zero network.
8. The honest part: what we haven't validated and how you can help.

## Early developer communities and migration use cases

- **Communities:** Notion and ClickUp consultant/partner groups; r/Notion, r/ClickUp, Hacker News,
  Lobsters (if invited), the TypeScript Discord, local "indie hackers"/open-source meetups. Prefer
  places where you already participate; never mass-message.
- **Use cases to ask about:** teams consolidating tools after a merger; agencies moving client
  workspaces; Notion roadmaps outgrowing the tool; compliance-driven moves needing an auditable record;
  freelancers who must hand over a workspace; people who want a backup-shaped export with a loss list.

## Contributor onboarding: good first issues

Create these as issues labelled `good first issue` (each small, with a pointer to the files):

1. **Add Notion block fixtures** for `heading_4`, `breadcrumb`, `template`, nested `column_list` →
   tests in `packages/connector-notion/test`.
2. **More time-zone/DST cases** in `packages/shared/test/time.test.ts` (half-hour zones, southern
   hemisphere transitions, year boundaries).
3. **Markdown escaping edge cases** (`escapeMarkdown`): setext headings, HTML entities, emoji ZWJ
   sequences → `packages/core/test/markdown.test.ts`.
4. **Dashboard accessibility pass**: screen-reader labels, focus order, contrast in dark mode.
5. **Translate finding messages** (extract message catalogue; start with German or Japanese).
6. **`exitos inspect clickup` polish**: show statuses and custom fields per list.
7. **CSV user-map import** (`users.mapFile`) with validation and tests.
8. **A second example connector** (e.g. CSV source) using the SDK.
9. **Docs**: a "migrating Notion rollups" explainer; a screencast script review.
10. **Live validation report** with the sandbox guide (the most valuable "first issue").

## Measurable signals (and how to read them honestly)

| Signal                 | How measured                                                                              | Notes                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Installation success   | issue reports + CI install job; (opt-in telemetry is **not** implemented and not planned) | Count `install` problems in issues; time-to-first-demo from user feedback. |
| Demo completion        | self-reported; CI smoke test stays green                                                  | No telemetry. Ask in README for feedback.                                  |
| Real migration success | live-validation issues with redacted reports                                              | The only metric that proves value; track success/fail and _why_.           |
| Issue activity         | issues opened/closed, time to first response                                              | Quality over volume.                                                       |
| Contributors           | unique authors of merged PRs; first-time contributors                                     |                                                                            |
| Organic stars          | GitHub stars                                                                              | A vanity signal; never buy, trade or solicit them.                         |

## Pre-launch checklist

- [ ] Repository created under the intended owner; description/topics set; **private vulnerability
      reporting enabled**; CI green on `main`
- [ ] `CODE_OF_CONDUCT.md` contact filled in; `SECURITY.md` channel works
- [ ] README claims verified one by one (support matrix, "not live-validated" notice, test counts are the real ones)
- [ ] `pnpm check` and `pnpm test:e2e` pass on a clean clone; demo works in < 1 minute
- [ ] At least one live validation run by someone else recorded in `docs/validation-log.md`
- [ ] Name decision made ([naming.md](naming.md)); trademark search done if using the name commercially
- [ ] LICENSE and NOTICE correct; no real data or tokens in history (`node scripts/check-secrets.mjs` and a
      history scan)
- [ ] Release notes reviewed ([release-notes-v0.1.0.md](release-notes-v0.1.0.md)); tag created only on approval
- [ ] You are available for the first 24 hours after posting
