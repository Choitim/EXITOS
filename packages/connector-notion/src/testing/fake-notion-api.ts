import type { FetchLike } from '@exitos/shared';
import type { Obj } from './builders.js';

/**
 * An in-process fake of the Notion REST API, serving API-shaped JSON from a fixture.
 *
 * Faithful where it matters to ExitOS: Bearer auth + `Notion-Version` required, cursor pagination
 * with `page_size` ≤ 100, `POST /data_sources/:id/query` honouring `created_time` filters/sorts and
 * the documented 10 000-row cap (`request_status: incomplete`), property-item pagination, 404 for
 * content not shared with the integration, 403 for missing capabilities, and `429 + Retry-After`.
 *
 * No sockets are opened: it is a `fetch` function. This is what the offline demo and the
 * integration tests run the REAL connector against (ADR 0008).
 */
export interface NotionFixture {
  workspace: { id: string; name: string; botId: string };
  /** When false, `GET /users` returns 403 and person objects carry no e-mail. */
  userInfoCapability: boolean;
  users: Obj[];
  databases: Obj[];
  dataSources: Obj[];
  pages: Obj[];
  /** Children by parent (page or block) id, in dashed UUID form. */
  blocks: Record<string, Obj[]>;
  /** Full property-item lists for truncated properties: key = `${pageId}:${propertyId}`. */
  propertyItems?: Record<string, Obj[]>;
  /** Ids that exist but are not shared with the integration (→ 404 object_not_found). */
  hidden?: string[];
  /** Ids the integration may not read (→ 403 restricted_resource). */
  forbidden?: string[];
}

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  body: unknown;
}

export interface Fault {
  /** Return true to apply this fault to a request. */
  match: (request: FakeRequest) => boolean;
  /** How many times to apply it (default 1). */
  times?: number;
  respond: () => Response | Promise<Response> | never;
}

export interface FakeNotionOptions {
  /** Accepted bearer tokens. Default: any non-empty token. */
  validTokens?: readonly string[];
  /** Per-query result cap (real Notion: 10 000). Lowered in tests to exercise the windowing. */
  queryResultCap?: number;
}

export interface FakeNotionApi {
  fetch: FetchLike;
  /** Every request received, in order (including ones that hit an injected fault). */
  readonly requests: FakeRequest[];
  fault(fault: Fault): void;
  /** Convenience: respond 429 with Retry-After to the next `times` requests matching `match`. */
  rateLimit(times: number, retryAfterSeconds: number, match?: (r: FakeRequest) => boolean): void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const apiError = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response =>
  json(status, { object: 'error', status, code, message, request_id: 'fake-request-id' }, headers);

const dashed = (id: string): string => {
  const n = id.replace(/-/g, '').toLowerCase();
  return n.length === 32
    ? `${n.slice(0, 8)}-${n.slice(8, 12)}-${n.slice(12, 16)}-${n.slice(16, 20)}-${n.slice(20)}`
    : id;
};
const norm = (id: unknown): string =>
  String(typeof id === 'string' ? id : '')
    .replace(/-/g, '')
    .toLowerCase();

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    return headers.find(([k]) => k?.toLowerCase() === name.toLowerCase())?.[1];
  }
  for (const [k, v] of Object.entries(headers))
    if (k.toLowerCase() === name.toLowerCase()) return String(v);
  return undefined;
}

