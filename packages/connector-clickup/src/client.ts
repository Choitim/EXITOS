import type { ConnectorContext } from '@exitos/core/sdk';
import {
  HttpClient,
  RequestScheduler,
  assertSafePathSegment,
  parseResetTimestamp,
  type RetryEvent,
} from '@exitos/shared';
import type { z } from 'zod';
import {
  CreatedTaskSchema,
  DocSchema,
  DocSearchSchema,
  FoldersSchema,
  LinkResultSchema,
  ListFieldsSchema,
  ListSchema,
  ListsSchema,
  PageSchema,
  PagesSchema,
  SpacesSchema,
  TagsSchema,
  TaskListSchema,
  TaskSchema,
  TeamsSchema,
  UserSchema,
  type CustomFieldDef,
  type DocInfo,
  type ListInfo,
  type PageNode,
  type TaskInfo,
} from './schemas.js';

export interface ClickUpClientOptions {
  context: ConnectorContext;
  token: string;
  requestsPerMinute: number;
}

export interface TaskPage {
  tasks: TaskInfo[];
  /** True when the listing reached ClickUp's `last_page` (or an empty page): nothing was cut off. */
  complete: boolean;
  requests: number;
}

const safe = (id: string | number, label: string): string =>
  assertSafePathSegment(String(id), label);
const MAX_TASK_PAGES = 2000; // 200 000 tasks per list is far beyond a sane migration

/** Typed, validated, rate-limited access to the parts of ClickUp's API v2/v3 that ExitOS uses. */
export class ClickUpClient {
  readonly #http: HttpClient;
  readonly scheduler: RequestScheduler;

