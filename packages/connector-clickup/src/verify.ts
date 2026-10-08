import { ApiError, epochToZonedDate } from '@exitos/shared';
import type {
  FieldCheck,
  ItemVerification,
  MigrationAction,
  MigrationPlan,
  VerifyInput,
  VerifyOutput,
} from '@exitos/core';
import { type ClickUpClient, flattenPages } from './client.js';
import { canon, priorityFrom } from './convert.js';
import { normalizeMarkdownForCompare } from './markdown.js';
import {
  ACTION_KINDS,
  CreateDocPayloadSchema,
  CreatePagePayloadSchema,
  CreateTaskPayloadSchema,
  LinkPayloadSchema,
  type CreateTaskPayload,
} from './payloads.js';
import type { TaskInfo } from './schemas.js';

const SNIPPET = 120;
const clip = (s: string): string => (s.length > SNIPPET ? `${s.slice(0, SNIPPET)}…` : s);

/** Short, safe rendering of an arbitrary API value (never "[object Object]"). */
const show = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : (JSON.stringify(v) ?? 'undefined');

const check = (
  field: string,
  status: FieldCheck['status'],
  expected?: string,
  actual?: string,
  note?: string,
): FieldCheck => ({
  field,
  status,
  ...(expected === undefined ? {} : { expected: clip(expected) }),
  ...(actual === undefined ? {} : { actual: clip(actual) }),
  ...(note === undefined ? {} : { note }),
});

/** Point at the first line where two texts really differ (skipping blank lines on the longer side). */
function firstDifference(expected: string, actual: string): { expected: string; actual: string } {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const i = e.findIndex((line, idx) => line !== a[idx]);
  const at = i === -1 ? Math.min(e.length, a.length) : i;
  const pick = (lines: string[]): string =>
    lines.slice(at).find((l) => l.trim() !== '') ?? '(end of text)';
  return { expected: `from line ${at + 1}: ${pick(e)}`, actual: `from line ${at + 1}: ${pick(a)}` };
}

/** Compare one planned task with what ClickUp returned. */
export function compareTask(
  planned: CreateTaskPayload,
  task: TaskInfo,
  timezone: string,
): FieldCheck[] {
  const checks: FieldCheck[] = [];
  const body = planned.body;

  checks.push(
    body.name.normalize('NFC').trim() === task.name.normalize('NFC').trim()
      ? check('name', 'verified')
      : check('name', 'mismatched', body.name, task.name),
  );

  if (body.status !== undefined) {
    const actual = task.status?.status ?? '';
    checks.push(
      canon(actual) === canon(body.status)
        ? check('status', 'verified')
        : check('status', 'mismatched', body.status, actual),
    );
  }

  if (body.priority !== undefined) {
    const raw = task.priority?.id ?? task.priority?.priority;
    const actual =
      raw === undefined ? undefined : priorityFrom(typeof raw === 'number' ? raw : String(raw));
    checks.push(
      actual === body.priority
        ? check('priority', 'verified')
        : check('priority', 'mismatched', String(body.priority), String(raw ?? 'none')),
    );
  }

  const dateCheck = (
    field: 'due_date' | 'start_date',
    planned: number | undefined,
    timeFlag: boolean | undefined,
    actualRaw: string | null | undefined,
  ): void => {
    if (planned === undefined) return;
    const actual = actualRaw === null || actualRaw === undefined ? undefined : Number(actualRaw);
    if (actual === undefined || Number.isNaN(actual)) {
      checks.push(check(field, 'mismatched', String(planned), 'none'));
      return;
    }
    const ok =
      timeFlag === true
        ? actual === planned
        : epochToZonedDate(actual, timezone) === epochToZonedDate(planned, timezone);
    checks.push(
      ok
        ? check(field, 'verified')
        : check(
            field,
            'mismatched',
            new Date(planned).toISOString(),
            new Date(actual).toISOString(),
            timeFlag === true ? undefined : `Compared as calendar days in ${timezone}.`,
          ),
    );
  };
  dateCheck('due_date', body.due_date, body.due_date_time, task.due_date);
  dateCheck('start_date', body.start_date, body.start_date_time, task.start_date);

  if (body.assignees !== undefined) {
    const want = [...body.assignees].sort((a, b) => a - b).join(',');
    const got = task.assignees
      .map((u) => u.id)
      .sort((a, b) => a - b)
      .join(',');
    checks.push(
      want === got ? check('assignees', 'verified') : check('assignees', 'mismatched', want, got),
    );
  }

  if (body.tags !== undefined) {
    const have = new Set(task.tags.map((t) => canon(t.name)));
    const missing = body.tags.filter((t) => !have.has(canon(t)));
    checks.push(
      missing.length === 0
        ? check('tags', 'verified')
        : check(
            'tags',
            'mismatched',
            body.tags.join(', '),
            task.tags.map((t) => t.name).join(', '),
          ),
    );
  }

  for (const cf of body.custom_fields ?? []) {
    const actual = task.custom_fields.find((f) => f.id === cf.id);
    const label = `custom_field:${actual?.name ?? cf.id}`;
    if (!actual) {
      checks.push(check(label, 'mismatched', JSON.stringify(cf.value), 'not set'));
      continue;
    }
    checks.push(compareCustomField(label, cf.value, actual));
  }

  // The description is the largest carrier of content: compare the full (normalised) text.
  const expectedMd = normalizeMarkdownForCompare(body.markdown_content);
  const actualRaw = task.markdown_description ?? task.description ?? null;
  if (actualRaw === null) {
    checks.push(
      check(
        'description',
        'unverified',
        undefined,
        undefined,
        'ClickUp did not return the description text.',
      ),
    );
  } else {
    const actualMd = normalizeMarkdownForCompare(actualRaw);
    if (expectedMd === actualMd) checks.push(check('description', 'verified'));
    else {
      const d = firstDifference(expectedMd, actualMd);
      checks.push(
        check(
          'description',
          'mismatched',
          d.expected,
          d.actual,
          'Text differs after whitespace normalisation.',
        ),
      );
    }
  }
  return checks;
}

