# Security review (v0.1)

A self-review by the maintainers against the requirements in the project brief. It is a checklist with
evidence, not an independent audit. Report problems privately — see [SECURITY.md](../SECURITY.md).

**Scope:** the CLI, the engine, the Notion and ClickUp connectors, the state database, and the local
dashboard server. **Out of scope:** the security of Notion/ClickUp themselves and of your machine.

## Assets and trust boundaries

| Asset                                      | Where it lives                                     | Protected by                                                           |
| ------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Notion token, ClickUp token                | environment / `.env` (mode-checked)                | never written to plans, state, logs, reports; redacted from errors     |
| Your content (titles, descriptions, names) | `migration-plan.json`, `.exitos/state.db`, reports | files created `0600`, directory `0700`; gitignored; `report --redact`  |
| Source workspace                           | Notion                                             | read-only credential guidance; read-only guard in code                 |
| Destination workspace                      | ClickUp                                            | explicit approval; four allow-listed write endpoints; no delete/update |

Untrusted inputs, all validated with Zod: **API responses**, **`migration.yaml`**, **plan files**,
**state rows**, **environment overrides** (`*_API_BASE_URL`).

## Checklist

| Requirement                                             | Status | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials only from env / a safe local mechanism      | ✅     | `apps/cli/src/runtime/env.ts` reads only 5 named keys from `.env`; real env wins; warns if `.env` is group/world-readable. Config files containing keys like `token`/`apiKey` are **rejected** (`findSecretKeys`).                                                                                                                                              |
| `.env` gitignored, `.env.example` provided              | ✅     | `.gitignore` (`.env`, `.env.*`, `!.env.example`)                                                                                                                                                                                                                                                                                                                |
| No tokens, real exports or private content committed    | ✅     | all fixtures are synthetic (`examples/demo-workspace`); signed-URL-looking strings in fixtures are obviously fake (`FIXTURE_SIGNATURE_NOT_REAL`) and tests assert they never reach plans, state or reports; CI runs `scripts/check-secrets.mjs` (token shapes, private keys) over tracked files                                                                 |
| Redact tokens and private data from logs and exceptions | ✅     | `packages/shared/src/redact.ts` (token shapes, `Bearer`, `Authorization`, signed-URL parameters, exact registered secrets); applied in `ExitOsError` constructors and the logger. Tests: `redact.test.ts`; end-to-end "no token appears in any artefact" in `docs-security.test.ts` and the spawned live-cycle test `spawn.test.ts` (scans every file on disk). |
| Validate imported data at trust boundaries              | ✅     | Zod on every Notion/ClickUp response (`raw.ts`, `schemas.ts`), config, plan (`parsePlanJson`), state rows, action payloads (strict)                                                                                                                                                                                                                             |
| Avoid arbitrary code execution / shell injection        | ✅     | no `eval`/`Function`, no `child_process` in product code (only in tests), no shell strings; YAML parsed with the `core` schema (no custom tags) and an alias cap                                                                                                                                                                                                |
| Sanitise Markdown/HTML before browser rendering         | ✅     | dashboard never uses `dangerouslySetInnerHTML`; Markdown is parsed to a tree and rendered as React elements; link scheme allow-list (`http`, `https`, `mailto`); strict CSP without `unsafe-inline`/`unsafe-eval`. Tests: web unit tests + Playwright XSS check.                                                                                                |
| Don't follow arbitrary attachment URLs                  | ✅     | attachments are never fetched ([ADR 0009](decisions/0009-attachments-not-transferred.md)); only http(s) URLs without credentials are kept as links; Notion-hosted signed URLs are never stored                                                                                                                                                                  |
| Diagnostic reports don't expose private data            | ✅     | `exitos report --redact` replaces titles, names, URLs, ids and field values with hashes (`approval-config-report.test.ts`, `commands.test.ts`)                                                                                                                                                                                                                  |
| Apply requires explicit approval                        | ✅     | plan id typed or `--approve <id>`; plan is hash-sealed; approval checked before any state or connection exists (`commands.test.ts › approval gate`)                                                                                                                                                                                                             |
| No deletion from source systems                         | ✅     | the Notion connection is always read-only; the guard blocks any non-read endpoint (`extract.test.ts`); ClickUp deletion/updates are not even allow-listed (`units.test.ts › network policy`)                                                                                                                                                                    |
| Never overwrite existing destination content            | ✅     | create-only actions; collisions are warned; an existing differing target is a failure, not an overwrite                                                                                                                                                                                                                                                         |

## Specific mitigations

- **Token exfiltration.** Each connector declares the only host its token may reach; a guarded `fetch`
  refuses any other host and plain `http` except loopback. `NOTION_API_BASE_URL`/`CLICKUP_API_BASE_URL`
  overrides are rejected unless loopback or the real host (`resolveBaseUrl`).
