import type {
  DateValue,
  EntityKey,
  FieldDefinition,
  FieldOption,
  FieldValue,
  Finding,
  UserReference,
} from '@exitos/core/sdk';
import { z } from 'zod';
import { normalizeNotionId } from './ids.js';
import {
  normalizeFile,
  normalizeRichText,
  notionDataSourceKey,
  notionPageKey,
  notionUserKey,
  plainText,
  scalarToString,
} from './normalize-text.js';
import {
  FileRawSchema,
  RichTextArraySchema,
  UserRawSchema,
  type PropertyItemRaw,
  type PropertySchemaRaw,
  type PropertyValueRaw,
  type UserRaw,
} from './raw.js';

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const OptionSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string(),
  color: z.string().optional(),
});
const GroupSchema = z.looseObject({
  name: z.string(),
  option_ids: z.array(z.string()).default([]),
});

function options(config: unknown): FieldOption[] {
  const parsed = z.array(OptionSchema).safeParse(asRecord(config).options);
  return parsed.success
    ? parsed.data.map((o) => ({
        name: o.name,
        ...(o.id === undefined ? {} : { id: o.id }),
        ...(o.color === undefined ? {} : { color: o.color }),
      }))
    : [];
}

export interface SchemaContext {
  /** Data sources selected for migration (normalised ids). Relations to others are out of scope. */
  selectedDataSourceIds: ReadonlySet<string>;
}

/** Notion property schema → normalized field definition. Unknown types become `unsupported`. */
export function fieldFromSchema(prop: PropertySchemaRaw, ctx: SchemaContext): FieldDefinition {
  const config = (prop as Record<string, unknown>)[prop.type];
  const base = { id: prop.id, name: prop.name, sourceType: prop.type };
  switch (prop.type) {
    case 'title':
      return { ...base, kind: 'title' };
    case 'rich_text':
      return { ...base, kind: 'text' };
    case 'number':
      return { ...base, kind: 'number' };
    case 'select':
      return { ...base, kind: 'select', options: options(config) };
    case 'multi_select':
      return { ...base, kind: 'multiSelect', options: options(config) };
    case 'status': {
      const opts = options(config);
      const groups = z.array(GroupSchema).safeParse(asRecord(config).groups);
      const groupOf = new Map<string, string>();
      if (groups.success) {
        for (const g of groups.data) for (const id of g.option_ids) groupOf.set(id, g.name);
      }
      return {
        ...base,
        kind: 'status',
        options: opts.map((o) => {
          const group = o.id === undefined ? undefined : groupOf.get(o.id);
          return group === undefined ? o : { ...o, group };
        }),
      };
    }
    case 'date':
      return { ...base, kind: 'date' };
    case 'checkbox':
      return { ...base, kind: 'checkbox' };
    case 'url':
      return { ...base, kind: 'url' };
    case 'email':
      return { ...base, kind: 'email' };
    case 'phone_number':
      return { ...base, kind: 'phone' };
    case 'people':
      return { ...base, kind: 'person' };
    case 'files':
      return { ...base, kind: 'files' };
    case 'relation': {
      const cfg = asRecord(config);
      const target = str(cfg.data_source_id);
      const targetId = target === undefined ? undefined : normalizeNotionId(target);
      return {
        ...base,
        kind: 'relation',
        relation: {
          ...(target === undefined ? {} : { targetCollection: notionDataSourceKey(target) }),
          targetInScope: targetId !== undefined && ctx.selectedDataSourceIds.has(targetId),
          dual: str(cfg.type) === 'dual_property',
        },
      };
    }
    case 'formula':
      return { ...base, kind: 'computed', readOnly: true, computed: { type: 'formula' } };
    case 'rollup':
      return { ...base, kind: 'computed', readOnly: true, computed: { type: 'rollup' } };
    case 'created_time':
    case 'last_edited_time':
      return { ...base, kind: 'timestamp', readOnly: true };
    case 'created_by':
    case 'last_edited_by':
      return { ...base, kind: 'userStamp', readOnly: true };
    case 'unique_id': {
      const prefix = str(asRecord(config).prefix);
      return {
        ...base,
        kind: 'uniqueId',
        readOnly: true,
        ...(prefix ? { uniqueIdPrefix: prefix } : {}),
      };
    }
    default:
      return {
        ...base,
        kind: 'unsupported',
        note: `Notion property type "${prop.type}" is not supported`,
      };
  }
}

