# Market thesis (hypotheses, not facts)

> **Read this as a set of falsifiable hypotheses.** There are **no market sizes, revenue figures,
> customer counts or growth numbers** in this document because none have been measured, and none
> have been invented. Anything stated as a belief is marked **[H]** (hypothesis) and paired with the
> evidence that would confirm or kill it. The only verified facts are in
> [competitive-landscape.md](competitive-landscape.md) and [api-verification.md](api-verification.md).

## 1. The problem: software portability

People and teams routinely move between software products — task trackers, wikis, CRMs, help desks.
Today's options are (a) the destination's importer, (b) a paid migration service, (c) automation glue, or
(d) manual copy-paste. The recurring pain points that are _documented_ by vendors themselves (e.g.
ClickUp's own list of what its Notion importer does not import) are: no preview, content that silently
changes shape, and no per-run account of what was lost.

**[H1]** For a meaningful set of switchers, the blocker is not the cost of migrating but the _fear of
not knowing what will be lost_. _Confirm if:_ in user conversations, "I can't tell what I'd lose" is a
top-3 reason people delay or abandon a switch. _Kill if:_ people mostly cite cost, effort, or training.

## 2. Target customer and initial wedge

**Wedge (as built):** technical operators and consultants moving a **Notion database/wiki into
ClickUp** who need a repeatable, reviewable, resumable run and a loss report they can hand to a client.

**[H2]** Consultants/agencies who do this more than once value the plan + report artifact enough to
adopt a CLI. _Confirm if:_ ≥ N independent consultants reuse it for a second client (N to be set before
launch, not after). _Kill if:_ they prefer the free importer once they see its limits.

**[H3]** A narrow, excellent pair beats a broad, shallow catalogue for early credibility. _Confirm if:_
live-validated Notion → ClickUp earns contributions and validation reports before a second pair exists.

## 3. Existing alternatives

Documented in [competitive-landscape.md](competitive-landscape.md): ClickUp's native importer (free,
first-party, ZIP-based, no documented preview), multi-app migration SaaS (e.g. Import2 — Notion not
listed as a source when checked), sync/automation tools (Unito, Zapier, Make, n8n), ELT frameworks
(Airbyte, Meltano, dlt), exporters, and ad-hoc AI-agent workflows over the vendors' MCP servers. The
analysis explicitly records where incumbents are better.

## 4. Why a horizontal connector engine might have an advantage

**[H4]** Safety, planning, resumption, reconciliation and honest reporting are _the same problem
for every pair_. A shared engine means each new connector inherits them, and the normalized model makes
the loss report comparable across tools. _Confirm if:_ a second connector is built by a third party
with materially less effort than the first, using the SDK and conformance kit. _Kill if:_ every pair
needs bespoke planning/verification logic that the shared core cannot express.

**[H5]** Per-pair expertise (field semantics, API quirks) is the real moat, not the engine — so
community-maintained connectors with fixtures matter more than the core. _Watch:_ who maintains
connectors after the first month.

## 5. Open-source distribution strategy

- Apache-2.0, local-first, no accounts, a **zero-credential offline demo** as the top of the funnel.
- Trust is the product: honest limits, public ADRs, reproducible demo, redacted reports for support.
- Contribution surface: connectors, fixtures, validation runs, translations.
- Channels: developer communities and consultant forums (see [launch-plan.md](launch-plan.md));
  no purchased attention.

**[H6]** A runnable demo that visibly tells the truth about loss converts better than a feature
list. _Confirm if:_ demo completions (self-reported / via issues) correlate with live validation runs.

## 6. Potential enterprise offerings (hypotheses)

None built. If real usage appears, the plausible directions are:

- **Managed/hosted runs** for teams that cannot run a CLI (but local-first is the trust differentiator;
  a hosted offering would need to earn that trust back).
- **Audit and compliance packs:** signed plans, retained evidence, approval workflows, SSO for a
  review UI.
- **Support and SLAs** for connector maintenance and API-drift response.
- **Private connectors** for in-house systems.
- **Large-scale operation:** streaming extraction, scheduling windows, rate-limit sharing across
  tokens, multi-workspace orchestration.

## 7. Monetization hypotheses

**[H7]** Open core: the engine and public connectors stay free; money comes from hosted operation,
audit/compliance features and support. _Confirm if:_ organisations ask for those specifically.
**[H8]** Per-migration pricing for assisted/managed runs. **[H9]** Partnerships with
consultancies. None is validated; **no pricing or revenue projection is offered.**

## 8. Major risks

| Risk                 | Why it matters                                                                                                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Competitive**      | ClickUp or Import2 add a preview/loss report; AI agents with MCP servers do ad-hoc migrations; the free importer is "good enough".                                                                                               |
| **API**              | Notion and ClickUp change APIs (Notion already changed to data sources in 2025-09-03; ClickUp Docs is v3). Terms of service or rate limits could limit bulk use. ClickUp cannot create Custom Fields via API, limiting fidelity. |
| **Fidelity & trust** | A loss report that over-claims is worse than none. Live validation is **not done yet**.                                                                                                                                          |
| **Business**         | Migration is a one-time event (low repeat usage); small willingness to pay; consulting-shaped demand; support burden; liability if a migration damages data (hence the create-only design).                                      |
| **Execution**        | One maintainer; connector upkeep is perpetual; breadth is expensive.                                                                                                                                                             |
| **Legal/brand**      | The working name has not been trademark-cleared ([naming.md](naming.md)).                                                                                                                                                        |

## 9. Metrics required before fundraising (or before building a business around this)

Measured, not projected. Suggested thresholds are to be **decided before** looking at the data:

1. **Live-validated** migrations: number of independent real-workspace runs, with success/failure and
   reasons (from redacted reports).
2. **Demo-to-live conversion:** of people who complete the demo, how many attempt a real plan.
3. **Repeat use:** users/consultants who run it for a _second_ migration.
4. **Connector health:** time to fix after an upstream API change; number of external connector
   contributors.
5. **Support load:** issues per migration; fraction caused by ExitOS vs. API limits.
6. **Willingness to pay:** structured interviews with ≥ 10 target users about managed/audit
   offerings, including what they pay today (importers, consultants, hours).
7. **Retention of trust:** zero incidents of data loss or credential exposure.

If (1)–(3) are weak, the right conclusion may be "great open-source utility, not a company" — and that
is a fine outcome for this project.
