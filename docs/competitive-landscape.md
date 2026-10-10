# ExitOS Competitive Landscape

Last verified: 2026-10-09 (previous version: 2026-10-08; the corrections are listed near the end)

## Intro

ExitOS v0.1 is a local-first, Apache-2.0 CLI and library. It supports exactly one source/destination pair: a Notion database (data source) to ClickUp tasks, plus an experimental path from Notion pages to ClickUp Docs. Its workflow is a read-only plan, explicit approval, checkpointed apply/resume, and a verification report that lists what could not be preserved. It has **not** been validated against live Notion or ClickUp workspaces ([validation log](validation-log.md)).

This document surveys the tools people actually use to move work between Notion and ClickUp, and between project-management tools in general, to test whether ExitOS's differentiation is real. It ends with an [evidence table](#evidence-for-our-positioning) that the README may quote. It is not exhaustive.

How it was built, and how to read it:

- **Access date.** Every URL below was opened on 2026-10-09 unless another date is shown. Prices and limits are quoted as the page showed them that day and change often.
- **"Not documented"** means I looked at the page(s) named in the same entry and found nothing. It is not a claim that the feature does not exist. I did not run any competitor's product, so nothing here says how well any tool works, only what its own pages say.
- **ClickUp help pages.** `help.clickup.com` answered automated page fetchers with HTTP 403. I read the same article bodies through ClickUp's public Help Center API (`https://help.clickup.com/api/v2/help_center/en-us/articles/<id>.json`), which also reports each article's last-updated date. Links below are the normal article URLs.
- **How pages were read.** Where it mattered (ClickUp, Import2, Help Desk Migration, Zapier, n8n, Unito, Skyvia, Notion export, GitHub), key phrases and numbers were checked against the raw page text. The Make pages refused a plain download, so those entries rest on a summarised fetch and are marked.
- **GitHub figures** (stars, license, last push) come from the GitHub API on 2026-10-09. "Last push" is the date of the latest push, not a release date.
- Vendor claims are reported as claims. User reports are anecdotal.

**Headline findings (narrower than the previous version).**

1. I still found no tool, commercial or open source, that offers Notion to ClickUp migration together with a read-only plan, an approval gate, checkpoint/resume and a per-run list of what was not preserved. That describes my searches, not the whole market.
2. Several individual features are **not** unique. ClickUp's Spreadsheets importer documents a live data preview during field mapping. ClickUp's importers keep an import history with a per-import report and let you delete an import made in the last 10 days. Import2 offers a free, reversible sample migration. Help Desk Migration advertises a demo migration and an audit report (for help-desk platforms, not Notion or ClickUp). Marketing copy must not say "the only tool with a preview or a report".
3. What is distinctive is the combination for this pair: a plan that never writes, loss classification in that plan, approval by plan id, resumable apply, read-back verification, open source, and execution on your own machine.

## Alternatives people use, one by one

### ClickUp's native Notion importer (vendor feature)

