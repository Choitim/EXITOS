import { ApiError, WriteBlockedError, createGuardedFetch, RequestRecorder } from '@exitos/shared';
import { checkSourceConnector } from '@exitos/core/testing';
import { describe, expect, it } from 'vitest';
import { classifyNotionRequest, normalizeNotion } from '../src/index.js';
import {
  block,
  pageObj,
  richTexts,
  rt,
  uid,
  value,
  workspaceParent,
  type Obj,
} from '../src/testing/index.js';
import {
  DB,
  DS,
  GRACE,
  TOKEN,
  connect,
  extractAll,
  roadmapFixture,
  roadmapRow,
} from './fixtures.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => uid(`target:${i}`));

describe('pagination', () => {
  it('reads more than 100 rows across pages (100-per-page cap)', async () => {
    const h = connect(roadmapFixture(257), {
      source: { dataSources: [{ id: DS, bodies: false }] },
    });
    const raw = await extractAll(h);
    expect(raw.dataSources[0]?.pages).toHaveLength(257);
    const queries = h.fake.requests.filter((r) => r.path.endsWith('/query'));
    expect(queries).toHaveLength(3); // 100 + 100 + 57
    expect(queries.every((q) => (q.body as Obj).page_size === 100)).toBe(true);
    expect(normalizeNotion(raw).records).toHaveLength(257);
  });

  it('never loses or duplicates a row at page boundaries', async () => {
    const h = connect(roadmapFixture(200), {
      source: { dataSources: [{ id: DS, bodies: false }] },
    });
    const snap = normalizeNotion(await extractAll(h));
    expect(new Set(snap.records.map((r) => r.key)).size).toBe(200);
  });

  it('returns rows in a stable created_time order', async () => {
    const f = roadmapFixture(0);
    f.pages = [roadmapRow(3), roadmapRow(1), roadmapRow(2)];
    const snap = normalizeNotion(
      await extractAll(connect(f, { source: { dataSources: [{ id: DS, bodies: false }] } })),
    );
    expect(snap.records.map((r) => r.title)).toEqual(['Task 1', 'Task 2', 'Task 3']);
  });

  it('works around the 10 000-row query cap with created_time windows', async () => {
    const h = connect(roadmapFixture(450), {
      cap: 120,
      source: { dataSources: [{ id: DS, bodies: false }] },
    });
    const raw = await extractAll(h);
    expect(raw.dataSources[0]?.pages).toHaveLength(450);
    expect(raw.dataSources[0]?.incomplete).toBe(false);
    const queries = h.fake.requests.filter((r) => r.path.endsWith('/query'));
    expect(queries.some((q) => (q.body as Obj).filter !== undefined)).toBe(true); // used a window filter
  });

  it('says so loudly when the cap cannot be worked around (too many rows share one timestamp)', async () => {
    const f = roadmapFixture(0);
    f.pages = Array.from({ length: 150 }, (_, i) =>
      roadmapRow(i + 1, { created: '2026-01-01T00:00:00.000Z' }),
    );
    const h = connect(f, { cap: 100, source: { dataSources: [{ id: DS, bodies: false }] } });
    const snap = normalizeNotion(await extractAll(h));
    const finding = snap.findings.find((x) => x.code === 'SOURCE_ROWS_INCOMPLETE');
    expect(finding).toMatchObject({ outcome: 'unsupported', severity: 'error' });
    expect(snap.collections[0]?.incomplete).toBe(true);
  });

  it('stops at limits.maxRecordsPerDataSource and reports the truncation', async () => {
    const h = connect(roadmapFixture(300), {
      source: {
        dataSources: [{ id: DS, bodies: false }],
        limits: { maxRecordsPerDataSource: 150 },
      },
    });
    const snap = normalizeNotion(await extractAll(h));
    expect(snap.findings.find((f) => f.code === 'SOURCE_ROWS_INCOMPLETE')?.message).toMatch(
      /maxRecordsPerDataSource/,
    );
  });
});