function compareCustomField(
  label: string,
  planned: unknown,
  actual: NonNullable<TaskInfo['custom_fields'][number]>,
): FieldCheck {
  const value = actual.value;
  if (value === undefined || value === null)
    return check(label, 'mismatched', JSON.stringify(planned), 'empty');
  switch (actual.type) {
    case 'number':
    case 'currency':
      return Number(value) === Number(planned)
        ? check(label, 'verified')
        : check(label, 'mismatched', show(planned), show(value));
    case 'checkbox':
      return (value === true || value === 'true') === (planned === true)
        ? check(label, 'verified')
        : check(label, 'mismatched', show(planned), show(value));
    case 'date':
      return Number(value) === Number(planned)
        ? check(label, 'verified')
        : check(
            label,
            'unverified',
            undefined,
            undefined,
            'Dates without a time may be re-based by ClickUp.',
          );
    case 'drop_down': {
      const options = (
        actual.type_config as
          { options?: Array<{ id?: string; orderindex?: number | string }> } | undefined
      )?.options;
      const wanted = options?.find((o) => o.id === planned);
      if (!wanted)
        return check(label, 'unverified', undefined, undefined, 'Option list not returned.');
      return Number(wanted.orderindex) === Number(value) || show(value) === show(planned)
        ? check(label, 'verified')
        : check(label, 'mismatched', show(planned), show(value));
    }
    case 'labels': {
      const want = Array.isArray(planned) ? planned.map(show).sort().join(',') : '';
      const got = Array.isArray(value) ? value.map(show).sort().join(',') : '';
      return want === got ? check(label, 'verified') : check(label, 'mismatched', want, got);
    }
    default:
      return show(value) === show(planned)
        ? check(label, 'verified')
        : check(label, 'mismatched', show(planned), show(value));
  }
}

function worstStatus(checks: readonly FieldCheck[]): ItemVerification['status'] {
  if (checks.some((c) => c.status === 'missing')) return 'missing';
  if (checks.some((c) => c.status === 'mismatched')) return 'mismatched';
  if (checks.some((c) => c.status === 'unverified')) return 'unverified';
  return 'verified';
}

const SCOPE_TEXT =
  'For each planned task: it exists in the destination list, and its name, status, priority, start/due dates, assignees, tags, mapped custom-field values and the full description text match the plan. For each link: both tasks are linked. For each Doc page: its name, parent and content match. NOT verified: comments, attachments, activity, notifications, views, or anything outside the plan.';

