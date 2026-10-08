import {
  type Collection,
  type DataRecord,
  type FieldDefinition,
  type FieldKind,
  type FieldValue,
  type Finding,
  type JsonValue,
  type MappingRule,
  type Outcome,
  type UserReference,
  type UsersConfig,
} from '@exitos/core';
import { stableId } from '@exitos/shared';
import type { FieldMapping, ListMapping } from './config.js';
import {
  canon,
  convertDate,
  priorityFrom,
  valueToMarkdown,
  valueToPlain,
  validEmail,
  validPhone,
  validUrl,
  type Instant,
} from './convert.js';
import type { ListInspection } from './inspection.js';
import type { UserResolver } from './users.js';

export interface TaskDraft {
  status?: string;
  priority?: 1 | 2 | 3 | 4;
  due?: Instant;
  start?: Instant;
  assignees: number[];
  tags: string[];
  customFields: Array<{ id: string; value: JsonValue; time?: boolean }>;
  /** "Properties from Notion" rows for values with no first-class destination. */
  rows: Array<{ label: string; markdown: string }>;
  createdAt?: string;
  findings: Finding[];
}

export const newDraft = (): TaskDraft => ({
  assignees: [],
  tags: [],
  customFields: [],
  rows: [],
  findings: [],
});

export interface Env {
  timezone: string;
  users: UserResolver;
  unmappedPeople: UsersConfig['unmapped'];
  unmappedFields: 'description' | 'skip';
  titleOfRecord: (key: string) => string | undefined;
  recordInScope: (key: string) => boolean;
  relations: 'link' | 'skip';
}

export interface FieldPlan {
  rule: MappingRule;
  field: FieldDefinition;
  /** Applies one record's value to the task being built. */
  apply(draft: TaskDraft, value: FieldValue | undefined, record: DataRecord): void;
}

export interface FieldPlanResult {
  plans: FieldPlan[];
  /** Mapping problems that must stop `apply` (severity error). */
  errors: Finding[];
}

type Core = Pick<Finding, 'code' | 'outcome' | 'severity' | 'category' | 'message'>;

const note = (draft: TaskDraft, record: DataRecord, field: string, f: Core): void => {
  draft.findings.push({ ...f, entity: record.key, collection: record.collection, field });
};

const err = (collection: Collection, code: string, message: string, field?: string): Finding => ({
  code,
  outcome: 'unsupported',
  severity: 'error',
  category: 'destination',
  message,
  collection: collection.key,
  ...(field === undefined ? {} : { field }),
});

// ---- what each source kind may be mapped to -----------------------------------------------------
const TARGET_KINDS: Record<
  Exclude<FieldMapping['to'], 'custom_field' | 'description' | 'skip'>,
  FieldKind[]
> = {
  status: ['status', 'select'],
  priority: ['select', 'status'],
  due_date: ['date'],
  start_date: ['date'],
  assignees: ['person'],
  tags: ['multiSelect', 'select'],
};

const CUSTOM_FIELD_TYPES: Partial<Record<FieldKind, string[]>> = {
  title: ['short_text', 'text'],
  text: ['text', 'short_text'],
  number: ['number', 'currency'],
  select: ['drop_down', 'short_text', 'text'],
  status: ['drop_down', 'short_text', 'text'],
  multiSelect: ['labels'],
  date: ['date'],
  checkbox: ['checkbox'],
  url: ['url', 'short_text', 'text'],
  email: ['email', 'short_text', 'text'],
  phone: ['phone', 'short_text', 'text'],
};

type SimpleTarget = keyof typeof TARGET_KINDS;

/** Notion status group → ClickUp status types that mean the same thing (used for suggestions only). */
const STATUS_GROUP_TYPES: Record<string, string[]> = {
  'to do': ['open'],
  'in progress': ['custom', 'active'],
  complete: ['closed', 'done'],
};

