import { sha256Hex } from '@exitos/shared';

/**
 * Builders for Notion API-shaped JSON. They mimic the documented object shapes (including fields
 * ExitOS ignores) so fixtures and tests exercise realistic payloads rather than hand-trimmed ones.
 */
export type Obj = Record<string, unknown>;

/** Deterministic UUID-shaped id from a label. */
export function uid(label: string): string {
  const h = sha256Hex(`exitos-fixture:${label}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface Annotations {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  color?: string;
}

export function rt(text: string, annotations: Annotations & { href?: string } = {}): Obj {
  const { href, ...a } = annotations;
  return {
    type: 'text',
    text: { content: text, link: href === undefined ? null : { url: href } },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
      ...a,
    },
    plain_text: text,
    href: href ?? null,
  };
}

export const richTexts = (text: string): Obj[] => (text === '' ? [] : [rt(text)]);

export function mentionUser(userId: string, name: string): Obj {
  return {
    type: 'mention',
    mention: { type: 'user', user: { object: 'user', id: userId } },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    plain_text: `@${name}`,
    href: null,
  };
}

export function mentionPage(pageId: string, title: string): Obj {
  return {
    type: 'mention',
    mention: { type: 'page', page: { id: pageId } },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    plain_text: title,
    href: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
  };
}

export function equationInline(expression: string): Obj {
  return {
    type: 'equation',
    equation: { expression },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default',
    },
    plain_text: expression,
    href: null,
  };
}

export function userObj(id: string, name: string, email?: string): Obj {
  return {
    object: 'user',
    id,
    type: 'person',
    name,
    avatar_url: null,
    ...(email === undefined ? {} : { person: { email } }),
  };
}

export const botObj = (id: string, workspaceName: string, workspaceId: string): Obj => ({
  object: 'user',
  id,
  type: 'bot',
  name: 'ExitOS integration',
  avatar_url: null,
  bot: {
    owner: { type: 'workspace', workspace: true },
    workspace_name: workspaceName,
    workspace_id: workspaceId,
    workspace_limits: { max_file_upload_size_in_bytes: 5_242_880 },
  },
});

// ---- property VALUES (page.properties[name]) ------------------------------------------------
export const value = {
  title: (id: string, text: string): Obj => ({ id, type: 'title', title: richTexts(text) }),
  richText: (id: string, text: string): Obj => ({
    id,
    type: 'rich_text',
    rich_text: richTexts(text),
  }),
  richTextSpans: (id: string, spans: Obj[]): Obj => ({ id, type: 'rich_text', rich_text: spans }),
  number: (id: string, n: number | null): Obj => ({ id, type: 'number', number: n }),
  select: (id: string, name: string | null, color = 'default'): Obj => ({
    id,
    type: 'select',
    select: name === null ? null : { id: uid(`opt:${id}:${name}`).slice(0, 8), name, color },
  }),
  status: (id: string, name: string, color = 'default'): Obj => ({
    id,
    type: 'status',
    status: { id: uid(`status:${name}`).slice(0, 8), name, color },
  }),
  multiSelect: (id: string, names: string[]): Obj => ({
    id,
    type: 'multi_select',
    multi_select: names.map((name) => ({
      id: uid(`opt:${id}:${name}`).slice(0, 8),
      name,
      color: 'default',
    })),
  }),
  date: (
    id: string,
    start: string | null,
    end: string | null = null,
    timeZone: string | null = null,
  ): Obj => ({
    id,
    type: 'date',
    date: start === null ? null : { start, end, time_zone: timeZone },
  }),
  people: (id: string, users: Obj[]): Obj => ({ id, type: 'people', people: users }),
  checkbox: (id: string, v: boolean): Obj => ({ id, type: 'checkbox', checkbox: v }),
  url: (id: string, v: string | null): Obj => ({ id, type: 'url', url: v }),
  email: (id: string, v: string | null): Obj => ({ id, type: 'email', email: v }),
  phone: (id: string, v: string | null): Obj => ({ id, type: 'phone_number', phone_number: v }),
  files: (id: string, files: Obj[]): Obj => ({ id, type: 'files', files }),
  relation: (id: string, ids: string[], hasMore = false): Obj => ({
    id,
    type: 'relation',
    relation: ids.map((i) => ({ id: i })),
    has_more: hasMore,
  }),
  formulaNumber: (id: string, n: number | null): Obj => ({
    id,
    type: 'formula',
    formula: { type: 'number', number: n },
  }),
  formulaString: (id: string, s: string): Obj => ({
    id,
    type: 'formula',
    formula: { type: 'string', string: s },
  }),
  rollupNumber: (id: string, n: number): Obj => ({
    id,
    type: 'rollup',
    rollup: { type: 'number', number: n, function: 'count' },
  }),
  createdTime: (id: string, iso: string): Obj => ({ id, type: 'created_time', created_time: iso }),
  lastEditedTime: (id: string, iso: string): Obj => ({
    id,
    type: 'last_edited_time',
    last_edited_time: iso,
  }),
  createdBy: (id: string, user: Obj): Obj => ({ id, type: 'created_by', created_by: user }),
  uniqueId: (id: string, prefix: string | null, n: number): Obj => ({
    id,
    type: 'unique_id',
    unique_id: { prefix, number: n },
  }),
  button: (id: string): Obj => ({ id, type: 'button', button: {} }),
  place: (id: string, name: string): Obj => ({
    id,
    type: 'place',
    place: { lat: 52.52, lon: 13.405, name, address: null },
  }),
};

export const hostedFile = (name: string): Obj => ({
  name,
  type: 'file',
  file: {
    url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/fixture/${encodeURIComponent(name)}?X-Amz-Signature=FIXTURE_SIGNATURE_NOT_REAL&X-Amz-Expires=3600`,
    expiry_time: '2026-10-08T13:00:00.000Z',
  },
});
export const externalFile = (name: string, url: string): Obj => ({
  name,
  type: 'external',
  external: { url },
});

