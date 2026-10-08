import { ValidationError } from './errors.js';

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * IDs from plan files and API responses are interpolated into URL paths. Allow only a conservative
 * character set so a tampered plan cannot smuggle `../`, query strings or extra path segments.
 */
export function assertSafePathSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new ValidationError(
      'UNSAFE_PATH_SEGMENT',
      `${label} contains characters that are not allowed in an identifier.`,
    );
  }
  return value;
}

export function isSafePathSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value);
}
