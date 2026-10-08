import type { NetworkPolicy } from '@exitos/core/sdk';
import type { RequestClassifier } from '@exitos/shared';

export const NOTION_API_BASE = 'https://api.notion.com';
export const NOTION_API_VERSION = '2026-03-11';

/**
 * Notion exposes some READS as POST (`/v1/search`, data-source `query`). Classifying by endpoint,
 * not by HTTP method, lets read-only mode allow them while still blocking every write — and
 * anything unrecognised is refused (ADR 0006). The Notion source is always read-only anyway.
 */
export const classifyNotionRequest: RequestClassifier = ({ method, url }) => {
  const path = url.pathname;
  if (!path.startsWith('/v1/')) return 'unknown';
  if (method === 'GET') return 'read';
  if (method === 'POST') {
    if (path === '/v1/search') return 'read';
    if (/^\/v1\/data_sources\/[^/]+\/query$/.test(path)) return 'read';
    if (/^\/v1\/databases\/[^/]+\/query$/.test(path)) return 'read'; // legacy (pre-2025-09-03)
  }
  return 'write';
};

export const notionNetworkPolicy: NetworkPolicy = {
  defaultBaseUrl: NOTION_API_BASE,
  allowedHosts: (baseUrl) => [new URL(baseUrl).host],
  classify: classifyNotionRequest,
};
