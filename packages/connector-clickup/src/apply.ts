import { ValidationError } from '@exitos/shared';
import type { ApplyContext, ApplyResult, MigrationAction } from '@exitos/core';
import type { z } from 'zod';
import type { ClickUpClient } from './client.js';
import {
  ACTION_KINDS,
  CreateDocPayloadSchema,
  CreatePagePayloadSchema,
  CreateTaskPayloadSchema,
  LinkPayloadSchema,
} from './payloads.js';

/** Parse an action payload; on failure name the offending paths but never echo values. */
export function parsePayload<T>(schema: z.ZodType<T>, action: MigrationAction): T {
  const parsed = schema.safeParse(action.payload);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 4)
      .map((i) => i.path.join('.') || '(root)')
      .join(', ');
    throw new ValidationError(
      'PAYLOAD_INVALID',
      `Action ${action.id} has an invalid payload at: ${where}. The plan file may have been edited.`,
    );
  }
  return parsed.data;
}

function need(
  ctx: ApplyContext,
  actionId: string,
  what: string,
): { destinationId: string; destinationUrl?: string } {
  const found = ctx.resolveDependency(actionId);
  if (!found) {
    throw new ValidationError(
      'DEPENDENCY_UNRESOLVED',
      `The ${what} this action depends on has no destination id yet.`,
    );
  }
  return found;
}

/**
 * Execute exactly one planned action. This is the ONLY place that writes to ClickUp, and the only
 * writes are the four the network policy allow-lists (create task, link tasks, create Doc, create
 * Doc page). Errors surface unchanged: `AmbiguousWriteError` tells the executor to reconcile.
 */
export async function applyClickUpAction(
  client: ClickUpClient,
  action: MigrationAction,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  switch (action.kind) {
    case ACTION_KINDS.createTask: {
      const p = parsePayload(CreateTaskPayloadSchema, action);
      const created = await client.createTask(p.listId, p.body);
      return {
        destinationId: created.id,
        ...(created.url === undefined ? {} : { destinationUrl: created.url }),
      };
    }

    case ACTION_KINDS.linkTasks: {
      const p = parsePayload(LinkPayloadSchema, action);
      const from = need(ctx, p.fromAction, 'first task');
      const to = need(ctx, p.toAction, 'second task');
      await client.linkTasks(from.destinationId, to.destinationId);
      return { destinationId: `${from.destinationId}->${to.destinationId}` };
    }

    case ACTION_KINDS.createDoc: {
      const p = parsePayload(CreateDocPayloadSchema, action);
      const doc = await client.createDoc(p.workspaceId, {
        name: p.name,
        parent: p.parent,
        visibility: p.visibility,
        // Do not let ClickUp add an empty first page; our own page action creates the content.
        create_page: false,
      });
      return { destinationId: doc.id };
    }

    case ACTION_KINDS.createDocPage: {
      const p = parsePayload(CreatePagePayloadSchema, action);
      const doc = need(ctx, p.docAction, 'Doc');
      const parent =
        p.parentPageAction === undefined ? undefined : need(ctx, p.parentPageAction, 'parent page');
      const page = await client.createPage(p.workspaceId, doc.destinationId, {
        name: p.name,
        content: p.content,
        content_format: 'text/md',
        ...(parent === undefined ? {} : { parent_page_id: parent.destinationId }),
      });
      return { destinationId: page.id };
    }

    default:
      throw new ValidationError(
        'UNKNOWN_ACTION_KIND',
        `This connector cannot execute actions of kind "${action.kind}".`,
      );
  }
}
