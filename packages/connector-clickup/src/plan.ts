import {
  existingKey,
  renderBlocksToMarkdown,
  itemOutcome,
  type Collection,
  type DataRecord,
  type Document,
  type DocumentBlock,
  type EntityKey,
  type Finding,
  type MigrationAction,
  type Outcome,
  type PlanCollection,
  type PlanFragment,
  type PlanInput,
  type PlanTarget,
  type PlanUsers,
  type RenderPolicy,
  type UserReference,
} from '@exitos/core';
import { stableId } from '@exitos/shared';
import { DOC_PARENT_TYPE, type ClickUpDestinationConfig, type ListMapping } from './config.js';
import {
  ClickUpInspectionSchema,
  type ClickUpInspection,
  type ListInspection,
} from './inspection.js';
import {
  CLICKUP_DOC_POLICY,
  CLICKUP_TASK_POLICY,
  composeMarkdown,
  markerText,
  propertiesTable,
  provenanceFooter,
  pruneMigratedChildPages,
} from './markdown.js';
import { newDraft, planFields, type Env, type FieldPlan } from './mapping.js';
import {
  ACTION_KINDS,
  type CreateDocPayload,
  type CreatePagePayload,
  type CreateTaskPayload,
  type LinkPayload,
} from './payloads.js';
import { UserResolver } from './users.js';

export const KNOWN_LIMITS: readonly string[] = [
  'Attachment and image bytes: Notion-hosted files are never downloaded or re-uploaded (external links are kept).',
  'Comments and discussions, page history and version history.',
  'Page and database permissions, sharing settings and the people who can see a page.',
  'Database views, filters, sorts, grouping and templates; button properties; automations.',
  'Page icons and covers.',
  'ClickUp Custom Fields cannot be created through the ClickUp API — only existing ones are filled.',
  'Notion user ids are unrelated to ClickUp user ids: people are only assigned through your explicit mapping.',
  'Relations become symmetric ClickUp linked tasks; the direction is lost. Subtasks and dependencies are not created.',
  'Original creation/edit timestamps and authors cannot be set in ClickUp (they are kept as text).',
  'Notion-hosted block types ClickUp Docs cannot render (toggles, columns, synced blocks, callouts, colours, underline) arrive in simplified form.',
];

const scopeOfList = (listId: string): string => `clickup:list:${listId}`;
const DOCS_SCOPE = (workspaceId: string): string => `clickup:docs:${workspaceId}`;
const LINK_SCOPE = 'clickup:links';

const actionId = (kind: string, key: string): MigrationAction['id'] => stableId('act', kind, key);

function matchCollection(
  collection: Collection,
  lists: readonly ListMapping[],
): ListMapping | undefined {
  const norm = (s: string): string => s.trim().toLowerCase().replace(/-/g, '');
  return lists.find((l) => {
    const wanted = norm(l.source);
    return (
      wanted === norm(collection.id) ||
      wanted === norm(collection.name) ||
      l.source.trim() === collection.key
    );
  });
}

