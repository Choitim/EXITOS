import { ConfigError, ApiError, type Clock } from '@exitos/shared';
import type {
  ConnectorContext,
  DiscoveredContainer,
  ExtractOptions,
  InspectedCollection,
  SourceConnector,
  SourceConnectorDefinition,
  SourceDiscovery,
  SourceInspection,
  Finding,
} from '@exitos/core/sdk';
import { NotionClient } from './client.js';
import { NotionSourceConfigSchema, type NotionSourceConfig } from './config.js';
import { extractNotion, resolveDataSources } from './extract.js';
import type { NotionRaw } from './model.js';
import { notionNetworkPolicy, NOTION_API_VERSION } from './network.js';
import { normalizeNotion } from './normalize.js';
import { fieldFromSchema } from './normalize-properties.js';
import { notionDataSourceKey, plainText, titleOf } from './normalize-text.js';
import { normalizeNotionId } from './ids.js';
import { DataSourceRawSchema, PageRawSchema, isTrashed } from './raw.js';

export const NOTION_CONNECTOR_VERSION = '0.1.0';

const SEARCH_NOTE =
  'Notion search is not exhaustive and indexes with a delay: content shared with the integration may be missing here. Use explicit ids in migration.yaml for repeatable plans.';

class NotionSource implements SourceConnector<NotionRaw> {
  readonly manifest = notionManifest;
  readonly #client: NotionClient;
  readonly #config: NotionSourceConfig;
  readonly #clock: Clock;

  constructor(context: ConnectorContext, config: NotionSourceConfig) {
    const token = context.credentials.NOTION_TOKEN;
    if (token === undefined) throw new ConfigError('NOTION_TOKEN is not set.');
    this.#config = config;
    this.#clock = context.clock;
    this.#client = new NotionClient({
      context,
      token,
      notionVersion: config.notionVersion,
      requestsPerMinute: config.requestsPerMinute,
    });
  }

  async discover(): Promise<SourceDiscovery> {
    const me = await this.#client.me();
    const [sourceHits, pageHits] = [
      await this.#client.search('data_source'),
      await this.#client.search('page'),
    ];

    const containers: DiscoveredContainer[] = [];
    for (const hit of sourceHits) {
      const ds = DataSourceRawSchema.safeParse(hit);
      if (!ds.success || isTrashed(ds.data)) continue;
      containers.push({
        id: normalizeNotionId(ds.data.id),
        kind: 'data_source',
        name: plainText(ds.data.title).trim() || 'Untitled data source',
        ...(ds.data.url === undefined ? {} : { url: ds.data.url }),
        path: `${Object.keys(ds.data.properties).length} properties`,
      });
    }
    for (const hit of pageHits) {
      const page = PageRawSchema.safeParse(hit);
      if (!page.success || isTrashed(page.data)) continue;
      // Rows of databases are migrated through their data source, not listed as pages.
      if (page.data.parent.type === 'data_source_id' || page.data.parent.type === 'database_id')
        continue;
      const titleProp = Object.values(page.data.properties).find((p) => p.type === 'title');
      const title = titleOf((titleProp as Record<string, unknown> | undefined)?.title);
      containers.push({
        id: normalizeNotionId(page.data.id),
        kind: 'page',
        name: title.trim() || 'Untitled',
        ...(page.data.url === undefined ? {} : { url: page.data.url }),
        path: page.data.parent.type,
      });
    }
    containers.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );

    const findings: Finding[] = [];
    const notes = [SEARCH_NOTE];
    if (containers.length === 0) {
      notes.push(
        'Nothing is shared with this integration yet. In Notion open the database or page → ••• → Connections → add your integration.',
      );
    }
    return {
      workspace: {
        system: 'notion',
        id: me.bot?.workspace_id ?? 'unknown',
        name: me.bot?.workspace_name?.trim() || 'Notion workspace',
      },
      containers,
      findings,
      notes,
    };
  }

  async inspect(): Promise<SourceInspection> {
    const config = this.#config;
    if (config.dataSources.length === 0 && config.pages.length === 0) {
      throw new ConfigError(
        'Nothing is selected to inspect. Add source.dataSources or source.pages to the config, or run `exitos inspect notion` without --config to discover what is shared.',
      );
    }
    const me = await this.#client.me();
    const findings: Finding[] = [];
    const collections: InspectedCollection[] = [];
    const selected = new Set<string>();
    const resolved = [];
    for (const entry of config.dataSources) {
      resolved.push(...(await resolveDataSources(this.#client, entry.id, findings)));
    }
    for (const ds of resolved) selected.add(normalizeNotionId(ds.id));

    const seen = new Set<string>();
    for (const ds of resolved) {
      const id = normalizeNotionId(ds.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const fields = Object.values(ds.properties).map((p) =>
        fieldFromSchema(p, { selectedDataSourceIds: selected }),
      );
      const query = await this.#client.queryAllPages(id, {
        maxRecords: config.limits.maxRecordsPerDataSource,
        filterProperties: ['title'],
      });
      collections.push({
        key: notionDataSourceKey(id),
        id,
        name: plainText(ds.title).trim() || 'Untitled data source',
        recordCount: query.pages.filter((p) => !isTrashed(p)).length,
        ...(query.incomplete ? { incomplete: true } : {}),
        fields: fields
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((field) => {
            const support = classifyField(field.kind);
            return {
              field,
              support: support.level,
              ...(support.note ? { note: support.note } : {}),
            };
          }),
      });
    }

    const documents: SourceInspection['documents'] = [];
    for (const entry of config.pages) {
      try {
        const page = await this.#client.getPage(entry.id);
        const titleProp = Object.values(page.properties).find((p) => p.type === 'title');
        const title = titleOf((titleProp as Record<string, unknown> | undefined)?.title);
        documents.push({
          key: `notion:page:${normalizeNotionId(page.id)}`,
          title: title || 'Untitled',
          childCount: 0,
        });
      } catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 403))
          throw error;
        findings.push({
          code: 'SOURCE_PAGE_NOT_ACCESSIBLE',
          outcome: 'unsupported',
          severity: 'error',
          category: 'permission',
          message: `Page ${entry.id} was not found. Check the id and share it with your integration.`,
        });
      }
    }

    return {
      workspace: {
        system: 'notion',
        id: me.bot?.workspace_id ?? 'unknown',
        name: me.bot?.workspace_name?.trim() || 'Notion workspace',
      },
      collections,
      documents,
      findings,
      notes: [],
      requests: { reads: this.#client.scheduler.stats.requests },
    };
  }

  extract(options: ExtractOptions = {}): Promise<NotionRaw> {
    return extractNotion({
      client: this.#client,
      config: this.#config,
      now: () => new Date(this.#clock.now()),
      onProgress: options.onProgress ?? (() => undefined),
    });
  }

  normalize(raw: NotionRaw) {
    return normalizeNotion(raw);
  }
}

