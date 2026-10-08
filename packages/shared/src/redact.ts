/**
 * Secret redaction. Applied to every log line, error message and diagnostic report.
 *
 * Two layers: (1) exact strings registered at runtime (the actual tokens in use), and
 * (2) pattern-based scrubbing for token shapes and signed-URL query parameters.
 */

const REDACTED = '[REDACTED]';

const SENSITIVE_QUERY_PARAMS =
  'X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|X-Amz-Algorithm|Signature|sig|token|access_token|refresh_token|api_key|apikey|key|secret|password';

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bntn_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\bsecret_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\bpk_\d+_[A-Za-z0-9]{12,}\b/g, REDACTED],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/(authorization["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, `$1${REDACTED}`],
  [new RegExp(`([?&](?:${SENSITIVE_QUERY_PARAMS})=)[^&\\s"'<>]+`, 'gi'), `$1${REDACTED}`],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${REDACTED}@`],
];

const SENSITIVE_KEY =
  /^(authorization|token|access_?token|refresh_?token|api_?key|secret|password|cookie|signature)$/i;

export class SecretRedactor {
  readonly #secrets = new Set<string>();

  /** Register an exact secret value (ignored if too short to be a real credential). */
  add(secret: string | undefined): void {
    if (secret !== undefined && secret.length >= 8) this.#secrets.add(secret);
  }

  clear(): void {
    this.#secrets.clear();
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.#secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    for (const [pattern, replacement] of PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  /** Deeply copy a JSON-like value, scrubbing strings and values under sensitive keys. */
  redactDeep<T>(value: T): T {
    return this.#deep(value, 0) as T;
  }

  #deep(value: unknown, depth: number): unknown {
    if (depth > 20) return REDACTED;
    if (typeof value === 'string') return this.redact(value);
    if (Array.isArray(value)) return value.map((v) => this.#deep(v, depth + 1));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY.test(key) ? REDACTED : this.#deep(inner, depth + 1);
      }
      return out;
    }
    return value;
  }
}

/** Process-wide redactor: credential loaders register their tokens here. */
export const defaultRedactor = new SecretRedactor();

export function registerSecret(secret: string | undefined): void {
  defaultRedactor.add(secret);
}

export function redactString(text: string): string {
  return defaultRedactor.redact(text);
}

export function redactDeep<T>(value: T): T {
  return defaultRedactor.redactDeep(value);
}

/**
 * Remove credentials, fragments and sensitive query values from a URL so it can be logged.
 * Returns a placeholder for unparsable input rather than echoing it.
 */
export function sanitizeUrl(input: string | URL): string {
  try {
    const url = new URL(input);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (new RegExp(`^(${SENSITIVE_QUERY_PARAMS})$`, 'i').test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return '[unparsable-url]';
  }
}
