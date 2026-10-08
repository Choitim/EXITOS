import {
  block,
  dataSourceObj,
  databaseObj,
  equationInline,
  externalFile,
  hostedFile,
  mentionPage,
  mentionUser,
  pageObj,
  richTexts,
  rowParent,
  rt,
  schema,
  uid,
  userObj,
  value,
  workspaceParent,
  type NotionFixture,
  type Obj,
} from '@exitos/connector-notion/testing';

/**
 * A SYNTHETIC Notion workspace for `exitos demo`.
 *
 * Every name, e-mail address, URL and sentence below was invented for this repository. The e-mail
 * addresses use the reserved example.com domain. Nothing here is, or was derived from, real data.
 * The shapes follow the documented Notion API (version 2026-03-11 data-source model), so the real
 * Notion connector runs unmodified against it.
 */

// ---- stable ids ------------------------------------------------------------------------------
export const DEMO = {
  workspaceId: uid('demo:workspace'),
  botId: uid('demo:bot'),
  roadmapDb: uid('demo:roadmap:db'),
  roadmapDs: uid('demo:roadmap:ds'),
  bugsDb: uid('demo:bugs:db'),
  bugsDs: uid('demo:bugs:ds'),
  handbook: uid('demo:handbook'),
  users: {
    ada: uid('demo:user:ada'),
    grace: uid('demo:user:grace'),
    linus: uid('demo:user:linus'),
    margaret: uid('demo:user:margaret'),
  },
} as const;

const USERS = {
  ada: userObj(DEMO.users.ada, 'Ada Lovelace', 'ada.lovelace@example.com'),
  grace: userObj(DEMO.users.grace, 'Grace Hopper', 'grace.hopper@example.com'),
  linus: userObj(DEMO.users.linus, 'Linus Torvalds', 'linus@example.com'),
  margaret: userObj(DEMO.users.margaret, 'Margaret Hamilton', 'margaret.hamilton@example.com'),
};
type UserKey = keyof typeof USERS;

const rowId = (n: number): string => uid(`demo:roadmap:row:${n}`);
const bugId = (n: number): string => uid(`demo:bugs:row:${n}`);

// ---- roadmap rows ---------------------------------------------------------------------------
interface Row {
  title: string;
  status: string;
  priority: string | null;
  owner?: UserKey[];
  due?: [string, string | null, string | null] | null;
  tags?: string[];
  points?: number;
  epic?: string;
  spec?: string;
  review?: boolean;
  deps?: number[];
  notes?: string;
  body?: 'kitchen' | 'simple' | 'checklist' | 'spec' | 'locked' | 'none';
  files?: Array<'hosted' | 'external'>;
}

