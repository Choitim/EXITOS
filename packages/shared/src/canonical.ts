import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted, `undefined` dropped, no whitespace.
 * Throws on values that cannot be represented stably (NaN, Infinity, bigint, functions).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return value;
    case 'undefined':
      return undefined;
    case 'object': {
      if (Array.isArray(value)) return value.map((v) => canonicalize(v) ?? null);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        const inner = canonicalize((value as Record<string, unknown>)[key]);
        if (inner !== undefined) out[key] = inner;
      }
      return out;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashObject(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Short, stable, collision-resistant-enough identifier derived from parts. */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256Hex(parts.join('\u0000')).slice(0, 12)}`;
}
