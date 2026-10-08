import type { FetchLike } from '@exitos/shared';

/**
 * An in-process fake of the parts of ClickUp's API v2 / v3 that ExitOS uses.
 *
 * Faithful where it matters: Authorization header required; hierarchy endpoints; list statuses and
 * custom-field definitions; `POST /list/{id}/task` validating status, priority, assignees and custom
 * fields; `GET /list/{id}/task` at 100 per page with `last_page`; drop-down values returned as
 * `orderindex` and numbers as strings (as ClickUp does); linked tasks; Docs v3 create/search/pages;
 * a 100-requests-per-minute limit that answers `429` with `X-RateLimit-*` headers (and, like the
 * real API, no `Retry-After`).
 *
 * It keeps its state in memory and can export/import it as JSON so a demo can survive across CLI
 * processes. No sockets are opened (ADR 0008).
 */

export interface FakeMember {
  id: number;
  username: string;
  email: string;
}

export interface FakeFieldDef {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  options?: Array<{ id: string; name: string }>;
}

export interface FakeList {
  id: string;
  name: string;
  spaceId: string;
  folderId?: string;
  statuses: Array<{ status: string; type: string }>;
  fields: FakeFieldDef[];
}

export interface FakeTask {
  id: string;
  name: string;
  markdown_description: string;
  status: string;
  priority: number | null;
  due_date: string | null;
  start_date: string | null;
  assignees: number[];
  tags: string[];
  customValues: Record<string, unknown>; // by field id (drop_down stores option id; date stores ms)
  listId: string;
  date_created: number;
  links: string[];
  archived: boolean;
}

export interface FakeDoc {
  id: string;
  name: string;
  workspaceId: string;
  parent: { id: string; type: number };
  visibility: string;
  date_created: number;
}

export interface FakePage {
  id: string;
  docId: string;
  parentPageId: string | null;
  name: string;
  content: string;
  date_created: number;
  order: number;
}

export interface FakeClickUpState {
  workspace: { id: string; name: string };
  members: FakeMember[];
  spaces: Array<{ id: string; name: string; tags: string[] }>;
  folders: Array<{ id: string; name: string; spaceId: string }>;
  lists: FakeList[];
  tasks: FakeTask[];
  docs: FakeDoc[];
  pages: FakePage[];
  counters: { task: number; doc: number; page: number };
}

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  body: unknown;
}

export interface FakeClickUpOptions {
  /** Millisecond clock; inject a virtual clock for deterministic timestamps and rate limiting. */
  now?: () => number;
  /** Real ClickUp: 100/min on Free, Unlimited and Business plans. Set 0 to disable. */
  rateLimitPerMinute?: number;
  validTokens?: readonly string[];
  /** Called after every state change (used by the demo to persist state to disk). */
  onChange?: (state: FakeClickUpState) => void;
}

export interface Fault {
  match: (request: FakeRequest) => boolean;
  times?: number;
  /** `respond` returns a response; `throw` simulates a dropped connection. */
  respond?: () => Response;
  throw?: () => Error;
  /** Process the request normally (state changes!) and THEN fail: "the write happened, the reply was lost". */
  failAfterCommit?: () => Error | Response;
}

export interface FakeClickUpApi {
  fetch: FetchLike;
  state: FakeClickUpState;
  readonly requests: FakeRequest[];
  fault(fault: Fault): void;
  /** Convenience: answer the next `times` matching requests with 429. */
  rateLimit(times: number, match?: (r: FakeRequest) => boolean): void;
  /** Tasks currently in a list (for assertions). */
  tasksIn(listId: string): FakeTask[];
  /** Behaviour switches for tests. */
  behavior: { omitDescriptions: boolean };
  /** Counters useful for demos and assertions. */
  readonly stats: { rateLimited: number; faultsTriggered: number };
  exportState(): FakeClickUpState;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const error = (status: number, err: string, code: string): Response =>
  json(status, { err, ECODE: code });

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  if (Array.isArray(h)) return h.find(([k]) => k?.toLowerCase() === name.toLowerCase())?.[1];
  for (const [k, v] of Object.entries(h))
    if (k.toLowerCase() === name.toLowerCase()) return String(v);
  return undefined;
}

const taskId = (n: number): string => `86f${n.toString(36).padStart(6, '0')}`;

