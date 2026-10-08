import {
  APIErrorCode,
  APIResponseError,
  Client,
  LogLevel,
  isNotionClientError,
} from '@notionhq/client';
import type { ConnectorContext } from '@exitos/core/sdk';
import {
  ApiError,
  NetworkError,
  RequestScheduler,
  mapWithConcurrency,
  redactString,
  type RetryEvent,
} from '@exitos/shared';
import { type z } from 'zod';
import {
  BlockRawSchema,
  BotUserRawSchema,
  DataSourceRawSchema,
  DatabaseRawSchema,
  ListEnvelopeSchema,
  PageRawSchema,
  PropertyItemRawSchema,
  UserRawSchema,
  type BlockRaw,
  type DataSourceRaw,
  type DatabaseRaw,
  type ListEnvelope,
  type PageRaw,
  type PropertyItemRaw,
  type UserRaw,
} from './raw.js';

const PAGE_SIZE = 100;
/** Notion documents a hard cap of 10 000 results per data-source query. */
const MAX_WINDOWS = 100;

export interface NotionClientOptions {
  context: ConnectorContext;
  token: string;
  notionVersion: string;
  requestsPerMinute: number;
}

export interface QueryResult {
  pages: PageRaw[];
  /** True when rows could not be read (cap reached without progress, or maxRecords hit). */
  incomplete: boolean;
  reason?: 'query_cap_no_progress' | 'max_records';
  windows: number;
  requestsMade: number;
  /** Non-page results (wiki data sources) that were skipped. */
  skippedNonPages: number;
}

/**
 * Thin, validated wrapper over the official Notion SDK.
 *
 * All traffic goes through `context.fetch` (host allow-list + read-only guard) and a single
 * `RequestScheduler` (pacing, 429/Retry-After, backoff). SDK-level retries are disabled so
 * pacing is decided in exactly one place (ADR 0012).
 */
export class NotionClient {
  readonly #sdk: Client;
  readonly scheduler: RequestScheduler;
  readonly #context: ConnectorContext;

  constructor(options: NotionClientOptions) {
    const { context } = options;
    this.#context = context;
    this.scheduler = new RequestScheduler({
      clock: context.clock,
      concurrency: Math.max(1, context.concurrency),
      requestsPerMinute: options.requestsPerMinute,
      burst: 5,
      onRetry: (event: RetryEvent) =>
        context.logger.debug('notion: retrying request', {
          reason: event.reason,
          status: event.status,
          waitMs: event.waitMs,
          attempt: event.attempt,
        }),
    });

    const scheduled = (url: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = new URL(url).pathname.replace(/\/[0-9a-f-]{32,36}/gi, '/:id');
      return this.scheduler.run(() => context.fetch(url, init), {
        label: `notion ${method} ${path}`,
        // Every call this connector makes is a read (some are POST), so all are safe to retry.
        idempotent: true,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
    };

    this.#sdk = new Client({
      auth: options.token,
      notionVersion: options.notionVersion,
      baseUrl: context.baseUrl,
      fetch: scheduled,
      retry: false,
      timeoutMs: 60_000,
      logLevel: LogLevel.ERROR,
      logger: () => undefined, // never let the SDK print; we log (redacted) ourselves
    });
  }

