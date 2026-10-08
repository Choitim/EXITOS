# 0013 — Corporate proxy support through `undici`, read from the standard environment variables

**Status:** accepted

## Context

Most company networks only allow outbound HTTPS through a proxy. Node's built-in `fetch` ignores
`HTTP_PROXY`/`HTTPS_PROXY` before Node 22.21 and 24 (`--use-env-proxy`), and ExitOS supports Node

> = 22.13, so on a locked-down network every live command failed with a bare `fetch failed`.

## Decision

- The CLI routes live requests through `undici`'s `ProxyAgent` **only when** `HTTPS_PROXY` /
  `HTTP_PROXY` is set (upper- or lower-case; upper-case wins). With none set, the global `fetch` is used
  unchanged, so the default path is exactly what was tested before.
- `NO_PROXY` follows the common convention (`*`, domain-and-subdomains, leading dot for subdomains only,
  optional `:port`); CIDR ranges are not interpreted.
- The variables are read from the **process environment only**, never from `.env`. `.env` keeps its
  five documented keys, so a file that is committed or shared by accident cannot redirect traffic.
- Proxy credentials (`http://user:pass@proxy:8080`) are never printed: every message names
  `scheme://host:port` only, and malformed values are rejected without echoing them.
- Custom CA certificates (TLS-inspecting proxies) are handled by Node itself via
  `NODE_EXTRA_CA_CERTS`; failures now say so (see `describeNetworkFailure`).
- The code lives in `apps/cli` (the only place that opens real connections); connectors still receive a
  plain `FetchLike`, so the write guard, scheduler and tests are unaffected.

## Alternatives considered

- **Wait for Node's `--use-env-proxy`.** Not available on the supported minimum (22.13).
- **`setGlobalDispatcher` from a user-land undici.** Node bundles its own undici, and mixing major
  versions breaks the dispatcher interface (Node 22 bundles 6.x, Node 24+ bundles 7.x/8.x).
- **A hand-written `CONNECT` tunnel.** More code to get wrong than a maintained, dependency-free library.
- **`undici` 8.** Requires Node >= 22.19, above the supported minimum. We use the 7.x line.

## Consequences

One new production dependency (`undici`, MIT, no transitive dependencies; the production tree is now
8 packages, all MIT/ISC, enforced by `pnpm check:licenses`). Behaviour is covered by unit tests against
a real loopback CONNECT proxy and by a test that starts the built CLI as a separate process behind a
refusing proxy. It has **not** been exercised against a real corporate proxy or a real TLS-inspecting
appliance.