export function createFakeClickUpApi(
  initial: FakeClickUpState,
  options: FakeClickUpOptions = {},
): FakeClickUpApi {
  const state: FakeClickUpState = structuredClone(initial);
  const now = options.now ?? (() => Date.now());
  const requests: FakeRequest[] = [];
  const faults: Array<Fault & { left: number }> = [];
  const windowLog: number[] = [];
  const limit = options.rateLimitPerMinute ?? 100;
  const memberIds = new Set(state.members.map((m) => m.id));
  const behavior = { omitDescriptions: false };
  const stats = { rateLimited: 0, faultsTriggered: 0 };
  const changed = (): void => options.onChange?.(state);

  const listById = (id: string): FakeList | undefined => state.lists.find((l) => l.id === id);

  const taskJson = (t: FakeTask, includeFields = true): Record<string, unknown> => {
    const list = listById(t.listId);
    const space = state.spaces.find((s) => s.id === list?.spaceId);
    return {
      id: t.id,
      custom_id: null,
      name: t.name,
      text_content: behavior.omitDescriptions
        ? null
        : t.markdown_description.replace(/[*_`#>]/g, ''),
      description: behavior.omitDescriptions ? null : t.markdown_description,
      markdown_description: behavior.omitDescriptions ? null : t.markdown_description,
      status: { status: t.status, type: 'open' },
      date_created: String(t.date_created),
      date_updated: String(t.date_created),
      archived: t.archived,
      creator: { id: 1, username: 'api', email: null },
      assignees: t.assignees.map((id) => {
        const m = state.members.find((x) => x.id === id);
        return { id, username: m?.username ?? String(id), email: m?.email ?? null };
      }),
      tags: t.tags.map((name) => ({ name })),
      parent: null,
      priority:
        t.priority === null
          ? null
          : {
              id: String(t.priority),
              priority: ['urgent', 'high', 'normal', 'low'][t.priority - 1],
            },
      due_date: t.due_date,
      start_date: t.start_date,
      custom_fields: includeFields
        ? (list?.fields ?? []).flatMap((f) => {
            if (!(f.id in t.customValues)) return [];
            const raw = t.customValues[f.id];
            let value: unknown = raw;
            if (f.type === 'drop_down') value = (f.options ?? []).findIndex((o) => o.id === raw);
            else if (f.type === 'number' || f.type === 'currency' || f.type === 'date')
              value = String(raw);
            return [
              {
                id: f.id,
                name: f.name,
                type: f.type,
                type_config: f.options
                  ? { options: f.options.map((o, i) => ({ ...o, orderindex: i })) }
                  : {},
                value,
              },
            ];
          })
        : [],
      linked_tasks: t.links.map((other) => ({ task_id: other, link_id: `${t.id}-${other}` })),
      list: { id: t.listId },
      team_id: state.workspace.id,
      url: `https://app.clickup.com/t/${t.id}`,
      space: { id: space?.id },
    };
  };

  const pageJson = (p: FakePage, withChildren: boolean): Record<string, unknown> => ({
    id: p.id,
    doc_id: p.docId,
    parent_page_id: p.parentPageId,
    workspace_id: Number(state.workspace.id),
    name: p.name,
    content: p.content,
    date_created: p.date_created,
    ...(withChildren
      ? {
          pages: state.pages
            .filter((c) => c.docId === p.docId && c.parentPageId === p.id)
            .sort((a, b) => a.order - b.order)
            .map((c) => pageJson(c, true)),
        }
      : {}),
  });

  const handle = (req: FakeRequest, init: RequestInit | undefined): Response => {
    const token = headerOf(init, 'authorization') ?? '';
    if (token === '' || (options.validTokens && !options.validTokens.includes(token))) {
      return error(401, 'Authorization header required', 'OAUTH_017');
    }
    const { method, path, query } = req;
    const body = (req.body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;

    if (method === 'GET' && path === '/api/v2/user') {
      return json(200, {
        user: { id: 1, username: 'ExitOS Demo User', email: 'demo@example.com' },
      });
    }
    if (method === 'GET' && path === '/api/v2/team') {
      return json(200, {
        teams: [
          {
            id: state.workspace.id,
            name: state.workspace.name,
            color: '#000',
            avatar: null,
            members: state.members.map((u) => ({ user: u })),
          },
        ],
      });
    }
    if (method === 'GET' && (m = /^\/api\/v2\/team\/([^/]+)\/space$/.exec(path))) {
      if (m[1] !== state.workspace.id) return error(401, 'Team not authorized', 'OAUTH_023');
      return json(200, { spaces: state.spaces.map(({ id, name }) => ({ id, name })) });
    }
    if (method === 'GET' && (m = /^\/api\/v2\/space\/([^/]+)\/folder$/.exec(path))) {
      return json(200, {
        folders: state.folders
          .filter((f) => f.spaceId === m?.[1])
          .map((f) => ({
            id: f.id,
            name: f.name,
            lists: state.lists
              .filter((l) => l.folderId === f.id)
              .map((l) => ({ id: l.id, name: l.name })),
          })),
      });
    }
    if (method === 'GET' && (m = /^\/api\/v2\/space\/([^/]+)\/list$/.exec(path))) {
      return json(200, {
        lists: state.lists
          .filter((l) => l.spaceId === m?.[1] && l.folderId === undefined)
          .map((l) => ({ id: l.id, name: l.name })),
      });
    }
    if (method === 'GET' && (m = /^\/api\/v2\/space\/([^/]+)\/tag$/.exec(path))) {
      const space = state.spaces.find((s) => s.id === m?.[1]);
      return space
        ? json(200, { tags: space.tags.map((name) => ({ name })) })
        : error(404, 'Space not found', 'SPACE_015');
    }
    if (method === 'GET' && (m = /^\/api\/v2\/list\/([^/]+)\/field$/.exec(path))) {
      const list = listById(m[1] as string);
      if (!list) return error(404, 'List not found', 'LIST_015');
      return json(200, {
        fields: list.fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          required: f.required ?? false,
          type_config: f.options
            ? { options: f.options.map((o, i) => ({ ...o, orderindex: i })) }
            : {},
          date_created: '1700000000000',
          hide_from_guests: false,
        })),
      });
    }
    if (method === 'GET' && (m = /^\/api\/v2\/list\/([^/]+)\/task$/.exec(path))) {
      const list = listById(m[1] as string);
      if (!list) return error(404, 'List not found', 'LIST_015');
      const page = Number(query.page?.[0] ?? '0');
      const after = query.date_created_gt?.[0] === undefined ? 0 : Number(query.date_created_gt[0]);
      const all = state.tasks
        .filter((t) => t.listId === list.id && t.date_created > after)
        .sort((a, b) => a.date_created - b.date_created || a.id.localeCompare(b.id));
      const slice = all.slice(page * 100, page * 100 + 100);
      return json(200, {
        tasks: slice.map((t) => taskJson(t)),
        last_page: (page + 1) * 100 >= all.length,
      });
    }
    if (method === 'GET' && (m = /^\/api\/v2\/list\/([^/]+)$/.exec(path))) {
      const list = listById(m[1] as string);
      if (!list) return error(404, 'List not found', 'LIST_015');
      const space = state.spaces.find((s) => s.id === list.spaceId);
      const folder = state.folders.find((f) => f.id === list.folderId);
      return json(200, {
        id: list.id,
        name: list.name,
        archived: false,
        statuses: list.statuses.map((s, i) => ({
          id: `st${i}`,
          status: s.status,
          type: s.type,
          orderindex: i,
        })),
        space: { id: space?.id, name: space?.name },
        folder: folder
          ? { id: folder.id, name: folder.name, hidden: false }
          : { id: '0', name: 'hidden', hidden: true },
      });
    }
    if (method === 'POST' && (m = /^\/api\/v2\/list\/([^/]+)\/task$/.exec(path))) {
      return createTask(listById(m[1] as string), body);
    }
    if (method === 'GET' && (m = /^\/api\/v2\/task\/([^/]+)$/.exec(path))) {
      const t = state.tasks.find((x) => x.id === m?.[1]);
      return t ? json(200, taskJson(t)) : error(404, 'Task not found', 'ITEM_013');
    }
    if (method === 'POST' && (m = /^\/api\/v2\/task\/([^/]+)\/link\/([^/]+)$/.exec(path))) {
      const a = state.tasks.find((x) => x.id === m?.[1]);
      const b = state.tasks.find((x) => x.id === m?.[2]);
      if (!a || !b) return error(404, 'Task not found', 'ITEM_013');
      if (!a.links.includes(b.id)) a.links.push(b.id);
      if (!b.links.includes(a.id)) b.links.push(a.id);
      changed();
      return json(200, { task: taskJson(a) });
    }

    // ---- Docs v3 -------------------------------------------------------------------------
    if (method === 'GET' && (m = /^\/api\/v3\/workspaces\/(\d+)\/docs$/.exec(path))) {
      let docs = state.docs.filter((d) => d.workspaceId === m?.[1]);
      const parentId = query.parent_id?.[0];
      if (parentId !== undefined) docs = docs.filter((d) => d.parent.id === parentId);
      return json(200, {
        docs: docs.map((d) => ({
          ...d,
          type: 1,
          public: false,
          creator: 1,
          deleted: false,
          archived: false,
        })),
        next_cursor: null,
      });
    }
    if (method === 'POST' && (m = /^\/api\/v3\/workspaces\/(\d+)\/docs$/.exec(path))) {
      if (typeof body.name !== 'string') return error(400, 'name is required', 'DOC_001');
      const parent = body.parent as { id?: unknown; type?: unknown } | undefined;
      if (!parent || typeof parent.id !== 'string' || typeof parent.type !== 'number')
        return error(400, 'parent is invalid', 'DOC_002');
      state.counters.doc += 1;
      const doc: FakeDoc = {
        id: `2kd${state.counters.doc.toString(36).padStart(4, '0')}-${state.counters.doc}`,
        name: body.name,
        workspaceId: m[1] as string,
        parent: { id: parent.id, type: parent.type },
        visibility: typeof body.visibility === 'string' ? body.visibility : 'PRIVATE',
        date_created: now(),
      };
      state.docs.push(doc);
      changed();
      return json(201, { ...doc, type: 1, public: false, creator: 1 });
    }
    if (
      method === 'POST' &&
      (m = /^\/api\/v3\/workspaces\/(\d+)\/docs\/([^/]+)\/pages$/.exec(path))
    ) {
      const doc = state.docs.find((d) => d.id === m?.[2]);
      if (!doc) return error(404, 'Doc not found', 'DOC_404');
      if (typeof body.name !== 'string') return error(400, 'name is required', 'DOC_003');
      if (
        typeof body.parent_page_id === 'string' &&
        !state.pages.some((p) => p.id === body.parent_page_id && p.docId === doc.id)
      ) {
        return error(400, 'parent_page_id does not exist in this Doc', 'DOC_004');
      }
      state.counters.page += 1;
      const page: FakePage = {
        id: `2kp${state.counters.page.toString(36).padStart(4, '0')}-${state.counters.page}`,
        docId: doc.id,
        parentPageId: typeof body.parent_page_id === 'string' ? body.parent_page_id : null,
        name: body.name,
        content: typeof body.content === 'string' ? body.content : '',
        date_created: now(),
        order: state.counters.page,
      };
      state.pages.push(page);
      changed();
      return json(201, pageJson(page, false));
    }
    if (
      method === 'GET' &&
      (m = /^\/api\/v3\/workspaces\/(\d+)\/docs\/([^/]+)\/pages$/.exec(path))
    ) {
      const doc = state.docs.find((d) => d.id === m?.[2]);
      if (!doc) return error(404, 'Doc not found', 'DOC_404');
      const roots = state.pages
        .filter((p) => p.docId === doc.id && p.parentPageId === null)
        .sort((a, b) => a.order - b.order);
      return json(
        200,
        roots.map((p) => pageJson(p, true)),
      );
    }
    return error(404, `Route not found: ${method} ${path}`, 'APP_001');
  };

  const createTask = (list: FakeList | undefined, body: Record<string, unknown>): Response => {
    if (!list) return error(404, 'List not found', 'LIST_015');
    if (typeof body.name !== 'string' || body.name.trim() === '')
      return error(400, 'Task name invalid', 'ITEM_003');
    let status = list.statuses[0]?.status ?? 'to do';
    if (body.status !== undefined) {
      const found = list.statuses.find(
        (s) => s.status.toLowerCase() === String(body.status).toLowerCase(),
      );
      if (!found) return error(400, 'Status not found', 'CRTSK_001');
      status = found.status;
    }
    if (
      body.priority !== undefined &&
      body.priority !== null &&
      ![1, 2, 3, 4].includes(body.priority as number)
    ) {
      return error(400, 'Priority invalid', 'ITEM_020');
    }
    for (const a of (body.assignees as unknown[] | undefined) ?? []) {
      if (!memberIds.has(a as number))
        return error(400, 'Assignee is not a member of this Workspace', 'ITEM_025');
    }
    const customValues: Record<string, unknown> = {};
    for (const cf of (body.custom_fields as Array<{ id: string; value: unknown }> | undefined) ??
      []) {
      const def = list.fields.find((f) => f.id === cf.id);
      if (!def) return error(400, 'Custom field not found', 'FIELD_033');
      if (def.type === 'drop_down' && !(def.options ?? []).some((o) => o.id === cf.value))
        return error(400, 'Dropdown option invalid', 'FIELD_036');
      if (def.type === 'number' && typeof cf.value !== 'number')
        return error(400, 'Value must be a number', 'FIELD_037');
      customValues[cf.id] = cf.value;
    }
    const space = state.spaces.find((s) => s.id === list.spaceId);
    const tags = ((body.tags as string[] | undefined) ?? []).filter((t) =>
      space?.tags.some((x) => x.toLowerCase() === t.toLowerCase()),
    );
    state.counters.task += 1;
    const created = now();
    const task: FakeTask = {
      id: taskId(state.counters.task),
      name: body.name,
      markdown_description:
        typeof body.markdown_content === 'string'
          ? body.markdown_content
          : typeof body.description === 'string'
            ? body.description
            : '',
      status,
      priority: (body.priority as number | null | undefined) ?? null,
      due_date: typeof body.due_date === 'number' ? String(body.due_date) : null,
      start_date: typeof body.start_date === 'number' ? String(body.start_date) : null,
      assignees: [...((body.assignees as number[] | undefined) ?? [])],
      tags,
      customValues,
      listId: list.id,
      date_created: created,
      links: [],
      archived: false,
    };
    state.tasks.push(task);
    changed();
    return json(200, taskJson(task));
  };

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const query: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (query[k.replace(/\[\]$/, '')] ??= []).push(v);
    let body: unknown;
    if (typeof init?.body === 'string' && init.body !== '') body = JSON.parse(init.body);
    const req: FakeRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      query,
      body,
    };
    requests.push(req);

    const fault = faults.find((f) => f.left > 0 && f.match(req));
    if (fault) {
      fault.left -= 1;
      stats.faultsTriggered += 1;
      if (fault.respond) {
        const res = fault.respond();
        if (res.status === 429) stats.rateLimited += 1;
        return res;
      }
      if (fault.throw) throw fault.throw();
      if (fault.failAfterCommit) {
        handle(req, init); // the write HAPPENS …
        const failure = fault.failAfterCommit();
        if (failure instanceof Error) throw failure; // … but the caller never hears about it
        return failure;
      }
    }

    // Rate limiting: a sliding one-minute window, like ClickUp's per-token limit.
    if (limit > 0) {
      const t = now();
      while (windowLog.length > 0 && (windowLog[0] as number) <= t - 60_000) windowLog.shift();
      if (windowLog.length >= limit) {
        stats.rateLimited += 1;
        const reset = Math.ceil(((windowLog[0] as number) + 60_000) / 1000);
        return json(
          429,
          { err: 'Rate limit reached', ECODE: 'APP_002' },
          {
            'x-ratelimit-limit': String(limit),
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
          },
        );
      }
      windowLog.push(t);
    }
    return handle(req, init);
  };

  return {
    fetch,
    state,
    requests,
    fault(fault) {
      faults.push({ ...fault, left: fault.times ?? 1 });
    },
    rateLimit(times, match = () => true) {
      faults.push({
        match,
        left: times,
        respond: () =>
          json(
            429,
            { err: 'Rate limit reached', ECODE: 'APP_002' },
            {
              'x-ratelimit-limit': '100',
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.ceil((now() + 5000) / 1000)),
            },
          ),
      });
    },
    tasksIn: (listId) => state.tasks.filter((t) => t.listId === listId),
    behavior,
    stats,
    exportState: () => structuredClone(state),
  };
}

/** An empty-ish ClickUp Workspace with one Space, one list and typical custom fields, for tests. */
export function basicClickUpState(overrides: Partial<FakeClickUpState> = {}): FakeClickUpState {
  return {
    workspace: { id: '9000001', name: 'Test Workspace' },
    members: [
      { id: 1001, username: 'ada', email: 'ada@example.com' },
      { id: 1002, username: 'grace', email: 'grace@example.com' },
    ],
    spaces: [{ id: '90010', name: 'Engineering', tags: ['frontend', 'backend', 'design'] }],
    folders: [],
    lists: [
      {
        id: '901001',
        name: 'Roadmap',
        spaceId: '90010',
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
    ],
    tasks: [],
    docs: [],
    pages: [],
    counters: { task: 0, doc: 0, page: 0 },
    ...overrides,
  };
}