/** What to do with a field when the config says nothing: sensible, conservative inference. */
function infer(
  field: FieldDefinition,
  siblings: readonly FieldDefinition[],
  taken: ReadonlySet<string>,
): FieldMapping | undefined {
  const name = field.name;
  const free = (t: SimpleTarget): boolean => !taken.has(t);
  switch (field.kind) {
    case 'status':
      return free('status') ? { to: 'status' } : undefined;
    case 'select':
      return /prio/i.test(name) && free('priority') ? { to: 'priority' } : undefined;
    case 'date': {
      const dates = siblings.filter((f) => f.kind === 'date');
      if (/(^|\W)(start|begin|from|kickoff)/i.test(name) && free('start_date'))
        return { to: 'start_date' };
      if (/(^|\W)(due|deadline|end|finish|target)/i.test(name) && free('due_date'))
        return { to: 'due_date' };
      if (dates.length === 1 && free('due_date')) return { to: 'due_date' };
      return undefined;
    }
    case 'person':
      return /(owner|assign|responsible|lead|dri)/i.test(name) && free('assignees')
        ? { to: 'assignees' }
        : undefined;
    case 'multiSelect':
      return /(tag|label)/i.test(name) && free('tags') ? { to: 'tags' } : undefined;
    default:
      return undefined;
  }
}

export interface PlanFieldsInput {
  collection: Collection;
  list: ListInspection;
  mapping: ListMapping;
  env: Env;
}

/**
 * Decide, for every source field, where it goes in ClickUp — and how faithfully — before looking at
 * any record. Misconfiguration is returned as `errors` (blocking), never guessed around.
 */
