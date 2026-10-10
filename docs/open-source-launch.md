# Open-source launch plan

> **Nothing in this document has been executed.** No post has been sent, no package has been published,
> no release has been tagged, and no repository setting has been changed by this plan. The texts below
> are drafts for the maintainer to read, edit and send personally. Every number is traceable to a
> command or a document in this repository; the source is named next to it. This document replaces
> `launch-plan.md`, which now only points here.

## 1. What is true today (status as of 2026-10-09)

Say this plainly in every post. It is also the reason the launch is framed as "a pre-release looking for
people to test it", not "a finished product".

| Fact                           | State today                                                                                                                                                                                                                                                                                              | Where to check                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| What ExitOS is                 | An Apache-2.0, local-first CLI and library. v0.1 migrates Notion database rows to ClickUp tasks. Notion pages to ClickUp Docs is experimental. No other pair exists.                                                                                                                                     | [README](../README.md), [product spec](product-spec.md)                              |
| Live validation                | **None.** It has never been run against a real Notion or ClickUp workspace. Tests use API-shaped fakes, in process and over loopback HTTP.                                                                                                                                                               | [validation log](validation-log.md), [enterprise readiness](enterprise-readiness.md) |
| Release                        | **No tag, no GitHub release, no package published.** The GitHub API reports no releases and no tags.                                                                                                                                                                                                     | `gh api repos/Choitim/EXITOS/releases`                                               |
| Repository                     | Public at <https://github.com/Choitim/EXITOS>, Apache-2.0. On 2026-10-09 the API showed: a description set, no topics, Discussions off, Pages off, only GitHub's default labels, 0 forks. Five open pull requests, all from Dependabot.                                                                  | `gh api repos/Choitim/EXITOS`                                                        |
| Unpushed work                  | At the start of this work `git status` reported local `main` three commits ahead of `origin/main`, and more edits are in the working tree. What people see on GitHub is older than what this document describes.                                                                                         | `git status`, `git log origin/main..main`                                            |
| CI                             | The last runs on `origin/main` (2026-10-08, commit `694ecd0`) concluded `success`.                                                                                                                                                                                                                       | `gh api repos/Choitim/EXITOS/actions/runs`                                           |
| Tests                          | Run `pnpm check`, `pnpm test:coverage` and `pnpm test:e2e` and quote what they print; [enterprise readiness](enterprise-readiness.md) records the last full run. Do not quote numbers from memory.                                                                                                       | `pnpm check`                                                                         |
| Users, contributors, community | **None known.** One maintainer. No external contributors, customers, testimonials or adoption data exist. Stars and forks are not evidence of anything and are not cited.                                                                                                                                | `gh api repos/Choitim/EXITOS`                                                        |
| Static online demo             | **Built, not published.** The code, the build (`pnpm build:demo`) and a manual-only Pages workflow (`.github/workflows/pages.yml`) are in the repository; GitHub Pages is off and nothing has been deployed. Everything about a public link in this plan is conditional on the maintainer publishing it. | [online-demo.md](online-demo.md)                                                     |
| Placeholders                   | `CODE_OF_CONDUCT.md` and `SECURITY.md` contain contact placeholders that only the maintainer can fill. The issue-template `config.yml` links used `OWNER/REPO` placeholders. Check all three before announcing.                                                                                          | [development.md](development.md) (Maintainer notes)                                  |
| Name                           | "ExitOS" is a working title that has not been trademark-cleared.                                                                                                                                                                                                                                         | [naming.md](naming.md)                                                               |
| Comparison with alternatives   | ClickUp's own importer is free and may be all you need. ExitOS is weaker on breadth, validation, hosting, attachments and undo.                                                                                                                                                                          | [competitive landscape](competitive-landscape.md#where-exitos-is-weaker)             |

### Two gates, not one

**Gate A, "soft announcement" (allowed once the GitHub checklist in section 4 is done).** Posting is honest if every post says: pre-release, never run against live services, here is the offline demo, please send validation reports. This asks for testers; it does not claim a working product.