export function createFakeNotionApi(
  fixture: NotionFixture,
  options: FakeNotionOptions = {},
): FakeNotionApi {
  const requests: FakeRequest[] = [];
  const faults: Array<Fault & { left: number }> = [];
  const cap = options.queryResultCap ?? 10_000;
  const hidden = new Set((fixture.hidden ?? []).map(norm));
  const forbidden = new Set((fixture.forbidden ?? []).map(norm));
  const byId = <T extends Obj>(list: T[], id: string): T | undefined =>
    list.find((o) => norm(o.id) === norm(id));

  const paginate = (items: Obj[], query: Record<string, string[]>, body: Obj | undefined): Obj => {
    const sizeRaw =
      (body?.page_size as number | undefined) ??
      (query.page_size?.[0] === undefined ? 100 : Number(query.page_size[0]));
    const size = Math.min(Math.max(1, sizeRaw), 100);
    const cursor = (body?.start_cursor as string | undefined) ?? query.start_cursor?.[0];
    const offset =
      cursor === undefined ? 0 : Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    const slice = items.slice(offset, offset + size);
    const next = offset + size;
    const more = next < items.length;
    return {
      object: 'list',
      results: slice,
      next_cursor: more ? Buffer.from(String(next), 'utf8').toString('base64url') : null,
      has_more: more,
      type: 'page_or_data_source',
    };
  };

  // Rows by data source, indexed once. Re-filtering every page on every request made a 100 000-row
  // fixture quadratic, which skewed the scale measurements; the index is rebuilt if pages are added.
  let rowIndex: Map<string, Obj[]> | undefined;
  let indexedPages = -1;
  const rowsOf = (dataSourceId: string): Obj[] => {
    if (rowIndex === undefined || indexedPages !== fixture.pages.length) {
      rowIndex = new Map();
      for (const page of fixture.pages) {
        if (hidden.has(norm(page.id))) continue;
        const key = norm((page.parent as Obj | undefined)?.data_source_id);
        const bucket = rowIndex.get(key);
        if (bucket === undefined) rowIndex.set(key, [page]);
        else bucket.push(page);
      }
      indexedPages = fixture.pages.length;
    }
    return rowIndex.get(norm(dataSourceId)) ?? [];
  };

  const handle = (req: FakeRequest, init: RequestInit | undefined): Response => {
    // ---- authentication & version -------------------------------------------------------------
    const auth = headerOf(init, 'authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (
      !auth.toLowerCase().startsWith('bearer ') ||
      token === '' ||
      (options.validTokens && !options.validTokens.includes(token))
    ) {
      return apiError(401, 'unauthorized', 'API token is invalid.');
    }
    if (headerOf(init, 'notion-version') === undefined) {
      return apiError(
        400,
        'missing_version',
        'Notion-Version header failed validation: should be defined.',
      );
    }

    const { method, path, query } = req;
    const body = (req.body ?? undefined) as Obj | undefined;
    let m: RegExpExecArray | null;

    if (method === 'GET' && path === '/v1/users/me') {
      return json(200, {
        object: 'user',
        id: fixture.workspace.botId,
        type: 'bot',
        name: 'ExitOS integration',
        avatar_url: null,
        bot: {
          owner: { type: 'workspace', workspace: true },
          workspace_name: fixture.workspace.name,
          workspace_id: fixture.workspace.id,
        },
      });
    }
    if (method === 'GET' && path === '/v1/users') {
      if (!fixture.userInfoCapability) {
        return apiError(403, 'restricted_resource', 'Insufficient permissions for this endpoint.');
      }
      return json(200, paginate(fixture.users, query, undefined));
    }
    if (method === 'POST' && path === '/v1/search') {
      const wanted = ((body?.filter as Obj | undefined)?.value as string | undefined) ?? undefined;
      const pool =
        wanted === 'data_source'
          ? fixture.dataSources
          : wanted === 'page'
            ? fixture.pages
            : [...fixture.dataSources, ...fixture.pages];
      return json(
        200,
        paginate(
          pool.filter((o) => !hidden.has(norm(o.id))),
          query,
          body,
        ),
      );
    }
    if (method === 'GET' && (m = /^\/v1\/databases\/([^/]+)$/.exec(path))) {
      const id = m[1] as string;
      const db = byId(fixture.databases, id);
      if (!db || hidden.has(norm(id))) return notFound('database', id);
      return json(200, db);
    }
    if (method === 'GET' && (m = /^\/v1\/data_sources\/([^/]+)$/.exec(path))) {
      const id = m[1] as string;
      const ds = byId(fixture.dataSources, id);
      if (!ds || hidden.has(norm(id))) return notFound('data_source', id);
      return json(200, ds);
    }
    if (method === 'POST' && (m = /^\/v1\/data_sources\/([^/]+)\/query$/.exec(path))) {
      const id = m[1] as string;
      if (!byId(fixture.dataSources, id) || hidden.has(norm(id)))
        return notFound('data_source', id);
      return json(200, queryDataSource(rowsOf(id), body, query, cap));
    }
    if (method === 'GET' && (m = /^\/v1\/pages\/([^/]+)\/properties\/([^/]+)$/.exec(path))) {
      const pageId = m[1] as string;
      const propId = decodeURIComponent(m[2] as string);
      if (!byId(fixture.pages, pageId) || hidden.has(norm(pageId))) return notFound('page', pageId);
      const items = fixture.propertyItems?.[`${dashed(pageId)}:${propId}`] ?? [];
      return json(200, { ...paginate(items, query, undefined), type: 'property_item' });
    }
    if (method === 'GET' && (m = /^\/v1\/pages\/([^/]+)$/.exec(path))) {
      const id = m[1] as string;
      const page = byId(fixture.pages, id);
      if (!page || hidden.has(norm(id))) return notFound('page', id);
      if (forbidden.has(norm(id)))
        return apiError(403, 'restricted_resource', 'Insufficient permissions for this endpoint.');
      return json(200, page);
    }
    if (method === 'GET' && (m = /^\/v1\/blocks\/([^/]+)\/children$/.exec(path))) {
      const id = m[1] as string;
      if (hidden.has(norm(id))) return notFound('block', id);
      if (forbidden.has(norm(id)))
        return apiError(403, 'restricted_resource', 'Insufficient permissions for this endpoint.');
      return json(200, paginate(fixture.blocks[dashed(id)] ?? [], query, undefined));
    }
    return apiError(404, 'invalid_request_url', `Invalid request URL: ${method} ${path}`);
  };

  const notFound = (kind: string, id: string): Response =>
    apiError(
      404,
      'object_not_found',
      `Could not find ${kind} with ID: ${dashed(id)}. Make sure the relevant pages and databases are shared with your integration.`,
    );

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
      return fault.respond();
    }
    return handle(req, init);
  };

  return {
    fetch,
    requests,
    fault(fault) {
      faults.push({ ...fault, left: fault.times ?? 1 });
    },
    rateLimit(times, retryAfterSeconds, match = () => true) {
      faults.push({
        match,
        left: times,
        respond: () =>
          apiError(
            429,
            'rate_limited',
            'You have been rate limited. Please try again in a few minutes.',
            {
              'retry-after': String(retryAfterSeconds),
            },
          ),
      });
    },
  };
}

