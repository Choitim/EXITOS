import { describe, expect, it } from 'vitest';
import type { FieldValue } from '@exitos/core/sdk';
import { normalizeNotion } from '../src/index.js';
import {
  dataSourceObj,
  externalFile,
  hostedFile,
  pageObj,
  rowParent,
  schema,
  uid,
  userObj,
  value,
} from '../src/testing/index.js';
import { ADA, DB, DS, connect, extractAll, roadmapFixture } from './fixtures.js';

/** One row that uses every property type the API documents (plus a few it does not). */
async function everyTypeSnapshot(
  rowOverrides: Record<string, ReturnType<typeof value.title>> = {},
  timeZoneDate = true,
) {
  const ada = userObj(ADA, 'Ada Lovelace', 'ada@example.com');
  const other = uid('target-page');
  const fixture = roadmapFixture(0, {
    dataSources: [
      dataSourceObj({
        id: DS,
        databaseId: DB,
        title: 'Everything',
        properties: [
          schema.title(),
          schema.richText('rt', 'Notes'),
          schema.number('n', 'Number'),
          schema.select('sel', 'Select', ['A', 'B']),
          schema.multiSelect('ms', 'Multi', ['x', 'y']),
          schema.status('stat', 'Status', { 'To-do': ['Open'], Complete: ['Closed'] }),
          schema.simple('d', 'Date', 'date'),
          schema.simple('p', 'People', 'people'),
          schema.simple('cb', 'Done', 'checkbox'),
          schema.simple('u', 'Link', 'url'),
          schema.simple('e', 'Mail', 'email'),
          schema.simple('ph', 'Phone', 'phone_number'),
          schema.simple('f', 'Files', 'files'),
          schema.relation('rel', 'Related', DS, true),
          schema.relation('ext', 'Elsewhere', uid('some-other-db')),
          schema.formula('fx', 'Formula', 'prop("Number") * 2'),
          schema.rollup('ru', 'Rollup'),
          schema.simple('ct', 'Created', 'created_time'),
          schema.simple('cby', 'Created by', 'created_by'),
          schema.simple('let', 'Edited', 'last_edited_time'),
          schema.uniqueId('uid', 'ID', 'RM'),
          schema.simple('btn', 'Button', 'button'),
          schema.simple('plc', 'Place', 'place'),
          schema.simple('ver', 'Verification', 'verification'),
          schema.simple('fut', 'From the future', 'quantum_flux'),
        ],
      }),
    ],
    pages: [
      pageObj({
        id: uid('row:all'),
        parent: rowParent(DS, DB),
        created: '2026-02-03T04:05:06.000Z',
        properties: {
          Name: value.title('title', 'Everything — 日本語 🚀'),
          Notes: value.richText('rt', 'Some notes'),
          Number: value.number('n', 3.5),
          Select: value.select('sel', 'A'),
          Multi: value.multiSelect('ms', ['x', 'y']),
          Status: value.status('stat', 'Open'),
          Date: timeZoneDate
            ? value.date('d', '2026-03-10T09:00:00', '2026-03-10T10:30:00', 'Europe/Berlin')
            : value.date('d', '2026-03-10'),
          People: value.people('p', [ada]),
          Done: value.checkbox('cb', true),
          Link: value.url('u', 'https://example.com'),
          Mail: value.email('e', 'a@example.com'),
          Phone: value.phone('ph', '+49 30 1234'),
          Files: value.files('f', [
            hostedFile('spec.pdf'),
            externalFile('logo.png', 'https://cdn.example.com/logo.png'),
          ]),
          Related: value.relation('rel', [other]),
          Elsewhere: value.relation('ext', [uid('outside')]),
          Formula: value.formulaNumber('fx', 7),
          Rollup: value.rollupNumber('ru', 2),
          Created: value.createdTime('ct', '2026-02-03T04:05:06.000Z'),
          'Created by': value.createdBy('cby', ada),
          Edited: value.lastEditedTime('let', '2026-02-04T00:00:00.000Z'),
          ID: value.uniqueId('uid', 'RM', 42),
          Button: value.button('btn'),
          Place: value.place('plc', 'Berlin HQ'),
          Verification: { id: 'ver', type: 'verification', verification: { state: 'verified' } },
          'From the future': { id: 'fut', type: 'quantum_flux', quantum_flux: { spin: 0.5 } },
          ...rowOverrides,
        },
      }),
    ],
  });
  const raw = await extractAll(
    connect(fixture, { source: { dataSources: [{ id: DS, bodies: false }] } }),
  );
  return normalizeNotion(raw);
}

const valueOf = (
  snapshot: Awaited<ReturnType<typeof everyTypeSnapshot>>,
  fieldName: string,
): FieldValue => {
  const col = snapshot.collections[0]!;
  const field = col.fields.find((f) => f.name === fieldName)!;
  return snapshot.records[0]!.values[field.id]!;
};

