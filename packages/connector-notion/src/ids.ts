import { ConfigError } from '@exitos/shared';

const HEX32 = /[0-9a-f]{32}/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical form used inside ExitOS entity keys: 32 lowercase hex characters, no dashes. */
export function normalizeNotionId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

/** `0f1e…` (32 hex) → `0f1e…` with dashes, the form the API returns and accepts. */
export function toDashedUuid(id: string): string {
  const n = normalizeNotionId(id);
  return `${n.slice(0, 8)}-${n.slice(8, 12)}-${n.slice(12, 16)}-${n.slice(16, 20)}-${n.slice(20)}`;
}

/**
 * Accept what people actually paste: a bare id (with or without dashes) or a Notion URL such as
 * `https://www.notion.so/My-Page-0f1e2d3c4b5a69788796a5b4c3d2e1f0?v=...`.
 */
export function parseNotionId(input: string): string {
  const trimmed = input.trim();
  if (UUID.test(trimmed)) return normalizeNotionId(trimmed);
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ConfigError(`"${trimmed.slice(0, 60)}" is not a valid Notion URL or id.`);
    }
    if (!/(^|\.)notion\.(so|site)$/i.test(url.hostname)) {
      throw new ConfigError(`"${url.hostname}" is not a Notion host.`);
    }
    const match = HEX32.exec(url.pathname.replace(/-/g, ''));
    if (match) return match[0].toLowerCase();
  }
  throw new ConfigError(
    `"${trimmed.slice(0, 60)}" is not a Notion id. Use the 32-character id or paste the page/database URL.`,
  );
}