describe('truncated property values', () => {
  it('fetches the full relation when Notion truncates it at 25 references', async () => {
    const all = ids(60);
    const f = roadmapFixture(0);
    const row = roadmapRow(1, {
      props: { 'Depends on': value.relation('dep', all.slice(0, 25), true) },
    });
    f.pages = [row];
    f.propertyItems = {
      [`${row.id as string}:dep`]: all.map((id) => ({
        object: 'property_item',
        type: 'relation',
        id: 'dep',
        relation: { id },
      })),
    };
    const h = connect(f, { source: { dataSources: [{ id: DS, bodies: false }] } });
    const snap = normalizeNotion(await extractAll(h));
    const rel = snap.records[0]!.values.dep!;
    expect(rel.kind === 'relation' && rel.targets).toHaveLength(60);
    expect(rel.kind === 'relation' && rel.truncated).toBeUndefined();
    expect(h.fake.requests.some((r) => r.path.includes('/properties/dep'))).toBe(true);
  });

  it('flags a relation as truncated when the full list cannot be retrieved', async () => {
    const f = roadmapFixture(0);
    const row = roadmapRow(1, { props: { 'Depends on': value.relation('dep', ids(25), true) } });
    f.pages = [row];
    f.hidden = []; // property endpoint answers with an empty list: nothing more to merge
    const h = connect(f, { source: { dataSources: [{ id: DS, bodies: false }] } });
    h.fake.fault({
      match: (r) => r.path.includes('/properties/'),
      respond: () =>
        new Response(
          JSON.stringify({
            object: 'error',
            status: 404,
            code: 'object_not_found',
            message: 'nope',
          }),
          { status: 404 },
        ),
    });
    const snap = normalizeNotion(await extractAll(h));
    expect(snap.findings.map((x) => x.code)).toContain('RELATION_TRUNCATED');
  });
});

