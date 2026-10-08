/** Terminal styling that respects NO_COLOR, FORCE_COLOR, non-TTY output and `--no-color`. */

export interface Style {
  readonly enabled: boolean;
  // Function-typed properties (not methods), so they can be passed around unbound.
  readonly bold: (s: string) => string;
  readonly dim: (s: string) => string;
  readonly red: (s: string) => string;
  readonly green: (s: string) => string;
  readonly yellow: (s: string) => string;
  readonly blue: (s: string) => string;
  readonly magenta: (s: string) => string;
  readonly cyan: (s: string) => string;
  readonly gray: (s: string) => string;
  /** Bold white-on-colour label, e.g. the OFFLINE DEMO banner. */
  readonly badge: (s: string, colour: 'yellow' | 'green' | 'red' | 'blue') => string;
}

export function shouldUseColor(input: {
  noColorFlag?: boolean | undefined;
  env: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
}): boolean {
  if (input.noColorFlag === true) return false;
  if (input.env.NO_COLOR !== undefined && input.env.NO_COLOR !== '') return false;
  if (input.env.FORCE_COLOR !== undefined && input.env.FORCE_COLOR !== '0') return true;
  if (input.env.TERM === 'dumb') return false;
  return input.isTTY;
}

export function createStyle(enabled: boolean): Style {
  const wrap =
    (open: number, close: number) =>
    (s: string): string =>
      enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  const bg = { yellow: 43, green: 42, red: 41, blue: 44 } as const;
  return {
    enabled,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    gray: wrap(90, 39),
    badge: (s, colour) => (enabled ? `\u001b[1;30;${bg[colour]}m ${s} \u001b[0m` : `[${s}]`),
  };
}

// eslint-disable-next-line no-control-regex -- stripping ANSI escape sequences
const ANSI = /\u001b\[[0-9;]*m/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

function charWidth(cp: number): number {
  // zero width: combining marks, variation selectors, ZWJ, ZWNJ
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x200d ||
    cp === 0x200c ||
    (cp >= 0x20d0 && cp <= 0x20ff)
  )
    return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Columns a string occupies in a terminal (ANSI ignored; CJK and emoji count as two). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

export function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

export function padStart(s: string, width: number): string {
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}

/** Truncate to a display width, adding an ellipsis; never splits an ANSI-free code point. */
export function truncate(s: string, width: number): string {
  if (displayWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** Word-wrap plain text to a width. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === '') line = word;
      else if (displayWidth(line) + 1 + displayWidth(word) <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}
