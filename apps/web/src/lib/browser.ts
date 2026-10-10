/**
 * The few places that touch browser APIs for side effects (clipboard, file download). Kept apart
 * from the pure helpers so those stay testable in Node.
 */

/** Copy text to the clipboard. Resolves `false` when the browser refuses or has no clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Offer `value` as a pretty-printed JSON file download (Blob + object URL, nothing is uploaded). */
export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** True when the visitor asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * Scroll so that the element `id` sits just below the sticky header (and, for page sections, the
 * guided tour's control bar). Does nothing if the element does not exist.
 */
export function scrollToElement(id: string, options: { belowTourBar: boolean }): void {
  const element = document.getElementById(id);
  if (element === null) return;
  const style = getComputedStyle(document.documentElement);
  const px = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
  const offset = px('--header-h') + (options.belowTourBar ? px('--tour-h') : 0) + 12;
  window.scrollTo({
    top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - offset),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}