// prettier-ignore
const ROADMAP: Row[] = [
  { title: 'Design robot arm v2 gripper', status: 'In progress', priority: 'High', owner: ['ada'], due: ['2026-10-30', null, null], tags: ['design', 'research'], points: 8, epic: 'Platform', spec: 'https://example.com/specs/gripper-v2', review: true, deps: [], notes: 'Soft-grip prototype survived 10 000 cycles in the lab.', body: 'kitchen', files: ['hosted', 'external'] },
  { title: 'Calibrate joint encoders', status: 'In progress', priority: 'Urgent', owner: ['ada', 'grace'], due: ['2026-10-14T09:00:00', null, 'Europe/Berlin'], tags: ['backend'], points: 5, epic: 'Platform', body: 'simple', deps: [1] },
  { title: 'Fleet dashboard: battery health widget', status: 'Not started', priority: 'Medium', owner: ['linus'], due: ['2026-11-12', null, null], tags: ['frontend'], points: 3, epic: 'Mobile', spec: 'https://example.com/specs/battery-widget', body: 'checklist' },
  { title: 'OTA firmware updater', status: 'In review', priority: 'High', owner: ['grace'], due: ['2026-10-20T17:30:00Z', null, null], tags: ['backend'], points: 13, epic: 'Platform', review: true, deps: [2], body: 'spec' },
  { title: 'Kalibrierung der Sensoren — Überarbeitung', status: 'In progress', priority: 'Medium', owner: ['margaret'], due: ['2026-11-03', '2026-11-07', null], tags: ['backend', 'research'], points: 5, notes: 'Messwerte stammen aus dem Labor in München.', body: 'simple' },
  { title: 'ロボットアーム校正ガイド', status: 'Not started', priority: 'Low', owner: [], due: null, tags: ['design'], points: 2, body: 'none' },
  { title: 'Customer pilot: warehouse in Rotterdam', status: 'Blocked', priority: 'Urgent', owner: ['ada'], due: ['2026-12-01', null, null], tags: ['research'], points: 21, epic: 'Growth', notes: 'Waiting on customs paperwork.', deps: [4], body: 'simple' },
  { title: 'Safety certification pre-audit', status: 'Not started', priority: 'High', owner: ['grace', 'margaret'], due: ['2026-12-15', null, null], tags: [], points: 8, deps: [1, 4], body: 'checklist', files: ['hosted'] },
  { title: 'Café 🚀 launch event planning', status: 'Not started', priority: 'Someday', owner: ['linus'], due: ['2027-02-01', null, null], tags: ['design'], points: 3, body: 'none' },
  { title: 'Reduce cold-start latency of the planner', status: 'Done', priority: 'High', owner: ['grace'], due: ['2026-09-20', null, null], tags: ['backend'], points: 5, epic: 'Platform', body: 'spec' },
  { title: 'Docs: getting started with the SDK', status: 'Done', priority: 'Medium', owner: ['ada'], due: ['2026-09-10', null, null], tags: ['frontend'], points: 2, spec: 'https://example.com/docs/sdk', body: 'simple' },
  { title: 'Replace deprecated gRPC calls', status: 'In progress', priority: 'Low', owner: [], due: ['2026-10-25', null, null], tags: ['backend'], points: 3, body: 'none', deps: [10] },
  { title: 'Mobile app: teleoperation view', status: 'In review', priority: 'High', owner: ['linus', 'ada'], due: ['2026-11-18T10:00:00+01:00', null, null], tags: ['frontend'], points: 8, epic: 'Mobile', review: true, deps: [3], body: 'simple' },
  { title: 'Gripper force-curve dataset', status: 'Done', priority: 'Medium', owner: ['margaret'], due: ['2026-08-30', null, null], tags: ['research'], points: 5, body: 'none', files: ['external'] },
  { title: 'Incident review: arm collision on line 3', status: 'Done', priority: 'Urgent', owner: ['ada', 'grace', 'margaret'], due: ['2026-09-02', null, null], tags: [], points: 3, notes: 'Root cause: stale calibration after a power cycle.', body: 'locked' },
  { title: 'Telemetry schema v3', status: 'In progress', priority: 'Medium', owner: ['grace'], due: ['2026-10-31', null, null], tags: ['backend'], points: 5, epic: 'Platform', spec: 'https://example.com/specs/telemetry-v3', body: 'spec', deps: [12] },
  { title: 'Onboarding checklist for new engineers', status: 'Not started', priority: 'Low', owner: [], due: null, tags: [], points: 1, body: 'checklist' },
  { title: 'Vision: reduce false positives in bin picking', status: 'In progress', priority: 'High', owner: ['ada'], due: ['2026-11-30', null, null], tags: ['research', 'backend'], points: 13, epic: 'Platform', body: 'simple', deps: [1, 5] },
  { title: 'Design system refresh', status: 'Not started', priority: 'Medium', owner: ['linus'], due: ['2026-12-10', '2027-01-15', null], tags: ['design', 'frontend'], points: 8, epic: 'Mobile', body: 'none' },
  { title: 'Hardware-in-the-loop test rig', status: 'In review', priority: 'High', owner: ['margaret'], due: ['2026-10-18', null, null], tags: ['backend'], points: 8, review: true, body: 'spec' },
  { title: 'Localise the operator console (DE, FR, JA)', status: 'Not started', priority: 'Low', owner: [], due: ['2027-01-20', null, null], tags: ['frontend'], points: 5, notes: 'Right-to-left (AR, HE) is out of scope for v1: العربية / עברית', body: 'none' },
  { title: 'Budget review Q4', status: 'Done', priority: 'Medium', owner: ['grace'], due: ['2026-09-30', null, null], tags: [], points: 1, body: 'none' },
  { title: 'Public API rate-limit policy', status: 'In progress', priority: 'Medium', owner: ['linus', 'grace'], due: ['2026-11-05', null, null], tags: ['backend'], points: 3, epic: 'Platform', body: 'simple', deps: [16] },
  { title: 'Sim-to-real transfer experiments', status: 'In progress', priority: null, owner: ['ada'], due: null, tags: ['research'], points: 13, epic: 'Growth', body: 'none' },
  { title: 'Customer success playbook', status: 'Not started', priority: 'Low', owner: [], due: ['2027-03-01', null, null], tags: [], points: 2, body: 'checklist' },
  { title: 'Retire the legacy teach pendant', status: 'Not started', priority: 'Low', owner: ['margaret'], due: null, tags: ['backend'], points: 5, body: 'none', deps: [999] },
  { title: 'Power budget analysis for the mobile base', status: 'Done', priority: 'High', owner: ['ada', 'margaret'], due: ['2026-09-25T08:00:00', null, 'America/Los_Angeles'], tags: ['research'], points: 5, body: 'spec' },
  { title: 'Accessibility audit of the operator console', status: 'In review', priority: 'Medium', owner: ['linus'], due: ['2026-11-22', null, null], tags: ['frontend', 'design'], points: 3, epic: 'Mobile', review: true, body: 'checklist' },
];