export function planFields(input: PlanFieldsInput): FieldPlanResult {
  const { collection, list, mapping, env } = input;
  const errors: Finding[] = [];
  const plans: FieldPlan[] = [];
  const fieldsByName = new Map(collection.fields.map((f) => [f.name, f]));

  for (const configured of Object.keys(mapping.fields)) {
    if (!fieldsByName.has(configured)) {
      errors.push(
        err(
          collection,
          'MAPPING_UNKNOWN_FIELD',
          `The mapping for "${configured}" does not match any property of "${collection.name}". Available: ${collection.fields.map((f) => f.name).join(', ')}.`,
          configured,
        ),
      );
    }
  }

  const taken = new Map<string, string>(); // simple target -> field name
  const takeTarget = (target: string, fieldName: string): boolean => {
    const prev = taken.get(target);
    if (prev !== undefined && prev !== fieldName) {
      errors.push(
        err(
          collection,
          'MAPPING_TARGET_CONFLICT',
          `Both "${prev}" and "${fieldName}" are mapped to ${target}; a task has only one.`,
          fieldName,
        ),
      );
      return false;
    }
    taken.set(target, fieldName);
    return true;
  };

  // Explicit mappings claim their targets first, so inference never steals them.
  for (const field of collection.fields) {
    const explicit = mapping.fields[field.name];
    if (explicit && explicit.to in TARGET_KINDS) takeTarget(explicit.to, field.name);
  }

  const mk = (
    field: FieldDefinition,
    target: MappingRule['target'],
    transform: MappingRule['transform'],
    outcome: Outcome,
    reason: string,
    explicit: boolean,
    extra: Partial<Pick<MappingRule, 'valueMap' | 'unmappedValues'>> = {},
  ): MappingRule => ({
    id: stableId('map', collection.key, field.id),
    collection: collection.key,
    source: { fieldId: field.id, name: field.name, kind: field.kind, sourceType: field.sourceType },
    target,
    transform,
    outcome,
    reason,
    explicit,
    ...extra,
  });

  for (const field of collection.fields) {
    // ---- title ---------------------------------------------------------------------------
    if (field.kind === 'title') {
      plans.push({
        field,
        rule: mk(
          field,
          { kind: 'name' },
          'direct',
          'supported',
          'The title becomes the task name.',
          false,
        ),
        apply() {
          /* the record title is used directly */
        },
      });
      continue;
    }

    const explicit = mapping.fields[field.name];

    // ---- relations -----------------------------------------------------------------------
    if (field.kind === 'relation') {
      if (explicit && explicit.to !== 'skip') {
        errors.push(
          err(
            collection,
            'MAPPING_INCOMPATIBLE',
            `"${field.name}" is a relation; configure list.relations (link|skip) instead of a field mapping.`,
            field.name,
          ),
        );
      }
      plans.push(relationPlan(field, mk, env, explicit?.to === 'skip'));
      continue;
    }

    // ---- unsupported source types --------------------------------------------------------
    if (field.kind === 'unsupported') {
      plans.push({
        field,
        rule: mk(
          field,
          { kind: 'dropped' },
          'none',
          'unsupported',
          `Property type "${field.sourceType}" has no portable representation, so it is not read or migrated.`,
          false,
        ),
        apply() {
          /* reported by the source connector */
        },
      });
      continue;
    }

    // ---- explicit skip -------------------------------------------------------------------
    if (explicit?.to === 'skip') {
      plans.push({
        field,
        rule: mk(
          field,
          { kind: 'dropped' },
          'none',
          'skipped',
          'Skipped because the configuration says so (to: skip).',
          true,
        ),
        apply(draft, value, record) {
          if (valueToPlain(value) !== undefined) {
            note(draft, record, field.name, {
              code: 'FIELD_EXPLICITLY_SKIPPED',
              outcome: 'skipped',
              severity: 'info',
              category: 'field_type',
              message: 'Skipped by configuration; the value is not migrated.',
            });
          }
        },
      });
      continue;
    }

    const chosen: FieldMapping | undefined =
      explicit ?? infer(field, collection.fields, new Set(taken.keys()));
    const isExplicit = explicit !== undefined;

    if (chosen && chosen.to in TARGET_KINDS) {
      const target = chosen.to as SimpleTarget;
      if (!TARGET_KINDS[target].includes(field.kind)) {
        errors.push(
          err(
            collection,
            'MAPPING_INCOMPATIBLE',
            `"${field.name}" is a ${field.sourceType} property and cannot be mapped to ${target}.`,
            field.name,
          ),
        );
        continue;
      }
      if (!isExplicit && !takeTarget(target, field.name)) continue;
      const plan = simpleTargetPlan(
        field,
        target,
        chosen,
        isExplicit,
        list,
        collection,
        env,
        mk,
        errors,
      );
      if (plan) plans.push(plan);
      continue;
    }

    if (chosen?.to === 'custom_field') {
      const plan = customFieldPlan(field, chosen, list, collection, env, mk, errors);
      if (plan) plans.push(plan);
      continue;
    }

    // ---- explicit description or no mapping: keep the value as text -----------------------
    plans.push(textPlan(field, isExplicit, env, mk));
  }

  return { plans, errors };
}

type Mk = (
  field: FieldDefinition,
  target: MappingRule['target'],
  transform: MappingRule['transform'],
  outcome: Outcome,
  reason: string,
  explicit: boolean,
  extra?: Partial<Pick<MappingRule, 'valueMap' | 'unmappedValues'>>,
) => MappingRule;

