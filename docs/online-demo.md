# Online demo

A static, simulated, read-only copy of the ExitOS dashboard that anyone can open in a browser without
installing anything: no login, no credentials, no backend, no real data.

> **Status: it does not exist yet.** The code, the build and the publishing workflow are in this
> repository, but nothing is published. The page only exists at `https://choitim.github.io/EXITOS/`
> after the maintainer has switched on GitHub Pages and run the "Pages" workflow once
> ([how](#publishing-it-maintainer-only)). Until then, build and open it locally
> ([how](#run-it-locally)).

## What it is

- The real ExitOS dashboard (the same React app that `exitos ui` serves), built in a "static demo"
  mode and fed by **one recorded file**, `demo-state.json`, instead of a local server.
- That file is what the **real ExitOS engine** produced when it ran its offline demo: a synthetic
  Notion workspace ("Acme Robotics (synthetic demo)"), fake in-process Notion and ClickUp APIs, the
  plan, the approved run, the event log, the verification result and the report. It is the exact
  document `GET /api/state` returns for `exitos ui --demo`, checked and cleaned by
  `scripts/build-demo-state.mjs` (see [How it is built](#how-it-is-built)).
- A guided tour of six steps over the real dashboard sections: select the sample workspace, inspect
  the source, preview compatibility, view the mapping, **replay** the recorded run, review the
  verification report.
- Labelled **DEMO** at all times: an amber badge in the sticky header ("Replay of a recorded run on
  synthetic data") and a statement at the top of the page.

## What it is NOT

- **It is not connected to anything.** The page cannot reach Notion or ClickUp. It has no token field
  and nothing to log in to. It never pretends to connect: it says on every screen that it replays a
  recording.
- **It is not a live migration.** "Start simulation" replays events that were recorded earlier.
  Nothing is written anywhere. The step is labelled "Replay of a recorded offline run, not a live
  migration".
- **It is not a benchmark.** The replay takes about nine seconds because that is a comfortable pace to
  read, not because the engine takes nine seconds. The recorded timestamps shown on each event are
  the offline demo's own simulated clock, and no speed figure anywhere on the page is a measurement.
- **It does not validate ExitOS against real workspaces.** v0.1 is a pre-release that has been tested
  against API-shaped fakes only ([validation log](validation-log.md)). The page says so, and it does
  not claim "zero data loss". Moving Notion pages to ClickUp Docs stays labelled _experimental_.
- It is not a place to try your own data. There is no upload and no input that goes anywhere.

## The six steps

| Step | What it does                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Shows the one sample workspace in the recording (name, collections with their row counts, pages). It says "1 sample workspace available".         |
| 2    | Scrolls to and highlights **Source and destination**.                                                                                             |
| 3    | Scrolls to and highlights **Compatibility**.                                                                                                      |
| 4    | Scrolls to and highlights **Mapping preview**.                                                                                                    |
| 5    | "Start simulation" replays the recorded event log with a progress bar and an event list, ending at the recorded totals. Skip and Reset are there. |
| 6    | Scrolls to **Verification** and highlights the recorded result.                                                                                   |

The sections stay on the page; the tour only scrolls to and highlights them. The tour keeps its state in
memory only (a reload starts over; nothing goes to storage, cookies or the URL). With
`prefers-reduced-motion` the page does not animate or scroll smoothly and the replay shows the finished
result at once.

### How the replay works (and why it invents nothing)

`apps/web/src/lib/replay.ts` walks the recorded event log from the first event to the last, spread
evenly over nine seconds. At any moment:

- the events shown are a prefix of the recorded events, with their own messages and recorded times;
- "actions written" is the number of recorded `action_succeeded` events shown so far;
- when the last event has been shown, the figures are exactly the recorded run counts and the recorded
  verification result (for the current recording: 175 of 175 actions, 175 verified).

Only the pacing is ours. If a recording ever carried fewer events than actions (the dashboard state
keeps the latest 250 events), the replay counts the difference as "done before the first event shown"
and says so on the page.

## How it is built

1. **Static build mode.** `vite build --mode demo` (web package script `build:demo`) builds the
   dashboard into `apps/web/dist-demo` with a **relative base** (`./`), so it works from any folder and
   from a sub-path such as `https://<user>.github.io/EXITOS/`. A compile-time constant
   (`__STATIC_DEMO__`) guards every demo code path; the JavaScript and HTML of the normal `pnpm build`
   output contain none of it (its stylesheet carries the few extra CSS rules).
2. **The data.** `scripts/build-demo-state.mjs` runs the real, built CLI in a fresh temporary directory
   with a scrubbed environment: `exitos demo --no-color`, then `exitos ui --demo` on a free loopback
   port, and fetches `/api/state`. It validates the document with the built `DashboardStateSchema`,
   **scrubs** the temporary directory and repository path, and **asserts** that none of the following
   is present, failing loudly and writing nothing otherwise:
   - absolute file-system paths (`/Users/`, `/home/`, `/private/`, `/var/folders`, `/tmp/`, `C:\`, UNC
     paths, `file:` URLs, `~/`);
   - the temporary directory name, this machine's user name, host name, home directory or repository
     path;
   - token-shaped strings (the patterns of `scripts/check-secrets.mjs`, plus JWTs, bearer credentials
     and `sk-` keys);
   - URL hosts other than the engine's synthetic ones (`www.notion.so`, `app.clickup.com`,
     `example.*`);
   - any mode other than `demo`, a run that is not `verified`, or a verification that did not pass.

   It then writes `apps/web/dist-demo/demo-state.json` and nothing else, and prints its size.

3. **Loading.** In static mode the page loads `./demo-state.json` once (a relative URL, `no-cache`,
   no credentials, no referrer). There is no polling and no `/api` request. It refuses any document
   whose mode is not `demo`.
4. **The tour** is a small state machine (`lib/tour.ts`) plus components in `apps/web/src/demo/`.
5. **Content-Security-Policy.** A static host cannot send headers, so the demo's `index.html` carries
   the policy in a `<meta http-equiv>` tag, placed before any script or stylesheet. It mirrors the
   policy of `exitos ui` (`apps/cli/src/server/server.ts`) directive for directive, except
   `frame-ancestors`, which browsers ignore in a meta tag:
   `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`.
   A unit test keeps the two in step, and a browser test proves it is enforced.
6. **Publishing** is `.github/workflows/pages.yml` (manual only, see below).

`pnpm build:demo` does all of this in order: it first checks that the CLI and `@exitos/core` are built
(and says "run `pnpm build` first" if not), builds the static site, then records the data.

## Run it locally

```bash
pnpm install
pnpm build            # the CLI, core and the normal dashboard (the demo's data is recorded by the real CLI)
pnpm build:demo       # the static demo into apps/web/dist-demo, with demo-state.json
pnpm preview:demo     # serves it at http://127.0.0.1:4174/EXITOS/ (a sub-path, like GitHub Pages)
```

Any static file server works on `apps/web/dist-demo`, from the root or from a sub-path. Opening
`index.html` straight from disk (`file://`) does not work: browsers refuse to load module scripts from
`file://` addresses, so the page stays empty. Serve the folder instead.

## Publishing it (maintainer only)

Nothing publishes by itself. `pages.yml` runs **only** when started by hand (`workflow_dispatch`).

1. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Pages → Run workflow** (on the default branch).
3. The workflow installs with the frozen lockfile, runs `pnpm build` and `pnpm build:demo`, uploads
   `apps/web/dist-demo` and deploys it to the `github-pages` environment.
4. The address is shown in the run's summary. For this repository it would be
   `https://choitim.github.io/EXITOS/`, **but it does not exist until the two steps above have been
   done.** Nothing in the repository, including the README, should link to it before then.

To take it down again, change **Settings → Pages → Source** to "None" or delete the deployment.

The workflow uses `actions/checkout`, `pnpm/action-setup` and `actions/setup-node` at the same major
versions as `ci.yml`, and `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` and
`actions/deploy-pages@v5`, the latest majors at the time of writing. It builds in one job and deploys in
a second one. Its permissions are `contents: read`, `pages: write` and `id-token: write`, which the
Pages deployment needs; it has no other permissions and no secrets.

## Regenerating the data

The recording changes when the engine's offline demo does (a new version, a changed fixture). Rebuild
it with:

```bash
pnpm build && pnpm build:demo
```

The migration figures on the page always come from that file. None of them is written into the page's
code.

## Privacy and safety

- The page makes a handful of requests, all to its own folder: `index.html`, one script, one
  stylesheet, the icon and `demo-state.json`. No third-party request of any kind: no analytics, no
  fonts, no CDN. The Content-Security-Policy (`connect-src 'self'`) forbids it and the browser test
  checks it.
- It stores nothing: no cookies, no local or session storage, no IndexedDB. Reloading starts over.
- It sends nothing: the only data it handles is the recorded file it loads.
- The page is built from the same code as the local dashboard and keeps its safeguards: no inline
  scripts or styles, no `dangerouslySetInnerHTML`, Markdown is parsed to React elements, URLs go
  through an allow-list. The source-hygiene unit tests cover the demo's files too.
- The recorded content contains links such as "Original Notion page" that point at pages that do not
  exist. The demo shows those as plain text, never as links. The only link that leaves the site is the
  one to this repository, opened by the visitor in a new tab with no referrer.
- All data is synthetic. Nothing in the recording comes from a real workspace.

## Limitations

- It is one recorded run of one sample workspace. There is nothing to configure and no second
  workspace; the page says so rather than showing placeholders.
- The recording is a snapshot: it reflects the engine that produced it, not later versions.
- A static host cannot send response headers, so the policy comes from a meta tag. The meta tag cannot
  carry `frame-ancestors`, so the demo cannot forbid other sites from framing it (it contains no
  secret and offers no action, so the risk is a look-alike frame, not data exposure).
- The page needs JavaScript and a browser that supports ES2023 modules.
- The recorded timestamps are the offline demo's simulated clock, not real durations.
- It says nothing about how ExitOS behaves against real Notion or ClickUp workspaces, which v0.1 has not
  been validated against.

## Tests

- `pnpm exec vitest run apps/web`: the replay derivation (monotonic, ends at the recorded totals,
  nothing invented), the tour state machine, the static data loading (relative URL, one request, no
  polling), the Content-Security-Policy, the leak checks of `build-demo-state.mjs`, and the
  source-hygiene rules for every dashboard file, including the demo's.
- `pnpm test:e2e` (the `static-demo` project, `e2e/static-demo.spec.ts`): serves `apps/web/dist-demo` from
  a sub-path with a header-less file server and walks all six steps. It checks the DEMO labelling, that
  there is no request to another origin and none to `/api/`, that the meta Content-Security-Policy is
  present and enforced and not violated, that the replay takes about nine seconds and ends at the
  recorded totals, that verification shows the recorded counts, keyboard-only operation, reduced
  motion, no sideways scrolling at 360 px, and basic accessibility checks (landmarks, heading order,
  names, `aria-current`, visible focus). If `apps/web/dist-demo` is missing, the global setup builds it.