function roadmapProperties(): Obj[] {
  return [
    schema.title(),
    schema.status('st', 'Status', {
      'To-do': ['Not started'],
      'In progress': ['In progress', 'In review'],
      Complete: ['Done'],
      Other: ['Blocked'],
    }),
    schema.select('pri', 'Priority', ['Urgent', 'High', 'Medium', 'Low', 'Someday']),
    schema.simple('due', 'Due', 'date'),
    schema.simple('own', 'Owner', 'people'),
    schema.multiSelect('tag', 'Tags', ['frontend', 'backend', 'design', 'research']),
    schema.number('pts', 'Story points'),
    schema.select('epic', 'Epic', ['Platform', 'Mobile', 'Growth']),
    schema.simple('url', 'Spec', 'url'),
    schema.simple('rev', 'Needs review', 'checkbox'),
    schema.relation('dep', 'Depends on', DEMO.roadmapDs),
    schema.richText('notes', 'Notes'),
    schema.simple('files', 'Attachments', 'files'),
    schema.rollup('ru', 'Open dependencies'),
    schema.formula('fx', 'Days until due', 'dateBetween(prop("Due"), now(), "days")'),
    schema.uniqueId('uid', 'ID', 'RM'),
    schema.simple('ct', 'Created', 'created_time'),
    schema.simple('cby', 'Created by', 'created_by'),
    schema.simple('btn', 'Notify team', 'button'),
  ];
}

