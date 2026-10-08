import type { FetchLike } from '../src/index.js';

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Build a fetch that serves queued responses/errors in order and records the calls. */
export function scriptedFetch(script: Array<Response | Error | (() => Response | Error)>): {
  fetch: FetchLike;
  calls: Array<{ url: string; method: string; body?: string }>;
} {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    const next = script[i++];
    if (next === undefined) throw new Error(`scriptedFetch exhausted at call ${i}`);
    const value = typeof next === 'function' ? next() : next;
    if (value instanceof Error) throw value;
    return value;
  };
  return { fetch, calls };
}
