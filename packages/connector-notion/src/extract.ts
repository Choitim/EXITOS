import { ApiError, toSafeMessage } from '@exitos/shared';
import type { Finding } from '@exitos/core/sdk';
import { type NotionClient } from './client.js';
import type { NotionSourceConfig } from './config.js';
import { normalizeNotionId } from './ids.js';
import type {
  BlockNode,
  DataSourceBundle,
  NotionRaw,
  PageBundle,
  StandalonePageBundle,
} from './model.js';
import { notionDataSourceKey, notionPageKey } from './normalize-text.js';
import {
  isTrashed,
  type BlockRaw,
  type DataSourceRaw,
  type PageRaw,
  type PropertyItemRaw,
  type PropertyValueRaw,
  type UserRaw,
} from './raw.js';

const isAccessError = (e: unknown): e is ApiError =>
  e instanceof ApiError && (e.status === 404 || e.status === 403);

/** Notion truncates paginated property values in page objects at 25 references. */
const PROPERTY_REFERENCE_CAP = 25;

export interface ExtractContext {
  client: NotionClient;
  config: NotionSourceConfig;
  now: () => Date;
  onProgress: (message: string) => void;
}

/** Resolve a configured id to one or more data sources (it may be a database id). */
export async function resolveDataSources(
  client: NotionClient,
  id: string,
  findings: Finding[],
): Promise<DataSourceRaw[]> {
  try {
    return [await client.getDataSource(id)];
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 400)) throw error;
  }
  try {
    const database = await client.getDatabase(id);
    if (database.data_sources.length === 0) {
      findings.push({
        code: 'SOURCE_DATABASE_HAS_NO_DATA_SOURCE',
        outcome: 'unsupported',
        severity: 'error',
        category: 'source_feature',
        message: `Database ${id} exposes no data source to this integration.`,
      });
      return [];
    }
    const out: DataSourceRaw[] = [];
    for (const ds of database.data_sources) out.push(await client.getDataSource(ds.id));
    return out;
  } catch (error) {
    if (!isAccessError(error) && !(error instanceof ApiError && error.status === 400)) throw error;
    findings.push({
      code: 'SOURCE_NOT_ACCESSIBLE',
      outcome: 'unsupported',
      severity: 'error',
      category: 'permission',
      message: `Data source or database ${id} was not found. Check the id, and share it with your integration (••• → Connections).`,
    });
    return [];
  }
}

function needsFullItems(value: PropertyValueRaw): boolean {
  const record = value as Record<string, unknown>;
  const payload = record[value.type];
  if (value.type === 'relation')
    return (
      record.has_more === true ||
      (Array.isArray(payload) && payload.length >= PROPERTY_REFERENCE_CAP)
    );
  if (value.type === 'people' || value.type === 'title' || value.type === 'rich_text') {
    return Array.isArray(payload) && payload.length >= PROPERTY_REFERENCE_CAP;
  }
  return false;
}

async function completeTruncatedProperties(
  client: NotionClient,
  page: PageRaw,
): Promise<Record<string, PropertyItemRaw[]>> {
  const out: Record<string, PropertyItemRaw[]> = {};
  for (const value of Object.values(page.properties)) {
    if (!needsFullItems(value)) continue;
    try {
      out[value.id] = await client.getPropertyItems(page.id, value.id);
    } catch (error) {
      if (!isAccessError(error)) throw error;
    }
  }
  return out;
}

interface Budget {
  remaining: number;
  blocks: number;
  exceeded: boolean;
}

async function fetchTree(
  client: NotionClient,
  parentId: string,
  depth: number,
  maxDepth: number,
  budget: Budget,
): Promise<BlockNode[]> {
  const listing = await client.listBlockChildren(parentId, Math.max(0, budget.remaining));
  const blocks = listing.blocks;
  if (listing.truncated) budget.exceeded = true;
  budget.remaining -= blocks.length;
  budget.blocks += blocks.length;
  return client.map(blocks, async (block): Promise<BlockNode> => {
    const node: BlockNode = { block, children: [], status: 'ok' };
    if (!block.has_children || isTrashed(block)) return node;
    // Child pages are handled as pages of their own; child databases are reported, not entered.
    if (block.type === 'child_page' || block.type === 'child_database') return node;
    if (budget.remaining <= 0) {
      budget.exceeded = true;
      return { ...node, status: 'budget' };
    }
    if (depth >= maxDepth) return { ...node, status: 'depth_limit' };

    const syncedFrom = syncedOriginal(block);
    const readFrom = syncedFrom ?? block.id;
    try {
      node.children = await fetchTree(client, readFrom, depth + 1, maxDepth, budget);
    } catch (error) {
      if (!isAccessError(error)) throw error;
      node.status = 'inaccessible';
    }
    if (syncedFrom !== undefined) node.syncedFrom = syncedFrom;
    return node;
  });
}