// ---- property SCHEMAS (data_source.properties[name]) ----------------------------------------
export const schema = {
  title: (): Obj => ({ id: 'title', name: 'Name', type: 'title', title: {} }),
  richText: (id: string, name: string): Obj => ({ id, name, type: 'rich_text', rich_text: {} }),
  number: (id: string, name: string): Obj => ({
    id,
    name,
    type: 'number',
    number: { format: 'number' },
  }),
  select: (id: string, name: string, options: string[]): Obj => ({
    id,
    name,
    type: 'select',
    select: {
      options: options.map((n) => ({
        id: uid(`opt:${id}:${n}`).slice(0, 8),
        name: n,
        color: 'default',
      })),
    },
  }),
  multiSelect: (id: string, name: string, options: string[]): Obj => ({
    id,
    name,
    type: 'multi_select',
    multi_select: {
      options: options.map((n) => ({
        id: uid(`opt:${id}:${n}`).slice(0, 8),
        name: n,
        color: 'default',
      })),
    },
  }),
  status: (id: string, name: string, groups: Record<string, string[]>): Obj => {
    const options = Object.values(groups)
      .flat()
      .map((n) => ({ id: uid(`status:${n}`).slice(0, 8), name: n, color: 'default' }));
    return {
      id,
      name,
      type: 'status',
      status: {
        options,
        groups: Object.entries(groups).map(([groupName, names]) => ({
          id: uid(`group:${groupName}`).slice(0, 8),
          name: groupName,
          color: 'default',
          option_ids: names.map((n) => uid(`status:${n}`).slice(0, 8)),
        })),
      },
    };
  },
  simple: (id: string, name: string, type: string, config: Obj = {}): Obj => ({
    id,
    name,
    type,
    [type]: config,
  }),
  relation: (id: string, name: string, dataSourceId: string, dual = false): Obj => ({
    id,
    name,
    type: 'relation',
    relation: dual
      ? {
          data_source_id: dataSourceId,
          type: 'dual_property',
          dual_property: {
            synced_property_id: `${id}s`,
            synced_property_name: `${name} (reverse)`,
          },
        }
      : { data_source_id: dataSourceId, type: 'single_property', single_property: {} },
  }),
  formula: (id: string, name: string, expression: string): Obj => ({
    id,
    name,
    type: 'formula',
    formula: { expression },
  }),
  rollup: (id: string, name: string): Obj => ({
    id,
    name,
    type: 'rollup',
    rollup: {
      relation_property_name: 'Depends on',
      relation_property_id: 'dep',
      rollup_property_name: 'Name',
      rollup_property_id: 'title',
      function: 'count',
    },
  }),
  uniqueId: (id: string, name: string, prefix: string): Obj => ({
    id,
    name,
    type: 'unique_id',
    unique_id: { prefix },
  }),
};