**Gate B, "v0.1.0 release" (tag and GitHub Release).** Only after live validation is recorded in the [validation log](validation-log.md) and meets that file's checklist (at least two independent runs on different workspaces, more than 100 rows, relations, Ctrl-C resume and `kill -9` resume, time zones checked in ClickUp). Until then the repository stays an untagged pre-release candidate. A run by the maintainer on test workspaces is the fastest way to move toward Gate B and should happen before any post goes to a large audience.

## 2. Positioning

**One sentence.** ExitOS shows you what would move, change shape or stay behind before anything is written to your new tool, then checks the result afterwards. v0.1 does Notion to ClickUp.

**Why it can be said.** The claims below are the ones the [evidence table](competitive-landscape.md#evidence-for-our-positioning) marks "Supported" or "Partly", with the "Partly" qualifiers kept. Do not paraphrase them into stronger ones.

**What it is not (yet).** A universal migration engine. A replacement for ClickUp's free importer when that is good enough. Live-validated. Able to move attachments, comments or permissions. Able to undo a migration.

### The flow: Inspect, Plan, Approve, Apply, Verify

Everywhere else (the README, the dashboard's stage tracker) the flow is these five stages. The offline demo
prints them as six steps, "Step 1/6" to "Step 6/6", because it ends by printing the report as well, and the
table below follows the demo. The numbers are from `node apps/cli/dist/bin.js demo --no-color`, run on 2026-10-09 against the built-in synthetic workspace (nothing real, no network).

| Step | Command                                      | Reads or writes           | What the demo shows (synthetic data)                                                                                                                                  |
| ---- | -------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `exitos inspect notion`                      | Reads the source          | "Product Roadmap · 28 rows · 19 properties", "Bug Tracker · 130 rows · 6 properties", one page tree of 5 pages                                                        |
| 2    | `exitos plan notion clickup --config ...`    | Reads only                | 175 planned actions: 3 move as-is, 115 change shape, 57 lose detail; 12 findings cannot move; "Requests so far: 84 read · 0 write · 0 blocked by the read-only guard" |
| 3    | `exitos apply --plan ... --approve <planId>` | Needs the exact plan id   | "This will create 175 item(s) in ClickUp"; without the id, apply refuses                                                                                              |
| 4    | (the same `apply`)                           | Writes to the destination | Checkpointed. The demo injects two 429 responses and one lost reply; "Duplicates 0"                                                                                   |
| 5    | `exitos verify`                              | Reads the destination     | "175 verified · 0 mismatched · 0 missing · 0 unverified", plus a printed scope that says what is NOT verified                                                         |
| 6    | `exitos report`                              | Reads state               | "206 finding(s) require review or are unsupported", listed under NOT PRESERVED                                                                                        |

Tell people the demo is synthetic and says nothing about their workspace; the demo output says so itself.

## 3. GitHub repository description and topics

**Description** (limit 350 characters; this one is 319):

> See what survives before you switch apps. Open-source (Apache-2.0), local-first CLI: a read-only migration plan, approval by plan id, resumable apply and a verification report that lists what was not preserved. v0.1 pre-release: Notion to ClickUp, tested against fakes, not yet live-validated. Offline demo, no account.

The description already on GitHub says "listing everything that did NOT move". Replace it: the report lists what ExitOS knows it did not preserve, not everything.

**Topics.** GitHub's rules: lowercase letters, numbers and hyphens; 50 characters or fewer each; at most 20 per repository ([GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics), read 2026-10-09). These 14 comply:

`migration` `data-migration` `data-portability` `notion` `clickup` `notion-to-clickup` `project-management` `cli` `typescript` `nodejs` `open-source` `local-first` `dry-run` `sqlite`

The maintainer can apply both with:

```bash
gh repo edit Choitim/EXITOS \
  --description "See what survives before you switch apps. Open-source (Apache-2.0), local-first CLI: a read-only migration plan, approval by plan id, resumable apply and a verification report that lists what was not preserved. v0.1 pre-release: Notion to ClickUp, tested against fakes, not yet live-validated. Offline demo, no account." \
  --add-topic migration,data-migration,data-portability,notion,clickup,notion-to-clickup,project-management,cli,typescript,nodejs,open-source,local-first,dry-run,sqlite
```

Add `--homepage <Pages URL>` once the static demo is live.

## 4. GitHub launch checklist

Everything here is a manual action for the repository owner (**Maintainer**). Contributors and CI can prepare files, but only an admin can change settings. Tick a box only after you have looked at the result in the GitHub UI. Menu names change; the paths below were checked against GitHub's documentation on 2026-10-09.

### Before changing any setting

- [ ] **Maintainer.** Review the local commits and working-tree changes (`git log origin/main..main`, `git status`), then push them yourself. This plan never pushes.
- [ ] **Maintainer.** Wait for CI on the pushed commit to finish green (jobs: "Check" on Ubuntu Node 22 and 24 and macOS Node 22, and "Dashboard browser test").
- [ ] **Maintainer.** Run `pnpm check` and `node scripts/check-secrets.mjs` on a clean clone, and scan the history for tokens before the new commits become public.
- [ ] **Maintainer.** Read every claim in `README.md` against the [evidence table](competitive-landscape.md#evidence-for-our-positioning). Remove or qualify anything marked "Partly" or "Unsupported".

### Security and community settings

- [ ] **Maintainer.** Private vulnerability reporting: _Settings → Advanced Security → Private vulnerability reporting → Enable_. Then open the _Security_ tab and confirm a "Report a vulnerability" button appears. `SECURITY.md` names this channel.
- [ ] **Maintainer.** Fill in the contact placeholders in `SECURITY.md` and `CODE_OF_CONDUCT.md` with an address you monitor, and delete the TODO notes. A Code of Conduct with no working contact cannot be enforced.
- [ ] **Maintainer.** Secret scanning and push protection: _Settings → Advanced Security_. Both are available on public repositories.
- [ ] **Maintainer.** Dependabot: version updates are already configured in `.github/dependabot.yml` (five update pull requests were open on 2026-10-09). Also turn on Dependabot alerts and security updates under _Settings → Advanced Security_. Review each pull request; some are major bumps (for example `actions/checkout` 4 to 7, `@types/node` 22 to 26) and must pass CI before merging.
- [ ] **Maintainer.** Branch protection (or a ruleset) on `main`: _Settings → Branches_. Require the CI status checks to pass (select them from the list after the first run), block force pushes and deletion. While there is a single maintainer, do not require approving reviews, or you cannot merge your own work; revisit when a second reviewer exists. `.github/CODEOWNERS` already lists the safety-critical paths.
- [ ] **Maintainer.** Fork pull-request workflows: _Settings → Actions → General_, require approval to run workflows from first-time contributors.
- [ ] **Maintainer.** Discussions: _Settings → General → Features → Discussions_ (or `gh repo edit Choitim/EXITOS --enable-discussions`). Suggested categories: Announcements, Q&A, Ideas, Show and tell, and "Validation reports" for people who run the sandbox guide. The issue chooser links to Discussions, so a disabled tab leaves a broken link.
- [ ] **Maintainer.** Optional: switch off the Wiki (_Settings → General → Features_). Documentation lives in `docs/`; a second place invites drift.

### Labels, issues and the repository card

- [ ] **Maintainer.** Labels: run the `gh label create ... --force` commands in [development.md](development.md) (Maintainer notes). They create the labels listed in `.github/labels.yml`. Confirm with `gh label list`.
- [ ] **Maintainer.** Open the labelled starter issues from [good-first-contributions.md](good-first-contributions.md) (that file says none has an issue yet), each labelled `good first issue` exactly as written, because GitHub uses that name to surface them.
- [ ] **Maintainer.** Description and topics: the `gh repo edit` command in section 3.
- [ ] **Maintainer.** Social preview image: _Settings → General → Social preview → Edit → Upload an image_ with `docs/assets/social-preview.png` (1280 x 640 pixels, 38 KB, PNG; GitHub asks for at least 640 x 320 and under 1 MB). GitHub offers no API for this; it is a manual upload.
- [ ] **Maintainer.** Pin the repository on your profile: your profile → _Customize your pins_.
- [ ] **Maintainer.** Verify the issue chooser: _Issues → New issue_ should show working links (no `OWNER/REPO` left in `.github/ISSUE_TEMPLATE/config.yml`).

### The static demo (the code exists; publishing it is a deliberate step)

- [ ] **Maintainer.** Run it locally first: `pnpm build && pnpm build:demo && pnpm preview:demo`, then walk the six steps yourself ([online-demo.md](online-demo.md)). Nothing publishes until you enable Pages and start the workflow.
- [ ] **Maintainer.** _Settings → Pages → Build and deployment → Source: GitHub Actions_, then _Actions → Pages → Run workflow_. Open the published URL in a private window and walk through the flow in section 9 yourself.
- [ ] **Maintainer.** Check that the static demo shows the "synthetic data, nothing real" notice and no external requests, then add the URL as the repository website: `gh repo edit Choitim/EXITOS --homepage <url>`.

### The release (Gate B)

- [ ] **Maintainer.** Do not create a tag or GitHub Release for v0.1.0 until the [validation log](validation-log.md) checklist is met. Release notes are drafted in [release-notes-v0.1.0.md](release-notes-v0.1.0.md); re-read them against the log on the day.
- [ ] **Maintainer.** Name decision made and trademark search done if the name will be used commercially ([naming.md](naming.md)).

### Before the first post (Gate A)

- [ ] **Maintainer.** Enable a live-validation intake: pin an issue or Discussion that links the `live_validation.yml` issue template and the [sandbox guide](live-sandbox-testing.md).
- [ ] **Maintainer.** Be free for the first 24 hours after posting. Answering promptly matters more than the wording of the post.

## 5. Show HN draft

**Read first.** Hacker News's [Show HN rules](https://news.ycombinator.com/showhn.html) (read 2026-10-09) say Show HN is "for something you've made that other people can play with", that it should be "easy for users to try your thing out, ideally without barriers such as signups or emails", that you should "be around to discuss" it, and "Please don't ask friends to upvote or comment." ExitOS's offline demo needs Node 22.13 or newer, pnpm and a build, so **post to HN once the static online demo is live**; otherwise the first reaction will be "I can't try it in one click".

**Title** (keep it within 80 characters, the limit of HN's title field; this one is 70):

```text
Show HN: ExitOS – preview what a Notion-to-ClickUp migration will lose
```

**URL:** `https://github.com/Choitim/EXITOS` (or the static demo, with the repository in the first comment).

**First comment** (post it yourself right after submitting):

> I'm the author. ExitOS is an Apache-2.0, local-first CLI that treats a migration as inspect, plan, approve, apply, verify, report. v0.1 handles one pair: Notion database rows to ClickUp tasks.
>
> Why: ClickUp's own Notion importer is free and documents what it does not import, but its docs describe no preview before you run it. I wanted a plan I could read first, with every item sorted into moves as-is, changes shape, loses detail, or cannot move.
>
> What exists today:
>
> - `exitos plan` is read-only. In the built-in synthetic demo it makes 84 read requests and 0 writes, and prints 175 actions: 3 move as-is, 115 change shape, 57 lose detail, 12 findings cannot move. A test spies on every request to check that no write is attempted.
> - `exitos apply` needs the id of the exact plan you reviewed. Plans are hash-sealed; an edited plan is refused.
> - Apply is checkpointed in SQLite. ClickUp documents no idempotency keys, so each task carries a provenance marker and, after a timeout or crash, ExitOS looks for the marker before re-sending. If it cannot tell, it stops and asks. I wrote down what is not guaranteed in docs/reliability.md instead of claiming exactly-once.
> - `exitos verify` reads the destination back and compares it with the plan within a declared scope (it says what it does not check: comments, attachments, views). A run only counts as complete after that passes.
> - There is a connector SDK with a conformance kit, but only two connectors exist.
>
> Honest status: it has never been run against a real Notion or ClickUp workspace. Everything is tested against API-shaped fakes, in process and over loopback HTTP, so the most useful thing anyone can send me is a redacted report from a throwaway workspace (docs/live-sandbox-testing.md). It does not move attachments, comments, permissions or views, and it has no undo. ClickUp's importer can be undone within 10 days; mine cannot. docs/competitive-landscape.md has the unflattering comparison with sources.
>
> Try it: `pnpm install && pnpm build && pnpm exitos demo` (synthetic data, no network, about a second). I'd like to hear what I got wrong.

Afterwards: stay in the thread for the first hours, answer with specifics and links to code or tests, accept criticism, correct mistakes openly, and do not ask anyone to upvote.

## 6. Reddit introduction draft

**Before posting anywhere.** Read each community's current rules and sidebar yourself. I could not check them (Reddit returned HTTP 403 to an automated request on 2026-10-09), so nothing below states what any subreddit allows. Many communities restrict self-promotion by ratio, by weekly thread, or by requiring a flair or moderator approval. If the rules say no, do not post. Disclose that you are the author in the title or first line. Post to one community at a time, days apart, and write each post for that audience instead of pasting the same text.

**Draft** (adapt the second paragraph per community):

> **I built an open-source CLI that previews what a Notion to ClickUp migration will lose before it writes anything (author here; pre-release, not yet tested on live workspaces)**
>
> Moving a Notion database into ClickUp usually means finding out what was lost after the import. ClickUp's own importer is free and its help page lists what does not import, but it describes no preview. ExitOS builds a read-only plan first: everything that moves as-is, changes shape, loses detail or cannot move. You approve that exact plan by its id, it applies with resume and retry, then it reads ClickUp back and reports what did not survive.
>
> You can see it work without any account: `pnpm install && pnpm build && pnpm exitos demo` runs on synthetic data, offline, in about a second. [Link to the static demo, once it exists.]
>
> Limits up front: Notion to ClickUp only; no attachments, comments, permissions or views; no undo; tested against fakes, never against a real workspace; ClickUp's importer might be all you need. If you can run the sandbox guide on a test workspace and tell me what broke, that is the most useful feedback I could get. Repo: https://github.com/Choitim/EXITOS

| Community                   | Angle for the second paragraph                                                                                                             | Check before posting                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| r/Notion, r/ClickUp         | The user's problem: "what will this move cost me?". Mention the ClickUp importer first and what ExitOS adds. Ask what they lost last time. | Self-promotion rules; whether tool posts need flair or approval. |
| r/opensource, r/SideProject | The project: Apache-2.0, local-first, no accounts, contributor docs. Say plainly that you are the only maintainer and want contributors.   | Rules on posting your own project; ratio rules.                  |
| r/typescript, r/node        | The engineering: strict TypeScript, Zod at trust boundaries, built-in `node:sqlite`, write-ahead checkpoints, the connector SDK.           | Whether project posts are allowed outside a weekly thread.       |
| r/selfhosted                | Local-first and no telemetry. Be clear it is a CLI, not a self-hosted service, so it may be off topic there.                               | Whether a CLI that is not a service is in scope at all.          |

## 7. X announcement (thread)

Six posts, each under 280 characters (links count as 23). Replace `<repo>` with the repository URL. Post from your own account; do not use any scheduling tool that pretends to be engagement.

```text
1/6 I built ExitOS: an open-source CLI that shows what a Notion to ClickUp migration will move, change or leave behind before anything is written. Pre-release, Apache-2.0, offline demo, no account. Never run on live workspaces yet; details below. <repo>
```

```text
2/6 The flow: inspect, plan, approve, apply, verify, report. The plan is read-only. Apply needs the id of the exact plan you reviewed. A run only counts as complete after a verify step passes.
```

```text
3/6 On the built-in synthetic workspace the plan lists 175 actions: 3 move as-is, 115 change shape, 57 lose detail, 12 cannot move. It made 84 read requests and 0 writes. Synthetic data; try it with: pnpm exitos demo
```

```text
4/6 Apply is checkpointed. The demo injects two 429s and one lost reply on purpose. ExitOS looks for its marker in ClickUp before re-sending, and ends with 0 duplicates and 175 verified, 0 mismatched, 0 missing.
```

```text
5/6 What it does not do: attachments, comments, permissions, views, undo. ClickUp's own importer is free and may be all you need. ExitOS is one pair, a CLI, and so far tested only against fakes.
```

```text
6/6 The most useful help right now: run the sandbox guide on a throwaway workspace and send a redacted validation report. Docs and an honest comparison with the alternatives are in the repo: <repo>
```

## 8. LinkedIn announcement

> I have open-sourced ExitOS, a small tool for a question every team asks before switching software: what will we lose?
>
> It is a command-line tool (Apache-2.0, runs on your own machine, no account). It reads your Notion database, builds a plan that you can read before anything is written, and sorts each item into moves as-is, changes shape, loses detail or cannot move. You approve that exact plan, it applies the migration with resume and retry, and then it reads ClickUp back and lists what did not survive.
>
> Where it stands: version 0.1, Notion to ClickUp only. It has been tested against simulated APIs, not yet against real workspaces, so I am treating it as a pre-release and looking for people willing to try it on a test workspace and tell me what breaks. It does not move attachments, comments or permissions. ClickUp's own importer is free and may be all you need; the repository has a sourced comparison.
>
> You can see it run before trusting it with anything: the repository has an offline demo on synthetic data (it needs Node 22.13 or newer and pnpm). Repo in the comments. I would value your feedback, especially if you have migrated a team between tools.
>
> (Disclosure: I am the author.)

## 9. Demo video storyboard (about 58 seconds)

**Purpose.** Show, in under a minute, what the tool actually does, using only data that is visibly synthetic. No voice-over claims beyond what the screen shows.

**Two sources of footage.**

1. **The static online demo** (once published; see section 4). Its flow is: select a sample Notion workspace, inspect the source, preview compatibility, view the migration mapping, simulate the migration, review the verification report. Before it exists, record the same screens from the local dashboard (`pnpm exitos ui --demo`), which has the matching views, and say so in the caption.
2. **The offline CLI demo**, `pnpm exitos demo`.

**Rules for the recording.** Terminal 100 x 30, dark theme, font at least 18 px (see [demo-recording.md](demo-recording.md) and [demo.tape](demo.tape)). Use `pnpm exitos demo --pace 700` for readable pauses. Keep the `[OFFLINE DEMO]` banner in frame. Never record a real workspace, token or plan file. Burn the numbers in as captions copied from the ledger below; do not retype them from memory, and re-run the demo before recording because a rebuilt CLI may print different counts. If the static demo shows different numbers from the CLI, use what each one shows, shot by shot.

| Time        | Shot                                | On screen                                                                                                                                          | Voice-over or caption                                                                                                      |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0:00 - 0:04 | Title card                          | ExitOS logo (`docs/assets/logo.svg`); "Pre-release. Synthetic data."                                                                               | "Before you move from Notion to ClickUp: what will move, and what will not?"                                               |
| 0:04 - 0:09 | 1. Select a sample Notion workspace | Static demo: choose "Acme Robotics (synthetic demo)"                                                                                               | "This is a sample workspace. Nothing here is real."                                                                        |
| 0:09 - 0:15 | 2. Inspect the source               | "Product Roadmap, 28 rows, 19 properties"; "Bug Tracker, 130 rows, 6 properties"; the Engineering Handbook page tree (5 pages)                     | "ExitOS reads the source. Read-only."                                                                                      |
| 0:15 - 0:22 | 3. Preview compatibility            | "3 move as-is, 115 change shape, 57 lose detail, 12 cannot move" (of 175 actions); highlight the Notion-hosted attachments finding                 | "Everything is sorted before anything is written. Files hosted by Notion are not transferred, and it says so."             |
| 0:22 - 0:28 | 4. View the migration mapping       | Field-mapping table: "Severity to priority: changes shape", "State to status: loses detail", "Notify team: not migrated"                           | "Each Notion property shows where it lands in ClickUp, and how faithfully."                                                |
| 0:28 - 0:35 | 5. Simulate the migration           | Progress; the line about a lost reply being found and not re-sent; "Duplicates 0"; caption "Simulated. In-process fake APIs. No network."          | "Approval is by plan id. The run survives rate limits and a lost reply without creating duplicates. This is a simulation." |
| 0:35 - 0:42 | 6. Review the verification report   | "175 verified, 0 mismatched, 0 missing, 0 unverified"; then the NOT PRESERVED table; the scope note that comments and attachments are not verified | "Then it reads the result back, within a stated scope, and still lists what did not make it."                              |
| 0:42 - 0:52 | CLI: the offline demo               | Type `pnpm exitos demo`; the banner; cut to "Requests so far: 84 read, 0 write"; cut to "175 verified"                                             | "The same run from the terminal. Offline, about a second."                                                                 |
| 0:52 - 0:58 | End card                            | Repository URL; "Pre-release. Tested on simulated APIs, not yet on live workspaces. Notion to ClickUp only. Feedback welcome."                     | (silence or the same text as a caption)                                                                                    |

Optional footnote on shot 5 or 7 (only if space allows): "Real runs are paced by ClickUp's rate limit. At 90 requests a minute the plan estimates 1.9 minutes for these 175 writes; 100,000 tasks take roughly 17 hours on a 100-per-minute plan."

### Number ledger (every figure on screen)

All figures come from `node apps/cli/dist/bin.js demo --no-color`, run on 2026-10-09 in an empty temporary directory (exit code 0, about 0.3 seconds). The test `apps/cli/test/spawn.test.ts` asserts the line "175 verified · 0 mismatched · 0 missing · 0 unverified", so a changed number would fail CI. Reproduce with `pnpm build` and then the command above.

| Figure                                     | Value in the demo run                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Source tables                              | Product Roadmap, 28 rows, 19 properties; Bug Tracker, 130 rows, 6 properties; 5 pages    |
| Planned actions                            | 175 (158 tasks, 11 task links, 1 Doc, 5 Doc pages)                                       |
| Moves as-is / changes shape / loses detail | 3 / 115 / 57 (of 175 actions)                                                            |
| Cannot move                                | 12 findings                                                                              |
| Plan-time requests                         | 84 read, 0 write, 0 blocked by the read-only guard                                       |
| Estimated writes                           | 175 requests, about 1.9 minutes at 90 per minute                                         |
| Assignments that would notify people       | 17                                                                                       |
| Injected trouble                           | two 429 responses and one lost reply; "Duplicates 0"                                     |
| Verification                               | 175 verified, 0 mismatched, 0 missing, 0 unverified                                      |
| Report                                     | 206 findings require review or are unsupported, listed under NOT PRESERVED               |
| Interrupt and resume (optional extra shot) | `demo --interrupt-after 40`, then `resume --demo` reached 175 of 175 and `verify` passed |

The 17 notifications and the two unmapped people are worth a caption if there is room: it shows that the plan warns about side effects as well as losses.

## 10. Contributor recruitment plan

**Where things stand.** There are no contributors other than the maintainer and no community. Nothing below describes people who exist; it describes how to invite them. Do not write "our community" anywhere until there is one.

**First goals (aims, not promises).** One live validation report from someone else. One merged pull request from someone else. One question answered in Discussions that was not asked by the maintainer. Measure these by looking at the repository, not by counting stars.

### Where to look

- **People who have the problem.** Teams and consultants who move Notion content into ClickUp. Reach them by being useful in public places where migration questions are already asked, on topic and with disclosure, when the community's rules allow it. Do not direct-message people who posted complaints (for example in ClickUp's feedback thread) and do not send unsolicited invitations.
- **The launch posts** in sections 5 to 8, which ask for validation reports and contributors by name.
- **Contributors who want a first issue.** GitHub surfaces issues labelled exactly `good first issue`. Directories of beginner-friendly projects also exist; I have not checked any directory's submission rules, so read them before submitting.
- **Readers of the code.** The TypeScript and Node communities for people interested in the engine (write-ahead checkpoints, reconciliation, the connector SDK). Same rule: read the community's rules first.

### What to offer

- [docs/good-first-contributions.md](good-first-contributions.md): eight small tasks, each checked against the current code. It says none has an issue number yet, so the maintainer should open them (section 4) and label them `good first issue`. The same page lists what is not a good first task (translation of finding messages, a new connector).
- **Live validation reports.** The most valuable contribution. Use the [sandbox guide](live-sandbox-testing.md) and the "Live validation result" issue template, with redacted output only.
- **Connector proposals** through the issue template, and the [connector SDK guide](connector-sdk.md).
- **Documentation fixes**, including trying the setup guide on a clean machine ([development.md](development.md)).
- Credit: say who did what in the changelog and the release notes.

### How to review pull requests

- CI must pass. The maintainer reviews every change; [CODEOWNERS](../.github/CODEOWNERS) lists the paths that guard the write path and the HTTP layer.
- Check, in this order: tests with the change (a bug fix has a test that failed before); synthetic fixtures only; the safety properties in [CONTRIBUTING.md](../CONTRIBUTING.md) untouched; docs and finding codes updated; no new runtime dependency without discussion, because the supply chain is deliberately small ([enterprise readiness](enterprise-readiness.md)); no claim stronger than the evidence.
- Review for the contributor, not against them: say what is good, ask for one change at a time, and prefer "here is the test I would add" to "this is wrong".
- **Response time is a goal, not a promise.** `SECURITY.md` aims to acknowledge vulnerability reports within five working days. A reasonable matching goal for ordinary issues and pull requests is a first human reply within a week. A volunteer maintainer will sometimes miss it; say so when it happens.

### Mentoring approach

- Invite draft pull requests early: a half-finished draft with a question is welcome ([good-first-contributions.md](good-first-contributions.md) says so).
- When a contributor claims a task, reply the same day if you can, name the file and the neighbouring test to copy, and link the relevant ADR.
- After a first merge, suggest one slightly larger task, never a pile of tasks.
- Thank people for negative results. A validation report that says "this broke" is worth more than a star.

## 11. Do not

- **Do not buy, trade, swap or solicit stars**, forks, followers, upvotes or comments. Do not ask friends to upvote a Show HN post (Hacker News forbids it). Do not use engagement groups.
- **Do not invent users, customers, testimonials, logos, quotes, investors, downloads or adoption.** There are none. "Used by" and "trusted by" sections stay empty.
- **Do not mass-message**: no cold DMs, no bulk e-mail, no unsolicited @-mentions of vendors or their staff, no copy-pasting one post across many communities in one day.
- **Do not publish benchmarks beyond the reproducible ones** in [enterprise-readiness.md](enterprise-readiness.md) (the scale table; the command that reproduces it is on that page), and always say they ran against in-process fakes with no network. Do not publish speed or reliability comparisons with other tools; none were run.
- **Do not claim live-validated integrations**, "production-ready", "enterprise-ready", "zero data loss", "lossless", "exactly-once", support for any pair other than Notion to ClickUp, or that attachments, comments or permissions migrate.
- **Do not say** ClickUp's importer is a "black box" or "loses your data". ClickUp documents what it does not import and keeps an import report. Say instead that its docs describe no preview, and that it is free and may be enough.
- **Do not post where the rules forbid self-promotion**, and do not hide that you are the author.
- **Do not post the static demo's URL or any "try it online" claim before the demo is live.**

## 12. Signals worth watching (and how to read them)

| Signal                   | How measured                                                                                             | Note                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Live validation reports  | Issues from the "Live validation result" template; rows added to the [validation log](validation-log.md) | The only signal that shows the tool works on real services. Record failures. |
| Install and demo success | Issues, Discussion replies. No telemetry exists in ExitOS and none is planned.                           | Ask for feedback instead of measuring silently.                              |
| Contributors             | Unique authors of merged pull requests; first-time contributors                                          | Quality over count.                                                          |
| Issue activity           | Opened and closed issues; time to first reply                                                            | Compare with the goal in section 10.                                         |
| Stars                    | GitHub                                                                                                   | A vanity signal. Never buy, trade or solicit them; never quote them.         |

## 13. Optional long-form write-up

If a longer article is wanted after the first validation report, an outline that fits the facts:

1. The problem: import tools that cannot show their work before they run.
2. Principles: read-only until approval, never delete or overwrite, report every loss it knows about, "verified" is not "applied".
3. Plans as artifacts: canonical JSON, a hash, approval by id, why `apply` does not re-read the source.
4. Making loss a first-class type: supported, transformed, lossy, unsupported ([finding codes](finding-codes.md)).
5. Reliability without idempotency keys: write-ahead log, provenance markers, reconciliation, and what is not guaranteed ([reliability](reliability.md)).
6. Pacing against rate limits once, in one scheduler.
7. Testing a connector without the service: fakes, fault injection, proving zero network in the demo.
8. What was validated, what was not, and how to help.
