import { ApiError } from '@exitos/shared';
import type { DestinationInspection, Finding, PlanTarget } from '@exitos/core/sdk';
import { z } from 'zod';
import type { ClickUpClient } from './client.js';
import type { ClickUpDestinationConfig } from './config.js';

const FieldOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  orderindex: z.number().nullable(),
});

export const ListInspectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string().nullable(),
  spaceName: z.string().nullable(),
  folderName: z.string().nullable(),
  statuses: z.array(z.object({ status: z.string(), type: z.string().nullable() })),
  fields: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      options: z.array(FieldOptionSchema),
    }),
  ),
  spaceTags: z.array(z.string()),
});
export type ListInspection = z.infer<typeof ListInspectionSchema>;

export const ClickUpInspectionSchema = z.object({
  user: z.object({ id: z.number(), username: z.string().nullable() }),
  members: z.array(
    z.object({ id: z.number(), username: z.string().nullable(), email: z.string().nullable() }),
  ),
  lists: z.record(z.string(), ListInspectionSchema),
});
export type ClickUpInspection = z.infer<typeof ClickUpInspectionSchema>;

/** Extract selectable options from a drop_down / labels custom field's `type_config`. */
function optionsOf(config: Record<string, unknown>): z.infer<typeof FieldOptionSchema>[] {
  const raw = config.options;
  if (!Array.isArray(raw)) return [];
  const out: z.infer<typeof FieldOptionSchema>[] = [];
  for (const o of raw as Array<Record<string, unknown>>) {
    const id = typeof o.id === 'string' ? o.id : undefined;
    const name =
      typeof o.name === 'string' ? o.name : typeof o.label === 'string' ? o.label : undefined;
    if (id === undefined || name === undefined) continue;
    const idx = typeof o.orderindex === 'number' ? o.orderindex : Number(o.orderindex);
    out.push({ id, name, orderindex: Number.isFinite(idx) ? idx : null });
  }
  return out;
}

/** Read-only facts about the destination that planning needs (statuses, fields, people, tags). */
export async function inspectClickUp(
  client: ClickUpClient,
  config: ClickUpDestinationConfig,
): Promise<DestinationInspection> {
  const findings: Finding[] = [];
  const user = await client.getAuthorizedUser();
  const teams = await client.getTeams();
  const team = teams.find((t) => t.id === config.workspaceId);
  if (!team) {
    findings.push({
      code: 'DEST_WORKSPACE_NOT_FOUND',
      outcome: 'unsupported',
      severity: 'error',
      category: 'destination',
      message: `Workspace ${config.workspaceId} is not available to this token. Available: ${
        teams.map((t) => `${t.name} (${t.id})`).join(', ') || 'none'
      }.`,
    });
  }

  const members = (team?.members ?? []).map((m) => ({
    id: m.user.id,
    username: m.user.username ?? null,
    email: m.user.email ?? null,
  }));

  const lists: Record<string, ListInspection> = {};
  const targets: PlanTarget[] = [];
  let reads = 3;
  const tagCache = new Map<string, string[]>();

  for (const mapping of config.lists) {
    try {
      const list = await client.getList(mapping.listId);
      const fields = await client.getListFields(mapping.listId);
      reads += 2;
      const spaceId = list.space?.id ?? null;
      let spaceTags: string[] = [];
      if (spaceId !== null) {
        const cached = tagCache.get(spaceId);
        if (cached) spaceTags = cached;
        else {
          try {
            spaceTags = await client.getSpaceTags(spaceId);
            reads += 1;
          } catch (error) {
            if (!(error instanceof ApiError) || (error.status !== 403 && error.status !== 404))
              throw error;
          }
          tagCache.set(spaceId, spaceTags);
        }
      }
      lists[list.id] = {
        id: list.id,
        name: list.name,
        spaceId,
        spaceName: list.space?.name ?? null,
        folderName: list.folder?.hidden === true ? null : (list.folder?.name ?? null),
        statuses: list.statuses.map((s) => ({ status: s.status, type: s.type ?? null })),
        fields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          required: f.required === true,
          options: optionsOf(f.type_config as Record<string, unknown>),
        })),
        spaceTags,
      };
      targets.push({
        kind: 'list',
        id: list.id,
        name: list.name,
        path: [
          team?.name ?? config.workspaceId,
          list.space?.name,
          list.folder?.hidden === true ? undefined : list.folder?.name,
          list.name,
        ]
          .filter((p): p is string => typeof p === 'string' && p !== '')
          .join(' / '),
      });
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        (error.status !== 404 && error.status !== 403 && error.status !== 401)
      ) {
        throw error;
      }
      if (error.status === 401) throw error;
      findings.push({
        code: error.status === 403 ? 'DEST_LIST_FORBIDDEN' : 'DEST_LIST_NOT_FOUND',
        outcome: 'unsupported',
        severity: 'error',
        category: 'destination',
        message:
          error.status === 403
            ? `This token may not access ClickUp list ${mapping.listId}.`
            : `ClickUp list ${mapping.listId} was not found. Open the list in ClickUp and copy the id from its URL.`,
      });
    }
  }

  return {
    workspace: {
      system: 'clickup',
      id: config.workspaceId,
      name: team?.name ?? `Workspace ${config.workspaceId}`,
    },
    targets,
    data: ClickUpInspectionSchema.parse({
      user: { id: user.id, username: user.username ?? null },
      members,
      lists,
    }),
    findings,
    requests: { reads },
  };
}
