import { basicClickUpState, type FakeClickUpState } from '@exitos/connector-clickup/testing';

/**
 * The SYNTHETIC ClickUp Workspace that the demo migrates into. Like the Notion fixture it is
 * entirely invented. It has two Lists with different status sets, existing Custom Fields to fill,
 * existing Space tags, three members — and one pre-existing task whose name collides with a task
 * that is about to be migrated, so the plan can show its collision warning.
 */
export const DEMO_CLICKUP = {
  workspaceId: '9000001',
  roadmapListId: '901001',
  bugsListId: '901002',
  spaceId: '90010',
  members: {
    ada: 1001,
    grace: 1002,
    alan: 1003,
  },
} as const;

export function buildDemoClickUpState(): FakeClickUpState {
  const base = basicClickUpState();
  return {
    ...base,
    workspace: { id: DEMO_CLICKUP.workspaceId, name: 'Acme Robotics (synthetic demo)' },
    members: [
      { id: 1001, username: 'ada', email: 'ada.lovelace@example.com' },
      { id: 1002, username: 'grace', email: 'grace.hopper@example.com' },
      { id: 1003, username: 'alan', email: 'alan.turing@example.com' },
    ],
    spaces: [
      { id: DEMO_CLICKUP.spaceId, name: 'Engineering', tags: ['frontend', 'backend', 'design'] },
    ],
    lists: [
      {
        id: DEMO_CLICKUP.roadmapListId,
        name: 'Roadmap',
        spaceId: DEMO_CLICKUP.spaceId,
        statuses: [
          { status: 'to do', type: 'open' },
          { status: 'in progress', type: 'custom' },
          { status: 'in review', type: 'custom' },
          { status: 'complete', type: 'closed' },
        ],
        fields: [
          { id: 'cf-points', name: 'Story points', type: 'number' },
          {
            id: 'cf-epic',
            name: 'Epic',
            type: 'drop_down',
            options: [
              { id: 'opt-platform', name: 'Platform' },
              { id: 'opt-mobile', name: 'Mobile' },
            ],
          },
          { id: 'cf-spec', name: 'Spec link', type: 'url' },
          { id: 'cf-review', name: 'Needs review', type: 'checkbox' },
        ],
      },
      {
        id: DEMO_CLICKUP.bugsListId,
        name: 'Bugs',
        spaceId: DEMO_CLICKUP.spaceId,
        statuses: [
          { status: 'to do', type: 'open' },
          { status: 'in progress', type: 'custom' },
          { status: 'complete', type: 'closed' },
        ],
        fields: [],
      },
    ],
    tasks: [
      {
        id: '86f000000',
        name: 'Design robot arm v2 gripper',
        markdown_description: 'An older, unrelated task that happens to share a name.',
        status: 'to do',
        priority: null,
        due_date: null,
        start_date: null,
        assignees: [],
        tags: [],
        customValues: {},
        listId: DEMO_CLICKUP.roadmapListId,
        date_created: Date.UTC(2026, 5, 1),
        links: [],
        archived: false,
      },
    ],
    counters: { task: 0, doc: 0, page: 0 },
  };
}