- **What it does.** You export Notion as HTML (zip), upload it in ClickUp's web app, choose a Space and map or invite users. Databases become Lists in a single Folder, fields become Text Custom Fields (with number and currency exceptions), Notion pages become one Doc with subpages. Workspace users are added as followers of imported tasks.
- **Preview.** Not documented on the help page. ClickUp's blog advises "Run a pilot import with one team or workspace before scaling".
- **Lost or unsupported content.** A static list on the help page: inline-database task comments and task descriptions, inline-database task attachments, button fields, page history and wikis do not import (wikis must be converted from Docs by hand). Toggles, checkboxes, callouts, table of contents, cover images, bookmarks, columns, dividers, videos, buttons, page icons and code blocks arrive as plain text or bullets. A percent sign on a number field is dropped; currency-formatted numbers become a Money field. Page comments can be imported if included in the export; they are added at the bottom of the page. A per-item loss list is not documented.
- **Resume or recovery.** Resume is not documented. Queued or in-progress imports can be cancelled. You can delete an import made in the last 10 days, which deletes every item it created.
- **Verification or report.** Each import has a report (status, items imported, an Errors section, per-entity tabs with the reason each item failed). Whether it lists lossy conversions is not documented.
- **Pricing.** "Unlimited Notion imports are available on all ClickUp plans"; up to 60 imports per day; plan limits still apply afterwards (Free Forever: 60 MB attachment storage, 60 Custom Fields, 100 Lists and Folders per Space).
- **Where data goes.** Web app only: you upload the export file to ClickUp ("You must use our web app to import"). Importing needs an admin or owner role (members only with the Importing permission on Business Plus and Enterprise).
- **Sources (accessed 2026-10-09).** [Import from Notion](https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion) (updated 2026-09-29) · [Manage imports](https://help.clickup.com/hc/en-us/articles/6310875506839-Manage-imports) (2026-10-08) · [Import and export feature availability and limits](https://help.clickup.com/hc/en-us/articles/30782347809815-Import-and-export-feature-availability-and-limits) (2026-09-24) · [ClickUp blog, 2026-02-12](https://clickup.com/blog/how-to-migrate-from-notion-to-clickup/).
- **Inconsistency worth knowing.** The same blog says "Rows, properties, and basic relationships transfer well" in one section and "Notion relations and rollups do not carry over as-is. They must be rebuilt" in another. The help page lists neither. Treat relation handling as undocumented.

### ClickUp's Spreadsheets importer (CSV or Excel)

- **What it does.** Imports CSV, Excel, JSON, TSV or TXT files into existing Lists, Folders or Spaces. A Notion database exported as CSV could be fed to it. ClickUp's Notion article does not describe that route, so treat it as my inference.
- **Preview.** Documented: "The live data preview helps you see the type of data being imported during field mapping", and invalid items are highlighted.
- **Lost or unsupported content.** Not documented for Notion data. Rows only; page bodies are outside what the page describes.
- **Resume, verification.** Resume is not documented. After the import you can open a full-page report from the import history.
- **Pricing and data path.** Same import allowance as above; web app upload.
- **Source.** [Use the Spreadsheets Importer](https://help.clickup.com/hc/en-us/articles/6310834724247-Use-the-Spreadsheets-Importer) (updated 2026-10-09), accessed 2026-10-09.

### Notion's own export (source side)

- **What it does.** Exports pages and databases as Markdown and CSV, HTML or PDF. The page says files, images and comments (page and block level) are included, and that a workspace export "can take up to 30 hours to process"; download links expire after 7 days.
- **Preview, resume, verification.** Not applicable or not documented.
- **Lost content.** Whether content is lost in export is not documented. The page says "You can't instantly recreate your workspace by reuploading your exported workspace content".
- **Pricing and access.** Plan gating is only partly documented (guests need Full access; admins can disable exports).
- **Into ClickUp?** Notion's import page lists Evernote, Trello, Quip, Dropbox Paper, Hackpad, Google Docs, Word, CSV, HTML, Markdown, PDF and others, with Confluence, Asana and Monday.com on their own pages. ClickUp is not listed.
- **Sources (accessed 2026-10-09).** [Export your content](https://www.notion.com/help/export-your-content) · [Import data into Notion](https://www.notion.com/help/import-data-into-notion).

### Import2 (commercial SaaS)

- **What it does.** A hosted migration service. Its pricing page claims "Import and export across 250+ apps". The app list shown there includes ClickUp, Asana, Basecamp, Jira, Linear, Monday, Teamwork and Trello. Notion was not on the homepage, the apps page or the pricing page (checked as raw text).
- **Preview.** A "free sample migration": "Check how your records, fields, and relationships will look in the new system before you pay." The FAQ says the sample "can be reversed", so it writes real sample records to the destination. It is not a read-only plan.
- **Lost or unsupported content.** Not documented.
- **Resume, delta.** Not documented.
- **Verification.** No report is documented. The pricing page promises "a final check before sign-off" in the professional-services tier and a money-back guarantee ("We will refund your fee and clean all imported records").
- **Pricing.** "One-time price, based on your apps and data volume"; full migrations "Starting from $499"; professional services "Starting from $5,000". A free tier for "Up to 500,000 records" is marked "Needed vendor's approve".
- **Where data goes.** Hosted service. It states the source database is never altered ("we only copy the data"). Where the data is hosted is not documented on the pages read. SOC2 Type II certification is claimed.
- **Sources (accessed 2026-10-09).** [import2.com](https://www.import2.com) · [apps](https://www.import2.com/apps) · [pricing](https://www.import2.com/pricing).

### Help Desk Migration (commercial SaaS)

- **What it does.** Moves tickets, contacts, companies and knowledge-base content between help desk, ITSM and PSA platforms ("100+ supported platforms"). Neither Notion nor ClickUp is mentioned on the page.
- **Preview.** "Unlimited free demos"; a demo lets you "test the process and get a clear, upfront price before moving any data".
- **Lost content and verification.** Advertised: "Every migration generates a complete audit report — so you know exactly what moved, what didn't, and why", and "every skipped record includes an actionable reason". This is the closest marketing claim to ExitOS's loss report, in a different product category.
- **Resume or delta.** A customer quote on the homepage mentions a "delta migration to capture any midstream changes".
- **Pricing.** Not shown on the homepage.
- **Where data goes.** Hosted. A "Private Cloud Migration Service" advertises dedicated infrastructure in a chosen AWS region. "SOC 2 Type II & GDPR compliant" is claimed.
- **Source (accessed 2026-10-09).** [help-desk-migration.com](https://help-desk-migration.com/).

### Trujay (now redirects to SyncMatters)

- `trujay.com` redirects to `syncmatters.com`, a CRM integration and migration company (HubSpot, monday.com, Salesforce). Nothing about Notion, ClickUp or project-management migration is documented on the homepage. A "Free trial" for "MigrateMyCRM" and an ISO27001 mention appear; pricing is not shown there.
- **Source (accessed 2026-10-09).** [syncmatters.com](https://syncmatters.com/).

### Migrate2

- `migrate2.com` resolves but redirects to a HugeDomains domain-for-sale page (HTTP `Location: https://www.hugedomains.com/domain_profile.cfm?d=migrate2.com`). I found no migration service by that name and removed it from the comparison.

### Unito (two-way sync, commercial SaaS)

- **What it does.** Keeps ClickUp and Notion in sync ("2-way"), with rules, field mapping ("comments, assignees, and attachments") and historical data ("sync data going back weeks, months and even years with one click"). One-time migration is not documented.
- **Preview, lost content, verification.** Not documented. The page offers "Book a demo with our integration experts".
- **Pricing.** "Try for 14 days"; plans are Basic and Pro (self-serve) and Enterprise (custom); exact prices are "shown in the app during your free trial". SOC 2 Type 2 is claimed.
- **Where data goes.** Cloud service (`app.unito.io`); Enterprise lists "on-prem connectors".
- **Sources (accessed 2026-10-09).** [Unito ClickUp-Notion](https://unito.io/integrations/clickup-notion/) · [pricing](https://unito.io/pricing/).

### Skyvia (cloud data integration)

- **What it does.** Import and bi-directional sync between ClickUp and Notion at table/record level, with filtering and transformations. Migrating Notion page bodies or blocks is not documented.
- **Preview.** Not documented. Results are viewable in a Run History.
- **Pricing.** A free plan with "10 000 loaded records per month" (pricing page: "Records per month 10k"); paid tiers start at Basic, price not shown.
- **Where data goes.** "Operation is executed in a cloud".
- **Sources (accessed 2026-10-09).** [Skyvia ClickUp-Notion](https://skyvia.com/data-integration/integrate-clickup-notion) · [pricing](https://skyvia.com/pricing).

### Zapier, Make and n8n (automation platforms)

- **What they do.** Event-driven workflows. They are not migration tools, but people use them to push new or changed Notion items into ClickUp. Bulk backfill of existing rows is not documented on the pages read. Preview, loss lists, resume and verification are not documented.
- **Zapier.** Notion triggers include "New Data Source Item" and "Updated Properties in Data Source Item"; ClickUp actions include "Create Task", "Create New Document" and "Create New Document Page". Pricing is per task: Free is 100 tasks a month, Professional starts at "$19.99" a month (annual billing) for 750 tasks. Cloud. [Zapier Notion-ClickUp](https://zapier.com/apps/notion/integrations/clickup) · [pricing](https://zapier.com/pricing).
- **Make** (summarised fetch; the pages refused a plain download). A Notion trigger "Watch Data Source Items" and ClickUp modules such as "Create a Task". Free plan "Up to 1,000 credits/mo"; Core "$9/mo" for 10,000 credits. Cloud. [Make Notion-ClickUp](https://www.make.com/en/integrations/notion/clickup) · [pricing](https://www.make.com/en/pricing).
- **n8n.** Fair-code (Sustainable Use License, not OSI open source); the README says "run it self-hosted or in the cloud". Notion and ClickUp nodes exist in the repo (`packages/nodes-base/nodes/Notion`, `.../ClickUp`). Cloud Starter is 20 EUR a month billed annually for 2.5K workflow executions. [n8n repo](https://github.com/n8n-io/n8n) · [pricing](https://n8n.io/pricing/).

### AI agents using the Notion and ClickUp MCP servers

- **What it does.** An LLM agent can read Notion and create ClickUp tasks and Docs through official MCP servers. No migration-specific features (plan, approval, resume, verification) are documented on the pages read.
- **Limits.** ClickUp's hosted MCP server is available on all plans; without the AI add-on the calls per 24 hours are capped at 100 (Free Forever), 300 (Unlimited), 1,000 (Business), 2,500 (Business Plus) and 5,000 (Enterprise). "There's no way to delete Lists, Folders, Docs, or comments through MCP."
- **Sources (accessed 2026-10-09).** [ClickUp MCP blog, 2026-09-08](https://clickup.com/blog/how-to-use-clickup-mcp-server/) · [Notion MCP server](https://github.com/makenotion/notion-mcp-server) (MIT, 4,662 stars, last push 2026-09-20).

### Adjacent, not a competitor

Auvaria's "Notion Migration" on AWS Marketplace is a professional-services offering for moving organizations into Notion, with custom private-offer pricing ([listing](https://aws.amazon.com/marketplace/pp/prodview-mfemccsrh3nfi), accessed 2026-10-09).

## At a glance

"Not documented" is not "no". Entries describe what each vendor's own pages say.

| Tool                         | Read-only preview before writing                           | Per-item loss list             | Resume                | Post-run report or verification                      | Runs on your machine           |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------ | --------------------- | ---------------------------------------------------- | ------------------------------ |
| ClickUp Notion importer      | Not documented                                             | Static list in docs only       | Not documented        | Import report with errors; delete within 10 days     | No (web upload)                |
| ClickUp Spreadsheets importer | Live data preview during field mapping                     | Not documented                 | Not documented        | Full-page import report                              | No (web upload)                |
| Import2                      | Free sample migration (writes sample records; reversible)  | Not documented                 | Not documented        | Not documented                                       | No (hosted)                    |
| Help Desk Migration          | Free demo migration                                        | Claims an audit report         | Delta migration cited | Claims an audit report                               | No (hosted; private cloud)     |
| Unito, Skyvia                | Not documented                                             | Not documented                 | Not documented        | Skyvia: Run History                                  | No (cloud); Unito Enterprise on-prem |
| Zapier, Make                 | Not documented                                             | Not documented                 | Not documented        | Not documented                                       | No (cloud)                     |
| n8n, Activepieces            | Not documented                                             | Not documented                 | Not documented        | Not documented                                       | Yes, self-hostable             |
| MCP + AI agent               | Not documented                                             | Not documented                 | Not documented        | Not documented                                       | Agent local; APIs hosted       |

## Open-source projects and libraries

Stars, license and last push: GitHub API, 2026-10-09. None of these offers Notion to ClickUp migration with a plan and an approval step; the table says what each is.

| Project                                                                                                                               | Facts                                                                                                                                                       | What it is, and what it documents                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [airbytehq/airbyte](https://github.com/airbytehq/airbyte)                                                                             | Root `LICENSE` is Elastic License 2.0 (not OSI open source); 22,199 stars; pushed 2026-10-10                                                                | ELT framework, 600+ connectors claimed, self-hostable. `source-notion` is generally available and certified; `source-clickup-api` is an alpha community connector. No Notion or ClickUp destination connector is in the repo.                              |
| [meltano/meltano](https://github.com/meltano/meltano), [Singer](https://github.com/singer-io/getting-started)                         | Meltano MIT, 2,648 stars, pushed 2026-10-10; Singer guide 1,351 stars, pushed 2025-08-08                                                                    | The Meltano Hub lists `tap-notion` and `tap-clickup`. The hub pages `target-clickup` and `target-notion` return 404. A community `TicketSwap/target-notion` exists (Apache-2.0, 0 stars).                                                                  |
| [dlt-hub/dlt](https://github.com/dlt-hub/dlt), [verified-sources](https://github.com/dlt-hub/verified-sources)                        | Apache-2.0; 5,950 stars; pushed 2026-10-09                                                                                                                  | Python load library. The verified Notion source loads databases only. The destination list has warehouses and databases but no ClickUp.                                                                                                                   |
| [dtinit/data-transfer-project](https://github.com/dtinit/data-transfer-project)                                                       | Apache-2.0; 3,625 stars; pushed 2026-10-08                                                                                                                  | Portability framework; adapters are for consumer services (Google, Microsoft, Apple and others). No Notion or ClickUp adapter.                                                                                                                            |
| [activepieces/activepieces](https://github.com/activepieces/activepieces)                                                             | MIT outside `ee` directories (per `LICENSE` and README); 24,970 stars; pushed 2026-10-10                                                                    | Automation platform with `notion` and `clickup` pieces. The README says "Self-hosted and network-gapped".                                                                                                                                                 |
| [yannbolliger/notion-exporter](https://github.com/yannbolliger/notion-exporter)                                                       | MIT; 189 stars; pushed 2026-01-12                                                                                                                           | Exports Notion to Markdown and CSV via an "official _but internal_" export API using the `token_v2` cookie; the README warns it "may break anytime".                                                                                                      |
| [souvikinator/notion-to-md](https://github.com/souvikinator/notion-to-md), [echo724/notion2md](https://github.com/echo724/notion2md) | MIT; 1,740 stars (pushed 2026-01-27) and 758 stars (pushed 2024-01-10)                                                                                      | Notion to Markdown converters. Export only.                                                                                                                                                                                                               |
| [darobin/notion-backup](https://github.com/darobin/notion-backup), [upleveled/notion-backup](https://github.com/upleveled/notion-backup) | MIT, 439 stars, pushed 2024-10-03 (README: "I am no longer maintaining this"); no license shown, 84 stars, pushed 2026-10-10                              | Notion backup scripts for GitHub workflows. Backup only.                                                                                                                                                                                                  |
| [bitbonsai/notion2obsidian](https://github.com/bitbonsai/notion2obsidian)                                                             | MIT; 120 stars; pushed 2025-10-15                                                                                                                           | Migrates a Notion export to Obsidian. Documents a dry-run mode ("Preview changes without modifying files"). Different destination.                                                                                                                       |
| [tommeier/basecamp-to-notion](https://github.com/tommeier/basecamp-to-notion)                                                         | MIT; 5 stars; pushed 2025-07-15                                                                                                                             | Basecamp to Notion (a different pair). Its README documents checkpoint resume, a SQLite progress database and a final per-item sync report (`sync_report.json`). No dry-run is documented. The design is close to ExitOS's.                              |
| [konscodes/clickup_notion_migrator](https://github.com/konscodes/clickup_notion_migrator)                                             | MIT; 0 stars; pushed 2025-10-27                                                                                                                             | ClickUp to Notion (the reverse direction). README lists duplicate prevention, pagination, rate limiting and error recovery.                                                                                                                               |
| [AnkurAhire/NOTION-TO-CLICKUP-MIGRATION](https://github.com/AnkurAhire/NOTION-TO-CLICKUP-MIGRATION)                                   | No license; 0 stars; pushed 2025-08-14; no README                                                                                                           | Five Python files (659 lines) that read Notion (`Notion-Version: 2022-06-28`) and create ClickUp tasks, including attachment upload. A keyword search for dry-run, resume, checkpoint, verify, preview and approve found nothing. Not a full code review. |
| [tristangodfrey/migrator](https://github.com/tristangodfrey/migrator)                                                                 | GPL-3.0; 0 stars; pushed 2022-04-17                                                                                                                         | Described as "Generic migration tool (currently only supports ClickUp -> Notion and vice versa)". The repository tree contains only `LICENSE`.                                                                                                            |
| ["clickup-migration-deep-dive" agent skill](https://claudeskills.info/skills/jeremylongshore/claude-code-plugins-plus-skills/clickup-migration-deep-dive/) | Third-party skill page                                                                                                                                      | Covers Trello, Asana, Jira and ClickUp-to-ClickUp migrations through API v2, and includes a validation step that compares task names with source items. Notion, dry-run and resume are not documented.                                                    |

## Where existing tools are strong

- **ClickUp's importer is free, first-party and already covers the main case.** It handles a whole workspace in one pass, maps Notion users (or invites them, or creates inactive users), needs no API token, keeps an import history with error details, and lets you undo an import made in the last 10 days. ExitOS cannot beat "free and built in" on convenience, and it has no undo.
- **Importer breadth.** ClickUp lists importers for Asana, Basecamp, Confluence, Jira, Monday, Notion, Todoist, Teamwork, Trello, Slack and Wrike. Import2 claims 250+ apps and offers human help and a money-back guarantee. Help Desk Migration claims 100+ platforms. ExitOS has one pair.
- **Sync and automation tools solve ongoing integration.** Unito (two-way, historical sync, SOC 2 Type 2 claimed), Zapier, Make, n8n, Activepieces and Skyvia are mature. If the goal is to run both apps side by side, they fit better than a one-shot migrator.
- **ELT frameworks have scale and community.** Airbyte, dlt and Meltano have large user bases and incremental state handling, and they are mature for getting Notion data into warehouses.
- **Notion exporters are mature.** `notion-to-md` has a real Markdown conversion engine. For getting Notion content out as files, existing tools are further along than ExitOS needs to be.
- **Vendor-maintained against API change.** ClickUp and Notion maintain their own importer and exporter. A third-party tool must track API changes itself: Notion's 2025-09-03 version moved database operations to `data_source_id` and its 2026-03-11 version renamed `archived` to `in_trash`, replaced `after` with `position` and renamed the `transcription` block to `meeting_notes`.
- **Commercial services carry assurance ExitOS lacks.** SOC 2 Type II (Import2, Help Desk Migration), money-back guarantees, support staff.

## Where gaps remain

Findings from ClickUp's own help center (read 2026-10-09) and the surrounding docs:

- **No documented preview in the Notion importer.** The help article and the blog describe none; the blog says to run a pilot import. (The Spreadsheets importer, a different path, does document a live data preview.)
- **Documented losses are static, not per run.** The list is in [Import from Notion](https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion). The per-import report documents status, counts and errors; a per-item list of lossy conversions is not documented.
- **Field typing.** Notion fields import as Text Custom Fields (number and currency are the stated exceptions). Typed mapping (select, date, person) is not described.
- **Relations and rollups are unclear.** The help page lists neither; the blog contradicts itself (see above).
- **Permissions do not map.** ClickUp's blog: "Notion permissions don't migrate."
- **Manual, file-based first step.** The importer needs a Notion HTML export. Notion says a workspace export "can take up to 30 hours to process" and download links expire after 7 days. You cannot choose a subset of rows or see the mapping before you import.
- **User-reported problems, anecdotal.** A ClickUp feedback thread (opened 2024-02-15; status "Completed"; latest comment seen 2024-08-29) contains reports of empty cards, task names not mapping, and partial counts ("605 of 607 tasks and 40 of 793 docs"). These are unverified claims and may predate fixes.
- **No approval gate or checkpoint/resume documented** for any tool surveyed for this pair. Only `basecamp-to-notion` (a different pair) documents checkpoint/resume with a progress database.
- **Automation tools are event-driven.** Whether Zapier, Make or n8n can backfill an existing database of thousands of rows safely is not documented, and none document a fidelity report.
- **Local execution.** The SaaS options run in the vendor's cloud. Self-hostable options (n8n, Activepieces, Airbyte) are general-purpose, and none documents a Notion-to-ClickUp migration with a plan and approval step.

## Honest differentiation for ExitOS

What ExitOS adds on paper, relative to what I found. The [evidence table](#evidence-for-our-positioning) says which of these the repository proves.

1. **A read-only plan before any write**, with the plan classified into moves as-is, changes shape, loses detail and cannot move, plus approval by plan id. Other tools offer partial previews (ClickUp's CSV mapping preview, Import2's reversible sample, Help Desk Migration's demo). None found is read-only with a loss classification for this pair.
2. **Checkpointed apply/resume** with reconciliation of ambiguous writes.
3. **Read-back verification** with a declared scope, and a report that lists what was not preserved.
4. **Local-first and Apache-2.0.** Data stays on your machine except for calls to the Notion and ClickUp APIs.
5. **API-based reading and writing** rather than a ZIP upload, which allows typed mapping of existing ClickUp fields and selective migration of one data source.

Where incumbents are better, stated plainly:

- ClickUp's importer is free, supported by the vendor, handles a whole workspace and user mapping, requires no tokens and can be undone within 10 days. For a team that just wants to move over, it is the lower-effort path and may be adequate.
- ExitOS v0.1 is one source/destination pair. Import2, Unito and the ELT tools cover many apps. ExitOS has no breadth advantage and should not claim "portability OS" scope in v0.1 copy.
- ExitOS is a CLI and library. Non-technical admins will find a web importer easier.
- Rate limits shape ExitOS's speed. ClickUp's API allows 100 requests/minute per token on Free Forever, Unlimited and Business (1,000 on Business Plus, 10,000 on Enterprise). Notion allows 180 requests/minute per connection, 600 on Business and Enterprise, with payload caps of 1,000 blocks and 500 KB per request and 2,000 characters per rich-text item. [docs/enterprise-readiness.md](enterprise-readiness.md) estimates roughly 17 hours for 100,000 tasks on a 100-per-minute plan.
- A new project has no track record. The nearest open-source Notion-to-ClickUp repository I found has 0 stars and no README; the nearest design match has 5 stars. Social proof is zero at launch.

## Risks to the differentiation

- **ClickUp could add a preview or loss report to its Notion importer.** It already has the import report and the spreadsheet preview. I saw no announcement; this is a risk, not a finding.
- **Import2 or another multi-app vendor could add Notion.** Import2 already offers a free sample migration and lists ClickUp. Notion was not on the pages read.
- **Loss detection is only as good as ExitOS's coverage.** A report that implies "everything else was preserved" when it was not is worse than none. It needs a fixture corpus of Notion block and property types and tests against real ClickUp output (not done: [validation log](validation-log.md)).
- **API drift.** Notion has shipped 2025-09-03 and 2026-03-11, both with breaking changes (ExitOS pins `2026-03-11`: `NOTION_API_VERSION` in `packages/connector-notion/src/network.ts`). ClickUp's Docs API is v3. A hobby-scale project must keep up.
- **Plan accuracy.** A dry-run plan cannot predict every write failure (rate limits, validation errors, plan limits such as Free Forever's 60 Custom Fields, 100 Lists and Folders per Space and 60 MB attachment storage). The report must say the plan is a prediction.
- **AI-agent workflows.** The Notion and ClickUp MCP servers let an agent attempt ad hoc migrations today. They are capped on lower ClickUp plans but will improve.
- **Small willingness to pay and a niche trigger.** Migration is a one-time event and a free importer exists.
- **Coverage of this research.** Keyword searches are not exhaustive. Private tools, consultants, other languages and recent launches may be missed. Re-run the searches before each launch post.

## Sources

All accessed 2026-10-09 unless a date is shown. The per-tool sections above give the exact pages.

ClickUp

- Help Center articles read through the Help Center API: [Import from Notion](https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion) · [Manage imports](https://help.clickup.com/hc/en-us/articles/6310875506839-Manage-imports) · [Use the Spreadsheets Importer](https://help.clickup.com/hc/en-us/articles/6310834724247-Use-the-Spreadsheets-Importer) · [Import and export feature availability and limits](https://help.clickup.com/hc/en-us/articles/30782347809815-Import-and-export-feature-availability-and-limits) · [How do I import my work into ClickUp?](https://help.clickup.com/hc/en-us/articles/6311099045783-How-do-I-import-my-work-into-ClickUp) · [Import and Export section](https://help.clickup.com/hc/en-us/sections/17043100285463-Import-and-Export)
- [ClickUp blog: migrate Notion to ClickUp](https://clickup.com/blog/how-to-migrate-from-notion-to-clickup/) (published 2026-02-12)
- [ClickUp feedback thread on the Notion importer](https://feedback.clickup.com/integrations/p/notion-import) (user reports, anecdotal)
- [ClickUp API rate limits](https://developer.clickup.com/docs/rate-limits)
- [ClickUp MCP server blog](https://clickup.com/blog/how-to-use-clickup-mcp-server/) (published 2026-09-08)

Notion

- [Export your content](https://www.notion.com/help/export-your-content) · [Import data into Notion](https://www.notion.com/help/import-data-into-notion)
- [API request limits](https://developers.notion.com/reference/request-limits)
- [Upgrade guide 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03) · [Upgrade guide 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)
- [Notion MCP server](https://github.com/makenotion/notion-mcp-server)

Commercial tools

- Import2: [home](https://www.import2.com) · [apps](https://www.import2.com/apps) · [pricing](https://www.import2.com/pricing)
- [Help Desk Migration](https://help-desk-migration.com/) · [SyncMatters (Trujay)](https://syncmatters.com/)
- [Unito ClickUp-Notion](https://unito.io/integrations/clickup-notion/) · [Unito pricing](https://unito.io/pricing/)
- [Skyvia ClickUp-Notion](https://skyvia.com/data-integration/integrate-clickup-notion) · [Skyvia pricing](https://skyvia.com/pricing)
- [Zapier](https://zapier.com/apps/notion/integrations/clickup) · [Zapier pricing](https://zapier.com/pricing) · [Make](https://www.make.com/en/integrations/notion/clickup) · [Make pricing](https://www.make.com/en/pricing) · [n8n pricing](https://n8n.io/pricing/)
- [Auvaria Notion Migration (AWS Marketplace)](https://aws.amazon.com/marketplace/pp/prodview-mfemccsrh3nfi)

Open source and frameworks (GitHub API, 2026-10-09)

- The repositories linked in the open-source table above, plus [n8n-io/n8n](https://github.com/n8n-io/n8n) (206,852 stars; `LICENSE.md` is the Sustainable Use License; pushed 2026-10-09) and [TicketSwap/target-notion](https://github.com/TicketSwap/target-notion).
- [Meltano Hub: tap-notion](https://hub.meltano.com/extractors/tap-notion) · [tap-clickup](https://hub.meltano.com/extractors/tap-clickup)

## Corrections to the 2026-10-08 version

What was outdated or unsupported, and what replaced it.

1. **Migrate2** was listed as an unconfirmed commercial service. The domain redirects to a HugeDomains sale page; the entry was removed.
2. **ClickUp per-run report.** The old text said a per-run report was "NV" and that no incumbent emits a post-run account. ClickUp's [Manage imports](https://help.clickup.com/hc/en-us/articles/6310875506839-Manage-imports) documents an import report with errors per entity. The claim is now narrowed to "a per-item list of lossy conversions is not documented".
3. **ClickUp rollback** was missing. Imports made in the last 10 days can be deleted, removing everything the import created.
4. **ClickUp preview.** "No preview documented" is now scoped to the Notion importer. The Spreadsheets importer documents a live data preview during field mapping.
5. **Page comments** were omitted. The Notion importer can import them (appended at the bottom of the page) if included in the export. Followers behaviour was added.
6. **Permissions.** The old text relied on third-party summaries. ClickUp's own blog states "Notion permissions don't migrate".
7. **Relations.** The old text said the blog says "basic relationships" transfer. It does say that, and it also says relations and rollups "do not carry over as-is". Both are now recorded.
8. **Import2.** "Roughly 50 apps" is replaced by the pricing page's claim of "250+ apps". Pricing ($499 full migration, $5,000 professional services, free tier with vendor approval) and the fact that the sample migration writes to the destination and is reversible were added. Hosting location is not documented.
9. **Help Desk Migration** was recorded only as "demo". Its advertised audit report ("what moved, what didn't, and why") and delta migration were added, because they weaken any claim that loss reports are unique to ExitOS.
10. **Unito.** The tier names "Standard, Premium, On-Prem" could not be re-verified and were dropped; the page shows Basic and Pro (self-serve) and Enterprise with "on-prem connectors".
11. **Zapier.** The template "Create ClickUp tasks from new Notion database items" could not be re-verified on the page and was dropped. Free-plan and entry-price figures were added.
12. **Make.** "Limits NV" is replaced by 1,000 free credits and a $9 Core plan (summarised fetch).
13. **n8n and Activepieces.** "Self-hosting NV" is replaced by the READMEs' own statements. The n8n entry about community templates on third-party sites was dropped as unverified. Stars refreshed.
14. **Airbyte.** `source-clickup-api` is an alpha community connector; `source-notion` is generally available and certified; the root license is ELv2 (confirmed).
15. **AnkurAhire/NOTION-TO-CLICKUP-MIGRATION** was "code not reviewed". Its five files were read: Notion to ClickUp scripts, no README, no dry-run, resume or verification found.
16. **The "clickup-migration-deep-dive" skill** was said to have no reporting. It does include a validation step comparing names; dry-run and resume remain undocumented.
17. **`darobin/notion-backup`:** its README says it is no longer maintained.
18. **New entries:** ClickUp's Spreadsheets importer, Skyvia, Notion's import-source list (ClickUp is absent), `tristangodfrey/migrator`, ClickUp MCP limits for all plans.
19. **Notion API.** The old text mentioned only 2025-09-03. Version 2026-03-11 (three breaking changes) exists, and the repository pins it.
20. **Stars and push dates** were refreshed from the GitHub API. The headline finding was re-stated narrower, and "vendor importers are black boxes" language is no longer supported: ClickUp documents its losses and keeps an import report.

## Evidence for our positioning

This table is what the README quotes. It is limited to what the repository proves and what the sources above say.

**Standing caveat for every row:** the repository's tests use API-shaped fakes (in process and over loopback HTTP). ExitOS has never been run against live Notion or ClickUp ([validation log](validation-log.md)). "Supported" therefore means "implemented, and a named test in this repository fails if it breaks". It says nothing about live behaviour.

Legend. **Supported:** implemented and proved by the evidence named. **Partly:** implemented, but a material part of the claim, as a reader would understand it, is not proved or is limited. **Unsupported — do not claim:** no evidence, or contradicted by the evidence.

| Differentiator                                              | Status        | Evidence in this repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | What alternatives do (with source URL)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Migration preview before execution                       | Supported     | `packages/connector-clickup/test/reliability.test.ts`: "dry run makes zero write requests (proved with request spies)" (`plan: no write to Notion, none to ClickUp, none even attempted`). `packages/shared/test/guard.test.ts`: "blocks writes before the network is touched in read-only mode". `apps/cli/test/spawn.test.ts`: "inspect → plan (read-only) → apply refused without approval → apply → verify → report". `node apps/cli/dist/bin.js demo --no-color` prints "READ-ONLY — nothing has been written anywhere" and "Requests so far: 84 read · 0 write · 0 blocked by the read-only guard".                                                                                                                                                                                         | ClickUp's Notion importer: no preview documented ([help article](https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion)); its blog advises a pilot import. ClickUp's Spreadsheets importer: "live data preview" during field mapping ([article](https://help.clickup.com/hc/en-us/articles/6310834724247-Use-the-Spreadsheets-Importer)). Import2: free sample migration that can be reversed, i.e. it writes to the destination ([pricing](https://www.import2.com/pricing)). Help Desk Migration: free demo ([site](https://help-desk-migration.com/)). Unito, Skyvia, Zapier, Make, n8n: not documented. A preview is not unique; a read-only plan with loss classification for this pair is what was not found.                                                                |
| 2. Unsupported and lossy content detected and listed        | Partly        | Outcomes `supported / transformed / lossy / unsupported` with stable codes: `docs/finding-codes.md` (`apps/cli/test/docs.test.ts` fails if an emitted code is undocumented). `packages/core/test/markdown.test.ts`: "never stores Notion-hosted files: leaves a placeholder and reports them unsupported", "inline databases are reported, not silently dropped". `packages/connector-clickup/test/plan.test.ts`: "a data source with no list mapping is reported as not migrated, never silently dropped", "lists what can never migrate". `packages/core/test/approval-config-report.test.ts`: "lists every lossy and unsupported finding under "Not preserved"". Demo (synthetic): "CANNOT MOVE 12 finding(s)", report "206 finding(s) were lossy or unsupported".                                  | ClickUp's Notion importer: a static "does not import" list in the help article; a per-item loss list is not documented; the import report covers errors (same article and [Manage imports](https://help.clickup.com/hc/en-us/articles/6310875506839-Manage-imports)). Help Desk Migration advertises an audit report of "what moved, what didn't, and why" for help-desk platforms, not Notion or ClickUp ([site](https://help-desk-migration.com/)). Import2, Unito, Skyvia, Zapier, Make, n8n: not documented. Why only Partly: classification is rule-based on known Notion property and block types and on fixtures. Real ClickUp rendering (for example Docs Markdown) is untested ([docs/reliability.md](reliability.md) section 7), and losses ExitOS does not anticipate are not listed. |
| 3. Explicit user approval                                   | Supported     | `apps/cli/test/commands.test.ts`, describe "approval gate": "refuses to apply without --approve in a non-interactive shell, and writes nothing", "refuses a wrong approval", "refuses a hand-edited plan file". `packages/core/test/approval-config-report.test.ts`: "refuses a tampered plan before creating any state". `packages/core/test/plan.test.ts`: "rejects a hand-edited plan (payload tampering)". Limit: one person confirms a plan id; no second-person approval, roles or SSO ([docs/enterprise-readiness.md](enterprise-readiness.md)).                                                                                                                                                                                                                               | ClickUp's Notion importer: you click Import after choosing a Space and mapping users; no plan-level approval is documented ([help article](https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion)). Import2: you review a free sample before paying; professional services add "a final check before sign-off" ([pricing](https://www.import2.com/pricing)). Help Desk Migration: a demo gives "a clear, upfront price before moving any data" ([site](https://help-desk-migration.com/)). Automation tools run on triggers, so the concept does not apply.                                                                                                                                                                                                                       |
| 4. Resumable and recoverable apply                          | Partly        | `packages/core/test/executor.test.ts`: "resume retries failed + blocked items and creates nothing twice", "survives a crash AFTER the destination wrote but BEFORE the checkpoint (adopts, no duplicate)", "stops and asks the operator when the outcome cannot be determined". `packages/connector-clickup/test/reliability.test.ts`: "survives a hard interruption mid-run: resume completes without duplicates", "losing the local database does not cause duplicates: items are adopted via their marker". `apps/cli/test/commands.test.ts`: "crash mid-run with --interrupt-after, then resume and verify: no duplicates". Run on 2026-10-09: `demo --interrupt-after 40`, then `resume --demo` and `verify --demo` ended "175 verified · 0 mismatched · 0 missing · 0 unverified". Why only Partly: all against fakes; ClickUp documents no idempotency keys and no list-consistency guarantee; [docs/reliability.md](reliability.md) section 5 lists residual duplicate risks; exactly-once is not claimed; there is no rollback. | ClickUp's Notion importer: resume not documented; imports can be cancelled while queued or running and deleted within 10 days ([Manage imports](https://help.clickup.com/hc/en-us/articles/6310875506839-Manage-imports)). Help Desk Migration: a customer quote cites "delta migration" ([site](https://help-desk-migration.com/)). Import2: re-run or delta not documented. Zapier, Make, n8n: event-driven; bulk backfill not documented. `tommeier/basecamp-to-notion` (different pair): checkpoint resume with a SQLite progress database ([README](https://github.com/tommeier/basecamp-to-notion)).                                                                                                                                                                  |
| 5. Post-migration verification                              | Supported     | `packages/connector-clickup/test/verify.test.ts`: "passes when ClickUp matches the plan, and only then is the run "verified"", "classifies a changed task as MISMATCHED, naming the field", "classifies a deleted task as MISSING", "reports "unverified" (never "verified") when ClickUp does not return what is needed to check". `apps/cli/test/commands.test.ts`: "apply alone leaves the run at "applied", and `status` says NOT VERIFIED". Demo: "175 verified · 0 mismatched · 0 missing · 0 unverified", with the scope printed: it does NOT verify comments, attachments, activity, notifications or views. "Verified" means the declared scope matched, not that nothing was lost.                                                                                                                                   | ClickUp's Notion importer: an import report with status, items imported and errors; no read-back comparison with the source is documented ([Manage imports](https://help.clickup.com/hc/en-us/articles/6310875506839-Manage-imports)). Import2: no report documented; a money-back guarantee instead ([pricing](https://www.import2.com/pricing)). Help Desk Migration advertises a complete audit report ([site](https://help-desk-migration.com/)). The "clickup-migration-deep-dive" skill includes a name-comparison validation step ([page](https://claudeskills.info/skills/jeremylongshore/claude-code-plugins-plus-skills/clickup-migration-deep-dive/)).                                                                                                                                  |
| 6. Open-source connector architecture                       | Partly        | Apache-2.0 `LICENSE`. SDK exported as `@exitos/core/sdk` and conformance kit as `@exitos/core/testing` (`packages/core/package.json` exports; `packages/core/src/sdk/`, `packages/core/src/testing/conformance.ts`). `examples/example-connector/test/example.test.ts`: "the source passes the conformance kit", "runs a complete plan → approve → apply → verify cycle through the real engine". Guide: [docs/connector-sdk.md](connector-sdk.md). Why only Partly: two shipped connectors (Notion source, ClickUp destination) and one example; no third-party connector exists, so the claim that new connectors are cheap (H4 in [market-thesis.md](market-thesis.md)) is untested; the SDK is pre-1.0.                                                                                                                                          | Airbyte (Elastic License 2.0; `source-notion`, `source-clickup-api`, no destination for either), Meltano (MIT; `tap-notion`, `tap-clickup` on the hub), dlt (Apache-2.0; Notion source, no ClickUp destination) are mature connector ecosystems for loading data into warehouses ([Airbyte](https://github.com/airbytehq/airbyte), [Meltano Hub](https://hub.meltano.com/extractors/tap-notion), [dlt](https://github.com/dlt-hub/verified-sources)). n8n and Activepieces ship Notion and ClickUp nodes or pieces ([n8n](https://github.com/n8n-io/n8n), [Activepieces](https://github.com/activepieces/activepieces)). None documents a plan, approval and verification contract.                                                                                                              |
| 7. Local-first execution                                    | Supported     | `apps/cli/test/spawn.test.ts`: "exitos demo completes, verified, in a process where any socket/DNS/fetch call kills it" and "leaves no files outside .exitos/demo". `packages/shared/test/guard.test.ts`: "refuses hosts that are not on the allow-list (token exfiltration guard)". `apps/cli/test/server.test.ts`: "binds to loopback only". `packages/core/test/state.test.ts`: "persists to disk across reopen, with restrictive file permissions". No telemetry code (the only source match for "telemetry" is a comment in `packages/shared/src/http/scheduler.ts`). Limits: a real run still sends content to the Notion and ClickUp APIs, and the plan and state files on disk contain that content ([docs/enterprise-readiness.md](enterprise-readiness.md)). Local-first is not offline.                                                           | ClickUp's Notion importer: you upload the export file to ClickUp's web app ([help article](https://help.clickup.com/hc/en-us/articles/21376442610839-Import-from-Notion)); the content ends up in ClickUp either way. Import2, Help Desk Migration, Skyvia, Zapier, Make: hosted services. n8n, Activepieces and Airbyte can be self-hosted ([n8n README](https://github.com/n8n-io/n8n), [Activepieces README](https://github.com/activepieces/activepieces), [Airbyte README](https://github.com/airbytehq/airbyte)). Unito lists "on-prem connectors" for Enterprise ([pricing](https://unito.io/pricing/)).                                                                                                                                                                                  |

### Where ExitOS is weaker

State these wherever the claims above are quoted.

- **No live validation.** Never run against real Notion or ClickUp. Every claim rests on fakes.
- **Breadth.** One pair (Notion to ClickUp). ClickUp's importer list has 11 sources, Import2 claims 250+ apps, Help Desk Migration 100+ platforms, Airbyte 600+ connectors.
- **Notion to ClickUp only,** and the Docs path is experimental.
- **No hosted option.** You need Node.js 22.13 or newer, API tokens and a command line. Windows is untested.
- **Attachments are not transferred.** Neither are comments, permissions, views, icons, subtasks, dependencies or original timestamps. The plan lists them; it does not move them. ClickUp's own importer can bring in page comments.
- **No rollback.** ExitOS never deletes; unwanted created items must be removed by hand. ClickUp can delete an import made in the last 10 days.
- **Cannot create ClickUp Custom Fields** (the API cannot); only existing fields are filled.
- **Speed.** A real run is paced by ClickUp's rate limit.
- **Assurance.** One maintainer, no support commitment, no independent security review, no SOC 2.
- **No users and no community yet.**

### Do not claim

- "Zero data loss", "lossless", "nothing is lost".
- "Live-validated", "works on real workspaces", "production-ready", "enterprise-ready".
- "The only tool with a preview or a loss report", "unlike vendor importers, which are black boxes" (ClickUp documents its losses and keeps an import report), or that ExitOS is faster, cheaper or more reliable than any named tool (no comparison was run).
- That attachments, comments or permissions migrate.
- Support for any pair other than Notion to ClickUp.
- "Exactly-once", "no duplicates guaranteed", "undo" or "rollback".
- Security attestations or audits.
