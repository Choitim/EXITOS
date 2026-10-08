import type { DashboardState } from '@exitos/core/schema';
import { useEffect, useRef, useState } from 'react';

export interface NavItem {
  id: string;
  label: string;
}

export const SECTIONS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'source-destination', label: 'Source & destination' },
  { id: 'compatibility', label: 'Compatibility' },
  { id: 'mapping', label: 'Mapping preview' },
  { id: 'unsupported', label: 'Unsupported' },
  { id: 'progress', label: 'Progress' },
  { id: 'verification', label: 'Verification' },
];

const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);

export type BadgeMode = DashboardState['mode'] | 'loading' | 'error';

export function ModeBadge({ mode }: { mode: BadgeMode }) {
  if (mode === 'demo') {
    return (
      <div className="mode-badge mode-demo" data-testid="mode-badge" data-mode="demo">
        <span className="text-base font-extrabold tracking-wider">OFFLINE DEMO</span>
        <span className="text-xs font-medium">Synthetic data · fake APIs · no network</span>
      </div>
    );
  }
  if (mode === 'live') {
    return (
      <div className="mode-badge mode-live" data-testid="mode-badge" data-mode="live">
        <span className="text-base font-extrabold tracking-wider">LIVE</span>
        <span className="text-xs font-medium">Real workspace data · read-only dashboard</span>
      </div>
    );
  }
  const idle = {
    empty: ['NO DATA YET', 'No plan or run in this state directory'],
    loading: ['LOADING', 'Reading the local state…'],
    error: ['NOT CONNECTED', 'The local server did not answer'],
  }[mode];
  return (
    <div className="mode-badge mode-idle" data-testid="mode-badge" data-mode={mode}>
      <span className="text-base font-extrabold tracking-wider">{idle[0]}</span>
      <span className="text-xs font-medium">{idle[1]}</span>
    </div>
  );
}

/** Highlights the nav entry of the section nearest the top of the viewport. */
function useActiveSection(ids: readonly string[], enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first !== undefined) setActive(first);
      },
      { rootMargin: '-25% 0px -65% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
  }, [ids, enabled]);
  return active;
}

export function Header({ mode, showNav }: { mode: BadgeMode; showNav: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const active = useActiveSection(SECTION_IDS, showNav);

  // Publish the header height so anchor targets can stop below the sticky header.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = (): void => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <header ref={ref} className="app-header">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:flex-nowrap">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-lg font-bold tracking-tight">ExitOS</h1>
          <span className="hidden text-sm text-muted sm:inline">local dashboard</span>
        </div>
        {showNav ? (
          <nav
            aria-label="Dashboard sections"
            className="order-last -mx-1 w-full overflow-x-auto lg:order-none lg:mx-0 lg:w-auto lg:flex-1"
          >
            <ul className="flex min-w-max gap-1 px-1 lg:justify-center">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    className="nav-link"
                    href={`#${s.id}`}
                    aria-current={active === s.id ? 'location' : undefined}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          <div className="flex-1" />
        )}
        <div className="ml-auto lg:ml-0">
          <ModeBadge mode={mode} />
        </div>
      </div>
    </header>
  );
}
