# ExitOS Competitive Landscape

Last verified: 2026-10-08

## Intro

ExitOS v0.1 is a local-first, Apache-2.0 CLI and library. It supports exactly one source/destination pair: a Notion database (data source) to ClickUp tasks, and Notion pages to ClickUp Docs. Its workflow is a read-only dry-run plan, explicit approval, checkpointed apply/resume, and a verification report that lists what could not be preserved.

This document surveys existing tools that overlap with that job, to test whether the differentiation is real. It was built from vendor documentation pages, GitHub metadata pulled through the GitHub API, and web searches on 2026-10-08. It is not exhaustive. Conventions:

- **NV** means "not verified": I could not confirm it from a primary source.
- Star counts and "last push" dates come from the GitHub API on 2026-10-08. "Last push" is the date of the latest commit push, not a release date.
- Pricing is recorded only where a page showed it. Most vendor pages did not.
- Third-party blog claims are flagged as such. Where a vendor's help page and a blog disagree, both are noted.

Headline finding: I found no tool, commercial or open source, that offers Notion to ClickUp migration together with a read-only plan, an approval gate, checkpoint/resume and a per-run "not preserved" report. That is a statement about what my searches turned up, not proof that no such tool exists.

## Alternatives table

Legend: Y = yes (seen on a primary page), N = no (seen or explicitly absent), NV = not verified.

