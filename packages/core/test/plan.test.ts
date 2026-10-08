import { PlanIntegrityError, ValidationError } from '@exitos/shared';
import { describe, expect, it } from 'vitest';
import {
  buildInventory,
  parsePlanJson,
  routeSourceFindings,
  sealPlan,
  splitPlan,
  validatePlanGraph,
  verifyPlanIntegrity,
} from '../src/index.js';
import { finding, makeAction, makePlan } from './helpers.js';

describe('plan sealing and integrity', () => {
  it('derives the plan id from the content hash', () => {
    const plan = makePlan([makeAction(1), makeAction(2)]);
    expect(plan.planId).toBe(`plan_${plan.hash.slice(0, 12)}`);
    expect(plan.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: identical content gives an identical hash, regardless of timestamp', () => {
    const a = makePlan([makeAction(1), makeAction(2)]);
    const { body } = splitPlan(a);
    const b = sealPlan(body, '2030-05-05T00:00:00.000Z');
    expect(b.hash).toBe(a.hash);
    expect(b.planId).toBe(a.planId);
    expect(b.generatedAt).not.toBe(a.generatedAt);
  });

  it('changes the hash when any approved content changes', () => {
    const a = makePlan([makeAction(1)]);
    const changed = makeAction(1);
    changed.payload = { n: 999 };
    expect(makePlan([changed]).hash).not.toBe(a.hash);
  });

  it('survives a JSON save/load round trip with integrity intact', () => {
    const plan = makePlan([makeAction(1), makeAction(2)]);
    const loaded = parsePlanJson(JSON.stringify(plan, null, 2));
    expect(loaded.hash).toBe(plan.hash);
  });

  it('rejects a hand-edited plan (payload tampering)', () => {
    const plan = makePlan([makeAction(1)]);
    const tampered = JSON.parse(JSON.stringify(plan)) as typeof plan;
    tampered.actions[0]!.payload = { n: 'changed after approval' };
    expect(() => verifyPlanIntegrity(tampered)).toThrow(PlanIntegrityError);
    expect(() => parsePlanJson(JSON.stringify(tampered))).toThrow(PlanIntegrityError);
  });

  it('rejects a plan whose id was swapped', () => {
    const plan = makePlan([makeAction(1)]);
    const swapped = { ...plan, planId: 'plan_000000000000' };
    expect(() => verifyPlanIntegrity(swapped)).toThrow(PlanIntegrityError);
  });

  it('rejects non-JSON and schema-invalid input without echoing its content', () => {
    expect(() => parsePlanJson('not json')).toThrow(/not valid JSON/);
    expect(() => parsePlanJson('{"schemaVersion":1}')).toThrow(ValidationError);
  });
});

describe('plan graph validation', () => {
  it('accepts a DAG', () => {
    const a = makeAction(1);
    const b = makeAction(2, { deps: [a.id] });
    expect(() => validatePlanGraph({ actions: [a, b] })).not.toThrow();
  });

  it('rejects unknown dependencies', () => {
    const b = makeAction(2, { deps: ['act_000000000000'] });
    expect(() => validatePlanGraph({ actions: [b] })).toThrow(/unknown action/);
  });

  it('rejects duplicate ids', () => {
    expect(() => validatePlanGraph({ actions: [makeAction(1), makeAction(1)] })).toThrow(
      /Duplicate/,
    );
  });

  it('rejects cycles', () => {
    const a = makeAction(1);
    const b = makeAction(2, { deps: [a.id] });
    const cyclic = { ...a, dependsOn: [b.id] };
    expect(() => validatePlanGraph({ actions: [cyclic, b] })).toThrow(/cycle/);
  });
});

describe('finding routing and inventory', () => {
  const rollup = finding({ code: 'FIELD_ROLLUP_SNAPSHOT', outcome: 'lossy', field: 'Open deps' });

  it('attaches entity-level source findings to the action that migrates that entity', () => {
    const action = makeAction(1);
    const { actions, planLevel } = routeSourceFindings(
      [
        { ...rollup, entity: 'test:item:1' },
        { ...rollup, entity: 'test:item:99', code: 'ORPHAN_FINDING' },
      ],
      [action],
    );
    expect(actions[0]?.findings.map((f) => f.code)).toEqual(['FIELD_ROLLUP_SNAPSHOT']);
    expect(actions[0]?.outcome).toBe('lossy'); // worst outcome wins
    expect(planLevel.map((f) => f.code)).toEqual(['ORPHAN_FINDING']); // never dropped
  });

  it('keeps collection-level findings at plan level', () => {
    const { planLevel } = routeSourceFindings(
      [finding({ code: 'SEARCH_NOT_EXHAUSTIVE', outcome: 'lossy' })],
      [makeAction(1)],
    );
    expect(planLevel).toHaveLength(1);
  });

  it('does not duplicate a finding the destination already attached', () => {
    const action = makeAction(1, { findings: [{ ...rollup, entity: 'test:item:1' }] });
    const { actions } = routeSourceFindings([{ ...rollup, entity: 'test:item:1' }], [action]);
    expect(actions[0]?.findings).toHaveLength(1);
  });

  it('aggregates the inventory by code and counts affected items, worst first', () => {
    const inventory = buildInventory([
      { ...rollup, entity: 'a:b:1' },
      { ...rollup, entity: 'a:b:2' },
      finding({ code: 'ATTACHMENT_HOSTED', outcome: 'unsupported', field: 'Files' }),
      finding({ code: 'SOME_INFO', outcome: 'supported' }),
    ]);
    expect(inventory.map((f) => f.code)).toEqual(['ATTACHMENT_HOSTED', 'FIELD_ROLLUP_SNAPSHOT']);
    expect(inventory[1]?.count).toBe(2);
    expect(inventory.every((f) => f.entity === undefined)).toBe(true);
  });
});