// ---- objects ----------------------------------------------------------------------------------
export function dataSourceObj(args: {
  id: string;
  databaseId: string;
  title: string;
  properties: Obj[];
  url?: string;
}): Obj {
  const properties: Obj = {};
  for (const p of args.properties) properties[p.name as string] = p;
  return {
    object: 'data_source',
    id: args.id,
    title: richTexts(args.title),
    description: [],
    parent: { type: 'database_id', database_id: args.databaseId },
    database_parent: { type: 'workspace', workspace: true },
    url: args.url ?? `https://www.notion.so/${args.id.replace(/-/g, '')}`,
    properties,
    in_trash: false,
    archived: false,
  };
}

export function databaseObj(args: {
  id: string;
  title: string;
  dataSources: Array<{ id: string; name: string }>;
}): Obj {
  return {
    object: 'database',
    id: args.id,
    title: richTexts(args.title),
    url: `https://www.notion.so/${args.id.replace(/-/g, '')}`,
    is_inline: false,
    data_sources: args.dataSources,
    in_trash: false,
    archived: false,
  };
}

export function pageObj(args: {
  id: string;
  parent: Obj;
  created: string;
  edited?: string;
  properties: Record<string, Obj>;
  createdBy?: Obj;
  trashed?: boolean;
  icon?: Obj | null;
}): Obj {
  return {
    object: 'page',
    id: args.id,
    created_time: args.created,
    last_edited_time: args.edited ?? args.created,
    created_by: args.createdBy ?? { object: 'user', id: 'unknown' },
    last_edited_by: args.createdBy ?? { object: 'user', id: 'unknown' },
    cover: null,
    icon: args.icon ?? null,
    parent: args.parent,
    in_trash: args.trashed ?? false,
    archived: args.trashed ?? false,
    properties: args.properties,
    url: `https://www.notion.so/${args.id.replace(/-/g, '')}`,
    public_url: null,
  };
}

export const rowParent = (dataSourceId: string, databaseId: string): Obj => ({
  type: 'data_source_id',
  data_source_id: dataSourceId,
  database_id: databaseId,
});
export const workspaceParent = (): Obj => ({ type: 'workspace', workspace: true });
export const pageParent = (pageId: string): Obj => ({ type: 'page_id', page_id: pageId });

// ---- blocks ------------------------------------------------------------------------------------
function blockBase(
  id: string,
  type: string,
  parentId: string,
  hasChildren: boolean,
  payload: Obj,
): Obj {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: parentId },
    created_time: '2026-03-01T09:00:00.000Z',
    last_edited_time: '2026-03-01T09:00:00.000Z',
    created_by: { object: 'user', id: 'unknown' },
    last_edited_by: { object: 'user', id: 'unknown' },
    has_children: hasChildren,
    in_trash: false,
    archived: false,
    type,
    [type]: payload,
  };
}