// ---- relations --------------------------------------------------------------------------------
function relationPlan(field: FieldDefinition, mk: Mk, env: Env, skipExplicit: boolean): FieldPlan {
  if (env.relations === 'link' && !skipExplicit) {
    return {
      field,
      rule: mk(
        field,
        { kind: 'link' },
        'direct',
        'transformed',
        'Relations between migrated items become ClickUp linked tasks. Links are symmetric, so the direction of the relation is not kept.',
        false,
      ),
      apply(draft, value, record) {
        if (value?.kind !== 'relation') return;
        const outside = value.targets.filter((t) => !env.recordInScope(t.key));
        if (outside.length > 0) {
          note(draft, record, field.name, {
            code: 'RELATION_TARGET_OUT_OF_SCOPE',
            outcome: 'unsupported',
            severity: 'warning',
            category: 'relation',
            message:
              'A related item is not part of this migration, so no link can be created; its identifier is kept in the description.',
          });
          draft.rows.push({
            label: `${field.name} (not migrated)`,
            markdown: outside.map((t) => t.key).join(', '),
          });
        }
        if (value.targets.length > outside.length) {
          note(draft, record, field.name, {
            code: 'RELATION_AS_LINK',
            outcome: 'transformed',
            severity: 'info',
            category: 'relation',
            message: 'Relation becomes a ClickUp linked task (symmetric; direction not kept).',
          });
        }
      },
    };
  }
  return {
    field,
    rule: mk(
      field,
      { kind: 'description_table' },
      'text',
      env.relations === 'skip' && !skipExplicit ? 'transformed' : 'skipped',
      'Relations are not linked (relations: skip); the related item titles are kept as text in the description.',
      skipExplicit,
    ),
    apply(draft, value, record) {
      const md = valueToMarkdown(value, field, record, env.titleOfRecord);
      if (md) {
        draft.rows.push({ label: field.name, markdown: md.markdown });
        note(draft, record, field.name, {
          code: 'RELATION_AS_TEXT',
          outcome: 'transformed',
          severity: 'info',
          category: 'relation',
          message: 'Relation kept as text; no link was created.',
        });
      }
    },
  };
}

