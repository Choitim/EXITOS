/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIC_DEMO_CSP } from '../static-demo-csp';

const directives = (policy: string): string[] => policy.split(';').map((d) => d.trim());

/** The policy `exitos ui` sends, read from its source so the two cannot drift apart unnoticed. */
function serverPolicy(): string {
  const source = readFileSync(new URL('../../cli/src/server/server.ts', import.meta.url), 'utf8');
  const block = /const CSP = \[([\s\S]*?)\]\.join\('; '\)/.exec(source)?.[1];
  if (block === undefined)
    throw new Error('could not find the CSP in apps/cli/src/server/server.ts');
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).join('; ');
}

describe('static demo Content-Security-Policy', () => {
  it('is the policy of the brief', () => {
    expect(directives(STATIC_DEMO_CSP)).toEqual([
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
    ]);
  });

  it('mirrors the local server, directive for directive', () => {
    const server = directives(serverPolicy());
    expect(server.length).toBeGreaterThan(5);
    // frame-ancestors is ignored (with a console warning) when a policy comes from a meta tag.
    expect(directives(STATIC_DEMO_CSP)).toEqual(
      server.filter((d) => !d.startsWith('frame-ancestors')),
    );
    expect(STATIC_DEMO_CSP).not.toContain('frame-ancestors');
  });

  it('allows nothing but this site: no inline code, no remote origin, no eval', () => {
    expect(STATIC_DEMO_CSP).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(STATIC_DEMO_CSP).toContain("default-src 'none'");
  });
});
