/**
 * Turning schema validation issues into something a person can fix.
 *
 * A mistake in a config file is the user's, not a bug of ours, so it must read like guidance:
 * where the problem is (`source.dataSources[0].id`) and what is wrong with it, never a raw dump.
 */

/** The part of a Zod issue we need; structural so callers do not depend on Zod's types. */
export interface ConfigIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** `["dataSources", 0, "id"]` → `dataSources[0].id` (empty path → empty string). */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

export interface FormatIssuesOptions {
  /** Prepended to every path, e.g. `source` for a connector's own section. */
  readonly prefix?: string;
  /** How many issues to list before summarising the rest (default 10). */
  readonly max?: number;
}

/** One bullet per issue (`  • where: what`), capped, with a final "… and N more" line when cut. */
export function formatConfigIssues(
  issues: readonly ConfigIssue[],
  options: FormatIssuesOptions = {},
): string[] {
  const max = options.max ?? 10;
  const lines = issues.slice(0, max).map((issue) => {
    const path = formatIssuePath(issue.path);
    const prefix = options.prefix ?? '';
    const separator = path === '' || path.startsWith('[') || prefix === '' ? '' : '.';
    const where = `${prefix}${separator}${path}`;
    return `  • ${where === '' ? '(root)' : where}: ${issue.message}`;
  });
  if (issues.length > max) lines.push(`  … and ${issues.length - max} more`);
  return lines;
}