describe('property types → normalized fields and values', () => {
  it('classifies every documented property type; unknown ones become unsupported (not a crash)', async () => {
    const snap = await everyTypeSnapshot();
    const kinds = Object.fromEntries(snap.collections[0]!.fields.map((f) => [f.name, f.kind]));
    expect(kinds).toMatchObject({
      Name: 'title',
      Notes: 'text',
      Number: 'number',
      Select: 'select',
      Multi: 'multiSelect',
      Status: 'status',
      Date: 'date',
      People: 'person',
      Done: 'checkbox',
      Link: 'url',
      Mail: 'email',
      Phone: 'phone',
      Files: 'files',
      Related: 'relation',
      Elsewhere: 'relation',
      Formula: 'computed',
      Rollup: 'computed',
      Created: 'timestamp',
      'Created by': 'userStamp',
      Edited: 'timestamp',
      ID: 'uniqueId',
      Button: 'unsupported',
      Place: 'unsupported',
      Verification: 'unsupported',
      'From the future': 'unsupported',
    });
    // The title property is always first.
    expect(snap.collections[0]!.fields[0]?.kind).toBe('title');
  });

  it('keeps the original source type name even when unsupported', async () => {
    const snap = await everyTypeSnapshot();
    const future = snap.collections[0]!.fields.find((f) => f.name === 'From the future')!;
    expect(future).toMatchObject({ kind: 'unsupported', sourceType: 'quantum_flux' });
  });

  it('reports each unreadable property type exactly once per collection', async () => {
    const snap = await everyTypeSnapshot();
    const unreadable = snap.findings
      .filter((f) => f.code === 'SOURCE_FIELD_UNREADABLE')
      .map((f) => f.field)
      .sort();
    expect(unreadable).toEqual(['Button', 'From the future', 'Place', 'Verification']);
    expect(
      snap.findings.every(
        (f) => f.code !== 'SOURCE_FIELD_UNREADABLE' || f.outcome === 'unsupported',
      ),
    ).toBe(true);
  });

  it('reads scalar values faithfully, including Unicode', async () => {
    const snap = await everyTypeSnapshot();
    expect(snap.records[0]?.title).toBe('Everything — 日本語 🚀');
    expect(valueOf(snap, 'Number')).toEqual({ kind: 'number', value: 3.5 });
    expect(valueOf(snap, 'Select')).toMatchObject({ kind: 'select', name: 'A' });
    expect(valueOf(snap, 'Multi')).toEqual({ kind: 'multiSelect', names: ['x', 'y'] });
    expect(valueOf(snap, 'Done')).toEqual({ kind: 'checkbox', value: true });
    expect(valueOf(snap, 'Link')).toEqual({ kind: 'url', value: 'https://example.com' });
    expect(valueOf(snap, 'Phone')).toEqual({ kind: 'phone', value: '+49 30 1234' });
  });

  it('keeps status groups', async () => {
    const snap = await everyTypeSnapshot();
    expect(valueOf(snap, 'Status')).toMatchObject({ kind: 'status', name: 'Open', group: 'To-do' });
  });

  it('keeps dates exactly as given, including range and time zone name', async () => {
    const snap = await everyTypeSnapshot();
    expect(valueOf(snap, 'Date')).toEqual({
      kind: 'date',
      value: {
        start: '2026-03-10T09:00:00',
        end: '2026-03-10T10:30:00',
        timeZone: 'Europe/Berlin',
      },
    });
    const dateOnly = await everyTypeSnapshot({}, false);
    expect(valueOf(dateOnly, 'Date')).toEqual({ kind: 'date', value: { start: '2026-03-10' } });
  });

  it('maps people with their name and e-mail', async () => {
    const snap = await everyTypeSnapshot();
    const people = valueOf(snap, 'People');
    expect(people.kind === 'person' && people.users[0]).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(snap.users.map((u) => u.name)).toContain('Ada Lovelace');
  });

  it('turns files into references and never stores a signed URL', async () => {
    const snap = await everyTypeSnapshot();
    const files = valueOf(snap, 'Files');
    expect(files.kind === 'files' && files.attachments.map((a) => [a.name, a.hosting])).toEqual([
      ['spec.pdf', 'internal'],
      ['logo.png', 'external'],
    ]);
    expect(JSON.stringify(snap)).not.toMatch(/X-Amz|amazonaws|FIXTURE_SIGNATURE/);
    expect(snap.attachments).toHaveLength(2);
  });

  it('snapshots formulas, rollups, unique ids and created-by', async () => {
    const snap = await everyTypeSnapshot();
    expect(valueOf(snap, 'Formula')).toEqual({
      kind: 'computed',
      computedType: 'formula',
      display: '7',
      complete: true,
    });
    expect(valueOf(snap, 'Rollup')).toEqual({
      kind: 'computed',
      computedType: 'rollup',
      display: '2',
      complete: true,
    });
    expect(valueOf(snap, 'ID')).toEqual({
      kind: 'uniqueId',
      prefix: 'RM',
      number: 42,
      display: 'RM-42',
    });
    expect(valueOf(snap, 'Created by')).toMatchObject({
      kind: 'userStamp',
      user: { name: 'Ada Lovelace' },
    });
  });

  it('flags relations: a target that was not extracted is unresolved and out of scope', async () => {
    const snap = await everyTypeSnapshot();
    const rel = valueOf(snap, 'Related');
    expect(rel.kind === 'relation' && rel.targets).toHaveLength(1);
    expect(snap.relationships).toHaveLength(2);
    expect(snap.relationships.every((r) => r.resolved === false && r.inScope === false)).toBe(true);
    const fields = snap.collections[0]!.fields;
    expect(fields.find((f) => f.name === 'Related')?.relation).toMatchObject({
      targetInScope: true,
      dual: true,
    });
    expect(fields.find((f) => f.name === 'Elsewhere')?.relation).toMatchObject({
      targetInScope: false,
    });
  });

  it('turns a malformed value into an explicit finding instead of throwing', async () => {
    const snap = await everyTypeSnapshot({ Number: { id: 'n', type: 'number', number: 'seven' } });
    expect(valueOf(snap, 'Number')).toMatchObject({ kind: 'unsupported' });
    expect(snap.findings.find((f) => f.code === 'PROPERTY_VALUE_MALFORMED')).toMatchObject({
      field: 'Number',
      outcome: 'unsupported',
    });
  });
});