- **Tampered plan files.** Plan integrity is a SHA-256 over the canonical body; edits are refused. A
  careful attacker who _recomputes_ the hash still cannot smuggle request fields (strict payload
  schemas), traverse paths (ids are checked against `[A-Za-z0-9_-]{1,64}`), or re-enable notifications
  (`notify_all: false` is a literal in the schema). Tests: `docs-security.test.ts › a plan file is
untrusted input`.
- **Write containment.** `apply` is the only code path that holds a read-write connection. Writes are
  limited to four ClickUp endpoints; everything else (including `DELETE`, `PUT`, task updates) is
  classified `unknown` and blocked even in read-write mode.
- **Outbound proxy.** `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` are read from the process environment
  only (never `.env`, so a shared file cannot redirect traffic). Proxy credentials are never printed:
  messages name `scheme://host:port` only, malformed values are rejected without being echoed, and
  only `http`/`https` proxy URLs are accepted ([ADR 0013](decisions/0013-proxy-support-via-undici.md)).
  The allowed-host guard sits above the transport, so a proxy cannot widen where a token may go.
  Network failures are explained by `describeNetworkFailure`, which redacts and bounds what it prints.
  Tests: `apps/cli/test/proxy.test.ts`, `spawn-proxy.test.ts`, `packages/shared/test/diagnose.test.ts`.
- **Local dashboard.** Binds `127.0.0.1`, rejects foreign `Host` headers (DNS rebinding), serves only
  `GET`/`HEAD`, normalises and confines static paths, sends a strict CSP, and exposes one JSON document
  built from a **read-only** SQLite handle. It never reads environment variables or credentials.
- **State at rest.** SQLite file `0600`, directory `0700`. It contains your content (plans embed it) —
  **not** credentials. Delete `.exitos/` when done.
- **Signed URLs.** Notion-hosted file URLs are short-lived bearer-style links; they are dropped at
  normalization and never reach plans, state or reports.
- **Denial of service from a hostile workspace.** Block depth, blocks per page, rows, pages, response
  size (25 MB) and request timeouts are bounded; pagination loops are capped; the 10 000-row cap is
  handled rather than looped on.

## Known limitations / residual risk

- Plan files and the state database hold **plaintext copies of your content**. Use disk encryption and
  do not commit them (`.gitignore` covers the defaults).
- The `.env` mode check is advisory on non-POSIX systems.
- `node:sqlite` is marked experimental by Node ([ADR 0003](decisions/0003-node-sqlite-for-state.md)).
- A _personal_ Notion access token carries all of your permissions; the docs recommend an internal
  connection with the _Read content_ capability only, but ExitOS cannot enforce that.
- The ClickUp personal token acts as you and has write access to everything you can write to;
  ExitOS limits itself to four endpoints, but the token itself is not scoped.
- The dashboard shows your plan content to anyone who can open `127.0.0.1:<port>` on your machine.
- A proxy that inspects TLS and whose CA you trust through `NODE_EXTRA_CA_CERTS` can read the tokens
  and content in transit. That is your organisation's decision; without it, an HTTPS proxy only sees
  the destination host (the tunnel is end to end).
- With an `http://` proxy URL, the proxy credentials travel unencrypted between ExitOS and the proxy.
  Use an `https://` proxy URL or a trusted network. NTLM/Kerberos proxy authentication and PAC files
  are not supported.
- Live behaviour of the two APIs is unverified ([live-sandbox-testing.md](live-sandbox-testing.md)).

## Supply chain

- Production dependencies are few: `zod`, `yaml`, `@notionhq/client`, `commander` and `undici` (proxy
  support) in the CLI, plus `react`, `react-dom` and its `scheduler` compiled into the dashboard's static
  files. Everything else is build/test tooling. All are MIT or ISC; `pnpm check:licenses` fails CI if any
  production dependency (direct or transitive) leaves an allow-list (MIT, ISC, Apache-2.0, BSD,
  0BSD, BlueOak, CC0, Unlicense), so a copyleft licence cannot arrive unnoticed.
- `pnpm sbom:generate` writes a CycloneDX SBOM of what the CLI ships; CI uploads it as an artifact.
- CodeQL (weekly and on every push and pull request) and a dependency review on pull requests
  (fails on high-severity advisories) run in GitHub Actions; coverage has an enforced floor.
- `pnpm audit` on 2026-10-08: **no known vulnerabilities**. CI re-runs it, and Dependabot is enabled.
- pnpm 12 enforces a **minimum release age** (24 hours by default) on new dependency versions, and
  this repository keeps it **enforced with no exclusions**. When the newest `vite` (8.3.4) and
  `@playwright/test` (1.64.0) were still inside that window, they were pinned one release back
  (`vite` 8.3.3, `@playwright/test` ^1.63.0) instead of being excluded. Dependabot will propose the
  newer versions once they have aged.
- The lockfile belongs in the repository; CI installs with `--frozen-lockfile`.
- Releases are not published by this repository's CI in v0.1 (no publishing credentials exist), so
  there are no signed artifacts or build provenance yet. GitHub Actions are pinned to major-version
  tags, not commit hashes; Dependabot proposes the updates.

## Reporting

See [SECURITY.md](../SECURITY.md). Do not file public issues for vulnerabilities, and never paste
tokens, plan files or unredacted reports into an issue.
