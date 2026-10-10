import { describe, expect, it } from 'vitest';
import {
  OUTCOME_META,
  OUTCOME_ORDER,
  STATE_META,
  STATE_ORDER,
  outcomeMeta,
  outcomeWithPlain,
  runStatusStyle,
  severityMeta,
} from '../src/lib/outcomes';

describe('outcome vocabulary', () => {
  it('names the four content outcomes with the CLI wording as the plain sub-label', () => {
    expect(OUTCOME_META.supported).toMatchObject({ label: 'Preserved', plain: 'Moves as-is' });
    expect(OUTCOME_META.transformed).toMatchObject({
      label: 'Transformed',
      plain: 'Changes shape',
    });
    expect(OUTCOME_META.lossy).toMatchObject({ label: 'Requires review', plain: 'Loses detail' });
    expect(OUTCOME_META.unsupported).toMatchObject({
      label: 'Unsupported',
      plain: 'Cannot move',
    });
  });

  it('keeps the data values (they are not renamed), including skipped', () => {
    expect(Object.keys(OUTCOME_META).sort()).toEqual(
      ['failed', 'lossy', 'skipped', 'supported', 'transformed', 'unsupported'].sort(),
    );
    expect([...OUTCOME_ORDER].sort()).toEqual(Object.keys(OUTCOME_META).sort());
    expect(OUTCOME_META.skipped.label).toBe('Skipped');
  });

  it('has exactly six legend states, in the order they are explained', () => {
    expect(STATE_ORDER).toEqual([
      'supported',
      'transformed',
      'lossy',
      'unsupported',
      'failed',
      'verified',
    ]);
    expect(STATE_ORDER.map((s) => STATE_META[s].label)).toEqual([
      'Preserved',
      'Transformed',
      'Requires review',
      'Unsupported',
      'Failed',
      'Verified',
    ]);
  });

  it('gives every legend state its own word and its own icon (never colour alone)', () => {
    const labels = STATE_ORDER.map((s) => STATE_META[s].label);
    const icons = STATE_ORDER.map((s) => STATE_META[s].icon);
    expect(new Set(labels).size).toBe(6);
    expect(new Set(icons).size).toBe(6);
    for (const state of STATE_ORDER) {
      expect(STATE_META[state].plain.length).toBeGreaterThan(0);
      expect(STATE_META[state].description.length).toBeGreaterThan(10);
    }
  });

  it('marks the two run-level states as such, drawn as strong filled chips', () => {
    expect(STATE_META.failed).toMatchObject({ level: 'run', solid: true, tone: 'bad' });
    expect(STATE_META.verified).toMatchObject({ level: 'run', solid: true, tone: 'ok' });
    for (const state of ['supported', 'transformed', 'lossy', 'unsupported'] as const) {
      expect(STATE_META[state]).toMatchObject({ level: 'item', solid: false });
    }
    // Failed is the same state whether it is a data outcome or a run state.
    expect(OUTCOME_META.failed).toBe(STATE_META.failed);
  });

  it('never uses the word "complete" (only a verified run may sound finished)', () => {
    const everything = JSON.stringify([STATE_META, OUTCOME_META]);
    expect(everything).not.toMatch(/\bcomplete(d)?\b/i);
  });

  it('shows an unknown outcome as it is instead of hiding it', () => {
    expect(outcomeMeta('brand_new')).toMatchObject({ label: 'brand_new', tone: 'neutral' });
    expect(outcomeWithPlain('brand_new')).toBe('brand_new (brand_new)');
  });

  it('combines name and sub-label for selects and aria-labels', () => {
    expect(outcomeWithPlain('lossy')).toBe('Requires review (loses detail)');
    expect(outcomeWithPlain('unsupported')).toBe('Unsupported (cannot move)');
    expect(outcomeWithPlain('supported')).toBe('Preserved (moves as-is)');
    expect(outcomeWithPlain('transformed')).toBe('Transformed (changes shape)');
  });
});

describe('severity and run status styling', () => {
  it('maps severities', () => {
    expect(severityMeta('error')).toMatchObject({ label: 'Error', tone: 'bad' });
    expect(severityMeta('warning')).toMatchObject({ label: 'Warning', tone: 'warn' });
    expect(severityMeta('info')).toMatchObject({ label: 'Info', tone: 'info' });
    expect(severityMeta('odd')).toMatchObject({ label: 'odd', tone: 'neutral' });
  });

  it('draws verified and the two failures as the strong run-level chips', () => {
    expect(runStatusStyle('verified')).toEqual({ icon: 'verified', solid: true });
    expect(runStatusStyle('failed')).toEqual({ icon: 'failed', solid: true });
    expect(runStatusStyle('verification_failed')).toEqual({ icon: 'failed', solid: true });
    expect(runStatusStyle('applying').solid).toBe(false);
    expect(runStatusStyle('applied').solid).toBe(false);
    expect(runStatusStyle('something_new').solid).toBe(false);
  });
});
