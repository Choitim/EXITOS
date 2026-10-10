import { useId, useState, type ReactNode } from 'react';
import { useTourHighlight } from '../hooks/TourContext';
import { copyText } from '../lib/browser';
import type { Tone } from '../lib/format';
import {
  outcomeMeta,
  runStatusStyle,
  STATE_META,
  type IconName,
  type StateKey,
} from '../lib/outcomes';

// ---- icons -------------------------------------------------------------------------------------

const ICON_PATHS: Record<IconName, ReactNode> = {
  check: <path d="M3 8.5l3.2 3.2L13 4.8" />,
  transform: (
    <>
      <path d="M13 8a5 5 0 1 1-1.7-3.75" />
      <path d="M13.2 2.2v3.3H9.9" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.2l6.3 11H1.7z" />
      <path d="M8 6.4v3.2M8 11.6v.1" />
    </>
  ),
  cross: <path d="M4 4l8 8M12 4l-8 8" />,
  minus: <path d="M4 8h8" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6M8 5.1v.1" />
    </>
  ),
  // Run-level states: a shield with a check (Verified) and a stop sign (Failed).
  verified: (
    <>
      <path d="M8 1.8l5 1.9v4.1c0 2.9-2.1 5-5 6.4-2.9-1.4-5-3.5-5-6.4V3.7z" />
      <path d="M5.6 8.1l1.8 1.8 3.2-3.5" />
    </>
  ),
  failed: (
    <>
      <path d="M5.4 1.8h5.2l3.6 3.6v5.2l-3.6 3.6H5.4l-3.6-3.6V5.4z" />
      <path d="M8 4.9v3.7M8 11v.1" />
    </>
  ),
  plus: <path d="M8 3.2v9.6M3.2 8h9.6" />,
  link: (
    <>
      <path d="M6.9 9.1a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6" />
      <path d="M9.1 6.9a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.3 1.4" />
    </>
  ),
  flag: <path d="M3.5 14V2.5M3.5 3h8.4l-1.6 2.6 1.6 2.6H3.5" />,
  play: <path d="M5 3l7 5-7 5z" />,
  chevron: <path d="M4 6l4 4 4-4" />,
};

/** Decorative icon: the meaning is always repeated in text next to it. */
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`inline-block shrink-0 ${className}`}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// ---- tone + chips ------------------------------------------------------------------------------

export const TONE_CHIP: Record<Tone, string> = {
  ok: 'chip-ok',
  info: 'chip-info',
  warn: 'chip-warn',
  bad: 'chip-bad',
  neutral: 'chip-neutral',
};

/** Text colour per tone (static class names so Tailwind can see them). */
export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-muted',
};

/** Strong, filled chips: only the two run-level states (Failed, Verified) use them. */
const SOLID_CHIP: Partial<Record<Tone, string>> = { ok: 'chip-solid-ok', bad: 'chip-solid-bad' };

export function Chip({
  tone,
  icon,
  children,
  className = '',
  title,
  solid = false,
}: {
  tone: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
  solid?: boolean;
}) {
  return (
    <span
      className={`chip ${(solid && SOLID_CHIP[tone]) || TONE_CHIP[tone]} ${className}`}
      title={title}
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </span>
  );
}

/**
 * Outcome as icon + word, never colour alone. With `withPlain` the plain-language sub-label
 * ("loses detail") is printed next to the name.
 */
export function OutcomeChip({
  outcome,
  withPlain = false,
}: {
  outcome: string;
  withPlain?: boolean;
}) {
  const meta = outcomeMeta(outcome);
  const chip = (
    <Chip tone={meta.tone} icon={meta.icon} title={meta.plain} solid={meta.solid}>
      {meta.label}
    </Chip>
  );
  if (!withPlain) return chip;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {chip}
      <span className="text-xs text-muted">{meta.plain}</span>
    </span>
  );
}

/** One of the six legend states (including the two run-level ones) as icon + word. */
export function StateChip({ state, withPlain = false }: { state: StateKey; withPlain?: boolean }) {
  const meta = STATE_META[state];
  const chip = (
    <Chip tone={meta.tone} icon={meta.icon} title={meta.plain} solid={meta.solid}>
      {meta.label}
    </Chip>
  );
  if (!withPlain) return chip;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {chip}
      <span className="text-xs text-muted">{meta.plain}</span>
    </span>
  );
}

/** A run status ("Applying", "Verified", "Verification failed") with its icon. */
export function RunStatusChip({
  status,
  label,
  tone,
}: {
  status: string;
  label: string;
  tone: Tone;
}) {
  const style = runStatusStyle(status);
  return (
    <Chip tone={tone} icon={style.icon} solid={style.solid} title={status}>
      {label}
    </Chip>
  );
}

