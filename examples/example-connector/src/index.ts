/**
 * A MINIMAL connector pair, written to be read:
 *
 *   json-file  (source)       reads a small JSON file of tasks
 *   markdown-folder (destination)  writes one Markdown file per task
 *
 * It uses the local file system instead of HTTP, which shows that a connector is just an object
 * implementing the contract in `@exitos/core/sdk`. Copy this file, rename things, and replace the
 * file-system calls with API calls. See docs/connector-sdk.md.
 *
 * What a destination MUST get right (and this one does):
 *   1. `plan()` is PURE and deterministic — same input, same actions, stable ids.
 *   2. `apply()` does exactly ONE action and never overwrites existing content.
 *   3. Every action has an `idempotencyKey`, so a retry can be recognised.
 *   4. `reconcile()` can tell whether an action with an unknown outcome took effect.
 *   5. `verify()` compares the plan with the real destination state.
 *   6. Anything that cannot be preserved is reported as a Finding — never dropped silently.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ConfigError, ValidationError, stableId } from '@exitos/shared';
import {
  entityKey,
  type ApplyContext,
  type ApplyResult,
  type DataRecord,
  type DestinationConnector,
  type DestinationConnectorDefinition,
  type DestinationInspection,
  type Finding,
  type MigrationAction,
  type NetworkPolicy,
  type PlanFragment,
  type PlanInput,
  type ReconcileRequest,
  type ReconcileResult,
  type SourceConnector,
  type SourceConnectorDefinition,
  type SourceSnapshot,
  type ValidationResult,
  type VerifyInput,
  type VerifyOutput,
} from '@exitos/core/sdk';
import { z } from 'zod';

/** These connectors never touch the network, so their policy allows no host at all. */
const NO_NETWORK: NetworkPolicy = {
  defaultBaseUrl: 'file://local',
  allowedHosts: () => [],
  classify: () => 'unknown',
};

// ---- source: json-file ---------------------------------------------------------------------

const SourceConfigSchema = z.strictObject({
  type: z.literal('json-file'),
  path: z.string().min(1),
});
type SourceConfig = z.infer<typeof SourceConfigSchema>;

const FileSchema = z.object({
  title: z.string().default('Tasks'),
  items: z.array(
    z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
      title: z.string(),
      done: z.boolean().default(false),
      notes: z.string().optional(),
      /** A field this example does not know how to migrate: it must be reported, not dropped. */
      attachmentUrl: z.string().optional(),
    }),
  ),
});
type RawFile = z.infer<typeof FileSchema>;

class JsonFileSource implements SourceConnector<RawFile> {
  readonly manifest = jsonFileManifest;
  constructor(private readonly config: SourceConfig) {}

  async discover() {
    return {
      workspace: { system: 'json-file', id: 'local', name: this.config.path },
      containers: [{ id: this.config.path, kind: 'file', name: this.config.path }],
      findings: [],
      notes: [],
    };
  }

  async inspect() {
    const raw = await this.extract();
    const snapshot = this.normalize(raw);
    return {
      workspace: snapshot.source,
      collections: snapshot.collections.map((c) => ({
        key: c.key,
        id: c.id,
        name: c.name,
        recordCount: c.recordCount,
        fields: c.fields.map((field) => ({ field, support: 'supported' as const })),
      })),
      documents: [],
      findings: snapshot.findings,
      notes: [],
      requests: { reads: 0 },
    };
  }

  /** ALL source I/O happens here, and it is read-only. */
  async extract(): Promise<RawFile> {
    const path = resolve(this.config.path);
    if (!existsSync(path)) throw new ConfigError(`File not found: ${this.config.path}`);
    return FileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }

