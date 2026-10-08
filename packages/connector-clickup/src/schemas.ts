import { z } from 'zod';

/**
 * Response schemas for the ClickUp endpoints ExitOS reads. Loose on purpose: ClickUp adds fields
 * freely; we only require what we use, and parse everything at the trust boundary.
 *
 * ClickUp returns many numbers as strings ("date_created": "1700000000000"), so ids and timestamps
 * accept either and are converted explicitly.
 */
const Id = z.union([z.string(), z.number()]).transform(String);
const Ms = z.union([z.string(), z.number()]).transform(String).nullish();

export const UserSchema = z.looseObject({
  user: z.looseObject({
    id: z.number(),
    username: z.string().nullish(),
    email: z.string().nullish(),
  }),
});

export const TeamsSchema = z.looseObject({
  teams: z.array(
    z.looseObject({
      id: Id,
      name: z.string(),
      members: z
        .array(
          z.looseObject({
            user: z.looseObject({
              id: z.number(),
              username: z.string().nullish(),
              email: z.string().nullish(),
            }),
          }),
        )
        .default([]),
    }),
  ),
});

export const SpacesSchema = z.looseObject({
  spaces: z.array(z.looseObject({ id: Id, name: z.string() })),
});

export const FoldersSchema = z.looseObject({
  folders: z.array(
    z.looseObject({
      id: Id,
      name: z.string(),
      lists: z.array(z.looseObject({ id: Id, name: z.string() })).default([]),
    }),
  ),
});

export const ListsSchema = z.looseObject({
  lists: z.array(z.looseObject({ id: Id, name: z.string() })),
});

export const StatusSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string(),
  type: z.string().optional(),
  orderindex: z.number().optional(),
});

export const ListSchema = z.looseObject({
  id: Id,
  name: z.string(),
  archived: z.boolean().optional(),
  statuses: z.array(StatusSchema).default([]),
  space: z.looseObject({ id: Id, name: z.string().optional() }).optional(),
  folder: z
    .looseObject({ id: Id, name: z.string().optional(), hidden: z.boolean().optional() })
    .nullish(),
});
export type ListInfo = z.infer<typeof ListSchema>;

export const CustomFieldDefSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  type_config: z.looseObject({}).default({}),
  required: z.boolean().optional(),
});
export type CustomFieldDef = z.infer<typeof CustomFieldDefSchema>;
export const ListFieldsSchema = z.looseObject({ fields: z.array(CustomFieldDefSchema) });

export const TagsSchema = z.looseObject({
  tags: z.array(z.looseObject({ name: z.string() })),
});

const UserRefSchema = z.looseObject({
  id: z.number(),
  username: z.string().nullish(),
  email: z.string().nullish(),
});

export const TaskSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  description: z.string().nullish(),
  text_content: z.string().nullish(),
  markdown_description: z.string().nullish(),
  status: z.looseObject({ status: z.string() }).nullish(),
  priority: z
    .looseObject({
      id: z.union([z.string(), z.number()]).optional(),
      priority: z.string().optional(),
    })
    .nullish(),
  date_created: Ms,
  due_date: Ms,
  start_date: Ms,
  assignees: z.array(UserRefSchema).default([]),
  tags: z.array(z.looseObject({ name: z.string() })).default([]),
  custom_fields: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string().optional(),
        type: z.string().optional(),
        type_config: z.looseObject({}).optional(),
        value: z.unknown().optional(),
      }),
    )
    .default([]),
  linked_tasks: z
    .array(z.looseObject({ task_id: z.string(), link_id: z.string().optional() }))
    .default([]),
  parent: z.string().nullish(),
  list: z.looseObject({ id: Id }).optional(),
});
export type TaskInfo = z.infer<typeof TaskSchema>;

export const TaskListSchema = z.looseObject({
  tasks: z.array(TaskSchema),
  last_page: z.boolean().optional(),
});

/** Create-task responses carry the full task; we only need the identity. */
export const CreatedTaskSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
});

export const LinkResultSchema = z.looseObject({
  task: z.looseObject({ id: z.string() }).optional(),
});

// ---- Docs v3 ----------------------------------------------------------------------------------
export const DocSchema = z.looseObject({
  id: z.string(),
  name: z.string().default(''),
  date_created: z.union([z.number(), z.string()]).optional(),
  parent: z.looseObject({ id: z.string(), type: z.number() }).optional(),
  deleted: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type DocInfo = z.infer<typeof DocSchema>;

export const DocSearchSchema = z.looseObject({
  docs: z.array(DocSchema).default([]),
  next_cursor: z.string().nullish(),
});

export interface PageNode {
  id: string;
  doc_id?: string | undefined;
  parent_page_id?: string | null | undefined;
  name: string;
  content?: string | null | undefined;
  date_created?: string | number | undefined;
  pages?: PageNode[] | undefined;
}

export const PageSchema: z.ZodType<PageNode> = z.lazy(() =>
  z.looseObject({
    id: z.string(),
    doc_id: z.string().optional(),
    parent_page_id: z.string().nullish(),
    name: z.string().default(''),
    content: z.string().nullish(),
    date_created: z.union([z.number(), z.string()]).optional(),
    pages: z.array(PageSchema).optional(),
  }),
);

/** `GET .../pages` returns either a bare array or an object wrapping it; accept both. */
export const PagesSchema = z.union([
  z.array(PageSchema),
  z.looseObject({ pages: z.array(PageSchema) }).transform((v) => v.pages),
]);
