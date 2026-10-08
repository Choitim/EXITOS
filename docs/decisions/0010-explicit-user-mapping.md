# 0010 — Explicit user mapping; assignment is opt-in

**Status:** accepted

## Context

Notion user IDs are unrelated to ClickUp user IDs. Notion only returns e-mail addresses if the
connection has the user-information capability. ClickUp notifies assignees of API-created tasks.

## Decision

- No user ID is ever assumed to match across systems.
- `users.map` in the config maps a Notion user ID or e-mail to a ClickUp user ID. The planner
  validates each target against `GET /v2/team` members.
- `users.matchByEmail: true` (default **false**) additionally auto-suggests matches by exact,
  case-insensitive e-mail equality; every suggested match is listed in the plan.
- Unmapped people are never assigned. Their names are preserved as text in the task description
  (setting `users.unmapped: "description" | "ignore"`) and counted as findings.
- Tasks are created with `notify_all: false`; the plan prints how many assignees will be notified.

## Consequences

A first run with no mapping produces unassigned tasks and a clear list of people to map — safe by
default, and never spams anybody.