  /** PURE: no I/O, deterministic. */
  normalize(raw: RawFile): SourceSnapshot {
    const collection = entityKey('json-file', 'collection', 'tasks');
    const findings: Finding[] = [];
    const records: DataRecord[] = raw.items.map((item) => {
      const key = entityKey('json-file', 'item', item.id);
      if (item.attachmentUrl !== undefined) {
        findings.push({
          code: 'ATTACHMENT_NOT_SUPPORTED',
          outcome: 'unsupported',
          severity: 'warning',
          category: 'attachment',
          message:
            'This example connector cannot migrate attachments; the URL is not carried over.',
          entity: key,
          field: 'attachmentUrl',
        });
      }
      return {
        key,
        collection,
        title: item.title,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archived: false,
        values: {
          title: { kind: 'title', text: item.title },
          done: { kind: 'checkbox', value: item.done },
          ...(item.notes === undefined ? {} : { notes: { kind: 'text', text: item.notes } }),
        },
      };
    });
    return {
      schemaVersion: 1,
      source: { system: 'json-file', id: 'local', name: this.config.path },
      extractedAt: '2026-01-01T00:00:00.000Z',
      collections: [
        {
          key: collection,
          system: 'json-file',
          id: 'tasks',
          name: raw.title,
          fields: [
            { id: 'title', name: 'Title', kind: 'title', sourceType: 'string' },
            { id: 'done', name: 'Done', kind: 'checkbox', sourceType: 'boolean' },
            { id: 'notes', name: 'Notes', kind: 'text', sourceType: 'string' },
          ],
          recordCount: records.length,
        },
      ],
      records,
      documents: [],
      relationships: [],
      attachments: [],
      users: [],
      findings,
    };
  }
}

const jsonFileManifest = {
  id: 'json-file',
  name: 'JSON file',
  version: '0.1.0',
  kind: 'source' as const,
  capabilities: ['one collection of tasks'],
};

export const jsonFileSource: SourceConnectorDefinition<SourceConfig, RawFile> = {
  manifest: jsonFileManifest,
  network: NO_NETWORK,
  credentials: [],
  configSchema: SourceConfigSchema,
  create: (_context, config) => new JsonFileSource(config),
};

// ---- destination: markdown-folder ---------------------------------------------------------

const DestConfigSchema = z.strictObject({
  type: z.literal('markdown-folder'),
  directory: z.string().min(1),
});
type DestConfig = z.infer<typeof DestConfigSchema>;

const PayloadSchema = z.strictObject({
  file: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,80}\.md$/),
  content: z.string(),
});

const slug = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'untitled';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

class MarkdownFolderDestination implements DestinationConnector {
  readonly manifest = markdownFolderManifest;
  constructor(private readonly config: DestConfig) {}

  async discover() {
    return {
      workspaces: [{ id: this.config.directory, name: this.config.directory }],
      containers: [],
      findings: [],
      notes: [],
    };
  }

  async inspect(): Promise<DestinationInspection> {
    return {
      workspace: { system: 'markdown-folder', id: 'local', name: this.config.directory },
      targets: [{ kind: 'folder', id: 'root', name: this.config.directory }],
      data: {},
      findings: [],
      requests: { reads: 0 },
    };
  }

  /** PURE: turns the normalized snapshot into actions. No file-system access. */
  plan(input: PlanInput): PlanFragment {
    const scope = `markdown-folder:${this.config.directory}`;
    const actions: MigrationAction[] = input.snapshot.records.map((record) => {
      const done = record.values.done?.kind === 'checkbox' ? record.values.done.value : false;
      const notes = record.values.notes?.kind === 'text' ? record.values.notes.text : '';
      const file = `${slug(record.title)}-${sha(record.key).slice(0, 8)}.md`;
      const content = `---\ntitle: ${JSON.stringify(record.title)}\ndone: ${done}\nsource: ${record.key}\n---\n\n${notes}\n`;
      return {
        id: stableId('act', 'example.write_markdown', record.key),
        kind: 'example.write_markdown',
        label: `Write ${file}`,
        source: record.key,
        idempotencyKey: record.key,
        scope,
        dependsOn: [],
        disposition: input.existing.has(`${scope}|${record.key}`) ? 'skip' : 'execute',
        outcome: 'supported',
        findings: [],
        estimatedRequests: 1,
        payload: { file, content },
      };
    });
    return {
      collections: input.snapshot.collections.map((c) => ({
        key: c.key,
        name: c.name,
        recordCount: c.recordCount,
        target: { kind: 'folder', id: 'root', name: this.config.directory },
      })),
      mappings: [],
      actions,
      users: { mapped: [], unmapped: [], assignmentsThatNotify: 0 },
      findings: [],
      targets: [{ kind: 'folder', id: 'root', name: this.config.directory }],
      destinationConfig: { type: 'markdown-folder', directory: this.config.directory },
      knownLimits: ['Attachments are not migrated.'],
      options: {},
      requestsPerMinute: 6000,
    };
  }

