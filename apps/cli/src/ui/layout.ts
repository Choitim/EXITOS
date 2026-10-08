import { displayWidth, padEnd, padStart, truncate, type Style } from './style.js';

export interface Column<T> {
  header: string;
  /** Plain-text cell value (colouring is applied separately so widths stay correct). */
  value: (row: T) => string;
  align?: 'left' | 'right';
  /** Maximum width; the column shrinks to content up to this. */
  max?: number;
  min?: number;
  colour?: (row: T, cell: string) => string;
}

/** Render an aligned table that fits `maxWidth`, shrinking the widest flexible column if needed. */
export function table<T>(
  columns: ReadonlyArray<Column<T>>,
  rows: readonly T[],
  style: Style,
  maxWidth = 100,
): string[] {
  const cells = rows.map((row) => columns.map((c) => c.value(row)));
  const widths = columns.map((c, i) => {
    const natural = Math.max(displayWidth(c.header), ...cells.map((r) => displayWidth(r[i] ?? '')));
    return Math.min(c.max ?? natural, Math.max(c.min ?? 0, natural));
  });
  const gap = 2;
  const total = (): number => widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  // Shrink the widest shrinkable column until the table fits.
  for (let guard = 0; total() > maxWidth && guard < 200; guard++) {
    let widest = -1;
    columns.forEach((c, i) => {
      if (
        widths[i] !== undefined &&
        widths[i] > (c.min ?? 8) &&
        (widest === -1 || widths[i] > (widths[widest] as number))
      )
        widest = i;
    });
    if (widest === -1) break;
    widths[widest] = (widths[widest] as number) - 1;
  }
  const line = (parts: string[]): string => parts.join(' '.repeat(gap)).replace(/\s+$/, '');
  const out: string[] = [];
  out.push(
    line(
      columns.map((c, i) =>
        style.bold(
          c.align === 'right'
            ? padStart(c.header, widths[i] ?? 0)
            : padEnd(c.header, widths[i] ?? 0),
        ),
      ),
    ),
  );
  out.push(style.gray(widths.map((w) => '─'.repeat(w)).join(' '.repeat(gap))));
  rows.forEach((row, r) => {
    out.push(
      line(
        columns.map((c, i) => {
          const w = widths[i] ?? 0;
          const raw = truncate(cells[r]?.[i] ?? '', w);
          const padded = c.align === 'right' ? padStart(raw, w) : padEnd(raw, w);
          return c.colour ? c.colour(row, padded) : padded;
        }),
      ),
    );
  });
  return out;
}

export function rule(title: string, style: Style, width = 80): string {
  const label = ` ${title} `;
  const fill = Math.max(2, width - displayWidth(label) - 2);
  return `${style.gray('──')}${style.bold(label)}${style.gray('─'.repeat(fill))}`;
}

export function box(
  lines: readonly string[],
  style: Style,
  width = 78,
  colour: (s: string) => string = style.gray,
): string[] {
  const inner = width - 4;
  const top = colour(`┌${'─'.repeat(width - 2)}┐`);
  const bottom = colour(`└${'─'.repeat(width - 2)}┘`);
  const body = lines.map(
    (l) => `${colour('│')} ${padEnd(truncate(l, inner), inner)} ${colour('│')}`,
  );
  return [top, ...body, bottom];
}

export function keyValues(
  rows: ReadonlyArray<readonly [string, string]>,
  style: Style,
  keyWidth = 14,
): string[] {
  return rows.map(([k, v]) => `${style.gray(padEnd(k, keyWidth))}${v}`);
}

export function bar(done: number, total: number, width: number, style: Style): string {
  const ratio = total === 0 ? 1 : Math.min(1, done / total);
  const filled = Math.round(ratio * width);
  return `${style.green('█'.repeat(filled))}${style.gray('░'.repeat(width - filled))} ${String(Math.round(ratio * 100)).padStart(3)}%`;
}

export const number = (n: number): string => n.toLocaleString('en-US');