describe('page bodies', () => {
  const rowId = uid('row:1');
  const bodyFixture = () => {
    const f = roadmapFixture(1);
    const b1 = uid('b1');
    const b2 = uid('b2');
    const b3 = uid('b3');
    const tbl = uid('tbl');
    f.blocks[rowId] = [
      block.heading(uid('h'), rowId, 1, 'Plan'),
      block.bullet(b1, rowId, 'Parent item', true),
      block.toggle(b2, rowId, 'Toggle', true),
      block.table(tbl, rowId, 2),
      block.paragraph(b3, rowId, [rt('Café '), rt('bold', { bold: true })]),
    ];
    f.blocks[b1] = [block.bullet(uid('b1a'), b1, 'Child', true)];
    f.blocks[uid('b1a')] = [block.bullet(uid('b1aa'), uid('b1a'), 'Grandchild')];
    f.blocks[b2] = [block.paragraph(uid('b2a'), b2, richTexts('Hidden text'))];
    f.blocks[tbl] = [
      block.tableRow(uid('r1'), tbl, ['H1', 'H2']),
      block.tableRow(uid('r2'), tbl, ['a', 'b']),
    ];
    return f;
  };

  it('traverses nested blocks recursively', async () => {
    const snap = normalizeNotion(await extractAll(connect(bodyFixture())));
    const doc = snap.documents[0]!;
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'heading',
      'bulletedListItem',
      'toggle',
      'table',
      'paragraph',
    ]);
    expect(doc.blocks[1]?.children[0]?.children[0]?.text[0]?.text).toBe('Grandchild');
    expect(doc.blocks[3]?.children.map((c) => c.cells?.[0]?.[0]?.text)).toEqual(['H1', 'a']);
    expect(snap.records[0]?.body).toBe(doc.key);
  });

  it('paginates block children beyond 100', async () => {
    const f = roadmapFixture(1);
    f.blocks[rowId] = Array.from({ length: 230 }, (_, i) =>
      block.paragraph(uid(`p${i}`), rowId, richTexts(`Paragraph ${i}`)),
    );
    const h = connect(f);
    const doc = normalizeNotion(await extractAll(h)).documents[0]!;
    expect(doc.blocks).toHaveLength(230);
    expect(
      h.fake.requests.filter((r) => r.path.endsWith(`/blocks/${rowId}/children`)),
    ).toHaveLength(3);
  });

  it('respects the depth limit and reports what was not read', async () => {
    const f = roadmapFixture(1);
    let parent = rowId;
    for (let d = 0; d < 6; d++) {
      const id = uid(`deep${d}`);
      f.blocks[parent] = [block.bullet(id, parent, `Level ${d}`, true)];
      parent = id;
    }
    f.blocks[parent] = [block.bullet(uid('leaf'), parent, 'Leaf')];
    const snap = normalizeNotion(
      await extractAll(connect(f, { source: { limits: { maxBlockDepth: 3 } } })),
    );
    expect(snap.findings.find((x) => x.code === 'BLOCK_DEPTH_LIMIT')).toMatchObject({
      outcome: 'lossy',
      entity: `notion:page:${rowId.replace(/-/g, '')}`,
    });
  });

  it('stops at the per-page block budget', async () => {
    const f = roadmapFixture(1);
    const parentBlock = uid('parent');
    f.blocks[rowId] = [block.bullet(parentBlock, rowId, 'has kids', true)];
    f.blocks[parentBlock] = Array.from({ length: 30 }, (_, i) =>
      block.paragraph(uid(`k${i}`), parentBlock, richTexts('x')),
    );
    const snap = normalizeNotion(
      await extractAll(connect(f, { source: { limits: { maxBlocksPerPage: 10 } } })),
    );
    expect(snap.findings.map((x) => x.code)).toContain('PAGE_BLOCK_BUDGET');
  });

  it('copies synced blocks from their original and reports an inaccessible original', async () => {
    const f = roadmapFixture(1);
    const original = uid('orig');
    const copy = uid('copy');
    const lostOriginal = uid('lost');
    const lostCopy = uid('lostcopy');
    f.blocks[rowId] = [
      block.syncedCopy(copy, rowId, original),
      block.syncedCopy(lostCopy, rowId, lostOriginal),
    ];
    f.blocks[original] = [block.paragraph(uid('o1'), original, richTexts('Shared content'))];
    f.hidden = [lostOriginal];
    const doc = normalizeNotion(await extractAll(connect(f))).documents[0]!;
    expect(doc.blocks[0]).toMatchObject({ kind: 'syncedBlock' });
    expect(doc.blocks[0]?.children[0]?.text[0]?.text).toBe('Shared content');
    expect(doc.blocks[1]).toMatchObject({
      kind: 'syncedBlock',
      reason: expect.stringContaining('not shared'),
    });
  });

  it('keeps unknown block types as explicit unsupported blocks', async () => {
    const f = roadmapFixture(1);
    f.blocks[rowId] = [
      block.unsupported(uid('u'), rowId, 'ai_block'),
      block.meetingNotes(uid('mn'), rowId),
    ];
    const doc = normalizeNotion(await extractAll(connect(f))).documents[0]!;
    expect(doc.blocks.map((b) => [b.kind, b.sourceType])).toEqual([
      ['unsupported', 'ai_block'],
      ['unsupported', 'meeting_notes'],
    ]);
  });

  it('records an inaccessible page body as a finding but still migrates the row', async () => {
    const f = roadmapFixture(2);
    f.hidden = [rowId];
    // row 1's *page* is visible in the query but its content is not shared:
    f.hidden = [];
    const h = connect(f);
    h.fake.fault({
      match: (r) => r.path === `/v1/blocks/${rowId}/children`,
      respond: () =>
        new Response(
          JSON.stringify({ object: 'error', status: 404, code: 'object_not_found', message: 'x' }),
          { status: 404 },
        ),
    });
    const snap = normalizeNotion(await extractAll(h));
    expect(snap.records).toHaveLength(2);
    expect(snap.findings.find((x) => x.code === 'PAGE_BODY_INACCESSIBLE')).toMatchObject({
      outcome: 'unsupported',
      entity: `notion:page:${rowId.replace(/-/g, '')}`,
    });
  });

  it('skips bodies when bodies:false (fewer requests)', async () => {
    const h = connect(roadmapFixture(5), { source: { dataSources: [{ id: DS, bodies: false }] } });
    await extractAll(h);
    expect(h.fake.requests.some((r) => r.path.includes('/blocks/'))).toBe(false);
  });
});

