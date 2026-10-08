import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AmbiguousWriteError,
  ApiError,
  HttpClient,
  RequestScheduler,
  ValidationError,
  VirtualClock,
} from '../src/index.js';
import { jsonResponse, scriptedFetch } from './http-helpers.js';

function client(script: Parameters<typeof scriptedFetch>[0]) {
  const { fetch, calls } = scriptedFetch(script);
  const scheduler = new RequestScheduler({
    clock: new VirtualClock(),
    concurrency: 2,
    random: () => 0,
    retry: { maxAttempts: 2 },
  });
  const http = new HttpClient({
    fetch,
    scheduler,
    baseUrl: 'https://api.test/api',
    system: 'testsys',
    headers: () => ({ Authorization: 'pk_1_SECRETSECRETSECRET' }),
    parseError: (_status, body) => {
      const b = body as { err?: string; ECODE?: string } | undefined;
      return { ...(b?.err ? { message: b.err } : {}), ...(b?.ECODE ? { code: b.ECODE } : {}) };
    },
  });
  return { http, calls };
}

const Task = z.object({ id: z.string() });

describe('HttpClient', () => {
  it('sends auth header, JSON body and returns schema-validated data', async () => {
    const { http, calls } = client([jsonResponse(200, { id: 'abc', extra: 1 })]);
    const out = await http.request({
      method: 'POST',
      path: '/v2/list/1/task',
      body: { name: 'x' },
      schema: Task,
    });
    expect(out).toEqual({ id: 'abc' });
    expect(calls[0]?.body).toBe('{"name":"x"}');
  });

  it('serialises array query params in the bracket form ClickUp expects', async () => {
    const { http, calls } = client([jsonResponse(200, { id: 'a' })]);
    await http.request({
      method: 'GET',
      path: '/v2/list/1/task',
      query: { page: 0, statuses: ['to do', 'in progress'], skip: undefined },
      schema: Task,
    });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.getAll('statuses[]')).toEqual(['to do', 'in progress']);
    expect(url.searchParams.get('page')).toBe('0');
    expect(url.searchParams.has('skip')).toBe(false);
  });

  it('turns 4xx into a redacted ApiError and does not retry', async () => {
    const { http, calls } = client([
      jsonResponse(400, { err: 'Status not found for pk_1_SECRETSECRETSECRET', ECODE: 'ITEM_015' }),
    ]);
    const error = await http
      .request({ method: 'POST', path: '/v2/list/1/task', body: {}, schema: Task })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.status).toBe(400);
    expect(api.apiCode).toBe('ITEM_015');
    expect(api.message).not.toContain('SECRETSECRET');
    expect(calls).toHaveLength(1);
  });

  it('classifies auth failures', async () => {
    const { http } = client([jsonResponse(401, { err: 'Token invalid', ECODE: 'OAUTH_025' })]);
    const error = (await http
      .request({ method: 'GET', path: '/v2/user', schema: Task })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.isAuthFailure).toBe(true);
  });

  it('treats a network failure on a write as an AMBIGUOUS outcome', async () => {
    const { http, calls } = client([new Error('socket hang up')]);
    await expect(
      http.request({ method: 'POST', path: '/v2/list/1/task', body: {}, schema: Task }),
    ).rejects.toBeInstanceOf(AmbiguousWriteError);
    expect(calls).toHaveLength(1);
  });

  it('treats a 5xx on a write as ambiguous (the task may have been created)', async () => {
    const { http, calls } = client([jsonResponse(502, { err: 'bad gateway' })]);
    await expect(
      http.request({ method: 'POST', path: '/v2/list/1/task', body: {}, schema: Task }),
    ).rejects.toBeInstanceOf(AmbiguousWriteError);
    expect(calls).toHaveLength(1);
  });

  it('treats a 2xx with an unreadable body on a write as ambiguous', async () => {
    const { http } = client([jsonResponse(200, '<html>oops</html>')]);
    await expect(
      http.request({ method: 'POST', path: '/v2/list/1/task', body: {}, schema: Task }),
    ).rejects.toBeInstanceOf(AmbiguousWriteError);

    const { http: http2 } = client([jsonResponse(200, { nope: true })]);
    await expect(
      http2.request({ method: 'POST', path: '/v2/list/1/task', body: {}, schema: Task }),
    ).rejects.toBeInstanceOf(AmbiguousWriteError);
  });

  it('reports schema mismatches on reads as ValidationError without echoing values', async () => {
    const { http } = client([jsonResponse(200, { id: 12345, secret: 'do-not-print' })]);
    const error = await http
      .request({ method: 'GET', path: '/v2/task/1', schema: Task })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain('id');
    expect((error as Error).message).not.toContain('do-not-print');
  });

  it('retries a read through a transient 503', async () => {
    const { http, calls } = client([jsonResponse(503, {}), jsonResponse(200, { id: 'ok' })]);
    const out = await http.request({ method: 'GET', path: '/v2/task/1', schema: Task });
    expect(out.id).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('rejects oversized responses', async () => {
    const { fetch } = scriptedFetch([
      jsonResponse(200, { id: 'x' }, { 'content-length': '999999999' }),
    ]);
    const http = new HttpClient({
      fetch,
      scheduler: new RequestScheduler({ clock: new VirtualClock(), concurrency: 1 }),
      baseUrl: 'https://api.test',
      system: 't',
      headers: () => ({}),
      maxResponseBytes: 1024,
    });
    await expect(http.request({ method: 'GET', path: '/x', schema: Task })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