  constructor(options: ClickUpClientOptions) {
    const { context } = options;
    this.scheduler = new RequestScheduler({
      clock: context.clock,
      concurrency: Math.max(1, context.concurrency),
      requestsPerMinute: options.requestsPerMinute,
      burst: 5,
      // ClickUp documents X-RateLimit-Reset (a Unix timestamp) on 429s; Retry-After is not documented
      // but is still honoured by the scheduler if it is present.
      rateLimitDelayMs: (response, now) =>
        parseResetTimestamp(response.headers.get('x-ratelimit-reset'), now),
      onRetry: (event: RetryEvent) =>
        context.logger.debug('clickup: retrying request', {
          reason: event.reason,
          status: event.status,
          waitMs: event.waitMs,
          attempt: event.attempt,
        }),
    });
    this.#http = new HttpClient({
      fetch: context.fetch,
      scheduler: this.scheduler,
      baseUrl: context.baseUrl,
      system: 'clickup',
      // Personal tokens are sent as-is (docs: `Authorization: pk_...`).
      headers: () => ({ Authorization: options.token }),
      timeoutMs: 30_000,
      parseError: (_status, body) => {
        const b = (body ?? {}) as {
          err?: unknown;
          ECODE?: unknown;
          message?: unknown;
          error?: unknown;
        };
        const message = [b.err, b.message, b.error].find((m): m is string => typeof m === 'string');
        return {
          ...(typeof b.ECODE === 'string' ? { code: b.ECODE } : {}),
          ...(message === undefined ? {} : { message }),
        };
      },
    });
  }

  #get<T>(
    path: string,
    schema: z.ZodType<T>,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.#http.request({
      method: 'GET',
      path,
      schema,
      ...(query === undefined ? {} : { query }),
    });
  }

  // ---- identity & hierarchy ----------------------------------------------------------------

  async getAuthorizedUser() {
    return (await this.#get('/v2/user', UserSchema)).user;
  }

  async getTeams() {
    return (await this.#get('/v2/team', TeamsSchema)).teams;
  }

  async getSpaces(teamId: string) {
    return (
      await this.#get(`/v2/team/${safe(teamId, 'workspaceId')}/space`, SpacesSchema, {
        archived: false,
      })
    ).spaces;
  }

  async getFolders(spaceId: string) {
    return (
      await this.#get(`/v2/space/${safe(spaceId, 'spaceId')}/folder`, FoldersSchema, {
        archived: false,
      })
    ).folders;
  }

  async getFolderlessLists(spaceId: string) {
    return (
      await this.#get(`/v2/space/${safe(spaceId, 'spaceId')}/list`, ListsSchema, {
        archived: false,
      })
    ).lists;
  }

  getList(listId: string): Promise<ListInfo> {
    return this.#get(`/v2/list/${safe(listId, 'listId')}`, ListSchema);
  }

  async getListFields(listId: string): Promise<CustomFieldDef[]> {
    return (await this.#get(`/v2/list/${safe(listId, 'listId')}/field`, ListFieldsSchema)).fields;
  }

  async getSpaceTags(spaceId: string): Promise<string[]> {
    return (await this.#get(`/v2/space/${safe(spaceId, 'spaceId')}/tag`, TagsSchema)).tags.map(
      (t) => t.name,
    );
  }

  // ---- tasks --------------------------------------------------------------------------------

  /**
   * Every task of a list (open, closed and subtasks) with Markdown descriptions, 100 per page.
   * `createdAfterMs` narrows the listing, e.g. when reconciling an ambiguous create.
   */
  async listTasks(
    listId: string,
    options: { createdAfterMs?: number; maxPages?: number } = {},
  ): Promise<TaskPage> {
    const tasks: TaskInfo[] = [];
    let requests = 0;
    const limit = Math.min(options.maxPages ?? MAX_TASK_PAGES, MAX_TASK_PAGES);
    for (let page = 0; page < limit; page++) {
      const res = await this.#get(`/v2/list/${safe(listId, 'listId')}/task`, TaskListSchema, {
        page,
        include_closed: true,
        subtasks: true,
        include_timl: true,
        include_markdown_description: true,
        ...(options.createdAfterMs === undefined
          ? {}
          : { date_created_gt: options.createdAfterMs }),
      });
      requests += 1;
      tasks.push(...res.tasks);
      if (res.last_page === true || res.tasks.length === 0)
        return { tasks, complete: true, requests };
    }
    return { tasks, complete: false, requests };
  }

  getTask(taskId: string): Promise<TaskInfo> {
    return this.#get(`/v2/task/${safe(taskId, 'taskId')}`, TaskSchema, {
      include_markdown_description: true,
    });
  }

  createTask(listId: string, body: Record<string, unknown>) {
    return this.#http.request({
      method: 'POST',
      path: `/v2/list/${safe(listId, 'listId')}/task`,
      body,
      schema: CreatedTaskSchema,
    });
  }

  linkTasks(taskId: string, linksTo: string) {
    return this.#http.request({
      method: 'POST',
      path: `/v2/task/${safe(taskId, 'taskId')}/link/${safe(linksTo, 'linksTo')}`,
      schema: LinkResultSchema,
    });
  }

  // ---- docs (v3) ----------------------------------------------------------------------------

  async searchDocs(
    workspaceId: string,
    options: { parentId?: string; limit?: number } = {},
  ): Promise<DocInfo[]> {
    const out: DocInfo[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 500; guard++) {
      const res = await this.#get(
        `/v3/workspaces/${safe(workspaceId, 'workspaceId')}/docs`,
        DocSearchSchema,
        {
          ...(options.parentId === undefined ? {} : { parent_id: options.parentId }),
          limit: options.limit ?? 50,
          ...(cursor === undefined ? {} : { cursor }),
        },
      );
      out.push(...res.docs);
      if (!res.next_cursor) return out;
      cursor = res.next_cursor;
    }
    return out;
  }

  createDoc(workspaceId: string, body: Record<string, unknown>) {
    return this.#http.request({
      method: 'POST',
      path: `/v3/workspaces/${safe(workspaceId, 'workspaceId')}/docs`,
      body,
      schema: DocSchema,
    });
  }

  createPage(workspaceId: string, docId: string, body: Record<string, unknown>): Promise<PageNode> {
    return this.#http.request({
      method: 'POST',
      path: `/v3/workspaces/${safe(workspaceId, 'workspaceId')}/docs/${safe(docId, 'docId')}/pages`,
      body,
      schema: PageSchema,
    });
  }

  /** All pages of a doc, nested, with Markdown content. */
  getDocPages(workspaceId: string, docId: string): Promise<PageNode[]> {
    return this.#get(
      `/v3/workspaces/${safe(workspaceId, 'workspaceId')}/docs/${safe(docId, 'docId')}/pages`,
      PagesSchema,
      { max_page_depth: -1, content_format: 'text/md' },
    );
  }
}

/** Flatten a page tree depth-first. */
export function flattenPages(pages: readonly PageNode[]): PageNode[] {
  const out: PageNode[] = [];
  for (const page of pages) {
    out.push(page);
    if (page.pages) out.push(...flattenPages(page.pages));
  }
  return out;
}