describe('selection and discovery', () => {
  it('accepts a database id and expands it to its data sources', async () => {
    const h = connect(roadmapFixture(3), { source: { dataSources: [{ id: DB, bodies: false }] } });
    const snap = normalizeNotion(await extractAll(h));
    expect(snap.collections).toHaveLength(1);
    expect(snap.records).toHaveLength(3);
  });

  it('reports an inaccessible data source as a blocking error', async () => {
    const f = roadmapFixture(3);
    f.hidden = [DS, DB];
    const snap = normalizeNotion(await extractAll(connect(f)));
    expect(snap.records).toHaveLength(0);
    expect(snap.findings.find((x) => x.code === 'SOURCE_NOT_ACCESSIBLE')).toMatchObject({
      severity: 'error',
      category: 'permission',
    });
  });

  it('discover lists shared data sources and standalone pages, and warns that search is not exhaustive', async () => {
    const f = roadmapFixture(3);
    f.pages.push(
      pageObj({
        id: uid('handbook'),
        parent: workspaceParent(),
        created: '2026-01-01T00:00:00.000Z',
        properties: { title: value.title('title', 'Handbook') },
      }),
    );
    const d = await connect(f).source.discover();
    expect(d.containers.map((c) => [c.kind, c.name])).toEqual([
      ['data_source', 'Roadmap'],
      ['page', 'Handbook'],
    ]);
    expect(d.notes.join(' ')).toMatch(/not exhaustive/);
    expect(d.workspace.name).toBe('Test Workspace');
  });

  it('discover explains how to share content when nothing is visible', async () => {
    const f = roadmapFixture(0);
    f.dataSources = [];
    f.pages = [];
    const d = await connect(f).source.discover();
    expect(d.containers).toEqual([]);
    expect(d.notes.join(' ')).toMatch(/Connections/);
  });

  it('inspect counts rows and classifies fields', async () => {
    const inspection = await connect(roadmapFixture(130)).source.inspect();
    const col = inspection.collections[0]!;
    expect(col.recordCount).toBe(130);
    expect(col.fields.find((f) => f.field.name === 'Depends on')?.support).toBe('transformed');
    expect(col.fields.find((f) => f.field.name === 'Status')?.support).toBe('supported');
  });
});

describe('people', () => {
  it('lists the user directory only when names are missing', async () => {
    const f = roadmapFixture(1);
    f.pages = [
      roadmapRow(1, { props: { Owner: value.people('own', [{ object: 'user', id: GRACE }]) } }),
    ];
    const h = connect(f, { source: { dataSources: [{ id: DS, bodies: false }] } });
    const snap = normalizeNotion(await extractAll(h));
    expect(h.fake.requests.some((r) => r.path === '/v1/users')).toBe(true);
    const owner = snap.records[0]!.values.own!;
    expect(owner.kind === 'person' && owner.users[0]).toMatchObject({
      name: 'Grace Hopper',
      email: 'grace@example.com',
    });
  });

  it('degrades gracefully without the user-information capability', async () => {
    const f = roadmapFixture(1, { userInfoCapability: false });
    f.pages = [
      roadmapRow(1, { props: { Owner: value.people('own', [{ object: 'user', id: GRACE }]) } }),
    ];
    const snap = normalizeNotion(
      await extractAll(connect(f, { source: { dataSources: [{ id: DS, bodies: false }] } })),
    );
    expect(snap.findings.find((x) => x.code === 'USER_INFO_UNAVAILABLE')).toMatchObject({
      category: 'user_mapping',
    });
    const owner = snap.records[0]!.values.own!;
    expect(owner.kind === 'person' && owner.users[0]?.email).toBeUndefined();
  });
});