| Name | Type | License / pricing as observed | Notion to ClickUp | Dry-run / preview | Reports unsupported content | Local-first / self-hosted | Source URL |
|---|---|---|---|---|---|---|---|
| ClickUp native Notion importer | Vendor feature (closed) | "Unlimited Notion imports ... on all ClickUp plans"; up to 60 imports/day | Y. Takes a Notion HTML export ZIP; databases become Lists in one Folder; fields become Text Custom Fields; pages become one Doc with subpages | No preview documented (ClickUp's own guide mentions none and advises testing first) | Static "does not import" list in docs only; a per-run report is NV | N. Web app only, file upload | https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion |
| Notion native export | Vendor feature (closed) | Pricing/plan gating NV | Source side only (Markdown+CSV, HTML, PDF) | N/A | Docs list some exclusions (see Sources); no per-run report | N. Cloud export, emailed or downloaded link | https://www.notion.com/help/export-your-content |
| Import2 | Commercial SaaS | Pricing not shown on pages read; "free sample migration", money-back guarantee, SOC2 Type II claimed | N. ClickUp is listed as a supported app; Notion is not listed on the apps page (checked 2026-10-08) | Y. "Free sample migration" to check records, fields, relationships before paying | NV | N. Hosted | https://www.import2.com and https://www.import2.com/apps |
| Help Desk Migration | Commercial SaaS | Pricing not disclosed on page; free unlimited demo | N. Help desk / ITSM / PSA / knowledge-base focus; no Notion or ClickUp mention | Y. Free demo | NV | N. Hosted | https://help-desk-migration.com/ |
| Trujay | Commercial SaaS | NV | NV. trujay.com 301-redirects to syncmatters.com, which is CRM-focused with no Notion/ClickUp mention | NV | NV | N | https://syncmatters.com/ |
| Migrate2 | Commercial SaaS (unconfirmed) | NV | NV. No evidence found | NV | NV | NV | none found |
| Unito | Commercial SaaS (two-way sync) | 14-day free trial, no card; plan prices not shown; self-serve (Basic, Pro) and enterprise (Standard, Premium, On-Prem, custom) | Partial. A ClickUp-Notion sync integration exists; it is sync, not migration. "Historical data" sync is offered. One-time migration with a fidelity report is not described | NV | NV | Mostly N. An "On-Prem" enterprise plan exists (custom pricing) | https://unito.io/integrations/clickup-notion/ and https://unito.io/pricing/ |
| Zapier | Commercial SaaS automation | Free tier exists; prices NV | Partial. Template "Create ClickUp tasks from new Notion database items"; ClickUp actions include Create Task, Create New Document, Create New Document Page. Event-driven; bulk backfill of existing rows NV | N | N | N | https://zapier.com/apps/notion/integrations/clickup |
| Make | Commercial SaaS automation | Free plan, no time limit; limits NV | Partial. Notion trigger "Watch Data Source Items" and ClickUp "Create a Task" modules exist. Event-driven; backfill NV | N | N | N | https://www.make.com/en/integrations/notion/clickup |
| n8n | Fair-code automation (Sustainable Use License; not OSI open source) | GitHub shows license "other"; ~206,885 stars; last push 2026-10-08; hosted pricing NV | Partial. Notion and ClickUp nodes exist in repo; community templates for Notion-ClickUp sync exist (third-party sites). Event-driven | N | N | Self-hosting NV on a primary page; code is public | https://github.com/n8n-io/n8n |
| Activepieces | Automation (MIT outside `ee` dirs) | ~24,948 stars; last push 2026-10-08 | Partial. `notion` and `clickup` pieces exist in repo. Event-driven | N | N | Self-hosting NV on a primary page | https://github.com/activepieces/activepieces |
| Airbyte | ELT framework | Repo LICENSE is Elastic License 2.0 (not OSI open source); ~22,189 stars; last push 2026-10-08 | N. `source-notion` (certified) and `source-clickup-api` (community) exist; no Notion or ClickUp destination connector in the repo | N | N | Y, self-hostable (per repo description) | https://github.com/airbytehq/airbyte |
| Meltano / Singer | ELT framework | Meltano MIT; ~2,647 stars; last push 2026-10-08. Singer getting-started repo ~1,351 stars, last push 2025-08-08 | N. Hub lists `tap-notion` and `tap-clickup`; community `TicketSwap/target-notion` exists; no `target-clickup` seen (search not exhaustive) | N | N | Y | https://hub.meltano.com/extractors/tap-notion |
| dlt | Python load library | Apache-2.0; ~5,941 stars; last push 2026-10-08 | N. Verified Notion source (databases only, per README); destinations are warehouses/databases, none for ClickUp | N | N | Y | https://github.com/dlt-hub/verified-sources (sources/notion) |
| Data Transfer Project | Portability framework | Apache-2.0; ~3,625 stars; last push 2026-09-15 | N. Adapter list has no Notion or ClickUp | NV | NV | Y (self-hostable framework, per repo) | https://github.com/dtinit/data-transfer-project |
| yannbolliger/notion-exporter | Notion exporter CLI/lib | MIT; ~189 stars; last push 2026-01-12 | N. Export only. Uses Notion's internal export API with browser cookies; README says it "may break anytime" | N | N | Y | https://github.com/yannbolliger/notion-exporter |
| souvikinator/notion-to-md | Notion converter lib | MIT; ~1,740 stars; last push 2026-01-27 | N. Notion to Markdown/MDX/HTML etc. | N | N | Y | https://github.com/souvikinator/notion-to-md |
| echo724/notion2md | Notion exporter CLI | MIT; ~758 stars; last push 2024-01-10 | N | N | N | Y | https://github.com/echo724/notion2md |
| darobin/notion-backup | Notion backup script | MIT; ~439 stars; last push 2024-10-03 | N. Backup only | N | N | Y | https://github.com/darobin/notion-backup |
| upleveled/notion-backup | Notion backup (GH Action) | License none shown; ~84 stars; last push 2026-10-05 | N. Backup only | N | N | Y | https://github.com/upleveled/notion-backup |
| bitbonsai/notion2obsidian | Notion export migrator | MIT; ~120 stars; last push 2025-10-15 | N. Targets Obsidian | Y. Documented dry-run mode | NV | Y | https://github.com/bitbonsai/notion2obsidian |
| tommeier/basecamp-to-notion | Migration CLI (Ruby) | MIT; ~5 stars; last push 2025-07-15 | N. Basecamp to Notion (opposite direction/pair). Design is close to ExitOS: SQLite progress DB, checkpoint resume, final per-item sync report | No dry-run documented in README read | Final sync report lists per-item status; "not preserved" content NV | Y | https://github.com/tommeier/basecamp-to-notion |
| konscodes/clickup_notion_migrator | Migration script (Python) | MIT; 0 stars; last push 2025-10-27 | N. ClickUp to Notion (reverse) | NV | NV | Y | https://github.com/konscodes/clickup_notion_migrator |
| AnkurAhire/NOTION-TO-CLICKUP-MIGRATION | Script repo | No license; 0 stars; last push 2025-08-14; no description; only `app/` and `.gitignore` seen; code not reviewed | NV. Name suggests Notion to ClickUp; function unverified | NV | NV | NV | https://github.com/AnkurAhire/NOTION-TO-CLICKUP-MIGRATION |
| Notion MCP + ClickUp MCP with an AI agent | Ad-hoc agent workflow | Notion MCP server: MIT, ~4,664 stars, last push 2026-09-20. ClickUp hosted MCP: official, all plans; without the AI add-on, call caps per 24h of 100 (Free) up to 5,000 (Enterprise), per ClickUp blog | Possible ad hoc, no purpose-built migration logic seen | N | N | Partly. Hosted endpoints, local agent | https://clickup.com/blog/how-to-use-clickup-mcp-server/ and https://github.com/makenotion/notion-mcp-server |
| Other importers (Asana, Jira, Trello, Notion's own import) | Vendor features | Not applicable | N. ClickUp's importer list covers Asana, Basecamp, Confluence, Jira, Monday, Trello, Wrike, Todoist, and Notion. Notion's import page lists Evernote, Trello, Asana, Confluence, Monday etc., and does not mention ClickUp. Asana's import article content could not be read (NV) | NV | NV | N | https://help.clickup.com/hc/en-us/sections/17043100285463-Import-and-Export |

Not a competitor but adjacent: Auvaria's "Notion Migration" on AWS Marketplace is a consulting service for migrating into Notion, with private-offer pricing only (https://aws.amazon.com/marketplace/pp/prodview-mfemccsrh3nfi). The `jeremylongshore` agent-skills repo contains a "clickup-migration-deep-dive" skill; per the page I read it covers Jira/Asana/Trello/workspace moves, not Notion, and has no dry-run, resume or reporting.

## Where existing tools are strong

- **ClickUp's importer is free, first-party and already covers the main case.** It handles a whole workspace in one pass, maps Notion users to ClickUp users (or invites them, or creates inactive users), and needs no API tokens. Unlimited Notion imports are allowed on all plans. ExitOS cannot beat "free and built in" on convenience.
- **Importer breadth.** ClickUp imports from at least Asana, Basecamp, Confluence, Jira, Monday, Trello, Wrike and Todoist. Import2 lists roughly 50 apps and has human help, a money-back guarantee and a free sample migration. ExitOS has one pair.
- **Sync and automation tools solve ongoing integration.** Unito (two-way, historical sync, SOC 2 Type 2 claimed), Zapier, Make, n8n and Activepieces are mature and no-code or low-code. If the goal is to run both apps side by side, they fit better than a one-shot migrator.
- **ELT frameworks have scale and community.** Airbyte (~22k stars), dlt (~5.9k) and Meltano (~2.6k) have large user bases, incremental state handling and certified Notion extraction (Airbyte `source-notion` is "certified"). They are mature for getting Notion data into warehouses.
- **Notion exporters are mature.** `notion-to-md` has ~1.7k stars and a real Markdown conversion engine. For getting Notion content out as files, existing tools are further along than ExitOS needs to be.
- **Vendor-maintained against API change.** ClickUp and Notion maintain their own importer and exporter. A third-party tool must track Notion's API changes itself (for example the 2025-09-03 version moved database operations to `data_source_id`).

## Where gaps remain

Findings from ClickUp's own help page (fetched 2026-10-08) and the surrounding docs:

- **No documented preview.** ClickUp's help page and its migration guide (dated 2026-02-12 per the fetch) describe no dry-run or preview. The guide says only to test in a controlled environment.
- **Documented losses.** The help page lists as not importing: inline database task comments, task descriptions and attachments, button fields, page history, and wikis (Wikis are created at the Doc level; you convert imported Docs afterward). Toggles, checkboxes, callouts, table of contents, cover images, bookmarks, columns, dividers, videos, buttons, page icons and code blocks arrive as plain text or bullets. Percent signs on number fields are dropped; currency-formatted numbers become a Money field.
- **Field typing.** Notion fields import as Text Custom Fields (the page's only stated exception is number and currency handling). Typed mapping (select, date, person, etc.) is not described.
- **Relations and rollups: unclear.** The help page does not list relations or rollups at all. ClickUp's blog says "basic relationships" transfer, while other third-party guides advise recreating relations and rollups by hand. Treat as NV until tested.
- **Permissions do not map.** Stated by third-party summaries of ClickUp's guidance; NV on the help page itself.
- **Manual, file-based first step.** The importer requires a Notion HTML export. Notion says exports "can take up to 30 hours to process" for large workspaces, private pages of other users are excluded, and (per the fetched summary) download links expire in 7 days. You cannot choose a subset of rows or preview mappings inside the importer.
- **User-reported problems, anecdotal.** A ClickUp feedback thread (launched Feb 2024) contains user reports of empty cards, task names not mapping, and partial counts (one user: 605 of 607 tasks, 40 of 793 docs). These are unverified user claims and may predate fixes.
- **No per-run, machine-readable account of what was lost.** I found no incumbent that emits a post-run list of items and properties that could not be preserved. Docs-level static lists exist; run-level reports were not seen.
- **No approval gate or resume.** None of the tools surveyed for this pair were seen to offer an explicit approval step or checkpointed resume. Only `basecamp-to-notion` (a different pair) documents checkpoint/resume with a progress database.
- **Automation tools are event-driven.** Zapier, Make and n8n templates trigger on new or updated items. Whether they can backfill an existing database of thousands of rows safely is NV, and none provide a fidelity report.
- **Local-first.** Every SaaS option here runs in the vendor's cloud. Fully local options are generic ELT frameworks or exporters, none of which write to ClickUp.

## Honest differentiation for ExitOS

What ExitOS adds on paper, relative to what I found:

1. **A read-only plan before any write**, plus explicit approval. ClickUp's importer documents no preview; Import2's "free sample migration" is the closest, but it runs inside a hosted service and its output format is NV.
2. **Checkpointed apply/resume** for the Notion-to-ClickUp pair. Not seen in the importer or automation tools.
3. **A verification report of what could not be preserved**, per run. ClickUp documents losses statically; ExitOS can make them concrete per item. This only helps if ExitOS actually detects losses reliably (see Risks).
4. **Local-first and Apache-2.0.** Data stays on the user's machine except for calls to the Notion and ClickUp APIs. This matters mainly to privacy-sensitive or regulated users.
5. **API-based reading and writing** rather than a ZIP upload. This may allow typed field mapping and selective migration of one data source. That is a design opportunity, not a delivered feature; ClickUp's importer is documented to create Text Custom Fields.

Where incumbents are better, stated plainly:

- ClickUp's importer is free, supported by the vendor, handles a whole workspace and user mapping, and requires no tokens. For a team that just wants to move over, it is the lower-effort path and may be adequate.
- ExitOS v0.1 is one source/destination pair. Import2, Unito and the ELT tools cover many apps. ExitOS has no breadth advantage and should not claim "portability OS" scope in v0.1 copy.
- ExitOS is a CLI and library. Non-technical admins will find a web importer easier.
- Rate limits will shape ExitOS speed. ClickUp's public API allows 100 requests/minute per token on Free Forever, Unlimited and Business plans (1,000 on Business Plus, 10,000 on Enterprise). Notion's API documents 180 requests/minute on non-Business plans and 600 on Business/Enterprise, with payload caps of 1000 blocks and 500KB per request and 2000 characters per rich-text item. Large workspaces will be slow, and the vendor importer is not subject to these client-side limits.
- A new project has no track record. The nearest open-source Notion-to-ClickUp repo I found has 0 stars and no documentation; the nearest design-pattern match has ~5 stars. Social proof for ExitOS will be zero at launch, versus a vendor feature or a SOC2-certified service.

## Risks to the differentiation

- **ClickUp could add a preview or loss report to its importer.** It is a cheap feature for a first-party tool. I saw no announcement; this is a risk, not a finding.
- **Import2 or another multi-app vendor could add Notion.** Import2 already offers a free sample migration and ClickUp as a destination. Notion was not on its apps list on 2026-10-08.
- **Loss detection is only as good as ExitOS's coverage.** A report that claims "everything else was preserved" when it was not is worse than none. It needs a fixture corpus of Notion block types and property types and tests against real ClickUp output.
- **API drift.** Notion changed the API to data sources (version 2025-09-03, not backward compatible) and ClickUp's Docs API is v3. Both can change again. A hobby-scale project must keep up.
- **Plan accuracy.** A dry-run plan cannot predict every write failure (ClickUp rate limits, validation errors, plan limits such as Free Forever's 60 Custom Fields, 100 Lists and Folders per Space, and 60 MB attachment storage). The report must state that the plan is a prediction.
- **AI-agent workflows.** Notion's and ClickUp's MCP servers let an LLM agent attempt ad hoc migrations today. They lack plan/approval/resume discipline and are constrained by ClickUp MCP call caps on lower plans, but they will keep improving and some users will prefer them.
- **Small willingness to pay and a niche trigger.** Migration is a one-time event, and a free native importer exists. Adoption may depend on users who tried the importer and hit its limits.
- **Coverage of this research.** GitHub keyword searches and web searches are not exhaustive. Private tools, consultants, other languages, and recently launched projects may be missed. Re-run the searches before launch.

## Sources

ClickUp
- Import from Notion (help center, fetched 2026-10-08; the "Notion import FAQ" URL returned the same article): https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion
- Import and export feature availability and limits (unlimited imports; 60/day; Free Forever caps): https://help.clickup.com/hc/en-us/articles/30782347809815-Importing-feature-availability-and-limits
- Import and Export section (list of importers): https://help.clickup.com/hc/en-us/sections/17043100285463-Import-and-Export
- ClickUp blog, migrate Notion to ClickUp (published 2026-02-12 per fetch): https://clickup.com/blog/how-to-migrate-from-notion-to-clickup/
- ClickUp feedback thread on the Notion importer (user reports, anecdotal): https://feedback.clickup.com/integrations/p/notion-import
- ClickUp API rate limits: https://developer.clickup.com/docs/rate-limits
- ClickUp Docs API, create a page: https://developer.clickup.com/reference/createpagepublic
- ClickUp MCP server blog (published 2026-09-08 per fetch): https://clickup.com/blog/how-to-use-clickup-mcp-server/

Notion
- Export your content: https://www.notion.com/help/export-your-content
- Import data into Notion: https://www.notion.com/help/import-data-into-notion
- API request limits: https://developers.notion.com/reference/request-limits
- API upgrade guide 2025-09-03: https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03
- Notion MCP server: https://github.com/makenotion/notion-mcp-server

Commercial tools
- Import2: https://www.import2.com and https://www.import2.com/apps
- Help Desk Migration: https://help-desk-migration.com/
- Trujay redirect target (SyncMatters): https://syncmatters.com/
- Unito: https://unito.io/integrations/clickup-notion/ and https://unito.io/pricing/
- Zapier: https://zapier.com/apps/notion/integrations/clickup
- Make: https://www.make.com/en/integrations/notion/clickup
- Auvaria Notion Migration (AWS Marketplace): https://aws.amazon.com/marketplace/pp/prodview-mfemccsrh3nfi

Open source and frameworks (stars and push dates from the GitHub API, 2026-10-08)
- https://github.com/n8n-io/n8n
- https://github.com/activepieces/activepieces
- https://github.com/airbytehq/airbyte (LICENSE: Elastic License 2.0; connector metadata `source-notion`, `source-clickup-api`)
- https://github.com/meltano/meltano and https://hub.meltano.com/extractors/tap-notion and https://hub.meltano.com/extractors/tap-clickup
- https://github.com/singer-io/getting-started
- https://github.com/dlt-hub/dlt and https://github.com/dlt-hub/verified-sources
- https://github.com/dtinit/data-transfer-project
- https://github.com/yannbolliger/notion-exporter
- https://github.com/souvikinator/notion-to-md
- https://github.com/echo724/notion2md
- https://github.com/darobin/notion-backup
- https://github.com/upleveled/notion-backup
- https://github.com/bitbonsai/notion2obsidian
- https://github.com/tommeier/basecamp-to-notion
- https://github.com/konscodes/clickup_notion_migrator
- https://github.com/AnkurAhire/NOTION-TO-CLICKUP-MIGRATION
- https://github.com/TicketSwap/target-notion
- Agent-skills page for "clickup-migration-deep-dive": https://claudeskills.info/skills/jeremylongshore/claude-code-plugins-plus-skills/clickup-migration-deep-dive/