// ---- status / priority / dates / assignees / tags ------------------------------------------------
function simpleTargetPlan(
  field: FieldDefinition,
  target: SimpleTarget,
  chosen: FieldMapping,
  explicit: boolean,
  list: ListInspection,
  collection: Collection,
  env: Env,
  mk: Mk,
  errors: Finding[],
): FieldPlan | undefined {
  switch (target) {
    case 'status': {
      const statuses = new Map(list.statuses.map((s) => [canon(s.status), s.status]));
      const valueMap = new Map<string, string>();
      for (const [from, to] of Object.entries(chosen.valueMap ?? {})) {
        const real = statuses.get(canon(String(to)));
        if (real === undefined) {
          errors.push(
            err(
              collection,
              'MAPPING_STATUS_UNKNOWN',
              `valueMap sends "${from}" to status "${String(to)}", which does not exist on list "${list.name}". Statuses: ${list.statuses.map((s) => s.status).join(', ')}.`,
              field.name,
            ),
          );
        } else valueMap.set(canon(from), real);
      }
      const resolve = (name: string): string | undefined =>
        valueMap.get(canon(name)) ?? statuses.get(canon(name));
      const options = (field.options ?? []).map((o) => o.name);
      const unmapped = options.filter((o) => resolve(o) === undefined);
      // Suggest (never apply) a status of the same kind when the source option has a status group.
      const suggestions = unmapped.flatMap((name) => {
        const group = (field.options ?? []).find((o) => o.name === name)?.group;
        const types = group === undefined ? undefined : STATUS_GROUP_TYPES[canon(group)];
        const candidates =
          types === undefined
            ? []
            : list.statuses.filter((s) => s.type !== null && types.includes(s.type));
        return candidates.length === 1 ? [`"${name}": "${candidates[0]?.status ?? ''}"`] : [];
      });
      return {
        field,
        rule: mk(
          field,
          { kind: 'status' },
          explicit && chosen.valueMap ? 'value_map' : 'name_match',
          unmapped.length === 0 ? 'supported' : 'lossy',
          unmapped.length === 0
            ? `Every option matches a status of list "${list.name}".`
            : `${unmapped.length} option(s) have no matching status on list "${list.name}" (${unmapped.join(', ')}); those tasks get the list's default status and keep the original value in the description. Add them to valueMap to fix${suggestions.length > 0 ? `, e.g. valueMap: { ${suggestions.join(', ')} }` : ''}.`,
          explicit,
          {
            valueMap: Object.fromEntries(
              options.flatMap((o) => (resolve(o) === undefined ? [] : [[o, resolve(o) as string]])),
            ),
            ...(unmapped.length === 0 ? {} : { unmappedValues: unmapped }),
          },
        ),
        apply(draft, value, record) {
          if (value?.kind !== 'status' && value?.kind !== 'select') return;
          if (value.name === null) return;
          const status = resolve(value.name);
          if (status !== undefined) draft.status = status;
          else {
            draft.rows.push({ label: field.name, markdown: value.name });
            note(draft, record, field.name, {
              code: 'STATUS_VALUE_UNMAPPED',
              outcome: 'lossy',
              severity: 'warning',
              category: 'field_type',
              message: `Status "${value.name}" has no equivalent on the ClickUp list; the task gets the list's default status and the original value is kept in the description.`,
            });
          }
        },
      };
    }

    case 'priority': {
      const map = new Map<string, 1 | 2 | 3 | 4>();
      for (const [from, to] of Object.entries(chosen.valueMap ?? {})) {
        const p = priorityFrom(to);
        if (p === undefined) {
          errors.push(
            err(
              collection,
              'MAPPING_PRIORITY_UNKNOWN',
              `valueMap sends "${from}" to priority "${String(to)}"; use 1–4 or urgent/high/normal/low.`,
              field.name,
            ),
          );
        } else map.set(canon(from), p);
      }
      const resolve = (name: string): 1 | 2 | 3 | 4 | undefined =>
        map.get(canon(name)) ?? priorityFrom(name);
      const options = (field.options ?? []).map((o) => o.name);
      const unmapped = options.filter((o) => resolve(o) === undefined);
      return {
        field,
        rule: mk(
          field,
          { kind: 'priority' },
          chosen.valueMap ? 'value_map' : 'name_match',
          unmapped.length === 0 ? 'transformed' : 'lossy',
          unmapped.length === 0
            ? 'Mapped to ClickUp priorities (1 Urgent … 4 Low). ClickUp priorities cannot be customised.'
            : `${unmapped.length} option(s) have no ClickUp priority (urgent/high/normal/low); add them to valueMap.`,
          explicit,
          {
            valueMap: Object.fromEntries(
              options.flatMap((o) => (resolve(o) === undefined ? [] : [[o, resolve(o) as number]])),
            ),
            ...(unmapped.length === 0 ? {} : { unmappedValues: unmapped }),
          },
        ),
        apply(draft, value, record) {
          if ((value?.kind !== 'select' && value?.kind !== 'status') || value.name === null) return;
          const p = resolve(value.name);
          if (p !== undefined) draft.priority = p;
          else {
            draft.rows.push({ label: field.name, markdown: value.name });
            note(draft, record, field.name, {
              code: 'PRIORITY_VALUE_UNMAPPED',
              outcome: 'lossy',
              severity: 'warning',
              category: 'field_type',
              message: `Priority "${value.name}" has no ClickUp equivalent; the task has no priority and the original value is kept in the description.`,
            });
          }
        },
      };
    }

    case 'due_date':
    case 'start_date':
      return {
        field,
        rule: mk(
          field,
          { kind: target },
          'epoch_ms',
          'supported',
          `Converted to a ClickUp ${target === 'due_date' ? 'due' : 'start'} date. Date-only values use ClickUp's 04:00 convention in ${env.timezone}; date-times become exact instants.${target === 'due_date' ? ' A range sets both start and due dates.' : ''}`,
          explicit,
        ),
        apply(draft, value, record) {
          if (value?.kind !== 'date' || value.value === null) return;
          const converted = convertDate(value.value, env.timezone);
          for (const f of converted.findings) note(draft, record, field.name, f);
          if (converted.invalid || converted.start === undefined) {
            draft.rows.push({ label: field.name, markdown: valueToPlain(value) ?? '' });
            return;
          }
          if (target === 'due_date') {
            if (converted.end) {
              draft.due = converted.end;
              if (draft.start === undefined) draft.start = converted.start;
              else
                note(draft, record, field.name, {
                  code: 'DATE_RANGE_START_LOST',
                  outcome: 'lossy',
                  severity: 'warning',
                  category: 'data',
                  message:
                    'The start of a date range could not be set because another property already provides the start date.',
                });
            } else draft.due = converted.start;
          } else {
            draft.start = converted.start;
            if (converted.end) {
              if (draft.due === undefined) draft.due = converted.end;
              else
                note(draft, record, field.name, {
                  code: 'DATE_RANGE_END_LOST',
                  outcome: 'lossy',
                  severity: 'warning',
                  category: 'data',
                  message:
                    'The end of a date range could not be set because another property already provides the due date.',
                });
            }
          }
        },
      };

    case 'assignees':
      return {
        field,
        rule: mk(
          field,
          { kind: 'assignees' },
          'user_map',
          'transformed',
          'People are assigned only if you map them in users.map (Notion and ClickUp ids are unrelated). Unmapped people are never assigned; their names are kept in the description. Assigning notifies people in ClickUp.',
          explicit,
        ),
        apply(draft, value, record) {
          if (value?.kind !== 'person') return;
          const unmapped: UserReference[] = [];
          for (const user of value.users) {
            const r = env.users.resolve(user);
            if (r) {
              if (!draft.assignees.includes(r.id)) draft.assignees.push(r.id);
            } else unmapped.push(user);
          }
          if (unmapped.length > 0) {
            note(draft, record, field.name, {
              code: 'USER_UNMAPPED',
              outcome: 'lossy',
              severity: 'warning',
              category: 'user_mapping',
              message: 'A person has no ClickUp mapping (users.map), so they are not assigned.',
            });
            if (env.unmappedPeople === 'description') {
              draft.rows.push({
                label: `${field.name} (Notion)`,
                markdown: unmapped.map((u) => u.name ?? u.email ?? u.id).join(', '),
              });
            }
          }
        },
      };

    case 'tags': {
      const spaceTags = new Map(list.spaceTags.map((t) => [canon(t), t]));
      return {
        field,
        rule: mk(
          field,
          { kind: 'tags' },
          'name_match',
          'transformed',
          'Mapped to ClickUp tags that already exist in the Space (ExitOS does not create tags). Missing tags are kept as text in the description.',
          explicit,
        ),
        apply(draft, value, record) {
          const names =
            value?.kind === 'multiSelect'
              ? value.names
              : value?.kind === 'select' && value.name !== null
                ? [value.name]
                : [];
          const missing: string[] = [];
          for (const name of names) {
            const real = spaceTags.get(canon(name));
            if (real !== undefined) {
              if (!draft.tags.includes(real)) draft.tags.push(real);
            } else missing.push(name);
          }
          if (missing.length > 0) {
            note(draft, record, field.name, {
              code: 'TAG_NOT_IN_SPACE',
              outcome: 'lossy',
              severity: 'warning',
              category: 'field_type',
              message:
                'A tag does not exist in the ClickUp Space, so it was not applied; it is kept as text in the description. Create the tag in ClickUp and re-plan.',
            });
            draft.rows.push({
              label: `${field.name} (not in ClickUp)`,
              markdown: missing.join(', '),
            });
          }
        },
      };
    }
  }
}