function queryDataSource(
  rows: Obj[],
  body: Obj | undefined,
  query: Record<string, string[]>,
  cap: number,
): Obj {
  const requested = (body?.page_size as number | undefined) ?? 100;
  if (requested > 100 || requested < 1) {
    return {
      object: 'error',
      status: 400,
      code: 'validation_error',
      message:
        'body failed validation: body.page_size should be ≤ `100`, instead was `' +
        String(requested) +
        '`.',
    };
  }
  let matched = [...rows];
  const filter = body?.filter as Obj | undefined;
  if (filter?.timestamp === 'created_time') {
    const after = (filter.created_time as Obj | undefined)?.on_or_after as string | undefined;
    if (after !== undefined) matched = matched.filter((r) => String(r.created_time) >= after);
  }
  const sorts = body?.sorts as Obj[] | undefined;
  const direction = sorts?.[0]?.direction === 'descending' ? -1 : 1;
  matched.sort(
    (a, b) =>
      direction *
      (String(a.created_time).localeCompare(String(b.created_time)) ||
        String(a.id).localeCompare(String(b.id))),
  );

  const capped = matched.length > cap;
  const visible = capped ? matched.slice(0, cap) : matched;

  const cursor = body?.start_cursor as string | undefined;
  const offset =
    cursor === undefined ? 0 : Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  const slice = visible.slice(offset, offset + requested);
  const next = offset + requested;
  const more = next < visible.length;

  const wantedProps = query.filter_properties;
  const results = wantedProps
    ? slice.map((r) => ({
        ...r,
        properties: Object.fromEntries(
          Object.entries(r.properties as Obj).filter(
            ([name, p]) =>
              wantedProps.includes(name) || wantedProps.includes(String((p as Obj).id)),
          ),
        ),
      }))
    : slice;

  return {
    object: 'list',
    results,
    next_cursor: more ? Buffer.from(String(next), 'utf8').toString('base64url') : null,
    has_more: more,
    type: 'page_or_data_source',
    // On the last page of a capped result set Notion reports the result as incomplete.
    ...(capped && !more
      ? { request_status: { type: 'incomplete', incomplete_reason: 'query_result_limit_reached' } }
      : {}),
  };
}
