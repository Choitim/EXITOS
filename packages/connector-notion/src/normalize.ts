import type {
  AttachmentReference,
  Collection,
  DataRecord,
  Document,
  EntityKey,
  FieldDefinition,
  FieldValue,
  Finding,
  Relationship,
  SourceSnapshot,
  UserReference,
} from '@exitos/core/sdk';
import { normalizeNotionId } from './ids.js';
import type { DataSourceBundle, NotionRaw, PageBundle, StandalonePageBundle } from './model.js';
import { normalizeBlocks } from './normalize-blocks.js';
import { fieldFromSchema, valueFromProperty } from './normalize-properties.js';
import {
  notionDataSourceKey,
  notionPageKey,
  notionPageUrl,
  plainText,
  titleOf,
} from './normalize-text.js';
import { isTrashed, type PropertyValueRaw, type UserRaw } from './raw.js';

const byCreated = (a: PageBundle, b: PageBundle): number =>
  a.page.created_time.localeCompare(b.page.created_time) || a.page.id.localeCompare(b.page.id);

function sortFields(fields: FieldDefinition[]): FieldDefinition[] {
  return [...fields].sort((a, b) => {
    if (a.kind === 'title' && b.kind !== 'title') return -1;
    if (b.kind === 'title' && a.kind !== 'title') return 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  });
}

/**
 * Notion raw data → normalized snapshot. PURE: no I/O, deterministic for identical input.
 * Findings made here are about what could not be READ; what cannot be WRITTEN is the destination's
 * to report.
 */
export function normalizeNotion(raw: NotionRaw): SourceSnapshot {
  const findings: Finding[] = [...raw.findings];
  const users = new Map<string, UserRaw>(raw.users.map((u) => [normalizeNotionId(u.id), u]));
  const seenUsers = new Map<string, UserReference>();
  const selected = new Set(raw.dataSources.map((d) => normalizeNotionId(d.schema.id)));

  const collections: Collection[] = [];
  const records: DataRecord[] = [];
  const documents: Document[] = [];
  const attachments = new Map<string, AttachmentReference>();
  const relationRows: Array<{ field: FieldDefinition; from: EntityKey; to: EntityKey }> = [];

  const sources = [...raw.dataSources].sort((a, b) => a.schema.id.localeCompare(b.schema.id));
  for (const source of sources) {
    normalizeDataSource(source, {
      users,
      seenUsers,
      selected,
      findings,
      collections,
      records,
      documents,
      attachments,
      relationRows,
    });
  }

  // Standalone pages (Docs migration)
  for (const standalone of [...raw.pages].sort((a, b) =>
    a.bundle.page.id.localeCompare(b.bundle.page.id),
  )) {
    const doc = normalizeStandalone(standalone, findings);
    if (doc) documents.push(doc);
  }

  const recordByKey = new Map(records.map((r) => [r.key, r]));
  const relationships: Relationship[] = relationRows
    .map(({ field, from, to }) => {
      const target = recordByKey.get(to);
      return {
        field: field.id,
        fieldName: field.name,
        from,
        to,
        ...(target === undefined ? {} : { toTitle: target.title }),
        resolved: target !== undefined,
        inScope: target !== undefined,
      };
    })
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) || a.field.localeCompare(b.field) || a.to.localeCompare(b.to),
    );

  return {
    schemaVersion: 1,
    source: { system: 'notion', id: raw.workspace.id, name: raw.workspace.name },
    extractedAt: raw.extractedAt,
    collections,
    records,
    documents: documents.sort((a, b) => a.key.localeCompare(b.key)),
    relationships,
    attachments: [...attachments.values()].sort((a, b) => a.key.localeCompare(b.key)),
    users: [...seenUsers.values()].sort((a, b) => a.id.localeCompare(b.id)),
    findings,
  };
}

