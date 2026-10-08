/**
 * URL allow-list. Content in a migration plan is data, never trusted: a link is rendered as a
 * clickable anchor only if it passes `sanitizeUrl`. Everything else becomes plain text.
 */

/** Longest URL we are willing to render (browsers accept more; nobody needs it here). */
export const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/**
 * Anything that browsers silently strip or reinterpret inside URLs, or that hides intent:
 * C0/C1 control characters (tab, CR, LF, NUL, ...), every Unicode space, zero-width and
 * bidirectional-control characters, line/paragraph separators and the BOM.
 */
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0020], // C0 controls and the space
  [0x007f, 0x00a0], // DEL, C1 controls, no-break space
  [0x00ad, 0x00ad], // soft hyphen
  [0x1680, 0x1680], // ogham space mark
  [0x180e, 0x180e], // mongolian vowel separator
  [0x2000, 0x200f], // en/em spaces, zero-width characters, LRM/RLM
  [0x2028, 0x202f], // line/paragraph separators, bidi embeddings and overrides, narrow no-break space
  [0x205f, 0x206f], // medium mathematical space, invisible operators, deprecated format characters
  [0x3000, 0x3000], // ideographic space
  [0xfeff, 0xfeff], // byte order mark / zero-width no-break space
  [0xfff9, 0xfffb], // interlinear annotation characters
];

function hasForbiddenCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    for (const [low, high] of FORBIDDEN_RANGES) {
      if (code >= low && code <= high) return true;
    }
  }
  return false;
}

/**
 * Returns a normalised, safe URL string, or `null` when the input must not be used as a link.
 *
 * Accepted: absolute `http://`, `https://` (with a host and no embedded credentials) and
 * `mailto:` (with an address). The check is deliberately strict:
 *  - no trimming or "fixing": leading/trailing/inner whitespace and control characters reject;
 *  - the scheme must be written literally (`java\tscript:`, `JaVaScRiPt:` never reach a browser);
 *  - relative, protocol-relative (`//evil.com`) and scheme-less strings reject;
 *  - the returned value is the WHATWG-normalised `href`, not the raw input.
 */
export function sanitizeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.length === 0 || input.length > MAX_URL_LENGTH) return null;
  if (hasForbiddenCharacter(input)) return null;
  if (input.includes('\\')) return null;
  // The host must start right after `//`: `https:///x` would otherwise be re-read as `https://x/`.
  if (!/^(?:https?:\/\/[^/?#]|mailto:)/i.test(input)) return null;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.protocol === 'mailto:') {
    return parsed.pathname.length > 0 && parsed.pathname.includes('@') ? parsed.href : null;
  }
  if (parsed.hostname.length === 0) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.href;
}

export function isSafeUrl(input: unknown): boolean {
  return sanitizeUrl(input) !== null;
}

/** Attributes every external link must carry. */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noreferrer noopener',
} as const;