function syncedOriginal(block: BlockRaw): string | undefined {
  if (block.type !== 'synced_block') return undefined;
  const payload = block.synced_block as { synced_from?: { block_id?: string } | null } | undefined;
  return payload?.synced_from?.block_id;
}

async function fetchBody(
  ctx: ExtractContext,
  pageId: string,
): Promise<Pick<PageBundle, 'blocks' | 'bodyStatus' | 'blockCount' | 'blocksTruncated'>> {
  const budget: Budget = {
    remaining: ctx.config.limits.maxBlocksPerPage,
    blocks: 0,
    exceeded: false,
  };
  try {
    const blocks = await fetchTree(ctx.client, pageId, 0, ctx.config.limits.maxBlockDepth, budget);
    return {
      blocks,
      bodyStatus: 'ok',
      blockCount: budget.blocks,
      blocksTruncated: budget.exceeded,
    };
  } catch (error) {
    if (!isAccessError(error)) throw error;
    return { blocks: [], bodyStatus: 'inaccessible', blockCount: 0 };
  }
}

function collectUsers(pages: readonly PageRaw[], into: Map<string, UserRaw>): void {
  const add = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object') return;
    const u = candidate as UserRaw;
    if (typeof u.id === 'string') {
      const key = normalizeNotionId(u.id);
      const prev = into.get(key);
      if (!prev || (!prev.name && u.name)) into.set(key, u);
    }
  };
  for (const page of pages) {
    add(page.created_by);
    add(page.last_edited_by);
    for (const value of Object.values(page.properties)) {
      const payload = (value as Record<string, unknown>)[value.type];
      if (value.type === 'people' && Array.isArray(payload)) payload.forEach(add);
      if (value.type === 'created_by' || value.type === 'last_edited_by') add(payload);
    }
  }
}

function childPageIds(nodes: readonly BlockNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.block.type === 'child_page' && !isTrashed(node.block)) out.push(node.block.id);
    out.push(...childPageIds(node.children));
  }
  return out;
}