interface Accumulators {
  users: ReadonlyMap<string, UserRaw>;
  seenUsers: Map<string, UserReference>;
  selected: ReadonlySet<string>;
  findings: Finding[];
  collections: Collection[];
  records: DataRecord[];
  documents: Document[];
  attachments: Map<string, AttachmentReference>;
  relationRows: Array<{ field: FieldDefinition; from: EntityKey; to: EntityKey }>;
}

function normalizeDataSource(source: DataSourceBundle, acc: Accumulators): void {
  const collectionKey = notionDataSourceKey(source.schema.id);
  const fields = sortFields(
    Object.values(source.schema.properties).map((p) =>
      fieldFromSchema(p, { selectedDataSourceIds: acc.selected }),
    ),
  );

  for (const field of fields) {
    if (field.kind === 'unsupported') {
      acc.findings.push({
        code: 'SOURCE_FIELD_UNREADABLE',
        outcome: 'unsupported',
        severity: 'warning',
        category: 'field_type',
        message: `Property type "${field.sourceType}" has no portable representation and its values are not read.`,
        collection: collectionKey,
        field: field.name,
      });
    }
  }
  if (source.incomplete) {
    acc.findings.push({
      code: 'SOURCE_ROWS_INCOMPLETE',
      outcome: 'unsupported',
      severity: 'error',
      category: 'source_feature',
      message:
        source.incompleteReason === 'max_records'
          ? 'Reading stopped at limits.maxRecordsPerDataSource; some rows were NOT read. Raise the limit or narrow the data source.'
          : 'Notion capped the query and the remaining rows could not be reached; some rows were NOT read.',
      collection: collectionKey,
    });
  }

  const title = plainText(source.schema.title).trim() || 'Untitled data source';
  const liveBundles = [...source.pages].sort(byCreated).filter((b) => !isTrashed(b.page));

  for (const bundle of liveBundles) {
    const page = bundle.page;
    const key = notionPageKey(page.id);
    const byPropertyId = new Map<string, PropertyValueRaw>();
    for (const value of Object.values(page.properties)) {
      byPropertyId.set(value.id, value);
    }
    const values: Record<string, FieldValue> = {};
    for (const field of fields) {
      const rawValue = byPropertyId.get(field.id);
      if (rawValue === undefined) continue;
      const value = valueFromProperty(field, rawValue, {
        record: key,
        collection: collectionKey,
        users: acc.users,
        fullItems: bundle.fullItems,
        findings: acc.findings,
        seenUsers: acc.seenUsers,
      });
      values[field.id] = value;
      if (value.kind === 'files') for (const a of value.attachments) acc.attachments.set(a.key, a);
      if (value.kind === 'relation') {
        if (value.truncated === true) {
          acc.findings.push({
            code: 'RELATION_TRUNCATED',
            outcome: 'lossy',
            severity: 'warning',
            category: 'relation',
            message: `Notion returned only part of the relation "${field.name}"; the remaining targets were not read.`,
            entity: key,
            collection: collectionKey,
            field: field.name,
          });
        }
        for (const target of value.targets)
          acc.relationRows.push({ field, from: key, to: target.key });
      }
    }

    const titleField = fields.find((f) => f.kind === 'title');
    const titleValue = titleField === undefined ? undefined : values[titleField.id];
    const recordTitle =
      titleValue?.kind === 'title' && titleValue.text.trim() !== ''
        ? titleValue.text.trim()
        : 'Untitled';

    let body: EntityKey | undefined;
    if (bundle.bodyStatus === 'ok' && bundle.blocks.length > 0) {
      const blockFindings: Finding[] = [];
      const blocks = normalizeBlocks(bundle.blocks, {
        page: key,
        collection: collectionKey,
        findings: blockFindings,
      });
      acc.findings.push(...blockFindings);
      if (bundle.blocksTruncated === true) acc.findings.push(budgetFinding(key, collectionKey));
      if (blocks.length > 0) {
        acc.documents.push({
          key,
          title: recordTitle,
          url: page.url ?? notionPageUrl(page.id),
          blocks,
          createdAt: page.created_time,
          updatedAt: page.last_edited_time,
          hasIcon: page.icon !== null && page.icon !== undefined,
          hasCover: page.cover !== null && page.cover !== undefined,
        });
        body = key;
      }
    } else if (bundle.bodyStatus === 'inaccessible') {
      acc.findings.push({
        code: 'PAGE_BODY_INACCESSIBLE',
        outcome: 'unsupported',
        severity: 'warning',
        category: 'permission',
        message:
          'The page content could not be read (not shared with the integration, or missing capability).',
        entity: key,
        collection: collectionKey,
      });
    }

    acc.records.push({
      key,
      collection: collectionKey,
      title: recordTitle,
      url: page.url ?? notionPageUrl(page.id),
      createdAt: page.created_time,
      updatedAt: page.last_edited_time,
      archived: false,
      values,
      ...(body === undefined ? {} : { body }),
    });
  }

  acc.collections.push({
    key: collectionKey,
    system: 'notion',
    id: normalizeNotionId(source.schema.id),
    name: title,
    ...(source.schema.url === undefined ? {} : { url: source.schema.url }),
    fields,
    recordCount: liveBundles.length,
    ...(source.incomplete ? { incomplete: true } : {}),
  });
}