export interface ValueContext {
  /** Key of the record the value belongs to (for attachment ownership and findings). */
  record: EntityKey;
  collection: EntityKey;
  users: ReadonlyMap<string, UserRaw>;
  /** Full property items for properties that were truncated in the page object. */
  fullItems: Readonly<Record<string, PropertyItemRaw[]>>;
  findings: Finding[];
  /** Users seen while normalising, for the snapshot's user list. */
  seenUsers: Map<string, UserReference>;
}

function userRef(raw: UserRaw, ctx: ValueContext): UserReference {
  const known = ctx.users.get(normalizeNotionId(raw.id));
  const merged = known ?? raw;
  const email = merged.person?.email ?? raw.person?.email ?? undefined;
  const name = merged.name ?? raw.name ?? undefined;
  const ref: UserReference = {
    key: notionUserKey(raw.id),
    id: normalizeNotionId(raw.id),
    type: merged.type ?? raw.type ?? 'unknown',
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
  ctx.seenUsers.set(ref.key, ref);
  return ref;
}

function dateValue(raw: unknown): DateValue | null {
  const r = asRecord(raw);
  const start = str(r.start);
  if (start === undefined) return null;
  const end = str(r.end);
  const tz = str(r.time_zone);
  return {
    start,
    ...(end === undefined ? {} : { end }),
    ...(tz === undefined ? {} : { timeZone: tz }),
  };
}

function computedDisplay(
  kind: 'formula' | 'rollup',
  payload: Record<string, unknown>,
): { display: string | null; complete: boolean } {
  const type = str(payload.type);
  if (type === undefined) return { display: null, complete: false };
  if (kind === 'formula') {
    const v = payload[type];
    if (type === 'date') return { display: dateValue(v)?.start ?? null, complete: true };
    return { display: scalarToString(v), complete: true };
  }
  // rollup
  if (type === 'incomplete' || type === 'unsupported') return { display: null, complete: false };
  if (type === 'date') return { display: dateValue(payload.date)?.start ?? null, complete: true };
  if (type === 'array') {
    const items = Array.isArray(payload.array) ? payload.array : [];
    const parts = items.slice(0, 20).map((item) => {
      const rec = asRecord(item);
      const t = str(rec.type);
      const v = t === undefined ? undefined : rec[t];
      if (t === 'title' || t === 'rich_text') {
        const parsed = RichTextArraySchema.safeParse(v);
        return parsed.success ? plainText(parsed.data) : '';
      }
      if (t === 'date') return dateValue(v)?.start ?? '';
      return scalarToString(v) ?? '';
    });
    return { display: parts.filter((p) => p !== '').join(', '), complete: items.length <= 20 };
  }
  const v = payload[type];
  return { display: scalarToString(v), complete: true };
}

/**
 * Page property value → normalized value. Never throws: a malformed value becomes `unsupported`
 * and is reported, so one odd row cannot abort an extraction.
 */
export function valueFromProperty(
  field: FieldDefinition,
  raw: PropertyValueRaw,
  ctx: ValueContext,
): FieldValue {
  const payload = (raw as Record<string, unknown>)[raw.type];
  const malformed = (): FieldValue => {
    ctx.findings.push({
      code: 'PROPERTY_VALUE_MALFORMED',
      outcome: 'unsupported',
      severity: 'warning',
      category: 'data',
      message: `The value of "${field.name}" had an unexpected shape and was not read.`,
      entity: ctx.record,
      collection: ctx.collection,
      field: field.name,
    });
    return { kind: 'unsupported', sourceType: raw.type };
  };

  switch (field.kind) {
    case 'title':
    case 'text': {
      const full = ctx.fullItems[field.id];
      const spansRaw =
        full !== undefined
          ? full
              .map((i) => (field.kind === 'title' ? i.title : i.rich_text))
              .filter((x) => x !== undefined)
          : RichTextArraySchema.safeParse(payload);
      const parsed = Array.isArray(spansRaw)
        ? { success: true as const, data: spansRaw }
        : spansRaw;
      if (!parsed.success) return malformed();
      const spans = normalizeRichText(parsed.data);
      return { kind: field.kind, text: spans.map((s) => s.text).join(''), spans };
    }
    case 'number':
      return typeof payload === 'number'
        ? { kind: 'number', value: payload }
        : payload === null || payload === undefined
          ? { kind: 'number', value: null }
          : malformed();
    case 'select': {
      if (payload === null || payload === undefined) return { kind: 'select', name: null };
      const o = OptionSchema.safeParse(payload);
      return o.success
        ? { kind: 'select', name: o.data.name, ...(o.data.id ? { id: o.data.id } : {}) }
        : malformed();
    }
    case 'status': {
      if (payload === null || payload === undefined) return { kind: 'status', name: null };
      const o = OptionSchema.safeParse(payload);
      if (!o.success) return malformed();
      const group = field.options?.find((x) => x.id !== undefined && x.id === o.data.id)?.group;
      return {
        kind: 'status',
        name: o.data.name,
        ...(o.data.id ? { id: o.data.id } : {}),
        ...(group ? { group } : {}),
      };
    }
    case 'multiSelect': {
      const parsed = z.array(OptionSchema).safeParse(payload);
      return parsed.success
        ? { kind: 'multiSelect', names: parsed.data.map((o) => o.name) }
        : malformed();
    }
    case 'date':
      return {
        kind: 'date',
        value: payload === null || payload === undefined ? null : dateValue(payload),
      };
    case 'checkbox':
      return typeof payload === 'boolean' ? { kind: 'checkbox', value: payload } : malformed();
    case 'url':
    case 'email':
    case 'phone':
      return typeof payload === 'string' || payload === null || payload === undefined
        ? { kind: field.kind, value: payload ?? null }
        : malformed();
    case 'person': {
      const full = ctx.fullItems[field.id];
      const list =
        full !== undefined
          ? full.map((i) => i.people).filter((x) => x !== undefined)
          : z.array(UserRawSchema).safeParse(payload);
      const parsed = Array.isArray(list) ? { success: true as const, data: list } : list;
      return parsed.success
        ? { kind: 'person', users: parsed.data.map((u) => userRef(u, ctx)) }
        : malformed();
    }
    case 'files': {
      const parsed = z.array(FileRawSchema).safeParse(payload);
      if (!parsed.success) return malformed();
      return {
        kind: 'files',
        attachments: parsed.data.map((f, i) => normalizeFile(f, ctx.record, field.name, i)),
      };
    }
    case 'relation': {
      const full = ctx.fullItems[field.id];
      const ids =
        full !== undefined
          ? full.map((i) => i.relation?.id).filter((x): x is string => x !== undefined)
          : z
              .array(z.looseObject({ id: z.string() }))
              .safeParse(payload)
              .data?.map((r) => r.id);
      if (ids === undefined) return malformed();
      const truncated = full === undefined && asRecord(raw).has_more === true;
      return {
        kind: 'relation',
        targets: ids.map((id) => ({ key: notionPageKey(id) })),
        ...(truncated ? { truncated: true } : {}),
      };
    }
    case 'computed': {
      const type = field.computed?.type ?? 'formula';
      const { display, complete } = computedDisplay(type, asRecord(payload));
      return { kind: 'computed', computedType: type, display, complete };
    }
    case 'timestamp':
      return { kind: 'timestamp', iso: typeof payload === 'string' ? payload : null };
    case 'userStamp': {
      const u = UserRawSchema.safeParse(payload);
      return { kind: 'userStamp', user: u.success ? userRef(u.data, ctx) : null };
    }
    case 'uniqueId': {
      const p = asRecord(payload);
      const number = typeof p.number === 'number' ? p.number : null;
      const prefix = str(p.prefix) ?? null;
      return {
        kind: 'uniqueId',
        prefix,
        number,
        display: number === null ? null : prefix ? `${prefix}-${number}` : String(number),
      };
    }
    case 'unsupported':
      return { kind: 'unsupported', sourceType: raw.type };
  }
}