  async #call<T>(label: string, run: () => Promise<unknown>, schema: z.ZodType<T>): Promise<T> {
    let raw: unknown;
    try {
      raw = await run();
    } catch (error) {
      throw mapNotionError(error, label);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const where = parsed.error.issues
        .slice(0, 4)
        .map((i) => i.path.join('.') || '(root)')
        .join(', ');
      throw new ApiError(`unexpected response shape at: ${where}`, {
        system: 'notion',
        status: 200,
        endpoint: label,
        apiCode: 'unexpected_response_shape',
      });
    }
    return parsed.data;
  }

  // ---- identity -----------------------------------------------------------------------------

  me(): Promise<z.infer<typeof BotUserRawSchema>> {
    return this.#call('GET /v1/users/me', () => this.#sdk.users.me({}), BotUserRawSchema);
  }

  /** All users visible to the connection. Throws `restricted_resource` without the capability. */
  async listUsers(): Promise<UserRaw[]> {
    const out: UserRaw[] = [];
    for await (const env of this.#paginate('GET /v1/users', (cursor) =>
      this.#sdk.users.list({ page_size: PAGE_SIZE, ...(cursor ? { start_cursor: cursor } : {}) }),
    )) {
      for (const item of env.results) {
        const user = UserRawSchema.safeParse(item);
        if (user.success) out.push(user.data);
      }
    }
    return out;
  }

  // ---- discovery ----------------------------------------------------------------------------

  /** `search` is explicitly NOT exhaustive (Notion docs); callers must say so. */
  async search(kind: 'data_source' | 'page'): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const env of this.#paginate('POST /v1/search', (cursor) =>
      this.#sdk.search({
        filter: { property: 'object', value: kind },
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    )) {
      out.push(...env.results);
    }
    return out;
  }

  getDatabase(id: string): Promise<DatabaseRaw> {
    return this.#call(
      'GET /v1/databases/:id',
      () => this.#sdk.databases.retrieve({ database_id: id }),
      DatabaseRawSchema,
    );
  }

  getDataSource(id: string): Promise<DataSourceRaw> {
    return this.#call(
      'GET /v1/data_sources/:id',
      () => this.#sdk.dataSources.retrieve({ data_source_id: id }),
      DataSourceRawSchema,
    );
  }

  getPage(id: string): Promise<PageRaw> {
    return this.#call(
      'GET /v1/pages/:id',
      () => this.#sdk.pages.retrieve({ page_id: id }),
      PageRawSchema,
    );
  }

  // ---- bulk reads ---------------------------------------------------------------------------

  /**
   * Read every row of a data source, in a stable `created_time` order.
   *
   * Notion caps a single query at 10 000 results and signals it with `request_status.type ===
   * "incomplete"`. We detect that and continue in `created_time` windows, de-duplicating by id, as
   * the documentation recommends — rather than silently returning a truncated list.
   */
  async queryAllPages(
    dataSourceId: string,
    options: { maxRecords: number; filterProperties?: string[] } = { maxRecords: 50_000 },
  ): Promise<QueryResult> {
    const rows = new Map<string, PageRaw>();
    let windowStart: string | undefined;
    let windows = 0;
    let requestsMade = 0;
    let skippedNonPages = 0;
    let incomplete = false;
    let reason: QueryResult['reason'];

    for (;;) {
      windows += 1;
      let cursor: string | undefined;
      let capped = false;
      let lastCreated: string | undefined;
      do {
        const body = {
          data_source_id: dataSourceId,
          page_size: PAGE_SIZE,
          sorts: [{ timestamp: 'created_time' as const, direction: 'ascending' as const }],
          ...(windowStart === undefined
            ? {}
            : {
                filter: {
                  timestamp: 'created_time' as const,
                  created_time: { on_or_after: windowStart },
                },
              }),
          ...(cursor === undefined ? {} : { start_cursor: cursor }),
          ...(options.filterProperties === undefined
            ? {}
            : { filter_properties: options.filterProperties }),
        };
        const env = await this.#call(
          'POST /v1/data_sources/:id/query',
          () => this.#sdk.dataSources.query(body),
          ListEnvelopeSchema,
        );
        requestsMade += 1;
        if (env.request_status?.type === 'incomplete') capped = true;
        for (const item of env.results) {
          const page = PageRawSchema.safeParse(item);
          if (!page.success) {
            skippedNonPages += 1;
            continue;
          }
          rows.set(page.data.id, page.data);
          lastCreated = page.data.created_time;
        }
        cursor = env.has_more === true && env.next_cursor ? env.next_cursor : undefined;
        if (rows.size >= options.maxRecords) {
          incomplete = true;
          reason = 'max_records';
          cursor = undefined;
          capped = false;
        }
      } while (cursor !== undefined);

      if (!capped) break;
      if (lastCreated === undefined || lastCreated === windowStart || windows >= MAX_WINDOWS) {
        // The cap was hit but the window cannot advance: > 10 000 rows share one timestamp.
        incomplete = true;
        reason = 'query_cap_no_progress';
        break;
      }
      windowStart = lastCreated;
    }

    return {
      pages: [...rows.values()],
      incomplete,
      ...(reason === undefined ? {} : { reason }),
      windows,
      requestsMade,
      skippedNonPages,
    };
  }

  /** Every item of one (paginated) page property, e.g. a relation with more than 25 targets. */
  async getPropertyItems(pageId: string, propertyId: string): Promise<PropertyItemRaw[]> {
    const out: PropertyItemRaw[] = [];
    for await (const env of this.#paginate('GET /v1/pages/:id/properties/:id', (cursor) =>
      this.#sdk.pages.properties.retrieve({
        page_id: pageId,
        property_id: propertyId,
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    )) {
      for (const item of env.results) {
        const parsed = PropertyItemRawSchema.safeParse(item);
        if (parsed.success) out.push(parsed.data);
      }
    }
    return out;
  }

  /**
   * First-level children of a block or page. Stops paginating once more than `max` blocks have been
   * seen (so a runaway page cannot exhaust the request budget); `truncated` says that happened.
   */
  async listBlockChildren(
    blockId: string,
    max = Number.POSITIVE_INFINITY,
  ): Promise<{ blocks: BlockRaw[]; truncated: boolean }> {
    const out: BlockRaw[] = [];
    let truncated = false;
    for await (const env of this.#paginate('GET /v1/blocks/:id/children', (cursor) =>
      this.#sdk.blocks.children.list({
        block_id: blockId,
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    )) {
      for (const item of env.results) {
        const block = BlockRawSchema.safeParse(item);
        if (block.success) out.push(block.data);
      }
      if (out.length > max) {
        truncated = true;
        break;
      }
    }
    if (out.length > max) {
      truncated = true;
      out.length = Math.max(0, max);
    }
    return { blocks: out, truncated };
  }

  /** Run a list of independent reads with the scheduler's concurrency budget. */
  map<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    return mapWithConcurrency(items, this.#context.concurrency, fn, this.#context.signal);
  }

  async *#paginate(
    label: string,
    fetchPage: (cursor: string | undefined) => Promise<unknown>,
  ): AsyncGenerator<ListEnvelope> {
    let cursor: string | undefined;
    for (let guard = 0; guard < 100_000; guard++) {
      const env = await this.#call(label, () => fetchPage(cursor), ListEnvelopeSchema);
      yield env;
      if (env.has_more !== true || !env.next_cursor) return;
      cursor = env.next_cursor;
    }
    throw new ApiError('pagination did not terminate', {
      system: 'notion',
      status: 200,
      endpoint: label,
      apiCode: 'pagination_loop',
    });
  }
}

/** Convert SDK and transport failures into ExitOS errors with redacted, user-facing messages. */
export function mapNotionError(error: unknown, label: string): Error {
  if (error instanceof APIResponseError) {
    const hint =
      error.code === APIErrorCode.ObjectNotFound
        ? ' (the page or database is missing, or has not been shared with your integration)'
        : error.code === APIErrorCode.RestrictedResource
          ? ' (the integration lacks the required capability)'
          : error.code === APIErrorCode.Unauthorized
            ? ' (the token is invalid or revoked)'
            : '';
    return new ApiError(`${error.code}${hint}`, {
      system: 'notion',
      status: error.status,
      endpoint: label,
      apiCode: error.code,
      retryable: error.status === 429 || error.status >= 500,
    });
  }
  if (isNotionClientError(error)) {
    return new NetworkError(`notion ${label}: ${redactString(error.message)}`, { cause: error });
  }
  // Our own errors (WriteBlockedError, NetworkError, AbortedError, …) pass through unchanged.
  return error instanceof Error ? error : new Error(redactString(String(error)));
}
