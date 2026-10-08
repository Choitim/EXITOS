import { ApiError, ValidationError } from '@exitos/shared';
import type { MigrationAction, ReconcileRequest, ReconcileResult } from '@exitos/core';
import { parsePayload } from './apply.js';
import type { ClickUpClient } from './client.js';
import { markerText } from './markdown.js';
import {
  ACTION_KINDS,
  CreateDocPayloadSchema,
  CreatePagePayloadSchema,
  CreateTaskPayloadSchema,
  LinkPayloadSchema,
} from './payloads.js';
import { flattenPages } from './client.js';

/** Clock skew allowance between this machine and ClickUp when bounding "created since" searches. */
const SKEW_MS = 60_000;

function textsOf(task: {
  markdown_description?: string | null | undefined;
  description?: string | null | undefined;
  text_content?: string | null | undefined;
}): string {
  return [task.markdown_description, task.description, task.text_content]
    .filter((t): t is string => typeof t === 'string')
    .join('\n');
}

/**
 * After a write with an unknown outcome (timeout, 5xx, dropped connection), look in ClickUp for the
 * item the action would have created.
 *
 *  - tasks and Doc pages are found by the provenance marker in their content;
 *  - links are found by reading the task's linked_tasks;
 *  - Docs have no content to carry a marker, so they are found by name under the parent and
 *    creation time — if two match we refuse to guess.
 *
 * `not_found` is only `confident` when the whole listing was read. ClickUp documents no consistency
 * guarantee for list endpoints right after a create, which is why the documentation calls this
 * best-effort rather than exactly-once.
 */
export async function reconcileClickUpAction(
  client: ClickUpClient,
  action: MigrationAction,
  request: ReconcileRequest,
): Promise<ReconcileResult> {
  const sinceMs = Date.parse(request.since);
  const createdAfterMs = Number.isNaN(sinceMs) ? undefined : sinceMs - SKEW_MS;

  try {
    switch (action.kind) {
      case ACTION_KINDS.createTask: {
        const p = parsePayload(CreateTaskPayloadSchema, action);
        const page = await client.listTasks(
          p.listId,
          createdAfterMs === undefined ? {} : { createdAfterMs },
        );
        if (p.marker !== null) {
          const hits = page.tasks.filter((t) => textsOf(t).includes(p.marker as string));
          if (hits.length === 1) {
            const t = hits[0] as (typeof hits)[number];
            return {
              status: 'found',
              destinationId: t.id,
              ...(t.url === undefined ? {} : { destinationUrl: t.url }),
            };
          }
          if (hits.length > 1) {
            return {
              status: 'undecidable',
              reason: `${hits.length} tasks carry the marker ${markerText(action.idempotencyKey)}; inspect the list manually.`,
            };
          }
          return { status: 'not_found', confident: page.complete };
        }
        // No marker was written: fall back to "same name, created since the attempt".
        const named = page.tasks.filter((t) => t.name === p.body.name);
        if (named.length === 1) {
          const t = named[0] as (typeof named)[number];
          return {
            status: 'found',
            destinationId: t.id,
            ...(t.url === undefined ? {} : { destinationUrl: t.url }),
          };
        }
        if (named.length > 1)
          return {
            status: 'undecidable',
            reason:
              'Several tasks with this name were created since the attempt and there is no marker to tell them apart.',
          };
        return { status: 'not_found', confident: page.complete };
      }

      case ACTION_KINDS.linkTasks: {
        const p = parsePayload(LinkPayloadSchema, action);
        const from = request.resolveDependency(p.fromAction);
        const to = request.resolveDependency(p.toAction);
        if (!from || !to)
          return { status: 'undecidable', reason: 'The tasks to link are not known yet.' };
        const task = await client.getTask(from.destinationId);
        const linked = task.linked_tasks.some((l) => l.task_id === to.destinationId);
        return linked
          ? { status: 'found', destinationId: `${from.destinationId}->${to.destinationId}` }
          : { status: 'not_found', confident: true };
      }

      case ACTION_KINDS.createDoc: {
        const p = parsePayload(CreateDocPayloadSchema, action);
        const docs = await client.searchDocs(p.workspaceId, { parentId: p.parent.id });
        const hits = docs.filter(
          (d) =>
            d.name === p.name &&
            d.deleted !== true &&
            (createdAfterMs === undefined || Number(d.date_created ?? 0) >= createdAfterMs),
        );
        if (hits.length === 1)
          return { status: 'found', destinationId: (hits[0] as (typeof hits)[number]).id };
        if (hits.length > 1)
          return {
            status: 'undecidable',
            reason: `${hits.length} Docs named "${p.name}" were created since the attempt; check ClickUp and use --assume-not-created if none is yours.`,
          };
        return { status: 'not_found', confident: true };
      }

      case ACTION_KINDS.createDocPage: {
        const p = parsePayload(CreatePagePayloadSchema, action);
        const doc = request.resolveDependency(p.docAction);
        if (!doc)
          return {
            status: 'undecidable',
            reason: 'The Doc this page belongs to is not known yet.',
          };
        const pages = flattenPages(await client.getDocPages(p.workspaceId, doc.destinationId));
        const hits =
          p.marker !== null
            ? pages.filter((pg) => (pg.content ?? '').includes(p.marker as string))
            : pages.filter((pg) => pg.name === p.name);
        if (hits.length === 1)
          return { status: 'found', destinationId: (hits[0] as (typeof hits)[number]).id };
        if (hits.length > 1)
          return {
            status: 'undecidable',
            reason: 'Several pages match; inspect the Doc manually.',
          };
        return { status: 'not_found', confident: true };
      }

      default:
        return { status: 'undecidable', reason: `No reconciliation exists for ${action.kind}.` };
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      return { status: 'not_found', confident: false };
    if (error instanceof ValidationError) return { status: 'undecidable', reason: error.message };
    throw error;
  }
}
