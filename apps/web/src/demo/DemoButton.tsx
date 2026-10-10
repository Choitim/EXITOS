import type { ReactNode, Ref } from 'react';

/**
 * A button that can be switched off without losing keyboard focus. A natively disabled button
 * drops focus, which would strand a keyboard user on "Start simulation" the moment it is pressed;
 * `aria-disabled` keeps the button focusable and announced as unavailable, and ignores clicks.
 */
export function DemoButton({
  children,
  onClick,
  unavailable = false,
  primary = false,
  testId,
  title,
  buttonRef,
}: {
  children: ReactNode;
  onClick: () => void;
  unavailable?: boolean;
  primary?: boolean;
  testId?: string;
  title?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={primary ? 'btn btn-primary' : 'btn'}
      aria-disabled={unavailable ? 'true' : undefined}
      onClick={unavailable ? undefined : onClick}
      data-testid={testId}
      title={title}
    >
      {children}
    </button>
  );
}