/** All Notion I/O for one migration plan. Read-only; findings describe anything not fully read. */
export async function extractNotion(ctx: ExtractContext): Promise<NotionRaw> {
  const { client, config } = ctx;
  const findings: Finding[] = [];
  const me = await client.me();
  const workspace = {
    id: me.bot?.workspace_id ?? 'unknown',
    name: me.bot?.workspace_name?.trim() || 'Notion workspace',
  };

  // ---- databases / data sources -> rows -----------------------------------------------------
  const dataSources: DataSourceBundle[] = [];
  const seen = new Set<string>();
  const embeddedUsers = new Map<string, UserRaw>();
  const allRows: PageRaw[] = [];

  for (const entry of config.dataSources) {
    const schemas = await resolveDataSources(client, entry.id, findings);
    for (const schema of schemas) {
      const id = normalizeNotionId(schema.id);
      if (seen.has(id)) continue;
      seen.add(id);

      ctx.onProgress(
        `Reading data source "${schema.title.map((t) => t.plain_text).join('') || id}"…`,
      );
      const query = await client.queryAllPages(id, {
        maxRecords: config.limits.maxRecordsPerDataSource,
      });
      const pages = query.pages.filter((p) => !isTrashed(p));
      ctx.onProgress(
        `  ${pages.length} row(s) found; reading ${entry.bodies ? 'properties and page bodies' : 'properties'}…`,
      );
      if (query.skippedNonPages > 0) {
        findings.push({
          code: 'SOURCE_NON_PAGE_RESULTS_SKIPPED',
          outcome: 'skipped',
          severity: 'info',
          category: 'source_feature',
          message: `${query.skippedNonPages} non-page result(s) (for example wiki data sources) were skipped.`,
          collection: notionDataSourceKey(id),
        });
      }

      const bundles = await client.map(pages, async (page): Promise<PageBundle> => {
        const fullItems = await completeTruncatedProperties(client, page);
        if (!entry.bodies)
          return { page, blocks: [], bodyStatus: 'skipped', fullItems, blockCount: 0 };
        const body = await fetchBody(ctx, page.id);
        return { page, fullItems, ...body };
      });
      collectUsers(pages, embeddedUsers);
      allRows.push(...pages);
      dataSources.push({
        schema,
        pages: bundles,
        incomplete: query.incomplete,
        ...(query.reason === undefined ? {} : { incompleteReason: query.reason }),
        bodies: entry.bodies,
      });
    }
  }

  // ---- standalone pages (+ child pages) -----------------------------------------------------
  const standalone: StandalonePageBundle[] = [];
  const visited = new Set<string>();
  const queue: Array<{
    id: string;
    parentId?: string;
    depth: number;
    children: boolean;
    top: boolean;
  }> = config.pages.map((p) => ({ id: p.id, depth: 0, children: p.includeChildPages, top: true }));
  while (queue.length > 0 && standalone.length < config.limits.maxPages) {
    const item = queue.shift() as (typeof queue)[number];
    const id = normalizeNotionId(item.id);
    if (visited.has(id)) continue;
    visited.add(id);

    let page: PageRaw;
    try {
      page = await client.getPage(id);
    } catch (error) {
      if (!isAccessError(error)) throw error;
      findings.push({
        code: 'SOURCE_PAGE_NOT_ACCESSIBLE',
        outcome: 'unsupported',
        severity: item.top ? 'error' : 'warning',
        category: 'permission',
        message: item.top
          ? `Page ${id} was not found. Check the id and share it with your integration.`
          : 'A nested page is not shared with the integration and was skipped.',
        entity: notionPageKey(id),
      });
      continue;
    }
    if (isTrashed(page)) continue;
    ctx.onProgress(`Reading page ${id}…`);
    const body = await fetchBody(ctx, id);
    const bundle: PageBundle = { page, fullItems: {}, ...body };
    standalone.push({
      bundle,
      ...(item.parentId === undefined ? {} : { parentId: item.parentId }),
      depth: item.depth,
    });
    collectUsers([page], embeddedUsers);
    if (item.children) {
      for (const childId of childPageIds(body.blocks)) {
        queue.push({
          id: childId,
          parentId: id,
          depth: item.depth + 1,
          children: true,
          top: false,
        });
      }
    }
  }
  if (queue.length > 0) {
    findings.push({
      code: 'PAGE_LIMIT_REACHED',
      outcome: 'lossy',
      severity: 'warning',
      category: 'source_feature',
      message: `Stopped after ${config.limits.maxPages} pages (limits.maxPages); ${queue.length} more were not read.`,
    });
  }

  // ---- people ---------------------------------------------------------------------------------
  let userDirectory: NotionRaw['userDirectory'] = 'not_needed';
  const needsDirectory = [...embeddedUsers.values()].some((u) => !u.name);
  if (needsDirectory) {
    try {
      const listed = await client.listUsers();
      userDirectory = 'available';
      for (const u of listed) embeddedUsers.set(normalizeNotionId(u.id), u);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 403) {
        ctx.onProgress(`Could not list users: ${toSafeMessage(error)}`);
      }
      userDirectory = 'forbidden';
      findings.push({
        code: 'USER_INFO_UNAVAILABLE',
        outcome: 'lossy',
        severity: 'info',
        category: 'user_mapping',
        message:
          'The integration cannot read user names or e-mail addresses (missing the "Read user information" capability). People can only be mapped by Notion user id.',
      });
    }
  }

  return {
    extractedAt: ctx.now().toISOString(),
    workspace,
    dataSources,
    pages: standalone,
    users: [...embeddedUsers.values()],
    userDirectory,
    findings,
    requests: client.scheduler.stats.requests,
  };
}