function roadmapRow(row: Row, index: number): Obj {
  const n = index + 1;
  const created = new Date(Date.UTC(2026, 6, 1, 9, 0, n * 7)).toISOString();
  const owners = (row.owner ?? []).map((k) => USERS[k]);
  const properties: Record<string, Obj> = {
    Name: value.title('title', row.title),
    Status: value.status('st', row.status),
    Priority: value.select('pri', row.priority),
    Due: row.due ? value.date('due', row.due[0], row.due[1], row.due[2]) : value.date('due', null),
    Owner: value.people('own', owners),
    Tags: value.multiSelect('tag', row.tags ?? []),
    'Story points': value.number('pts', row.points ?? null),
    Epic: value.select('epic', row.epic ?? null),
    Spec: value.url('url', row.spec ?? null),
    'Needs review': value.checkbox('rev', row.review ?? false),
    'Depends on': value.relation(
      'dep',
      (row.deps ?? []).map((d) => (d === 999 ? uid('demo:outside:legacy-pendant-spec') : rowId(d))),
    ),
    Notes: value.richText('notes', row.notes ?? ''),
    Attachments: value.files(
      'files',
      (row.files ?? []).map((f, i) =>
        f === 'hosted'
          ? hostedFile(`${slug(row.title)}-${i + 1}.pdf`)
          : externalFile('Reference', 'https://example.com/reference.pdf'),
      ),
    ),
    'Open dependencies': value.rollupNumber('ru', (row.deps ?? []).length),
    'Days until due': value.formulaNumber('fx', row.due ? 30 + n : null),
    ID: value.uniqueId('uid', 'RM', n),
    Created: value.createdTime('ct', created),
    'Created by': value.createdBy('cby', USERS.ada),
    'Notify team': value.button('btn'),
  };
  return pageObj({
    id: rowId(n),
    parent: rowParent(DEMO.roadmapDs, DEMO.roadmapDb),
    created,
    edited: new Date(Date.UTC(2026, 8, 1, 9, 0, n)).toISOString(),
    createdBy: USERS.ada,
    properties,
    icon: n === 1 ? { type: 'emoji', emoji: '🤖' } : null,
  });
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

// ---- page bodies -----------------------------------------------------------------------------
type Blocks = Record<string, Obj[]>;

function bodyFor(row: Row, n: number, blocks: Blocks): void {
  const page = rowId(n);
  const id = (s: string): string => uid(`demo:b:${n}:${s}`);
  switch (row.body) {
    case 'kitchen':
      return kitchenSink(page, id, blocks);
    case 'simple':
      blocks[page] = [
        block.heading(id('h'), page, 2, 'Goal'),
        block.paragraph(id('p'), page, [
          rt('Ship this safely and measure the effect. See also '),
          rt('the design notes', { href: 'https://example.com/notes' }),
          rt('.'),
        ]),
        block.bullet(id('b1'), page, 'Define the acceptance criteria', true),
        block.bullet(id('b2'), page, 'Review with the team'),
      ];
      blocks[id('b1')] = [
        block.bullet(id('b1a'), id('b1'), 'Latency budget: 50 ms'),
        block.bullet(id('b1b'), id('b1'), 'No regression in the safety suite'),
      ];
      return;
    case 'checklist':
      blocks[page] = [
        block.heading(id('h'), page, 3, 'Checklist'),
        block.todo(id('t1'), page, 'Draft the plan', true),
        block.todo(id('t2'), page, 'Get sign-off', false),
        block.todo(id('t3'), page, 'Announce to the team', false),
        block.callout(id('c'), page, 'Remember: every step needs an owner.', '📌'),
      ];
      return;
    case 'spec':
      blocks[page] = [
        block.heading(id('h'), page, 2, 'Specification'),
        block.paragraph(id('p'), page, [
          rt('Interface contract, '),
          rt('v2', { bold: true }),
          rt(' — supersedes v1.'),
        ]),
        block.table(id('tbl'), page, 3),
        block.code(
          id('code'),
          page,
          'def plan(goal, scene):\n    path = search(goal, scene)\n    return smooth(path)',
          'python',
          'Reference implementation sketch',
        ),
        block.quote(id('q'), page, 'Make it work, make it right, make it fast.'),
      ];
      blocks[id('tbl')] = [
        block.tableRow(id('r1'), id('tbl'), ['Parameter', 'Type', 'Default']),
        block.tableRow(id('r2'), id('tbl'), ['timeout_ms', 'int', '250']),
        block.tableRow(id('r3'), id('tbl'), ['mode', 'enum', 'safe']),
      ];
      return;
    case 'locked':
      // The integration was not given access to this page's content (reported, not hidden).
      blocks[page] = [
        block.paragraph(id('p'), page, richTexts('(not readable by the integration)')),
      ];
      return;
    case 'none':
    case undefined:
      return;
  }
}

function kitchenSink(page: string, id: (s: string) => string, blocks: Blocks): void {
  const sync = id('sync-orig');
  const lostOriginal = uid('demo:lost-original');
  blocks[page] = [
    block.heading(id('h1'), page, 1, 'Gripper v2 — design notes'),
    block.paragraph(id('p1'), page, [
      rt('Plain, '),
      rt('bold', { bold: true }),
      rt(', '),
      rt('italic', { italic: true }),
      rt(', '),
      rt('underlined', { underline: true }),
      rt(', '),
      rt('struck', { strikethrough: true }),
      rt(', '),
      rt('code', { code: true }),
      rt(', '),
      rt('red text', { color: 'red' }),
      rt(', a '),
      rt('link', { href: 'https://example.com/gripper' }),
      rt(', a mention of '),
      mentionUser(DEMO.users.ada, 'Ada Lovelace'),
      rt(', a page mention '),
      mentionPage(rowId(2), 'Calibrate joint encoders'),
      rt(' and math: '),
      equationInline('F = m \\cdot a'),
      rt('.'),
    ]),
    block.callout(id('c1'), page, 'The soft-grip prototype survived 10 000 cycles.', '💡'),
    block.heading(id('h2'), page, 2, 'Requirements'),
    block.bullet(id('b1'), page, 'Mechanical', true),
    block.bullet(id('b2'), page, 'Electrical'),
    block.numbered(id('n1'), page, 'Prototype', true),
    block.numbered(id('n2'), page, 'Test'),
    block.numbered(id('n3'), page, 'Iterate'),
    block.heading(id('h3'), page, 4, 'A fourth-level heading'),
    block.todo(id('t1'), page, 'Order silicone samples', true),
    block.todo(id('t2'), page, 'Print the mould', false),
    block.toggle(id('tg'), page, 'Open questions', true),
    block.quote(id('q'), page, 'A good gripper is one you never think about.'),
    block.code(id('code'), page, 'torque = grip_force * lever_arm', 'plaintext'),
    block.table(id('tbl'), page, 3),
    block.columnList(id('cols'), page),
    block.syncedOriginal(sync, page),
    block.syncedCopy(id('sync-copy'), page, sync),
    block.syncedCopy(id('sync-lost'), page, lostOriginal),
    block.imageExternal(
      id('img1'),
      page,
      'https://example.com/images/gripper.png',
      'Gripper render',
    ),
    block.imageHosted(id('img2'), page, 'gripper-photo.png'),
    block.pdfHosted(id('pdf'), page, 'datasheet.pdf'),
    block.bookmark(id('bm'), page, 'https://example.com/vendor/silicone', 'Supplier datasheet'),
    block.embed(id('embed'), page, 'https://example.com/embed/video/gripper-demo'),
    block.equation(id('eq'), page, 'E = \\frac{1}{2} k x^2'),
    block.divider(id('div'), page),
    block.toc(id('toc'), page),
    block.childPage(id('cp'), page, 'Gripper test log'),
    block.childDatabase(id('cdb'), page, 'Test runs'),
    block.linkToPage(id('ltp'), page, rowId(4)),
    block.unsupported(id('ai'), page, 'ai_block'),
    block.meetingNotes(id('mn'), page),
  ];
  blocks[id('b1')] = [
    block.bullet(id('b1a'), id('b1'), 'Fingertip stiffness', true),
    block.bullet(id('b1b'), id('b1'), 'Actuation stroke'),
  ];
  blocks[id('b1a')] = [
    block.bullet(id('b1aa'), id('b1a'), 'Shore 30A silicone'),
    block.bullet(id('b1ab'), id('b1a'), 'Printed lattice backbone'),
  ];
  blocks[id('n1')] = [block.bullet(id('n1a'), id('n1'), 'Cast three fingertip variants')];
  blocks[id('tg')] = [
    block.paragraph(id('tg1'), id('tg'), richTexts('How does the grip behave when wet?')),
    block.paragraph(id('tg2'), id('tg'), richTexts('Can we reduce the cost of the lattice?')),
  ];
  blocks[id('tbl')] = [
    block.tableRow(id('tr1'), id('tbl'), ['Cycle count', 'Result', 'Notes']),
    block.tableRow(id('tr2'), id('tbl'), ['1 000', 'pass', '—']),
    block.tableRow(id('tr3'), id('tbl'), ['10 000', 'pass', 'minor wear on the left fingertip']),
  ];
  const left = id('col-left');
  const right = id('col-right');
  blocks[id('cols')] = [block.column(left, id('cols')), block.column(right, id('cols'))];
  blocks[left] = [block.paragraph(id('cl'), left, richTexts('Left column: mechanical notes.'))];
  blocks[right] = [block.paragraph(id('cr'), right, richTexts('Right column: electrical notes.'))];
  blocks[sync] = [
    block.paragraph(
      id('so'),
      sync,
      richTexts('Shared safety warning: keep fingers clear of the gripper.'),
    ),
  ];
  blocks[id('cp')] = [
    block.paragraph(id('cp1'), id('cp'), richTexts('Test log content lives on its own page.')),
  ];
}

// ---- bug tracker (130 rows: exceeds the 100-item page size) ------------------------------------
const COMPONENTS = ['api', 'ui', 'infra', 'firmware'];
const SEVERITIES = ['S1', 'S2', 'S3', 'S4'];
const STATES = ['Open', 'Open', 'Triaged', 'Fixed', "Won't fix"];
const BUG_STEMS = [
  'Gripper drops payload under vibration',
  'Planner times out on cluttered scenes',
  'Dashboard shows stale battery level',
  'Encoder drift after a cold start',
  'Console crashes on locale switch',
  'Telemetry batch exceeds the size limit',
  'OTA update stalls at 94%',
  'Teleop view lags on mobile networks',
  'Safety stop does not latch',
  'Calibration wizard rejects valid input',
];

function bugProperties(): Obj[] {
  return [
    schema.title(),
    schema.select('sev', 'Severity', SEVERITIES),
    schema.status('state', 'State', {
      'To-do': ['Open'],
      'In progress': ['Triaged'],
      Complete: ['Fixed'],
      Other: ["Won't fix"],
    }),
    schema.simple('rep', 'Reporter', 'people'),
    schema.simple('found', 'Found', 'date'),
    schema.multiSelect('comp', 'Component', COMPONENTS),
  ];
}

function bugRow(n: number): Obj {
  const created = new Date(Date.UTC(2026, 7, 1, 8, 0, n * 11)).toISOString();
  const day = 1 + (n % 28);
  return pageObj({
    id: bugId(n),
    parent: rowParent(DEMO.bugsDs, DEMO.bugsDb),
    created,
    createdBy: USERS.grace,
    properties: {
      Name: value.title('title', `${BUG_STEMS[n % BUG_STEMS.length]} (#${n})`),
      Severity: value.select('sev', SEVERITIES[n % SEVERITIES.length] ?? 'S3'),
      State: value.status('state', STATES[n % STATES.length] ?? 'Open'),
      Reporter: value.people('rep', [
        n % 3 === 0 ? USERS.grace : n % 3 === 1 ? USERS.margaret : USERS.linus,
      ]),
      Found: value.date('found', `2026-09-${String(day).padStart(2, '0')}`),
      Component: value.multiSelect('comp', [
        COMPONENTS[n % COMPONENTS.length] ?? 'api',
        ...(n % 5 === 0 ? ['ui'] : []),
      ]),
    },
  });
}

// ---- standalone pages → Docs -----------------------------------------------------------------
function handbook(blocks: Blocks): Obj[] {
  const root = DEMO.handbook;
  const onboarding = uid('demo:handbook:onboarding');
  const runbooks = uid('demo:handbook:runbooks');
  const incident = uid('demo:handbook:incident');
  const dayOne = uid('demo:handbook:dayone');
  const page = (id: string, title: string, parent: Obj): Obj =>
    pageObj({
      id,
      parent,
      created: '2026-05-01T09:00:00.000Z',
      properties: { title: value.title('title', title) },
      createdBy: USERS.ada,
    });
  blocks[root] = [
    block.heading(uid('demo:hb:1'), root, 1, 'Engineering Handbook'),
    block.paragraph(uid('demo:hb:2'), root, [
      rt('How we build robots, '),
      rt('safely', { bold: true }),
      rt(' and quickly.'),
    ]),
    block.childPage(onboarding, root, 'Onboarding'),
    block.childPage(runbooks, root, 'Runbooks'),
    block.callout(uid('demo:hb:3'), root, 'Questions? Ask in #engineering.', '💬'),
  ];
  blocks[onboarding] = [
    block.heading(uid('demo:hb:4'), onboarding, 2, 'Your first week'),
    block.numbered(uid('demo:hb:5'), onboarding, 'Set up your laptop'),
    block.numbered(uid('demo:hb:6'), onboarding, 'Meet your buddy'),
    block.childPage(dayOne, onboarding, 'Day one checklist'),
  ];
  blocks[dayOne] = [
    block.todo(uid('demo:hb:7'), dayOne, 'Badge photo', false),
    block.todo(uid('demo:hb:8'), dayOne, 'Hardware tour', false),
  ];
  blocks[runbooks] = [
    block.heading(uid('demo:hb:9'), runbooks, 2, 'Runbooks'),
    block.childPage(incident, runbooks, 'Incident response'),
  ];
  blocks[incident] = [
    block.heading(uid('demo:hb:10'), incident, 2, 'When the arm does something unexpected'),
    block.code(uid('demo:hb:11'), incident, 'exitos-demo --e-stop', 'shell'),
    block.imageHosted(uid('demo:hb:12'), incident, 'e-stop-location.png'),
  ];
  return [
    page(root, 'Engineering Handbook', workspaceParent()),
    page(onboarding, 'Onboarding', { type: 'page_id', page_id: root }),
    page(runbooks, 'Runbooks', { type: 'page_id', page_id: root }),
    page(dayOne, 'Day one checklist', { type: 'page_id', page_id: onboarding }),
    page(incident, 'Incident response', { type: 'page_id', page_id: runbooks }),
  ];
}

export function buildDemoNotionFixture(): NotionFixture {
  const blocks: Blocks = {};
  ROADMAP.forEach((row, i) => bodyFor(row, i + 1, blocks));
  const bugs = Array.from({ length: 130 }, (_, i) => bugRow(i + 1));
  const lockedRow = ROADMAP.findIndex((r) => r.body === 'locked') + 1;

  return {
    workspace: { id: DEMO.workspaceId, name: 'Acme Robotics (synthetic demo)', botId: DEMO.botId },
    userInfoCapability: true,
    users: Object.values(USERS),
    databases: [
      databaseObj({
        id: DEMO.roadmapDb,
        title: 'Product Roadmap',
        dataSources: [{ id: DEMO.roadmapDs, name: 'Product Roadmap' }],
      }),
      databaseObj({
        id: DEMO.bugsDb,
        title: 'Bug Tracker',
        dataSources: [{ id: DEMO.bugsDs, name: 'Bug Tracker' }],
      }),
    ],
    dataSources: [
      dataSourceObj({
        id: DEMO.roadmapDs,
        databaseId: DEMO.roadmapDb,
        title: 'Product Roadmap',
        properties: roadmapProperties(),
      }),
      dataSourceObj({
        id: DEMO.bugsDs,
        databaseId: DEMO.bugsDb,
        title: 'Bug Tracker',
        properties: bugProperties(),
      }),
    ],
    pages: [...ROADMAP.map(roadmapRow), ...bugs, ...handbook(blocks)],
    blocks,
    // One row's content, and one synced original, are not shared with the integration.
    forbidden: [rowId(lockedRow)],
    hidden: [uid('demo:lost-original')],
  };
}

export const DEMO_IDS = {
  roadmapRows: ROADMAP.length,
  bugRows: 130,
  rowId,
  bugId,
};
