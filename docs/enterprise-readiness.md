# Enterprise readiness

> **ExitOS is a v0.1 pre-release.** This page is an honest self-assessment, not a certification. ExitOS
> holds no SOC 2, ISO 27001 or similar attestation, has had no independent security review or penetration
> test, and **has never been run against a live Notion or ClickUp workspace**
> ([validation log](validation-log.md)). Read it as "what a company evaluating this should know", with
> the evidence for every claim and the gaps spelled out.

## The short verdict

| Question                                               | Answer today                                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the engineering sound enough to evaluate seriously? | **Yes.** Read-only by default, explicit approval, resumable, verified, extensively tested, small dependency footprint, no telemetry.                                                          |
| Would we run it on a production workspace today?       | **No.** Nobody has run it against the real APIs. The first migration should be a throwaway workspace ([sandbox guide](live-sandbox-testing.md)), and the first real one should be supervised. |
| Can it run inside a corporate network?                 | **Probably.** Proxy and custom-CA support exist and are tested against local stand-ins, but not against a real corporate proxy.                                                               |
| What blocks calling it "enterprise-ready"?             | Live validation, an independent security review, signed releases, Windows support, attachment transfer, and a support commitment. See [what it would take](#what-it-would-take).              |

## Assessment by area

Legend: ✅ in place and tested · 🟡 partly, or tested only against fakes · ❌ not done.

| Area                        |     | Evidence                                                                                                                                                                                                                                                                                                                                                                                              | Gap                                                                                                                                                                                  |
| --------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Works against the real APIs | ❌  | Connectors follow the official docs ([api-verification](api-verification.md)) and are tested against API-shaped fakes, in-process and over loopback HTTP.                                                                                                                                                                                                                                             | **No live run has ever happened.** Mocks prove the engine's logic, not that the real services behave as documented. This is the main blocker.                                        |
| Source safety               | ✅  | The source connection can never write: an endpoint classifier fails closed, proved with request spies in every command.                                                                                                                                                                                                                                                                               | —                                                                                                                                                                                    |
| Destination safety          | ✅  | Writes are limited to four ClickUp create endpoints; nothing is deleted or overwritten; `apply` needs the plan id; plans are hash-sealed.                                                                                                                                                                                                                                                             | There is **no rollback**: unwanted created items must be deleted by hand.                                                                                                            |
| Reliability                 | 🟡  | Bounded concurrency, `Retry-After`, write-ahead checkpoints, resume, duplicate prevention by provenance marker. The branches that decide "adopt, re-send, or stop and ask" are pinned by tests that fail if they start guessing ([reliability model](reliability.md)).                                                                                                                                | Exactly-once is **not** claimed. ClickUp documents no read-after-write guarantee for list endpoints, so reconciliation is best-effort.                                               |
| Corporate network           | 🟡  | `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` ([ADR 0013](decisions/0013-proxy-support-via-undici.md)); `NODE_EXTRA_CA_CERTS` for TLS-inspecting proxies; failures name the real cause (proxy refused, DNS, untrusted certificate) and what to check. Tested against a real loopback CONNECT proxy and the built CLI as a separate process.                                                               | Not tested against a real corporate proxy, PAC files or NTLM/Kerberos proxy authentication (basic authentication in the proxy URL only). `NO_PROXY` CIDR ranges are not interpreted. |
| Secrets                     | ✅  | Tokens come from the environment; `.env` is read with a permission warning; tokens and signed URLs are redacted from all output; none is written to plans, state or reports.                                                                                                                                                                                                                          | No integration with a secret manager (use your tool to inject the two environment variables).                                                                                        |
| Privacy and data residency  | ✅  | Local-first and account-free. **No telemetry exists in the code.** The only outbound connections are to `api.notion.com` and `api.clickup.com`; the dashboard binds to `127.0.0.1`.                                                                                                                                                                                                                   | Plans and state contain your content; see [where data lives](#where-data-lives).                                                                                                     |
| Supply chain                | 🟡  | **5** third-party packages in the CLI's production tree (`commander`, `undici`, `@notionhq/client`, `zod`, `yaml`), all MIT/ISC; the dashboard adds `react`, `react-dom` and `scheduler` (MIT) compiled into static files. CI gates: license allow-list, `pnpm audit`, CodeQL, pull-request dependency review, SBOM artifact; Dependabot; committed lockfile; pnpm release-age policy, no exclusions. | No signed releases or build provenance yet (nothing has been published). Actions are pinned to major tags, not commit hashes.                                                        |
| Test depth                  | ✅  | 918 tests plus 99 browser tests. Coverage (v8) is **89.7 % statements, 77.8 % branches, 91.7 % functions, 91.1 % lines**, with a CI floor. The most dangerous tests were mutation-checked: breaking the code on purpose makes them fail.                                                                                                                                                              | Child-process tests do not count towards coverage, so the CLI's own figure (about 83 %) understates it. The experimental Docs migration is the thinnest area.                        |
| Scale                       | 🟡  | Measured up to **100 000 rows** under fakes: see [scale and sizing](#scale-and-sizing).                                                                                                                                                                                                                                                                                                               | State is held in memory during extraction; there is no streaming mode. Real duration is set by the destination's rate limit, not by ExitOS.                                          |
| Platforms                   | 🟡  | CI: Ubuntu (Node 22 and 24) and macOS (Node 22); also run locally on Node 22.13 and 26.                                                                                                                                                                                                                                                                                                               | **Windows is untested.** Use WSL2.                                                                                                                                                   |
| Auditability                | 🟡  | Plans are canonical JSON with a SHA-256 hash and an id; runs have ids; reports in JSON/Markdown list what moved and what did not; `--redact` makes them shareable.                                                                                                                                                                                                                                    | No tamper-evident audit log, signing of reports, or SIEM export.                                                                                                                     |
| Access control              | ❌  | ExitOS is a single-user command-line tool; it uses the permissions of the tokens you give it.                                                                                                                                                                                                                                                                                                         | No roles, approvals by a second person, or SSO. Do approvals in your change process around the CLI.                                                                                  |
| Coverage of the data        | ❌  | Rows to tasks, with Markdown bodies, statuses, priorities, dates, mapped assignees, tags, existing custom fields and relations.                                                                                                                                                                                                                                                                       | Attachment bytes, comments, permissions, views, icons, subtasks, dependencies and original timestamps do not migrate. The plan lists every loss.                                     |
| Maintenance and support     | ❌  | Changelog, semantic versioning, a security policy ([SECURITY.md](../SECURITY.md)).                                                                                                                                                                                                                                                                                                                    | One maintainer, no SLA, pre-1.0 (minor versions may break).                                                                                                                          |
| Independent assurance       | ❌  | Self-written [security review](security-review.md) and a CodeQL scan.                                                                                                                                                                                                                                                                                                                                 | No third-party audit, penetration test or compliance attestation.                                                                                                                    |

## Running it in a corporate environment

### Network and proxy

Allow outbound HTTPS (443) to exactly two hosts: **`api.notion.com`** and **`api.clickup.com`**. ExitOS
contacts nothing else, and its HTTP layer refuses any other host.

| Variable                                           | Effect                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS_PROXY` / `https_proxy`                      | Proxy for HTTPS requests (both services use HTTPS). Format `http://[user:password@]host:port`. Upper-case wins.                                |
| `HTTP_PROXY` / `http_proxy`                        | Proxy for plain HTTP requests.                                                                                                                 |
| `NO_PROXY` / `no_proxy`                            | Comma-separated hosts that skip the proxy. `*`, `example.com` (and subdomains), `.example.com` (subdomains only), `host:port`. No CIDR ranges. |
| `NODE_EXTRA_CA_CERTS=/path/to/company-root-ca.pem` | Trust your organisation's root certificate. Needed when a proxy or firewall inspects HTTPS; without it the failure says so.                    |

Proxy settings are read from the **process environment only**, never from `.env`. Credentials in the
proxy URL are never printed. To see which proxy a run uses, add the global `--verbose` flag
(`exitos --verbose inspect notion`): it logs the proxy as `scheme://host:port`, credentials hidden. When a
request fails, the message names the real cause (proxy refused, DNS, untrusted certificate) and the
variable to check.

### Credentials and least privilege

- **Notion:** use an internal connection and share only the pages and databases you intend to migrate;
  a connection sees nothing else. Add the user-information capability only if you want to match people by
  e-mail.
- **ClickUp:** a personal API token carries everything its owner can do. Create it from a dedicated
  migration user who is a member of only the target Workspace and Spaces, and revoke it afterwards.
- Pass both through the environment (`NOTION_TOKEN`, `CLICKUP_API_TOKEN`) from your secret manager. They
  are never written to disk by ExitOS.

### Where data lives

ExitOS keeps everything local, in the working directory unless `EXITOS_STATE_DIR` says otherwise.

| Path                              | Contains                                                                                                                                                   | Mode (checked)                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `.exitos/`                        | state directory                                                                                                                                            | `0700`                        |
| `.exitos/state.db`                | run state, checkpoints, id mappings                                                                                                                        | `0600`                        |
| `migration-plan.json`             | the full plan, **including the content being migrated**                                                                                                    | `0600`                        |
| reports (`exitos report --out …`) | counts and findings, with workspace and list names and ids; `--redact` replaces titles, names, URLs and values with hashes (the report says so at the top) | `0600`                        |
| `.env` (optional)                 | the two tokens                                                                                                                                             | warns if group/world-readable |

Treat the plan and state as **confidential as the source data**: they contain titles, property values
and page bodies. Reports hold no item content, but their workspace and list names are internal details,
so use `--redact` before sharing one. Delete `.exitos/` and the plan when the migration is done.

### Automation and exit codes

`apply --plan <file> --approve <planId>` needs no prompt, so a pipeline can apply a plan that a person
has reviewed. `apply` and `resume` print progress, not JSON: take the result from the exit code, then
read `status --json`, `verify --json` or `report --json`. Exit codes: `0` success · `1` unexpected error · `2` usage or configuration
error · `3` run stopped or partial (resume with `exitos resume`) · `4` verification failed · `5` approval
missing or plan integrity failure ([spec](product-spec.md)).

### Scale and sizing

Measured on one Apple-silicon Mac with Node 26, running the complete cycle (plan, approve, apply,
verify) against the in-process fake APIs.

| Rows    | Plan   | Apply  | Verify | Peak memory |
| ------- | ------ | ------ | ------ | ----------- |
| 5 000   | 0.6 s  | 0.4 s  | 0.2 s  | 365 MB      |
| 20 000  | 2.7 s  | 1.8 s  | 0.6 s  | 0.9 GB      |
| 50 000  | 7.4 s  | 5.0 s  | 2.2 s  | 1.5 GB      |
| 100 000 | 20.8 s | 11.9 s | 9.9 s  | 2.7 GB      |

How to read it:

- There is **no network latency** in these numbers, and the fakes share the process, so memory is an upper
  bound on what ExitOS itself needs. They show ExitOS's own cost, not how long a migration takes.
- **A real migration is paced by the destination.** ClickUp's documented limit is per token and depends
  on the plan: 100 requests per minute (Free Forever, Unlimited, Business), 1 000 (Business Plus),
  10 000 (Enterprise) ([api-verification](api-verification.md)). Each task is one create request, so
  100 000 tasks take roughly **17 hours** on a 100-per-minute plan and under 2 hours on Business Plus.
  `exitos plan` prints its own estimate.
- Reading a data source stops at `limits.maxRecordsPerDataSource` (default 50 000) and the plan is
  **blocked** (`SOURCE_ROWS_INCOMPLETE`) rather than migrating a partial set. Raise it deliberately for
  larger sources, and give Node more heap above ~50 000 rows (`NODE_OPTIONS=--max-old-space-size=8192`).
- Reproduce: `EXITOS_SCALE=1 EXITOS_SCALE_ROWS=20000 pnpm exec vitest run packages/connector-clickup/test/scale.test.ts --reporter=verbose`.

### Verifying the supply chain yourself

```bash
pnpm install --frozen-lockfile
pnpm check:licenses      # every production dependency is on the allow-list (MIT, ISC, Apache-2.0, BSD…)
pnpm audit               # known vulnerabilities
pnpm sbom:generate       # CycloneDX SBOM of what the CLI ships -> sbom/exitos-cli.cdx.json
pnpm test:coverage       # coverage with an enforced floor
```

## What it would take

In rough priority order, before ExitOS can responsibly be called enterprise-ready:

1. **Live validation** on real Notion and ClickUp test workspaces, recorded in the validation log, then on
   at least one supervised real migration.
2. **An independent security review**, and a proper vulnerability-disclosure channel enabled on the
   repository.
3. **Signed, reproducible releases** with build provenance and a published SBOM; Actions pinned by hash.
4. **Windows support** and a CI job that proves it.
5. **Attachments and comments**, the two losses people notice first, behind an explicit opt-in.
6. **Streaming extraction** so memory stays flat on very large sources.
7. **A support commitment**: more than one maintainer, a response-time policy, a compatibility and
   deprecation policy for plans and reports.

Contributions towards any of these are welcome; (1) is the most valuable thing anyone can send.
