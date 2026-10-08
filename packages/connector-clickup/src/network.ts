import type { NetworkPolicy } from '@exitos/core/sdk';
import type { RequestClassifier } from '@exitos/shared';

/** Base URL INCLUDING `/api`: v2 paths are `/v2/...`, v3 (Docs) paths are `/v3/...`. */
export const CLICKUP_API_BASE = 'https://api.clickup.com/api';

const ID = '[A-Za-z0-9_-]+';

/**
 * The only writes ExitOS ever performs on ClickUp. Anything else that is not a GET — DELETE, PUT,
 * PATCH, updating or moving existing items — is classified `unknown` and refused even in
 * read-write mode (ADR 0006): v0.1 never deletes or overwrites destination content.
 */
const WRITE_ENDPOINTS: ReadonlyArray<RegExp> = [
  new RegExp(`^/api/v2/list/${ID}/task$`), // create task
  new RegExp(`^/api/v2/task/${ID}/link/${ID}$`), // link two tasks
  new RegExp(`^/api/v3/workspaces/\\d+/docs$`), // create doc
  new RegExp(`^/api/v3/workspaces/\\d+/docs/${ID}/pages$`), // create page in a doc
];

export const classifyClickUpRequest: RequestClassifier = ({ method, url }) => {
  const path = url.pathname;
  if (!/^\/api\/v[23]\//.test(path)) return 'unknown';
  if (method === 'GET') return 'read';
  if (method === 'POST' && WRITE_ENDPOINTS.some((re) => re.test(path))) return 'write';
  return 'unknown';
};

export const clickupNetworkPolicy: NetworkPolicy = {
  defaultBaseUrl: CLICKUP_API_BASE,
  allowedHosts: (baseUrl) => [new URL(baseUrl).host],
  classify: classifyClickUpRequest,
};