describe('standalone pages', () => {
  const root = uid('root');
  const child = uid('child');
  const grandchild = uid('grandchild');
  const page = (id: string, title: string, parent: Obj) =>
    pageObj({
      id,
      parent,
      created: '2026-01-01T00:00:00.000Z',
      properties: { title: value.title('title', title) },
    });

  const pagesFixture = () => {
    const f = roadmapFixture(0);
    f.pages = [
      page(root, 'Handbook', workspaceParent()),
      page(child, 'Onboarding', { type: 'page_id', page_id: root }),
      page(grandchild, 'Day one', { type: 'page_id', page_id: child }),
    ];
    f.blocks[root] = [
      block.paragraph(uid('r1'), root, richTexts('Welcome')),
      block.childPage(child, root, 'Onboarding'),
    ];
    f.blocks[child] = [
      block.childPage(grandchild, child, 'Day one'),
      block.childPage(root, child, 'Back to root (cycle)'),
    ];
    f.blocks[grandchild] = [block.paragraph(uid('g1'), grandchild, richTexts('Deep content'))];
    return f;
  };

  it('crawls child pages with parent links and survives cycles', async () => {
    const snap = normalizeNotion(
      await extractAll(
        connect(pagesFixture(), { source: { dataSources: [], pages: [{ id: root }] } }),
      ),
    );
    const docs = snap.documents
      .map((d) => [d.title, d.parent] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(docs).toEqual([
      ['Day one', `notion:page:${child.replace(/-/g, '')}`],
      ['Handbook', undefined],
      ['Onboarding', `notion:page:${root.replace(/-/g, '')}`],
    ]);
  });

  it('does not follow child pages when includeChildPages is false', async () => {
    const snap = normalizeNotion(
      await extractAll(
        connect(pagesFixture(), {
          source: { dataSources: [], pages: [{ id: root, includeChildPages: false }] },
        }),
      ),
    );
    expect(snap.documents).toHaveLength(1);
  });

  it('reports a page that is not shared as a blocking error', async () => {
    const f = pagesFixture();
    f.hidden = [root];
    const snap = normalizeNotion(
      await extractAll(connect(f, { source: { dataSources: [], pages: [{ id: root }] } })),
    );
    expect(snap.documents).toHaveLength(0);
    expect(snap.findings.find((x) => x.code === 'SOURCE_PAGE_NOT_ACCESSIBLE')?.severity).toBe(
      'error',
    );
  });

  it('stops at limits.maxPages and says so', async () => {
    const snap = normalizeNotion(
      await extractAll(
        connect(pagesFixture(), {
          source: { dataSources: [], pages: [{ id: root }], limits: { maxPages: 2 } },
        }),
      ),
    );
    expect(snap.documents).toHaveLength(2);
    expect(snap.findings.map((x) => x.code)).toContain('PAGE_LIMIT_REACHED');
  });
});

describe('resilience', () => {
  it('waits out 429 responses (Retry-After) and succeeds', async () => {
    const h = connect(roadmapFixture(5), { source: { dataSources: [{ id: DS, bodies: false }] } });
    h.fake.rateLimit(2, 4, (r) => r.path.endsWith('/query'));
    const raw = await extractAll(h);
    expect(raw.dataSources[0]?.pages).toHaveLength(5);
    expect(h.clock.slept).toBeGreaterThanOrEqual(8000);
    expect(h.fake.requests.filter((r) => r.path.endsWith('/query'))).toHaveLength(3); // 2 throttled + 1 ok
  });

  it('retries transient 503s on reads', async () => {
    const h = connect(roadmapFixture(2), { source: { dataSources: [{ id: DS, bodies: false }] } });
    h.fake.fault({
      match: (r) => r.path.endsWith('/query'),
      times: 2,
      respond: () =>
        new Response('{"object":"error","status":503,"code":"service_unavailable","message":"x"}', {
          status: 503,
        }),
    });
    expect((await extractAll(h)).dataSources[0]?.pages).toHaveLength(2);
  });

  it('gives up with a clear error when 429s never stop', async () => {
    const h = connect(roadmapFixture(2), { source: { dataSources: [{ id: DS, bodies: false }] } });
    h.fake.rateLimit(50, 1, (r) => r.path.endsWith('/query'));
    await expect(extractAll(h)).rejects.toMatchObject({ status: 429, system: 'notion' });
  });

  it('maps an invalid token to an auth failure without echoing the token', async () => {
    const h = connect(roadmapFixture(1), { token: 'ntn_wrongwrongwrongwrongwrong1234' });
    const fake2 = connect(roadmapFixture(1)); // control
    await expect(fake2.source.discover()).resolves.toBeDefined();
    // build a harness whose fake only accepts a different token
    const strict = connect(roadmapFixture(1), { token: 'ntn_wrongwrongwrongwrongwrong1234' });
    strict.fake.fault({
      match: () => true,
      times: 99,
      respond: () =>
        new Response(
          '{"object":"error","status":401,"code":"unauthorized","message":"API token is invalid."}',
          { status: 401 },
        ),
    });
    const error = (await strict.source.discover().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isAuthFailure).toBe(true);
    expect(error.message).not.toContain('wrongwrong');
    expect(h).toBeDefined();
  });
});

describe('read-only guarantee and secrecy', () => {
  it('sends ZERO write requests during a full extraction', async () => {
    const h = connect(roadmapFixture(120));
    await extractAll(h);
    expect(h.recorder.writes).toHaveLength(0);
    expect(h.recorder.blocked).toHaveLength(0);
    expect(h.recorder.reads.length).toBeGreaterThan(0);
    // The only POSTs are the two documented read endpoints.
    for (const r of h.fake.requests.filter((x) => x.method !== 'GET')) {
      expect(['/v1/search'].includes(r.path) || r.path.endsWith('/query')).toBe(true);
    }
  });

  it('refuses a write even if code tries to send one through the source connection', async () => {
    const h = connect(roadmapFixture(1));
    const guarded = createGuardedFetch({
      fetch: h.fake.fetch,
      mode: 'read-only',
      classify: classifyNotionRequest,
      allowedHosts: ['api.notion.com'],
      recorder: new RequestRecorder(),
    });
    for (const [method, path] of [
      ['POST', '/v1/pages'],
      ['PATCH', '/v1/pages/x'],
      ['DELETE', '/v1/blocks/x'],
      ['PATCH', '/v1/blocks/x/children'],
    ] as const) {
      await expect(
        guarded(`https://api.notion.com${path}`, { method, body: '{}' }),
      ).rejects.toBeInstanceOf(WriteBlockedError);
    }
    expect(h.fake.requests).toHaveLength(0);
  });

  it('classifies Notion endpoints correctly (reads that use POST are allowed)', () => {
    const c = (method: string, path: string) =>
      classifyNotionRequest({ method, url: new URL(`https://api.notion.com${path}`) });
    expect(c('GET', '/v1/pages/abc')).toBe('read');
    expect(c('POST', '/v1/search')).toBe('read');
    expect(c('POST', '/v1/data_sources/abc/query')).toBe('read');
    expect(c('POST', '/v1/pages')).toBe('write');
    expect(c('PATCH', '/v1/data_sources/abc')).toBe('write');
    expect(c('GET', '/other')).toBe('unknown');
  });

  it('never writes the token to logs, raw data or the snapshot', async () => {
    const h = connect(roadmapFixture(3));
    const raw = await extractAll(h);
    const snap = normalizeNotion(raw);
    const blob = JSON.stringify([raw, snap, h.logger.lines]);
    expect(blob).not.toContain(TOKEN);
  });

  it('passes the connector conformance kit', async () => {
    const h = connect(roadmapFixture(12));
    const report = await checkSourceConnector(h.source, { secrets: [TOKEN], recorder: h.recorder });
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('is deterministic: two extractions of the same workspace normalise identically', async () => {
    const a = normalizeNotion(await extractAll(connect(roadmapFixture(40))));
    const b = normalizeNotion(await extractAll(connect(roadmapFixture(40))));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
