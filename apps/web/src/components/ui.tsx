import { useId, useState, type ReactNode } from 'react';
import { copyText } from '../lib/browser';
import type { Tone } from '../lib/format';
import { outcomeMeta, type IconName } from '../lib/outcomes';

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

export function Chip({
  tone,
  icon,
  children,
  className = '',
  title,
}: {
  tone: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={`chip ${TONE_CHIP[tone]} ${className}`} title={title}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </span>
  );
}

/** Outcome as icon + word, never colour alone. */
export function OutcomeChip({ outcome }: { outcome: string }) {
  const meta = outcomeMeta(outcome);
  return (
    <Chip tone={meta.tone} icon={meta.icon} title={meta.plain}>
      {meta.label}
    </Chip>
  );
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
  return (
    <section id={id} aria-labelledby={headingId} className="section">
      <header className="mb-4">
        <h2 id={headingId} className="section-title">
          <span className="section-number" aria-hidden="true">
            {number}
          </span>
          {title}
        </h2>
        {intro ? <p className="mt-1 max-w-3xl text-muted">{intro}</p> : null}
      </header>
      <div className="space-y-5">{children}</div>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
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
}: {
  tone: Tone;
  title: ReactNode;
  children?: ReactNode;
  role?: 'alert' | 'status';
  testId?: string;
}) {
  const icon: IconName =
    tone === 'ok' ? 'check' : tone === 'bad' ? 'cross' : tone === 'warn' ? 'warning' : 'info';
  return (
    <div className={`callout callout-${tone}`} role={role} data-testid={testId}>
      <Icon name={icon} className="callout-icon" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-1 space-y-1">{children}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-muted">
      {children}
    </p>
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
    <pre className="command max-h-72 overflow-auto" tabIndex={0} role="region" aria-label={label}>
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}
