import { DEMO } from './notion-fixture.js';
import { DEMO_CLICKUP } from './clickup-state.js';

/**
 * The migration configuration the demo uses. It doubles as a worked example of `migration.yaml`:
 * explicit status mapping, priority mapping, Custom Field mapping, and explicit user mapping.
 * (Ada is mapped by Notion user id, Grace by e-mail; Linus and Margaret are deliberately NOT
 * mapped, so the plan shows what happens to people it cannot match.)
 */
export const DEMO_MIGRATION_YAML = `# ExitOS demo configuration — all identifiers are synthetic.
version: 1

source:
  type: notion
  dataSources:
    - id: "${DEMO.roadmapDs}"
      name: Product Roadmap
    - id: "${DEMO.bugsDs}"
      name: Bug Tracker
      bodies: false          # tasks only; skip reading page bodies for the 130 bugs
  pages:
    - id: "${DEMO.handbook}"
      name: Engineering Handbook
      includeChildPages: true

destination:
  type: clickup
  workspaceId: "${DEMO_CLICKUP.workspaceId}"
  lists:
    - source: Product Roadmap
      listId: "${DEMO_CLICKUP.roadmapListId}"
      relations: link
      fields:
        Status:
          to: status
          valueMap:
            Not started: to do
            In progress: in progress
            In review: in review
            Done: complete
            # "Blocked" is deliberately left out: ClickUp has no such status, and the plan will say so.
        Priority:
          to: priority
          valueMap: { Urgent: 1, High: 2, Medium: 3, Low: 4 }   # "Someday" has no ClickUp priority
        "Story points": { to: custom_field, field: Story points }
        Epic:           { to: custom_field, field: Epic }        # "Growth" is not an option in ClickUp
        Spec:           { to: custom_field, field: Spec link }
        "Needs review": { to: custom_field, field: Needs review }
    - source: Bug Tracker
      listId: "${DEMO_CLICKUP.bugsListId}"
      fields:
        Severity:
          to: priority
          valueMap: { S1: urgent, S2: high, S3: normal, S4: low }
        State:
          to: status
          valueMap: { Open: to do, Triaged: in progress, Fixed: complete }   # "Won't fix" has no equivalent
        Found: { to: due_date }
  docs:
    parent: { type: space, id: "${DEMO_CLICKUP.spaceId}" }
    visibility: PRIVATE

users:
  map:
    "${DEMO.users.ada}": ${DEMO_CLICKUP.members.ada}                       # by Notion user id
    "grace.hopper@example.com": ${DEMO_CLICKUP.members.grace}              # by e-mail
  unmapped: description

options:
  timezone: Europe/Berlin
  provenance: footer
  concurrency: 4
  experimental:
    docs: true
`;
