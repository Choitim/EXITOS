/**
 * Content-Security-Policy of the static online demo.
 *
 * GitHub Pages cannot send response headers, so the demo's index.html carries the policy in a
 * `<meta http-equiv>` tag. It mirrors the policy `exitos ui` sends (apps/cli/src/server/server.ts)
 * directive for directive, minus `frame-ancestors`, which browsers ignore (and warn about) when the
 * policy is delivered through a meta tag. A unit test keeps the two in step.
 */
export const STATIC_DEMO_CSP: string = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
