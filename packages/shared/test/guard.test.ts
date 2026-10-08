import { describe, expect, it } from 'vitest';
import {
  HostNotAllowedError,
  RequestRecorder,
  WriteBlockedError,
  createGuardedFetch,
  type RequestClassifier,
} from '../src/index.js';
import { jsonResponse, scriptedFetch } from './http-helpers.js';

// Notion-like: POST /search and POST /query are reads; everything else non-GET is a write.
const classify: RequestClassifier = ({ method, url }) => {
  if (method === 'GET') return 'read';
  if (method === 'POST' && (url.pathname === '/v1/search' || url.pathname.endsWith('/query')))
    return 'read';
  if (url.pathname.startsWith('/v1/')) return 'write';
  return 'unknown';
};

function setup(mode: 'read-only' | 'read-write') {
  const recorder = new RequestRecorder();
  const { fetch, calls } = scriptedFetch(Array.from({ length: 10 }, () => jsonResponse(200, {})));
  const guarded = createGuardedFetch({
    fetch,
    mode,
    classify,
    allowedHosts: ['api.example.com', '127.0.0.1'],
    recorder,
  });
  return { guarded, recorder, calls };
}

describe('guarded fetch', () => {
  it('allows reads — including POST endpoints that are reads — in read-only mode', async () => {
    const { guarded, recorder, calls } = setup('read-only');
    await guarded('https://api.example.com/v1/pages/1');
    await guarded('https://api.example.com/v1/search', { method: 'POST', body: '{}' });
    await guarded('https://api.example.com/v1/data_sources/1/query', { method: 'POST' });
    expect(calls).toHaveLength(3);
    expect(recorder.writes).toHaveLength(0);
    expect(recorder.reads).toHaveLength(3);
  });

  it('blocks writes before the network is touched in read-only mode', async () => {
    const { guarded, recorder, calls } = setup('read-only');
    await expect(
      guarded('https://api.example.com/v1/pages', { method: 'POST', body: '{}' }),
    ).rejects.toBeInstanceOf(WriteBlockedError);
    await expect(
      guarded('https://api.example.com/v1/pages/1', { method: 'PATCH' }),
    ).rejects.toBeInstanceOf(WriteBlockedError);
    await expect(
      guarded('https://api.example.com/v1/pages/1', { method: 'DELETE' }),
    ).rejects.toBeInstanceOf(WriteBlockedError);
    expect(calls).toHaveLength(0);
    expect(recorder.writes).toHaveLength(0);
    expect(recorder.blocked).toHaveLength(3);
  });

  it('fails closed on unclassified endpoints, even in read-write mode', async () => {
    const { guarded, calls } = setup('read-write');
    await expect(
      guarded('https://api.example.com/other/thing', { method: 'POST' }),
    ).rejects.toBeInstanceOf(WriteBlockedError);
    expect(calls).toHaveLength(0);
  });

  it('permits classified writes in read-write mode and records them', async () => {
    const { guarded, recorder, calls } = setup('read-write');
    await guarded('https://api.example.com/v1/pages', { method: 'POST', body: '{}' });
    expect(calls).toHaveLength(1);
    expect(recorder.writes).toHaveLength(1);
    expect(recorder.writes[0]).toMatchObject({ method: 'POST', path: '/v1/pages', status: 200 });
  });

  it('refuses hosts that are not on the allow-list (token exfiltration guard)', async () => {
    const { guarded, calls } = setup('read-write');
    await expect(guarded('https://evil.example.net/v1/pages/1')).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses plain http except to loopback', async () => {
    const { guarded } = setup('read-only');
    await expect(guarded('http://api.example.com/v1/pages/1')).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
    await expect(guarded('http://127.0.0.1:4010/v1/pages/1')).resolves.toBeInstanceOf(Response);
  });

  it('never records query strings, headers or bodies', async () => {
    const { guarded, recorder } = setup('read-only');
    await guarded('https://api.example.com/v1/pages/1?token=abc', {
      headers: { Authorization: 'Bearer abcdefghijkl' },
    });
    expect(JSON.stringify(recorder.entries)).not.toContain('abc');
  });
});