/** How a Notion property type fares in an arbitrary destination (before choosing one). */
function classifyField(kind: string): {
  level: InspectedCollection['fields'][number]['support'];
  note?: string;
} {
  switch (kind) {
    case 'relation':
      return {
        level: 'transformed',
        note: 'Needs destination support for links; targets outside the selection are lost.',
      };
    case 'files':
      return {
        level: 'transformed',
        note: 'Attachments are carried as references only; file bytes are not transferred.',
      };
    case 'computed':
      return {
        level: 'lossy',
        note: 'Only the last computed value is carried; the formula/rollup logic is not.',
      };
    case 'timestamp':
    case 'userStamp':
      return { level: 'lossy', note: 'Most destinations cannot set creation/edit metadata.' };
    case 'uniqueId':
      return { level: 'transformed', note: 'Kept as text; the auto-increment behaviour is not.' };
    case 'unsupported':
      return { level: 'unsupported', note: 'No portable representation.' };
    default:
      return { level: 'supported' };
  }
}

export const notionManifest = {
  id: 'notion',
  name: 'Notion',
  version: NOTION_CONNECTOR_VERSION,
  kind: 'source' as const,
  vendorApiVersion: NOTION_API_VERSION,
  capabilities: [
    'databases (data sources)',
    'pages and nested blocks',
    'relations',
    'people (explicit mapping)',
    'read-only',
  ],
  documentationUrl: 'https://developers.notion.com/reference/intro',
};

export const notionSource: SourceConnectorDefinition<NotionSourceConfig, NotionRaw> = {
  manifest: notionManifest,
  network: notionNetworkPolicy,
  credentials: [
    {
      env: 'NOTION_TOKEN',
      description: 'Notion internal connection secret',
      required: true,
      prefixHint: 'ntn_',
    },
  ],
  configSchema: NotionSourceConfigSchema,
  create: (context, config) => new NotionSource(context, config),
};
