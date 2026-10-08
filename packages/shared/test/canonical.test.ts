import { describe, expect, it } from 'vitest';
import { canonicalJson, hashObject, sha256Hex, stableId } from '../src/index.js';

describe('canonical JSON and hashing', () => {
  it('sorts object keys recursively and is independent of insertion order', () => {
    const a = { b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'é' } };
    const b = { a: { c: 'é', d: [3, { x: 2, y: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"é","d":[3,{"x":2,"y":1}]},"b":1}');
  });

  it('drops undefined object members but preserves array positions', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('rejects values that cannot be represented stably', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ n: Infinity })).toThrow(TypeError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
  });

  it('hashes Unicode deterministically', () => {
    expect(hashObject({ t: '日本語 🚀' })).toBe(hashObject({ t: '日本語 🚀' }));
    expect(hashObject({ t: '日本語 🚀' })).not.toBe(hashObject({ t: '日本語 🚁' }));
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('stableId is deterministic and prefix-qualified', () => {
    expect(stableId('act', 'a', 'b')).toBe(stableId('act', 'a', 'b'));
    expect(stableId('act', 'a', 'b')).not.toBe(stableId('act', 'ab', ''));
    expect(stableId('act', 'x')).toMatch(/^act_[0-9a-f]{12}$/);
  });
});