/** Grey placeholder block shown while data loads. Decorative: the page announces loading in text. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

// ---- layout pieces -------------------------------------------------------------------------------

export function SectionShell({
  id,
  number,
  title,
  intro,
  children,
}: {
  id: string;
  number: number;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  // Only the online demo's guided tour ever sets this; everywhere else it is `null`.
  const tour = useTourHighlight();
  const highlighted = tour !== null && tour.sectionId === id;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={highlighted ? 'section tour-highlight' : 'section'}
      data-tour-highlight={highlighted ? 'true' : undefined}
    >
      {highlighted ? (
        <p className="tour-flag" data-testid="tour-flag">
          <Icon name="flag" />
          {tour.label}
        </p>
      ) : null}
      <header className="mb-5">
        <h2 id={headingId} className="section-title">
          <span className="section-number" aria-hidden="true">
            {number}
          </span>
          {title}
        </h2>
        {intro ? <p className="section-intro">{intro}</p> : null}
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function Card({
  title,
  headingLevel = 3,
  children,
  className = '',
  actions,
}: {
  title?: ReactNode;
  headingLevel?: 3 | 4;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className={`card ${className}`}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title ? <Heading className="card-title">{title}</Heading> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  testId,
  icon,
  iconTone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  /** Optional icon before the label, so a state is never only a colour. */
  icon?: IconName;
  iconTone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-sm text-muted">
        {icon ? <Icon name={icon} className={TONE_TEXT[iconTone]} /> : null}
        {label}
      </dt>
      <dd className="text-xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

/** Key/value rows. */
export function Facts({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label} className="facts-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal-scroll container for wide tables; focusable so keyboard users can scroll it. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function Callout({
  tone,
  title,
  children,
  role,
  testId,
  tourTarget,
}: {
  tone: Tone;
  title: ReactNode;
  children?: ReactNode;
  role?: 'alert' | 'status';
  testId?: string;
  /** Marks the callout as the thing the online demo's guided tour points at (styling only). */
  tourTarget?: string;
}) {
  const icon: IconName =
    tone === 'ok' ? 'check' : tone === 'bad' ? 'cross' : tone === 'warn' ? 'warning' : 'info';
  return (
    <div
      className={`callout callout-${tone}`}
      role={role}
      data-testid={testId}
      data-tour-target={tourTarget}
    >
      <Icon name={icon} className="callout-icon" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-1 space-y-1">{children}</div> : null}
      </div>
    </div>
  );
}

/** Dashed placeholder for a section that has nothing to show, with an optional bold lead line. */
export function Empty({
  children,
  title,
  testId,
}: {
  children: ReactNode;
  title?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="rounded-lg border border-dashed border-edge px-4 py-6 text-center text-muted"
      data-testid={testId}
    >
      {title ? <p className="mb-1 font-semibold text-fg">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

// ---- buttons ---------------------------------------------------------------------------------------

export function Button({
  children,
  onClick,
  disabled,
  variant = 'secondary',
  testId,
  ariaPressed,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  testId?: string;
  ariaPressed?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <button
      type={type}
      className={variant === 'primary' ? 'btn btn-primary' : 'btn'}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={ariaPressed}
      title={title}
    >
      {children}
    </button>
  );
}

/** Copies `text` and confirms in a polite live region (and says so if the browser refuses). */
export function CopyButton({
  text,
  label,
  testId,
}: {
  text: string;
  label: string;
  testId?: string;
}) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');
  const statusId = useId();
  const onClick = (): void => {
    void copyText(text).then((ok) => {
      setResult(ok ? 'copied' : 'failed');
      window.setTimeout(() => {
        setResult('idle');
      }, 4000);
    });
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn"
        onClick={onClick}
        data-testid={testId}
        aria-describedby={statusId}
      >
        {label}
      </button>
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        className="text-sm"
        data-testid={testId ? `${testId}-status` : undefined}
      >
        {result === 'copied' ? (
          <span className="text-ok">
            <Icon name="check" /> Copied to clipboard
          </span>
        ) : result === 'failed' ? (
          <span className="text-bad">
            <Icon name="cross" /> Copy failed: select the text and copy it yourself
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** A command the person can read, select and copy. */
export function CommandLine({ command }: { command: string }) {
  return (
    <pre className="command">
      <code>{command}</code>
    </pre>
  );
}

/** Scrollable, keyboard-focusable block of pretty-printed JSON. */
export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre
      className="command relative max-h-72 overflow-auto"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}