// ---- custom fields ---------------------------------------------------------------------------------
function customFieldPlan(
  field: FieldDefinition,
  chosen: FieldMapping,
  list: ListInspection,
  collection: Collection,
  env: Env,
  mk: Mk,
  errors: Finding[],
): FieldPlan | undefined {
  if (chosen.field === undefined) {
    errors.push(
      err(
        collection,
        'MAPPING_CUSTOM_FIELD_UNKNOWN',
        `"${field.name}" is mapped to custom_field but no \`field\` (name or id) is given.`,
        field.name,
      ),
    );
    return undefined;
  }
  const wanted = chosen.field.trim();
  const target =
    list.fields.find((f) => f.id === wanted) ??
    list.fields.find((f) => canon(f.name) === canon(wanted));
  if (!target) {
    errors.push(
      err(
        collection,
        'MAPPING_CUSTOM_FIELD_UNKNOWN',
        `List "${list.name}" has no Custom Field "${wanted}". ClickUp's API cannot create fields — create it in ClickUp first. Existing: ${list.fields.map((f) => f.name).join(', ') || '(none)'}.`,
        field.name,
      ),
    );
    return undefined;
  }
  const allowed = CUSTOM_FIELD_TYPES[field.kind] ?? [];
  if (!allowed.includes(target.type)) {
    errors.push(
      err(
        collection,
        'MAPPING_CUSTOM_FIELD_TYPE',
        `Cannot store a ${field.sourceType} property in the ${target.type} Custom Field "${target.name}". Compatible types: ${allowed.join(', ') || 'none'}.`,
        field.name,
      ),
    );
    return undefined;
  }

  const optionByName = new Map(target.options.map((o) => [canon(o.name), o.id]));
  const options = (field.options ?? []).map((o) => o.name);
  const choiceType = target.type === 'drop_down' || target.type === 'labels';
  const unmapped = choiceType ? options.filter((o) => !optionByName.has(canon(o))) : [];
  const identical =
    (field.kind === 'number' && target.type === 'number') ||
    (field.kind === 'checkbox' && target.type === 'checkbox') ||
    (field.kind === 'date' && target.type === 'date') ||
    (field.kind === 'url' && target.type === 'url') ||
    (field.kind === 'email' && target.type === 'email') ||
    (field.kind === 'phone' && target.type === 'phone');
  const outcome: Outcome =
    unmapped.length > 0 ? 'lossy' : identical || choiceType ? 'supported' : 'transformed';
  const customField = { id: target.id, name: target.name, type: target.type };

  return {
    field,
    rule: mk(
      field,
      { kind: 'custom_field', customField },
      choiceType ? 'name_match' : 'direct',
      outcome,
      unmapped.length > 0
        ? `${unmapped.length} option(s) do not exist in Custom Field "${target.name}"; those values are kept as text in the description.`
        : identical || choiceType
          ? `Stored in the existing ${target.type} Custom Field "${target.name}".`
          : `Stored as plain text in the Custom Field "${target.name}" (formatting is not kept).`,
      true,
      unmapped.length > 0 ? { unmappedValues: unmapped } : {},
    ),
    apply(draft, value, record) {
      const set = (v: JsonValue, time?: boolean): void => {
        draft.customFields.push({
          id: target.id,
          value: v,
          ...(time === undefined ? {} : { time }),
        });
      };
      const fallback = (code: string, message: string): void => {
        note(draft, record, field.name, {
          code,
          outcome: 'lossy',
          severity: 'warning',
          category: 'field_type',
          message,
        });
        const md = valueToMarkdown(value, field, record, env.titleOfRecord);
        if (md) draft.rows.push({ label: field.name, markdown: md.markdown });
      };
      if (value === undefined) return;
      switch (target.type) {
        case 'number':
        case 'currency':
          if (value.kind === 'number' && value.value !== null) set(value.value);
          return;
        case 'checkbox':
          if (value.kind === 'checkbox') set(value.value);
          return;
        case 'date': {
          if (value.kind !== 'date' || value.value === null) return;
          const c = convertDate(value.value, env.timezone);
          for (const f of c.findings) note(draft, record, field.name, f);
          if (c.start) set(c.start.ms, c.start.time);
          else
            fallback(
              'DATE_UNPARSEABLE',
              'A date could not be parsed; kept as text in the description.',
            );
          return;
        }
        case 'url':
        case 'email':
        case 'phone': {
          const text = valueToPlain(value);
          if (text === undefined || text === '') return;
          const ok =
            target.type === 'url'
              ? validUrl(text)
              : target.type === 'email'
                ? validEmail(text)
                : validPhone(text);
          if (ok) set(text);
          else
            fallback(
              'CUSTOM_FIELD_VALUE_INVALID',
              `The value is not a valid ${target.type} for ClickUp${target.type === 'phone' ? ' (a country code such as +49 is required)' : ''}; kept as text in the description.`,
            );
          return;
        }
        case 'drop_down': {
          const name =
            value.kind === 'select' || value.kind === 'status' ? value.name : valueToPlain(value);
          if (name === null || name === undefined || name === '') return;
          const id = optionByName.get(canon(name));
          if (id !== undefined) set(id);
          else
            fallback(
              'OPTION_VALUE_UNMAPPED',
              `"${name}" is not an option of the ClickUp dropdown "${target.name}" (ExitOS cannot add options); kept as text in the description.`,
            );
          return;
        }
        case 'labels': {
          if (value.kind !== 'multiSelect' || value.names.length === 0) return;
          const ids: string[] = [];
          const missing: string[] = [];
          for (const n of value.names) {
            const id = optionByName.get(canon(n));
            if (id === undefined) missing.push(n);
            else ids.push(id);
          }
          if (ids.length > 0) set(ids);
          if (missing.length > 0) {
            note(draft, record, field.name, {
              code: 'OPTION_VALUE_UNMAPPED',
              outcome: 'lossy',
              severity: 'warning',
              category: 'field_type',
              message:
                'A label is not an option of the ClickUp labels field; kept as text in the description.',
            });
            draft.rows.push({
              label: `${field.name} (not in ClickUp)`,
              markdown: missing.join(', '),
            });
          }
          return;
        }
        default: {
          const text = valueToPlain(value);
          if (text !== undefined && text !== '') set(text);
        }
      }
    },
  };
}