/** Compare the plan's intent with ClickUp's actual state using list reads (100 tasks per request). */
export async function verifyClickUp(
  client: ClickUpClient,
  input: VerifyInput,
): Promise<VerifyOutput> {
  const { plan } = input;
  const idOf = new Map(input.mappings.map((m) => [m.actionId, m.destinationId]));
  const timezoneOption = plan.options.timezone;
  const timezone = typeof timezoneOption === 'string' ? timezoneOption : 'UTC';
  const items: ItemVerification[] = [];
  const targets: VerifyOutput['targets'] = [];
  const notes: string[] = [];
  let reads = 0;

  // ---- tasks ----------------------------------------------------------------------------------
  const taskActions = plan.actions.filter(
    (a) => a.kind === ACTION_KINDS.createTask && idOf.has(a.id),
  );
  const byList = new Map<string, MigrationAction[]>();
  for (const a of taskActions) {
    const listId = String((a.payload as { listId?: unknown }).listId);
    byList.set(listId, [...(byList.get(listId) ?? []), a]);
  }
  const taskCache = new Map<string, TaskInfo>();

  for (const [listId, actions] of byList) {
    const page = await client.listTasks(listId);
    reads += page.requests;
    if (!page.complete)
      notes.push(
        `The task listing of list ${listId} was incomplete; some items were checked individually.`,
      );
    const byId = new Map(page.tasks.map((t) => [t.id, t]));
    let found = 0;

    for (const action of actions) {
      const destinationId = idOf.get(action.id) as string;
      const planned = CreateTaskPayloadSchema.safeParse(action.payload);
      if (!planned.success) {
        items.push({
          actionId: action.id,
          source: action.source,
          destinationId,
          status: 'unverified',
          checks: [
            check('plan', 'unverified', undefined, undefined, 'The planned payload is not valid.'),
          ],
        });
        continue;
      }
      let task = byId.get(destinationId);
      if (!task) {
        try {
          task = await client.getTask(destinationId);
          reads += 1;
          notes.push(
            `Task ${destinationId} was not in the list listing but exists (fetched individually).`,
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      if (!task) {
        items.push({
          actionId: action.id,
          source: action.source,
          destinationId,
          status: 'missing',
          checks: [
            check(
              'existence',
              'missing',
              undefined,
              undefined,
              'No task with this id exists in ClickUp.',
            ),
          ],
        });
        continue;
      }
      found += 1;
      taskCache.set(destinationId, task);
      const checks = compareTask(planned.data, task, timezone);
      items.push({
        actionId: action.id,
        source: action.source,
        destinationId,
        status: worstStatus(checks),
        checks,
      });
    }
    targets.push({ target: `list ${listId}`, expected: actions.length, found });
  }

  // ---- links ------------------------------------------------------------------------------------
  const linkActions = plan.actions.filter(
    (a) => a.kind === ACTION_KINDS.linkTasks && idOf.has(a.id),
  );
  for (const action of linkActions) {
    const p = LinkPayloadSchema.safeParse(action.payload);
    const from = p.success ? idOf.get(p.data.fromAction) : undefined;
    const to = p.success ? idOf.get(p.data.toAction) : undefined;
    if (!p.success || from === undefined || to === undefined) {
      items.push({
        actionId: action.id,
        source: null,
        status: 'unverified',
        checks: [
          check('link', 'unverified', undefined, undefined, 'The tasks to link were not created.'),
        ],
      });
      continue;
    }
    let task = taskCache.get(from);
    if (!task) {
      try {
        task = await client.getTask(from);
        reads += 1;
        taskCache.set(from, task);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    if (!task) {
      items.push({
        actionId: action.id,
        source: null,
        status: 'missing',
        checks: [
          check('link', 'missing', undefined, undefined, 'The first task no longer exists.'),
        ],
      });
      continue;
    }
    const linked = task.linked_tasks.some((l) => l.task_id === to);
    items.push({
      actionId: action.id,
      source: null,
      destinationId: idOf.get(action.id),
      status: linked ? 'verified' : 'mismatched',
      checks: [
        linked
          ? check('link', 'verified')
          : check('link', 'mismatched', `${from} ↔ ${to}`, 'not linked'),
      ],
    });
  }
  if (linkActions.length > 0)
    targets.push({
      target: 'task links',
      expected: linkActions.length,
      found: items.filter((i) => i.source === null && i.status === 'verified').length,
    });

  // ---- docs -------------------------------------------------------------------------------------
  await verifyDocs(client, plan, idOf, items, targets, notes, (n) => {
    reads += n;
  });

  return { items, targets, scope: SCOPE_TEXT, notes, readRequests: reads };
}

async function verifyDocs(
  client: ClickUpClient,
  plan: MigrationPlan,
  idOf: Map<string, string>,
  items: ItemVerification[],
  targets: VerifyOutput['targets'],
  notes: string[],
  addReads: (n: number) => void,
): Promise<void> {
  const docActions = plan.actions.filter(
    (a) => a.kind === ACTION_KINDS.createDoc && idOf.has(a.id),
  );
  const pageActions = plan.actions.filter(
    (a) => a.kind === ACTION_KINDS.createDocPage && idOf.has(a.id),
  );
  if (docActions.length === 0 && pageActions.length === 0) return;

  let docsFound = 0;
  let pagesFound = 0;
  for (const doc of docActions) {
    const dp = CreateDocPayloadSchema.safeParse(doc.payload);
    const docId = idOf.get(doc.id) as string;
    if (!dp.success) continue;
    let tree: Awaited<ReturnType<ClickUpClient['getDocPages']>> | undefined;
    try {
      tree = await client.getDocPages(dp.data.workspaceId, docId);
      addReads(1);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    if (!tree) {
      items.push({
        actionId: doc.id,
        source: doc.source,
        destinationId: docId,
        status: 'missing',
        checks: [check('existence', 'missing', undefined, undefined, 'The Doc does not exist.')],
      });
      continue;
    }
    docsFound += 1;
    items.push({
      actionId: doc.id,
      source: doc.source,
      destinationId: docId,
      status: 'verified',
      checks: [check('existence', 'verified')],
    });

    const flat = flattenPages(tree);
    const byId = new Map(flat.map((p) => [p.id, p]));
    for (const pa of pageActions) {
      const pp = CreatePagePayloadSchema.safeParse(pa.payload);
      if (!pp.success || pp.data.docAction !== doc.id) continue;
      const pageId = idOf.get(pa.id) as string;
      const page = byId.get(pageId);
      if (!page) {
        items.push({
          actionId: pa.id,
          source: pa.source,
          destinationId: pageId,
          status: 'missing',
          checks: [check('existence', 'missing')],
        });
        continue;
      }
      pagesFound += 1;
      const checks: FieldCheck[] = [
        page.name === pp.data.name
          ? check('name', 'verified')
          : check('name', 'mismatched', pp.data.name, page.name),
      ];
      const expectedParent =
        pp.data.parentPageAction === undefined ? undefined : idOf.get(pp.data.parentPageAction);
      const actualParent = page.parent_page_id ?? undefined;
      checks.push(
        (expectedParent ?? null) === (actualParent ?? null)
          ? check('parent', 'verified')
          : check(
              'parent',
              'mismatched',
              expectedParent ?? 'top level',
              actualParent ?? 'top level',
            ),
      );
      if (page.content === undefined || page.content === null) {
        checks.push(
          check(
            'content',
            'unverified',
            undefined,
            undefined,
            'ClickUp did not return the page content.',
          ),
        );
      } else {
        const e = normalizeMarkdownForCompare(pp.data.content);
        const a = normalizeMarkdownForCompare(page.content);
        if (e === a) checks.push(check('content', 'verified'));
        else {
          const d = firstDifference(e, a);
          checks.push(
            check(
              'content',
              'mismatched',
              d.expected,
              d.actual,
              'ClickUp Docs may re-write Markdown; compare in ClickUp.',
            ),
          );
        }
      }
      items.push({
        actionId: pa.id,
        source: pa.source,
        destinationId: pageId,
        status: worstStatus(checks),
        checks,
      });
    }
  }
  targets.push({ target: 'Docs', expected: docActions.length, found: docsFound });
  targets.push({ target: 'Doc pages', expected: pageActions.length, found: pagesFound });
  if (pageActions.length > 0)
    notes.push(
      'Docs migration is experimental; page content is compared as Markdown after whitespace normalisation.',
    );
}
