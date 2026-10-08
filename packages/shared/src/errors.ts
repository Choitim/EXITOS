import { redactString } from './redact.js';

export interface ErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
  exitCode?: number;
}

/** Process exit codes used by the CLI (documented in docs/product-spec.md). */
export const ExitCode = {
  Ok: 0,
  Unexpected: 1,
  Usage: 2,
  Partial: 3,
  VerificationFailed: 4,
  Approval: 5,
} as const;

/** Base class for every error ExitOS raises on purpose. Messages are always safe to print. */
export class ExitOsError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly exitCode: number;

  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(
      redactString(message),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = code;
    this.details = options.details ?? {};
    this.exitCode = options.exitCode ?? ExitCode.Unexpected;
  }
}

/** Bad or missing configuration, credentials or CLI usage. */
export class ConfigError extends ExitOsError {
  constructor(message: string, options: ErrorOptions = {}) {
    super('CONFIG_INVALID', message, { exitCode: ExitCode.Usage, ...options });
  }
}

/** Data crossing a trust boundary failed schema validation. Never includes the offending values. */
export class ValidationError extends ExitOsError {
  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(code, message, options);
  }
}

/** A write was attempted while the connection was read-only (or the endpoint was not classified). */
export class WriteBlockedError extends ExitOsError {
  constructor(method: string, host: string, path: string, reason: string) {
    super('WRITE_BLOCKED', `Blocked ${method} ${host}${path}: ${reason}`, {
      details: { method, host, path, reason },
    });
  }
}

export class HostNotAllowedError extends ExitOsError {
  constructor(host: string) {
    super(
      'HOST_NOT_ALLOWED',
      `Refusing to send a request to "${host}": host is not on this connector's allow-list.`,
      { details: { host } },
    );
  }
}

export interface ApiErrorInit extends ErrorOptions {
  system: string;
  status: number;
  endpoint: string;
  apiCode?: string;
  retryable?: boolean;
}

/** The remote API returned a non-success response. */
export class ApiError extends ExitOsError {
  readonly system: string;
  readonly status: number;
  readonly endpoint: string;
  readonly apiCode: string | undefined;
  readonly retryable: boolean;

  constructor(message: string, init: ApiErrorInit) {
    super('API_ERROR', `${init.system} ${init.endpoint} → HTTP ${init.status}: ${message}`, init);
    this.system = init.system;
    this.status = init.status;
    this.endpoint = init.endpoint;
    this.apiCode = init.apiCode;
    this.retryable = init.retryable ?? false;
  }

  /** True when the credential is rejected or lacks permission: retrying cannot help. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * A write whose outcome is unknown (timeout, connection reset, 5xx, or an unreadable 2xx).
 * The executor must reconcile before retrying; it must never blindly re-send (ADR 0007).
 */
export class AmbiguousWriteError extends ExitOsError {
  constructor(message: string, options: ErrorOptions = {}) {
    super('WRITE_OUTCOME_AMBIGUOUS', message, options);
  }
}

/** Network-level failure for a request that is safe to retry (reads). */
export class NetworkError extends ExitOsError {
  constructor(message: string, options: ErrorOptions = {}) {
    super('NETWORK_ERROR', message, options);
  }
}

export class ApprovalError extends ExitOsError {
  constructor(message: string) {
    super('APPROVAL_REQUIRED', message, { exitCode: ExitCode.Approval });
  }
}

export class PlanIntegrityError extends ExitOsError {
  constructor(message: string) {
    super('PLAN_INTEGRITY', message, { exitCode: ExitCode.Approval });
  }
}

/** Raised by the executor hook used for deterministic crash tests and `demo --interrupt-after`. */
export class SimulatedInterruptError extends ExitOsError {
  constructor(afterActions: number) {
    super(
      'SIMULATED_INTERRUPT',
      `Simulated interruption after ${afterActions} completed action(s).`,
      {
        exitCode: ExitCode.Partial,
      },
    );
  }
}

export class AbortedError extends ExitOsError {
  constructor(message = 'Operation aborted.') {
    super('ABORTED', message, { exitCode: ExitCode.Partial });
  }
}

export function isExitOsError(value: unknown): value is ExitOsError {
  return value instanceof ExitOsError;
}

/** Render any thrown value as a single redacted line. */
export function toSafeMessage(error: unknown): string {
  if (error instanceof Error) return redactString(error.message);
  if (typeof error === 'string') return redactString(error);
  return 'Unknown error';
}
