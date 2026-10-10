# Market thesis (hypotheses, not facts)

> **Read this as a set of falsifiable hypotheses.** There are **no market sizes, revenue figures,
> customer counts or growth numbers** in this document because none have been measured, and none
> have been invented. Anything stated as a belief is marked **[H]** (hypothesis) and paired with the
> evidence that would confirm or kill it. The only verified facts are in
> [competitive-landscape.md](competitive-landscape.md) and [api-verification.md](api-verification.md).

## 1. The problem: software portability

People and teams routinely move between software products — task trackers, wikis, CRMs, help desks.
Today's options are (a) the destination's importer, (b) a paid migration service, (c) automation glue, or
(d) manual copy-paste. What vendors themselves _document_ (e.g. ClickUp's own list of what its Notion
importer does not import) is: content that arrives in a different shape or not at all, and no preview
in the Notion importer's help page. ClickUp does keep a per-import report with errors and lets you delete
an import made in the last 10 days; a per-item list of lossy conversions is not documented
([competitive-landscape.md](competitive-landscape.md), read 2026-10-09). The pain is therefore narrower than
"vendor importers are black boxes": it is "I cannot read a plan, with the losses sorted, before I run it".

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
first-party, ZIP-based, no documented preview, with an import report and a 10-day delete), ClickUp's
Spreadsheets importer (live data preview during field mapping), multi-app migration SaaS (Import2 offers a
free, reversible sample migration and claims 250+ apps, Notion not listed on the pages read; Help Desk
Migration advertises a demo and an audit report for help-desk platforms), sync/automation tools (Unito,
Skyvia, Zapier, Make, n8n), ELT frameworks (Airbyte, Meltano, dlt), exporters, and ad-hoc AI-agent workflows
over the vendors' MCP servers. The analysis explicitly records where incumbents are better.

**[H10]** Because a preview, a report or a demo migration each exist somewhere, the defensible position is
the _combination_ for a specific pair (a read-only plan with losses sorted, approval by plan id, resumable
apply, read-back verification) together with open source and execution on the user's own machine, not any
single feature. _Confirm if:_ people who tried ClickUp's importer say the missing read-only plan and loss
list is why they try ExitOS. _Kill if:_ they say the importer's own report was enough, or that an
Import2-style sample migration answers the question.

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
- Contribution surface: connectors, fixtures, validation runs, documentation. (Translating finding
  messages needs a message catalogue first; see [good-first-contributions.md](good-first-contributions.md).)
- Channels: developer communities and consultant forums where the rules allow it (see
  [open-source-launch.md](open-source-launch.md)); no purchased attention. There are no users or
  contributors yet, so no distribution result is claimed.

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

| Risk                 | Why it matters                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Competitive**      | ClickUp already has an import report and a 10-day delete, and could add a preview/loss list to its Notion importer; Import2 already offers a free sample migration and could add Notion; AI agents with MCP servers do ad-hoc migrations; the free importer is "good enough". |
| **API**              | Notion and ClickUp change APIs (Notion changed to data sources in 2025-09-03 and shipped breaking changes again in 2026-03-11; ClickUp Docs is v3). Terms of service or rate limits could limit bulk use. ClickUp cannot create Custom Fields via API, limiting fidelity.     |
| **Fidelity & trust** | A loss report that over-claims is worse than none. Live validation is **not done yet**.                                                                                                                                                                                       |
| **Business**         | Migration is a one-time event (low repeat usage); small willingness to pay; consulting-shaped demand; support burden; liability if a migration damages data (hence the create-only design).                                                                                   |
| **Execution**        | One maintainer; connector upkeep is perpetual; breadth is expensive.                                                                                                                                                                                                          |
| **Legal/brand**      | The working name has not been trademark-cleared ([naming.md](naming.md)).                                                                                                                                                                                                     |

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
