# Security policy

ExitOS handles credentials for other services and copies people's content between them, so we take
security reports seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Security" tab → "Report a vulnerability", or
<https://github.com/Choitim/EXITOS/security/advisories/new>) on this repository.

> **TODO (maintainer): no private reporting channel is confirmed to be active.** Until you choose one,
> this section promises something a reporter may not be able to use. Pick one of these, then delete this
> note:
>
> 1. **GitHub private vulnerability reporting** (recommended): enable _Private vulnerability reporting_ in
>    the repository's security settings. The link above and the "Security vulnerability" entry in the issue
>    chooser then work.
> 2. **A monitored mailbox:** replace this line with `TODO: security contact address` once you have an
>    address that someone reads. Do not publish a personal address by accident.
> 3. **Both.**
>
> Also fill in the enforcement contact in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Include: what you found, how to reproduce it (a synthetic fixture is ideal), the affected version or
commit, and the impact you expect. **Never include real tokens, plan files, `.env` files or unredacted
reports** — use `exitos report --redact`.

We aim to acknowledge reports within **5 working days**, to share an assessment within **14 days**,
and to coordinate disclosure with you. These are goals of a small volunteer project, not a contractual
SLA.

## Supported versions

Only the latest `0.x` release receives fixes while the project is pre-1.0.

## What counts as a vulnerability here

Examples we very much want to hear about:

- a credential or signed URL reaching a log, plan, report, state file, error message or the dashboard;
- any way to make ExitOS **write to the source**, or to write/delete/update anything in the destination
  beyond the four documented create endpoints;
- `apply` running without the explicit approval of the exact plan, or accepting a tampered plan;
- sending a token to a host other than the connector's own API host;
- path traversal, request smuggling or injection via a plan file, config file or API response;
- XSS or other script injection in the local dashboard, or the dashboard serving files outside its root;
- anything that lets a remote page reach the local dashboard server (DNS rebinding, CSRF).

Out of scope: vulnerabilities in Notion, ClickUp or Node.js themselves; attacks that already require
control of your machine or your shell environment; findings about test fixtures.

## What ExitOS does to protect you (summary)

Credentials only from the environment; never written to disk by ExitOS; redacted from output. A source
connection that cannot write; a destination connection that can only create. Plans are hash-sealed and
approved by id. The dashboard is loopback-only, read-only, with a strict CSP. Details and evidence:
[docs/security-review.md](docs/security-review.md). That review was written by the maintainers; there has been
no independent audit or penetration test, so treat these as tested claims, not certification.

## Safe handling tips for users

- Use a **Notion internal connection with only the _Read content_ capability**, shared with just the
  pages you want to migrate, rather than a personal access token.
- Try a **test ClickUp Workspace** first; ClickUp personal tokens act as you.
- `.exitos/`, `migration-plan.json` and reports contain _your content_: keep them out of git and
  delete them when you are done.
- Revoke or rotate tokens after a migration.