// ---- everything else: keep it, visibly -------------------------------------------------------------
function textPlan(field: FieldDefinition, explicit: boolean, env: Env, mk: Mk): FieldPlan {
  const keep = env.unmappedFields === 'description' || explicit;
  const lossyKinds: FieldKind[] = ['computed', 'timestamp', 'userStamp', 'files'];
  const lossy = lossyKinds.includes(field.kind);

  if (!keep) {
    return {
      field,
      rule: mk(
        field,
        { kind: 'dropped' },
        'none',
        'unsupported',
        'No ClickUp field is mapped and unmappedFields is "skip", so the value is not migrated.',
        false,
      ),
      apply(draft, value, record) {
        if (valueToPlain(value) !== undefined) {
          note(draft, record, field.name, {
            code: 'FIELD_DROPPED',
            outcome: 'unsupported',
            severity: 'warning',
            category: 'field_type',
            message:
              'No ClickUp field is mapped and unmappedFields is "skip"; the value is not migrated.',
          });
        }
      },
    };
  }

  const reason =
    field.kind === 'computed'
      ? 'ClickUp has no formulas/rollups it can be given: the last computed value is kept as static text.'
      : field.kind === 'timestamp' || field.kind === 'userStamp'
        ? 'ClickUp sets creation/edit metadata itself; the original value is kept as text.'
        : field.kind === 'files'
          ? 'File names (and external links) are kept; Notion-hosted files are not downloaded or re-uploaded.'
          : 'No ClickUp field is mapped, so the value is kept as text in the task description.';
  return {
    field,
    rule: mk(
      field,
      { kind: 'description_table' },
      'text',
      lossy ? 'lossy' : 'transformed',
      reason,
      explicit,
    ),
    apply(draft, value, record) {
      const md = valueToMarkdown(value, field, record, env.titleOfRecord);
      if (!md) return;
      draft.findings.push(...md.findings);
      draft.rows.push({ label: field.name, markdown: md.markdown });
      const snapshot = field.kind === 'computed';
      note(draft, record, field.name, {
        code: snapshot
          ? 'FIELD_SNAPSHOT_ONLY'
          : field.kind === 'timestamp' || field.kind === 'userStamp'
            ? 'METADATA_AS_TEXT'
            : 'FIELD_PRESERVED_AS_TEXT',
        outcome: lossy && field.kind !== 'files' ? 'lossy' : 'transformed',
        severity: lossy && field.kind !== 'files' ? 'warning' : 'info',
        category: 'field_type',
        message: snapshot
          ? 'Formula/rollup logic is not migrated; only the last computed value is kept as static text.'
          : field.kind === 'timestamp' || field.kind === 'userStamp'
            ? 'Creation/edit metadata cannot be set in ClickUp; kept as text in the description.'
            : 'Kept as text in the description because no ClickUp field is mapped.',
      });
    },
  };
}
