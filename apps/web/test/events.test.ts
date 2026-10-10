import { describe, expect, it } from 'vitest';
import { describeEvent, eventLevelChip, humanizeEventType } from '../src/lib/events';

const event = (type: string, message = '') => ({ type, message });

describe('event labels', () => {
  it('names what the engine writes', () => {
    expect(describeEvent(event('approved', 'Plan plan_x approved.')).label).toBe('Plan approved');
    expect(describeEvent(event('run_started', 'Run started.')).label).toBe('Run started');
    expect(describeEvent(event('run_started', 'Resuming run.')).label).toBe('Run resumed');
    expect(describeEvent(event('run_finished', 'All actions applied.')).label).toBe('Run finished');
    expect(describeEvent(event('action_failed', 'Create task "x": HTTP 500')).label).toBe(
      'Write failed',
    );
    expect(describeEvent(event('run_stopped', 'Stopped after 5 consecutive failures.')).label).toBe(
      'Run stopped',
    );
    expect(describeEvent(event('assume_not_created', 'Operator confirmed')).label).toBe(
      'Confirmed not created',
    );
  });

  it('tells a created item from a link from anything else that was written', () => {
    expect(describeEvent(event('action_succeeded', 'Create task "A" in list "B"'))).toMatchObject({
      label: 'Created',
      icon: 'plus',
    });
    expect(describeEvent(event('action_succeeded', 'Create Doc "Handbook"')).label).toBe('Created');
    expect(describeEvent(event('action_succeeded', 'Create page "P" (sub-page)')).label).toBe(
      'Created',
    );
    expect(describeEvent(event('action_succeeded', 'Link "A" ↔ "B"'))).toMatchObject({
      label: 'Linked',
      icon: 'link',
    });
    expect(describeEvent(event('action_succeeded', 'Wrote something')).label).toBe('Written');
  });

  it('describes recovery after a lost reply, by what the check found', () => {
    expect(describeEvent(event('action_reconciled', 'Create task "A": found'))).toMatchObject({
      label: 'Recovered after a lost reply',
      known: true,
    });
    expect(describeEvent(event('action_reconciled', 'Create task "A": not_found')).label).toBe(
      'Checked after a lost reply: not found',
    );
    expect(describeEvent(event('action_reconciled', 'Create task "A": undecidable')).label).toBe(
      'Could not confirm after a lost reply',
    );
    expect(describeEvent(event('action_reconciled', 'no status here')).label).toBe(
      'Checked after a lost reply',
    );
  });

  it('says whether verification passed, failed or was incomplete', () => {
    expect(
      describeEvent(event('verification', 'Verification passed: 175 verified, 0 mismatched.')),
    ).toMatchObject({ label: 'Verification passed', icon: 'verified', tone: 'ok' });
    expect(
      describeEvent(event('verification', 'Verification failed: 1 mismatched.')),
    ).toMatchObject({ label: 'Verification failed', icon: 'failed', tone: 'bad' });
    expect(
      describeEvent(event('verification', 'Verification incomplete: 3 unverified.')).label,
    ).toBe('Verification incomplete');
    expect(describeEvent(event('verification', 'something else')).label).toBe('Verification');
  });

  it('has wording for a rate-limit wait should the engine record one', () => {
    for (const type of ['rate_limit', 'rate_limited', 'rate_limit_wait']) {
      expect(describeEvent(event(type, 'Waiting 30 s'))).toMatchObject({
        label: 'Waiting for rate limit',
        icon: 'clock',
      });
    }
  });

  it('never invents a meaning for a type it does not know', () => {
    const unknown = describeEvent(event('some_new_event', 'x'));
    expect(unknown).toMatchObject({ label: 'Some new event', icon: 'info', known: false });
    expect(humanizeEventType('a-b.c__d')).toBe('A b c d');
    expect(humanizeEventType('')).toBe('Event');
    expect(humanizeEventType('x'.repeat(100))).toHaveLength(48);
  });

  it('shows hostile text as plain text (it is only ever rendered by React as text)', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    expect(describeEvent(event(hostile)).label).toBe(hostile);
  });

  it('gives only warnings and errors a coloured chip', () => {
    expect(eventLevelChip('info')).toBeNull();
    expect(eventLevelChip('warn')).toEqual({ label: 'Warning', tone: 'warn', icon: 'warning' });
    expect(eventLevelChip('error')).toEqual({ label: 'Error', tone: 'bad', icon: 'cross' });
    expect(eventLevelChip('debug')).toBeNull();
  });
});
