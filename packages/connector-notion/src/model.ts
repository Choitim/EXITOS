import type { Finding } from '@exitos/core/sdk';
import type { BlockRaw, DataSourceRaw, PageRaw, PropertyItemRaw, UserRaw } from './raw.js';

/** A block with its (recursively fetched) children. */
export interface BlockNode {
  block: BlockRaw;
  children: BlockNode[];
  /**
   * ok            children fetched (or none exist)
   * inaccessible  children exist but the integration cannot read them (404/403)
   * depth_limit   not expanded: maxBlockDepth reached
   * budget        not expanded: maxBlocksPerPage reached
   */
  status: 'ok' | 'inaccessible' | 'depth_limit' | 'budget';
  /** For a duplicated synced block: the id of the original whose children were fetched. */
  syncedFrom?: string;
}

export interface PageBundle {
  page: PageRaw;
  blocks: BlockNode[];
  bodyStatus: 'ok' | 'inaccessible' | 'skipped';
  /** Complete item lists for paginated properties that were truncated in the page object. */
  fullItems: Record<string, PropertyItemRaw[]>;
  blockCount: number;
  /** More blocks existed than limits.maxBlocksPerPage allows reading. */
  blocksTruncated?: boolean;
}

export interface DataSourceBundle {
  schema: DataSourceRaw;
  pages: PageBundle[];
  incomplete: boolean;
  incompleteReason?: string;
  bodies: boolean;
}

export interface StandalonePageBundle {
  bundle: PageBundle;
  parentId?: string;
  depth: number;
}

/** Everything `extract` read, still in Notion's shape (plus the findings made while reading). */
export interface NotionRaw {
  extractedAt: string;
  workspace: { id: string; name: string };
  dataSources: DataSourceBundle[];
  pages: StandalonePageBundle[];
  users: UserRaw[];
  userDirectory: 'available' | 'forbidden' | 'not_needed';
  findings: Finding[];
  requests: number;
}