function cleanName(title: string): { name: string; changed: boolean } {
  const cleaned = title
    .replace(/[\r\n\t\v\f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const name = cleaned === '' ? 'Untitled' : cleaned;
  return { name, changed: name !== title.trim() };
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Pure planning: normalized snapshot + destination facts + config → actions, mappings, findings. */
export function planClickUp(input: PlanInput, cfg: ClickUpDestinationConfig): PlanFragment {
  const { snapshot, config } = input;
  const inspection: ClickUpInspection = ClickUpInspectionSchema.parse(input.inspection.data);
  const options = config.options;
  const findings: Finding[] = [];
  const mappings: PlanFragment['mappings'] = [];
  const collectionsOut: PlanCollection[] = [];
  const targets: PlanTarget[] = [...input.inspection.targets];
  const actions: MigrationAction[] = [];

  const resolver = new UserResolver(config.users, inspection.members);
  findings.push(...resolver.findings);

  const recordByKey = new Map<EntityKey, DataRecord>(snapshot.records.map((r) => [r.key, r]));
  const documentByKey = new Map<EntityKey, Document>(snapshot.documents.map((d) => [d.key, d]));

  // Which collections are migrated, and into which list.
  const env: Env = {
    timezone: options.timezone,
    users: resolver,
    unmappedPeople: config.users.unmapped,
    unmappedFields: options.unmappedFields,
    titleOfRecord: (key) => recordByKey.get(key)?.title,
    recordInScope: (key) => recordByKey.has(key),
    relations: 'link',
  };

  const matched = new Set<string>();
  for (const listCfg of cfg.lists) {
    const col = snapshot.collections.find((c) => matchCollection(c, [listCfg]) !== undefined);
    if (!col) {
      findings.push({
        code: 'CONFIG_SOURCE_NOT_SELECTED',
        outcome: 'unsupported',
        severity: 'error',
        category: 'destination',
        message: `destination.lists maps source "${listCfg.source}", but no such data source was read. Check the id/title and that it is listed under source.dataSources.`,
      });
    }
  }

  const taskActionBySource = new Map<EntityKey, MigrationAction['id']>();
  const userTally = new Map<
    string,
    { user: UserReference; resolved: ReturnType<UserResolver['resolve']> }
  >();
  let assignmentsThatNotify = 0;
  let anyMarkerless = false;

  for (const collection of snapshot.collections) {
    const listCfg = matchCollection(collection, cfg.lists);
    if (!listCfg) {
      findings.push({
        code: 'COLLECTION_NOT_MAPPED',
        outcome: 'skipped',
        severity: 'warning',
        category: 'scope',
        message: `Data source "${collection.name}" (${collection.recordCount} rows) has no entry in destination.lists, so none of its rows are migrated.`,
        collection: collection.key,
      });
      collectionsOut.push({
        key: collection.key,
        name: collection.name,
        recordCount: collection.recordCount,
        target: null,
      });
      continue;
    }
    matched.add(collection.key);
    const list: ListInspection | undefined = inspection.lists[listCfg.listId];
    const scope = scopeOfList(listCfg.listId);
    collectionsOut.push({
      key: collection.key,
      name: collection.name,
      recordCount: collection.recordCount,
      target: list
        ? { kind: 'list', id: list.id, name: list.name }
        : { kind: 'list', id: listCfg.listId, name: '(not reachable)' },
      ...(collection.incomplete ? { incomplete: true } : {}),
    });
    if (!list) continue; // inspection already reported DEST_LIST_NOT_FOUND / FORBIDDEN as a blocking error

    const colEnv: Env = { ...env, relations: listCfg.relations };
    const { plans, errors } = planFields({ collection, list, mapping: listCfg, env: colEnv });
    findings.push(...errors);
    mappings.push(...plans.map((p) => p.rule));
    const planByFieldId = new Map<string, FieldPlan>(plans.map((p) => [p.field.id, p]));

    for (const record of snapshot.records.filter((r) => r.collection === collection.key)) {
      const draft = newDraft();
      for (const field of collection.fields) {
        if (field.kind === 'title') continue;
        planByFieldId.get(field.id)?.apply(draft, record.values[field.id], record);
      }
      draft.createdAt = record.createdAt;

      // Page body → Markdown
      let bodyMd = '';
      const doc = record.body === undefined ? undefined : documentByKey.get(record.body);
      if (doc) {
        const policy: RenderPolicy = {
          ...CLICKUP_TASK_POLICY,
          unsupportedBlocks: options.unsupportedBlocks,
        };
        const rendered = renderBlocksToMarkdown(doc.blocks, policy, {
          entity: record.key,
          collection: collection.key,
        });
        bodyMd = rendered.markdown;
        draft.findings.push(...rendered.findings);
      }

      const key = record.key;
      const marker = options.provenance === 'footer' ? markerText(key) : null;
      if (marker === null) anyMarkerless = true;
      const markdown = composeMarkdown([
        bodyMd,
        propertiesTable(draft.rows),
        marker === null
          ? undefined
          : provenanceFooter({
              system: 'Notion',
              key,
              sourceUrl: record.url,
              createdAt: record.createdAt,
            }),
      ]);

      const { name, changed } = cleanName(record.title);
      if (changed) {
        draft.findings.push({
          code: 'NAME_NORMALIZED',
          outcome: 'transformed',
          severity: 'info',
          category: 'data',
          message:
            'Line breaks or surrounding whitespace in the title were replaced by single spaces (task names are one line).',
          entity: key,
          collection: collection.key,
        });
      }

      const body: CreateTaskPayload['body'] = {
        name,
        markdown_content: markdown,
        ...(draft.status === undefined ? {} : { status: draft.status }),
        ...(draft.priority === undefined ? {} : { priority: draft.priority }),
        ...(draft.due === undefined
          ? {}
          : { due_date: draft.due.ms, due_date_time: draft.due.time }),
        ...(draft.start === undefined
          ? {}
          : { start_date: draft.start.ms, start_date_time: draft.start.time }),
        ...(draft.assignees.length === 0 ? {} : { assignees: draft.assignees }),
        ...(draft.tags.length === 0 ? {} : { tags: draft.tags }),
        ...(draft.customFields.length === 0
          ? {}
          : {
              custom_fields: draft.customFields.map((cf) => ({
                id: cf.id,
                value: cf.value,
                ...(cf.time === undefined ? {} : { value_options: { time: cf.time } }),
              })),
            }),
        notify_all: false,
      };
      const payload: CreateTaskPayload = { listId: listCfg.listId, marker: marker, body };

      const id = actionId(ACTION_KINDS.createTask, key);
      taskActionBySource.set(key, id);
      const prior = input.existing.get(existingKey(scope, key));
      const outcome: Outcome = prior
        ? 'skipped'
        : itemOutcome(['supported', ...draft.findings.map((f) => f.outcome)]);
      if (!prior) assignmentsThatNotify += draft.assignees.length;

      // Track people for the users section.
      for (const fp of plans) {
        if (fp.rule.target.kind !== 'assignees') continue;
        const v = record.values[fp.field.id];
        if (v?.kind === 'person') {
          for (const u of v.users)
            if (!userTally.has(u.key))
              userTally.set(u.key, { user: u, resolved: resolver.resolve(u) });
        }
      }

      actions.push({
        id,
        kind: ACTION_KINDS.createTask,
        label: `Create task "${name}" in list "${list.name}"`,
        source: key,
        idempotencyKey: key,
        scope,
        dependsOn: [],
        disposition: prior ? 'skip' : 'execute',
        ...(prior
          ? { skipReason: 'already_migrated' as const, existingDestinationId: prior.destinationId }
          : {}),
        outcome,
        findings: draft.findings,
        estimatedRequests: prior ? 0 : 1,
        payload: payload,
      });
    }
  }

  // ---- relation links -------------------------------------------------------------------------
  const linkConfigByCollection = new Map<string, ListMapping>();
  for (const c of snapshot.collections) {
    const m = matchCollection(c, cfg.lists);
    if (m) linkConfigByCollection.set(c.key, m);
  }
  const pairs = new Map<string, { a: EntityKey; b: EntityKey }>();
  for (const rel of snapshot.relationships) {
    const fromRecord = recordByKey.get(rel.from);
    const lm = fromRecord ? linkConfigByCollection.get(fromRecord.collection) : undefined;
    if (!fromRecord || lm?.relations !== 'link' || !rel.resolved) continue;
    if (!taskActionBySource.has(rel.from) || !taskActionBySource.has(rel.to) || rel.from === rel.to)
      continue;
    const [a, b] = pairKey(rel.from, rel.to);
    pairs.set(`${a}|${b}`, { a, b });
  }
  for (const { a, b } of [...pairs.values()].sort((x, y) =>
    `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`),
  )) {
    const key = `link:${a}|${b}`;
    const prior = input.existing.get(existingKey(LINK_SCOPE, key));
    const payload: LinkPayload = {
      fromAction: taskActionBySource.get(a) as MigrationAction['id'],
      toAction: taskActionBySource.get(b) as MigrationAction['id'],
    };
    actions.push({
      id: actionId(ACTION_KINDS.linkTasks, key),
      kind: ACTION_KINDS.linkTasks,
      label: `Link "${recordByKey.get(a)?.title ?? a}" ↔ "${recordByKey.get(b)?.title ?? b}"`,
      source: null,
      idempotencyKey: key,
      scope: LINK_SCOPE,
      dependsOn: [payload.fromAction, payload.toAction],
      disposition: prior ? 'skip' : 'execute',
      ...(prior
        ? { skipReason: 'already_migrated' as const, existingDestinationId: prior.destinationId }
        : {}),
      outcome: prior ? 'skipped' : 'transformed',
      findings: [],
      estimatedRequests: prior ? 0 : 1,
      payload: payload,
    });
  }

  // ---- docs -------------------------------------------------------------------------------------
  const docsFindings = planDocs({
    snapshot,
    cfg,
    options,
    input,
    actions,
    documentByKey,
    recordBodyKeys: new Set(
      snapshot.records.flatMap((r) => (r.body === undefined ? [] : [r.body])),
    ),
    workspaceId: cfg.workspaceId,
    targets,
  });
  findings.push(...docsFindings);

  if (anyMarkerless) {
    findings.push({
      code: 'PROVENANCE_DISABLED',
      outcome: 'supported',
      severity: 'warning',
      category: 'destination',
      message:
        'options.provenance is "none": migrated items carry no marker, so an interrupted run cannot always be reconciled automatically and duplicates are harder to rule out.',
    });
  }
  if (assignmentsThatNotify > 0) {
    findings.push({
      code: 'ASSIGNEES_WILL_BE_NOTIFIED',
      outcome: 'supported',
      severity: 'warning',
      category: 'user_mapping',
      message: `${assignmentsThatNotify} task assignment(s) will notify people in ClickUp (ClickUp notifies assignees of API-created tasks).`,
    });
  }

  const users: PlanUsers = {
    mapped: [...userTally.values()]
      .filter((u) => u.resolved !== undefined)
      .map((u) => ({
        source: u.user.key,
        ...(u.user.name === undefined ? {} : { name: u.user.name }),
        destinationId: String(u.resolved?.id),
        via: u.resolved?.via ?? 'explicit',
      })),
    unmapped: [...userTally.values()]
      .filter((u) => u.resolved === undefined)
      .map((u) => ({
        source: u.user.key,
        ...(u.user.name === undefined ? {} : { name: u.user.name }),
      })),
    assignmentsThatNotify,
  };

  return {
    collections: collectionsOut,
    mappings,
    actions,
    users,
    findings,
    targets,
    // Everything needed to inspect, apply and verify later, without the original config file.
    destinationConfig: {
      type: 'clickup',
      workspaceId: cfg.workspaceId,
      requestsPerMinute: cfg.requestsPerMinute,
      lists: cfg.lists.map((l) => ({ source: l.source, listId: l.listId })),
    },
    knownLimits: [...KNOWN_LIMITS],
    options: {
      timezone: options.timezone,
      provenance: options.provenance,
      unmappedFields: options.unmappedFields,
      unsupportedBlocks: options.unsupportedBlocks,
      experimentalDocs: options.experimental.docs,
      matchByEmail: config.users.matchByEmail,
    },
    requestsPerMinute: cfg.requestsPerMinute,
  };
}

// ---- docs ------------------------------------------------------------------------------------------
interface DocsArgs {
  snapshot: PlanInput['snapshot'];
  cfg: ClickUpDestinationConfig;
  options: PlanInput['config']['options'];
  input: PlanInput;
  actions: MigrationAction[];
  documentByKey: Map<EntityKey, Document>;
  recordBodyKeys: Set<EntityKey>;
  workspaceId: string;
  targets: PlanTarget[];
}

function planDocs(a: DocsArgs): Finding[] {
  const findings: Finding[] = [];
  const standalone = a.snapshot.documents.filter((d) => !a.recordBodyKeys.has(d.key));
  if (standalone.length === 0) return findings;

  if (!a.options.experimental.docs) {
    findings.push({
      code: 'DOCS_EXPERIMENTAL_DISABLED',
      outcome: 'skipped',
      severity: 'warning',
      category: 'scope',
      message: `${standalone.length} Notion page(s) were read but are not migrated: page → ClickUp Docs migration is experimental. Set options.experimental.docs: true to include them.`,
    });
    return findings;
  }

  const parentCfg = a.cfg.docs.parent ?? { type: 'workspace' as const, id: a.workspaceId };
  a.targets.push({
    kind: 'docs-parent',
    id: parentCfg.id,
    name: `Docs go to ${parentCfg.type} ${parentCfg.id}`,
  });

  const keys = new Set(standalone.map((d) => d.key));
  const childrenOf = new Map<EntityKey, Document[]>();
  const roots: Document[] = [];
  for (const d of standalone) {
    if (d.parent !== undefined && keys.has(d.parent)) {
      childrenOf.set(d.parent, [...(childrenOf.get(d.parent) ?? []), d]);
    } else {
      if (d.parent !== undefined) {
        findings.push({
          code: 'DOC_PARENT_MISSING',
          outcome: 'lossy',
          severity: 'warning',
          category: 'scope',
          message: `"${d.title}" was a sub-page of a page that was not migrated; it becomes a top-level Doc.`,
          entity: d.key,
        });
      }
      roots.push(d);
    }
  }
  // Keep sub-pages in the order they appear in their parent's content.
  const orderIndex = (parent: Document, child: Document): number => {
    const order: EntityKey[] = [];
    const walk = (blocks: readonly DocumentBlock[]): void => {
      for (const b of blocks) {
        if (b.kind === 'childPage' && b.target !== undefined) order.push(b.target);
        walk(b.children);
      }
    };
    walk(parent.blocks);
    const i = order.indexOf(child.key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  for (const [parentKey, kids] of childrenOf) {
    const parent = a.documentByKey.get(parentKey);
    if (parent)
      kids.sort(
        (x, y) => orderIndex(parent, x) - orderIndex(parent, y) || x.title.localeCompare(y.title),
      );
  }
  roots.sort((x, y) => x.title.localeCompare(y.title) || x.key.localeCompare(y.key));

  const scope = DOCS_SCOPE(a.workspaceId);
  const policy: RenderPolicy = {
    ...CLICKUP_DOC_POLICY,
    unsupportedBlocks: a.options.unsupportedBlocks,
  };

  const emitDoc = (doc: Document): void => {
    const docKey = `${doc.key}#doc`;
    const docActionId = actionId(ACTION_KINDS.createDoc, docKey);
    const priorDoc = a.input.existing.get(existingKey(scope, docKey));
    const docPayload: CreateDocPayload = {
      workspaceId: a.workspaceId,
      name: doc.title,
      parent: { id: parentCfg.id, type: DOC_PARENT_TYPE[parentCfg.type] },
      visibility: a.cfg.docs.visibility,
    };
    a.actions.push({
      id: docActionId,
      kind: ACTION_KINDS.createDoc,
      label: `Create Doc "${doc.title}"`,
      source: doc.key,
      idempotencyKey: docKey,
      scope,
      dependsOn: [],
      disposition: priorDoc ? 'skip' : 'execute',
      ...(priorDoc
        ? { skipReason: 'already_migrated' as const, existingDestinationId: priorDoc.destinationId }
        : {}),
      outcome: priorDoc ? 'skipped' : 'supported',
      findings: [],
      estimatedRequests: priorDoc ? 0 : 1,
      payload: docPayload,
    });
    emitPage(doc, docActionId, undefined);
  };

  const emitPage = (
    doc: Document,
    docActionId: MigrationAction['id'],
    parentPageAction: MigrationAction['id'] | undefined,
  ): void => {
    const pageKey = `${doc.key}#page`;
    const pageActionId = actionId(ACTION_KINDS.createDocPage, pageKey);
    const prior = a.input.existing.get(existingKey(scope, pageKey));
    const migratedChildren = new Set(keys);
    const rendered = renderBlocksToMarkdown(
      pruneMigratedChildPages(doc.blocks, migratedChildren),
      policy,
      { entity: doc.key },
    );
    const marker = a.options.provenance === 'footer' ? markerText(pageKey) : null;
    const content = composeMarkdown([
      rendered.markdown,
      marker === null
        ? undefined
        : provenanceFooter({
            system: 'Notion',
            key: pageKey,
            sourceUrl: doc.url,
            createdAt: doc.createdAt,
          }),
    ]);
    const payload: CreatePagePayload = {
      workspaceId: a.workspaceId,
      docAction: docActionId,
      ...(parentPageAction === undefined ? {} : { parentPageAction }),
      name: doc.title === '' ? 'Untitled' : doc.title,
      content,
      marker,
    };
    a.actions.push({
      id: pageActionId,
      kind: ACTION_KINDS.createDocPage,
      label: `Create page "${doc.title}"${parentPageAction ? ' (sub-page)' : ''}`,
      source: doc.key,
      idempotencyKey: pageKey,
      scope,
      dependsOn: parentPageAction === undefined ? [docActionId] : [docActionId, parentPageAction],
      disposition: prior ? 'skip' : 'execute',
      ...(prior
        ? { skipReason: 'already_migrated' as const, existingDestinationId: prior.destinationId }
        : {}),
      outcome: prior
        ? 'skipped'
        : itemOutcome(['supported', ...rendered.findings.map((f) => f.outcome)]),
      findings: rendered.findings,
      estimatedRequests: prior ? 0 : 1,
      payload: payload,
    });
    for (const child of childrenOf.get(doc.key) ?? []) emitPage(child, docActionId, pageActionId);
  };

  for (const root of roots) emitDoc(root);
  return findings;
}
