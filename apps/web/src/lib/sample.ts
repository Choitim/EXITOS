/**
 * What the guided tour says about the sample Notion workspace, read from the recorded plan. Nothing
 * is added: every name and number below is a field of the plan.
 */
import type { MigrationPlan } from '@exitos/core/schema';

export interface SampleWorkspace {
  name: string;
  /** "Notion", "ClickUp", ...: how people write the system's name. */
  systemLabel: string;
  connector: string;
  collections: Array<{ name: string; rows: number }>;
  totalRows: number;
  /** Pages selected for migration (they become ClickUp Docs, which is experimental). */
  pages: Array<{ name: string; withChildPages: boolean }>;
  experimentalDocs: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The pages of the source selection; entries that are not `{ name: string }` are ignored. */
function selectedPages(selection: unknown): SampleWorkspace['pages'] {
  if (!isRecord(selection) || !Array.isArray(selection.pages)) return [];
  const pages: SampleWorkspace['pages'] = [];
  for (const entry of selection.pages as unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== 'string') continue;
    pages.push({ name: entry.name, withChildPages: entry.includeChildPages === true });
  }
  return pages;
}

const SYSTEM_LABELS: Readonly<Record<string, string>> = { notion: 'Notion', clickup: 'ClickUp' };

export function describeSample(plan: MigrationPlan): SampleWorkspace {
  const collections = plan.collections.map((c) => ({ name: c.name, rows: c.recordCount }));
  return {
    name: plan.source.workspace.name,
    systemLabel: SYSTEM_LABELS[plan.source.workspace.system] ?? plan.source.workspace.system,
    connector: `${plan.source.connector.id}@${plan.source.connector.version}`,
    collections,
    totalRows: collections.reduce((sum, c) => sum + c.rows, 0),
    pages: selectedPages(plan.source.selection),
    experimentalDocs: plan.options.experimentalDocs === true,
  };
}