export const block = {
  paragraph: (id: string, parent: string, spans: Obj[], children = false): Obj =>
    blockBase(id, 'paragraph', parent, children, { rich_text: spans, color: 'default' }),
  heading: (id: string, parent: string, level: 1 | 2 | 3 | 4, text: string): Obj =>
    blockBase(id, `heading_${level}`, parent, false, {
      rich_text: richTexts(text),
      color: 'default',
      is_toggleable: false,
    }),
  bullet: (id: string, parent: string, text: string, children = false): Obj =>
    blockBase(id, 'bulleted_list_item', parent, children, {
      rich_text: richTexts(text),
      color: 'default',
    }),
  numbered: (id: string, parent: string, text: string, children = false): Obj =>
    blockBase(id, 'numbered_list_item', parent, children, {
      rich_text: richTexts(text),
      color: 'default',
    }),
  todo: (id: string, parent: string, text: string, checked: boolean, children = false): Obj =>
    blockBase(id, 'to_do', parent, children, {
      rich_text: richTexts(text),
      checked,
      color: 'default',
    }),
  toggle: (id: string, parent: string, text: string, children = true): Obj =>
    blockBase(id, 'toggle', parent, children, { rich_text: richTexts(text), color: 'default' }),
  quote: (id: string, parent: string, text: string): Obj =>
    blockBase(id, 'quote', parent, false, { rich_text: richTexts(text), color: 'default' }),
  callout: (id: string, parent: string, text: string, emoji = '💡'): Obj =>
    blockBase(id, 'callout', parent, false, {
      rich_text: richTexts(text),
      icon: { type: 'emoji', emoji },
      color: 'gray_background',
    }),
  code: (id: string, parent: string, code: string, language: string, caption = ''): Obj =>
    blockBase(id, 'code', parent, false, {
      rich_text: richTexts(code),
      caption: richTexts(caption),
      language,
    }),
  divider: (id: string, parent: string): Obj => blockBase(id, 'divider', parent, false, {}),
  table: (id: string, parent: string, width: number, columnHeader = true): Obj =>
    blockBase(id, 'table', parent, true, {
      table_width: width,
      has_column_header: columnHeader,
      has_row_header: false,
    }),
  tableRow: (id: string, parent: string, cells: string[]): Obj =>
    blockBase(id, 'table_row', parent, false, { cells: cells.map((c) => richTexts(c)) }),
  columnList: (id: string, parent: string): Obj => blockBase(id, 'column_list', parent, true, {}),
  column: (id: string, parent: string): Obj => blockBase(id, 'column', parent, true, {}),
  imageExternal: (id: string, parent: string, url: string, caption = ''): Obj =>
    blockBase(id, 'image', parent, false, {
      type: 'external',
      external: { url },
      caption: richTexts(caption),
    }),
  imageHosted: (id: string, parent: string, name: string): Obj =>
    blockBase(id, 'image', parent, false, {
      type: 'file',
      file: {
        url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/fixture/${name}?X-Amz-Signature=FIXTURE_SIGNATURE_NOT_REAL`,
        expiry_time: '2026-10-08T13:00:00.000Z',
      },
      caption: richTexts(name),
    }),
  pdfHosted: (id: string, parent: string, name: string): Obj =>
    blockBase(id, 'pdf', parent, false, {
      type: 'file',
      file: {
        url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/fixture/${name}?X-Amz-Signature=FIXTURE_SIGNATURE_NOT_REAL`,
        expiry_time: '2026-10-08T13:00:00.000Z',
      },
      caption: [],
      name,
    }),
  bookmark: (id: string, parent: string, url: string, caption = ''): Obj =>
    blockBase(id, 'bookmark', parent, false, { url, caption: richTexts(caption) }),
  embed: (id: string, parent: string, url: string): Obj =>
    blockBase(id, 'embed', parent, false, { url, caption: [] }),
  equation: (id: string, parent: string, expression: string): Obj =>
    blockBase(id, 'equation', parent, false, { expression }),
  childPage: (id: string, parent: string, title: string): Obj =>
    blockBase(id, 'child_page', parent, true, { title }),
  childDatabase: (id: string, parent: string, title: string): Obj =>
    blockBase(id, 'child_database', parent, false, { title }),
  linkToPage: (id: string, parent: string, pageId: string): Obj =>
    blockBase(id, 'link_to_page', parent, false, { type: 'page_id', page_id: pageId }),
  syncedOriginal: (id: string, parent: string): Obj =>
    blockBase(id, 'synced_block', parent, true, { synced_from: null }),
  syncedCopy: (id: string, parent: string, originalId: string): Obj =>
    blockBase(id, 'synced_block', parent, true, {
      synced_from: { type: 'block_id', block_id: originalId },
    }),
  toc: (id: string, parent: string): Obj =>
    blockBase(id, 'table_of_contents', parent, false, { color: 'default' }),
  unsupported: (id: string, parent: string, blockType: string): Obj =>
    blockBase(id, 'unsupported', parent, false, { block_type: blockType }),
  meetingNotes: (id: string, parent: string): Obj =>
    blockBase(id, 'meeting_notes', parent, false, {
      title: richTexts('Weekly sync'),
      status: 'notes_ready',
    }),
};
