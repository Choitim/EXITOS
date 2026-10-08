import type { AdoptedItem, Finding, MigrationPlan, ValidationResult } from '@exitos/core';
import { PROVENANCE_KEY_PREFIX } from '@exitos/shared';
import type { ClickUpClient } from './client.js';
import { canon } from './convert.js';
import { ACTION_KINDS, CreateDocPayloadSchema, CreateTaskPayloadSchema } from './payloads.js';

const MARKER_RE = new RegExp(`${PROVENANCE_KEY_PREFIX.replace(/[-:]/g, '\\$&')}([^\\s\`]+)`, 'g');

/** Marker keys found in a piece of text (a task description). */
export function markersIn(text: string): string[] {
  return [...text.matchAll(MARKER_RE)].map((m) => m[1] as string);
}

/**
 * Read-only checks against the live destination, done once at plan time:
 *  1. ADOPT items a previous run (or another machine) already created — recognised by the
 *     provenance marker in their description — so losing the local database never causes duplicates;
 *  2. WARN when planned task names collide with unrelated existing tasks (ExitOS never overwrites);
 *  3. WARN when a listing could not be read completely.
 */
export async function validateClickUpPlan(
  client: ClickUpClient,
  plan: MigrationPlan,
): Promise<ValidationResult> {
  const findings: Finding[] = [];
  const adopted: AdoptedItem[] = [];
  let reads = 0;

  const taskActions = plan.actions.filter(
    (a) => a.kind === ACTION_KINDS.createTask && a.disposition === 'execute',
  );
  const lists = [
    ...new Set(
      taskActions.map((a) => {
        const id = (a.payload as { listId?: unknown }).listId;
        return typeof id === 'string' ? id : '';
      }),
    ),
  ].filter(Boolean);

  for (const listId of lists) {
    const page = await client.listTasks(listId);
    reads += page.requests;
    const byMarker = new Map<string, (typeof page.tasks)[number]>();
    for (const task of page.tasks) {
      const text = [task.markdown_description, task.description, task.text_content]
        .filter((t): t is string => typeof t === 'string')
        .join('\n');
      for (const key of markersIn(text)) if (!byMarker.has(key)) byMarker.set(key, task);
    }
    const existingNames = new Set(page.tasks.map((t) => canon(t.name)));
    let collisions = 0;

    for (const action of taskActions) {
      const payload = CreateTaskPayloadSchema.safeParse(action.payload);
      if (!payload.success || payload.data.listId !== listId) continue;
      const hit = byMarker.get(action.idempotencyKey);
      if (hit) {
        adopted.push({
          actionId: action.id,
          destinationId: hit.id,
          ...(hit.url === undefined ? {} : { destinationUrl: hit.url }),
        });
      } else if (existingNames.has(canon(payload.data.body.name))) {
        collisions += 1;
      }
    }

    if (collisions > 0) {
      findings.push({
        code: 'DEST_NAME_COLLISION',
        outcome: 'supported',
        severity: 'warning',
        category: 'destination',
        message: `${collisions} planned task(s) have the same name as an existing, unrelated task in ClickUp list ${listId}. ExitOS never overwrites or merges, so duplicates by name will be created. Review before approving.`,
        count: collisions,
      });
    }
    if (!page.complete) {
      findings.push({
        code: 'LIST_SCAN_INCOMPLETE',
        outcome: 'lossy',
        severity: 'warning',
        category: 'destination',
        message: `The existing tasks of list ${listId} could not be read completely, so already-migrated items may not have been detected.`,
      });
    }
  }

  const adoptedCount = adopted.length;
  if (adoptedCount > 0) {
    findings.push({
      code: 'ALREADY_PRESENT',
      outcome: 'skipped',
      severity: 'info',
      category: 'destination',
      message: `${adoptedCount} planned task(s) already exist in ClickUp (found via their provenance marker) and will be skipped, not duplicated.`,
      count: adoptedCount,
    });
  }

  // Docs: advisory only (a Doc has no content to carry a marker).
  const docActions = plan.actions.filter(
    (a) => a.kind === ACTION_KINDS.createDoc && a.disposition === 'execute',
  );
  if (docActions.length > 0) {
    const first = CreateDocPayloadSchema.safeParse(docActions[0]?.payload);
    if (first.success) {
      const docs = await client.searchDocs(first.data.workspaceId);
      reads += Math.max(1, Math.ceil(docs.length / 50));
      const names = new Set(docs.filter((d) => d.deleted !== true).map((d) => canon(d.name)));
      const clashing = docActions.filter((a) => {
        const p = CreateDocPayloadSchema.safeParse(a.payload);
        return p.success && names.has(canon(p.data.name));
      }).length;
      if (clashing > 0) {
        findings.push({
          code: 'DEST_DOC_NAME_COLLISION',
          outcome: 'supported',
          severity: 'warning',
          category: 'destination',
          message: `${clashing} planned Doc(s) have the same name as an existing Doc. ExitOS never overwrites; new Docs will be created alongside.`,
          count: clashing,
        });
      }
    }
  }

  return { findings, adopted, readRequests: reads };
}