  async validate(): Promise<ValidationResult> {
    return { findings: [], adopted: [], readRequests: 0 };
  }

  /** Exactly one action. Never overwrites: an existing file with different content is an error. */
  async apply(action: MigrationAction, _context: ApplyContext): Promise<ApplyResult> {
    const payload = PayloadSchema.safeParse(action.payload);
    if (!payload.success)
      throw new ValidationError('PAYLOAD_INVALID', 'The plan payload is not valid.');
    const target = this.pathFor(payload.data.file);
    if (existsSync(target)) {
      if (readFileSync(target, 'utf8') === payload.data.content)
        return { destinationId: payload.data.file }; // already done
      throw new ConfigError(
        `${payload.data.file} already exists with different content; ExitOS will not overwrite it.`,
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, payload.data.content, { flag: 'wx' }); // 'wx': fail rather than overwrite
    return { destinationId: payload.data.file };
  }

  /** After an ambiguous write: did the file get written? */
  async reconcile(action: MigrationAction, _request: ReconcileRequest): Promise<ReconcileResult> {
    const payload = PayloadSchema.parse(action.payload);
    const target = this.pathFor(payload.file);
    return existsSync(target) && readFileSync(target, 'utf8') === payload.content
      ? { status: 'found', destinationId: payload.file }
      : { status: 'not_found', confident: true };
  }

  async verify(input: VerifyInput): Promise<VerifyOutput> {
    const byId = new Map(input.plan.actions.map((a) => [a.id, a]));
    const items = input.mappings.map(({ actionId, destinationId }) => {
      const action = byId.get(actionId) as MigrationAction;
      const payload = PayloadSchema.parse(action.payload);
      const target = this.pathFor(payload.file);
      const status = !existsSync(target)
        ? ('missing' as const)
        : readFileSync(target, 'utf8') === payload.content
          ? ('verified' as const)
          : ('mismatched' as const);
      return {
        actionId,
        source: action.source,
        destinationId,
        status,
        checks: [{ field: 'content', status }],
      };
    });
    return {
      items,
      targets: [
        {
          target: this.config.directory,
          expected: input.mappings.length,
          found: items.filter((i) => i.status !== 'missing').length,
        },
      ],
      scope: 'Each planned file exists and its content equals the plan.',
      notes: [],
      readRequests: 0,
    };
  }

  /** Resolve inside the configured directory only — a plan can never write elsewhere. */
  private pathFor(file: string): string {
    const root = resolve(this.config.directory);
    const target = resolve(join(root, file));
    if (!target.startsWith(root + sep))
      throw new ValidationError('PATH_ESCAPE', 'Refusing to write outside the destination folder.');
    return target;
  }
}

const markdownFolderManifest = {
  id: 'markdown-folder',
  name: 'Markdown folder',
  version: '0.1.0',
  kind: 'destination' as const,
  capabilities: ['one .md file per record', 'never overwrites'],
};

export const markdownFolderDestination: DestinationConnectorDefinition<DestConfig> = {
  manifest: markdownFolderManifest,
  network: NO_NETWORK,
  credentials: [],
  configSchema: DestConfigSchema,
  create: (_context, config) => new MarkdownFolderDestination(config),
};