function normalizeStandalone(
  standalone: StandalonePageBundle,
  findings: Finding[],
): Document | undefined {
  const { bundle } = standalone;
  const page = bundle.page;
  if (isTrashed(page)) return undefined;
  const key = notionPageKey(page.id);
  const titleProp = Object.values(page.properties).find((p) => p.type === 'title');
  const title = titleOf(
    titleProp === undefined ? undefined : (titleProp as Record<string, unknown>).title,
  );

  const blockFindings: Finding[] = [];
  const blocks =
    bundle.bodyStatus === 'ok'
      ? normalizeBlocks(bundle.blocks, { page: key, findings: blockFindings })
      : [];
  findings.push(...blockFindings);
  if (bundle.blocksTruncated === true) findings.push(budgetFinding(key));
  if (bundle.bodyStatus === 'inaccessible') {
    findings.push({
      code: 'PAGE_BODY_INACCESSIBLE',
      outcome: 'unsupported',
      severity: 'warning',
      category: 'permission',
      message:
        'The page content could not be read (not shared with the integration, or missing capability).',
      entity: key,
    });
  }
  if (page.icon !== null && page.icon !== undefined) {
    findings.push({
      code: 'PAGE_ICON_NOT_MIGRATED',
      outcome: 'unsupported',
      severity: 'info',
      category: 'source_feature',
      message: 'Page icons are not migrated.',
      entity: key,
    });
  }
  if (page.cover !== null && page.cover !== undefined) {
    findings.push({
      code: 'PAGE_COVER_NOT_MIGRATED',
      outcome: 'unsupported',
      severity: 'info',
      category: 'source_feature',
      message: 'Page covers are not migrated.',
      entity: key,
    });
  }
  return {
    key,
    title: title === '' ? 'Untitled' : title,
    url: page.url ?? notionPageUrl(page.id),
    ...(standalone.parentId === undefined ? {} : { parent: notionPageKey(standalone.parentId) }),
    blocks,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    hasIcon: page.icon !== null && page.icon !== undefined,
    hasCover: page.cover !== null && page.cover !== undefined,
  };
}

function budgetFinding(entity: EntityKey, collection?: EntityKey): Finding {
  return {
    code: 'PAGE_BLOCK_BUDGET',
    outcome: 'lossy',
    severity: 'warning',
    category: 'source_feature',
    message: 'This page has more blocks than limits.maxBlocksPerPage; the remainder was not read.',
    entity,
    ...(collection === undefined ? {} : { collection }),
  };
}
