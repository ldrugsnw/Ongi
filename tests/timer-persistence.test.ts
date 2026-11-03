import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, transition } from '../src/timer/model.ts';
import type { TimerSnapshot, TimerState } from '../src/timer/model.ts';
import { TIMER_STORAGE_KEY, decodeSnapshot, readSnapshot, restoreSnapshot, saveSnapshot } from '../src/timer/persistence.ts';

const minute = 60_000;
const session = { id: 'saved-focus', phase: 'focus' as const, durationMs: minute };
const snapshot = (timer: TimerState): TimerSnapshot => ({ ...createSnapshot(), timer });
const running = (): TimerSnapshot => snapshot({ status: 'running', session: { ...session },
  elapsedBeforeRunMs: 10_000, runStartedAtMs: 100_000 });
const paused = (): TimerSnapshot => snapshot({ status: 'paused', session: { ...session }, elapsedMs: 10_000 });
const completed = (): TimerSnapshot => snapshot({ status: 'completed', session: { ...session },
  completedAtMs: 150_000, dialogDismissed: true });
const raw = (value: unknown) => JSON.stringify(value);

test('all four states round trip and decode returns independent values', () => {
  for (const saved of [createSnapshot(), running(), paused(), completed()]) {
    const decoded = decodeSnapshot(raw(saved));
    assert.deepEqual(decoded, saved);
    assert.notEqual(decoded, saved);
    assert.notEqual(decoded!.settings, saved.settings);
    assert.notEqual(decoded!.timer, saved.timer);
    if (decoded!.timer.status !== 'idle' && saved.timer.status !== 'idle') {
      assert.notEqual(decoded!.timer.session, saved.timer.session);
    }
  }
});

test('null, malformed JSON, nonobjects and missing or unknown versions are invalid', () => {
  for (const value of [null, '', '{', 'NaN', 'undefined', 'null', 'true', '42', '"text"', '[]', '{}',
    raw({ ...createSnapshot(), version: '1' }), raw({ ...createSnapshot(), version: 0 }),
    raw({ ...createSnapshot(), version: 2 }), raw({ settings: createSnapshot().settings, timer: { status: 'idle' } })]) {
    assert.equal(decodeSnapshot(value), null, String(value));
  }
});

test('persisted settings use the same strict integer minute validation', () => {
  for (const settings of [null, [], {}, { focusMs: minute }, { focusMs: '60000', restMs: minute },
    { focusMs: minute - 1, restMs: minute }, { focusMs: minute, restMs: 61 * minute },
    { focusMs: 181 * minute, restMs: minute }, { focusMs: NaN, restMs: Infinity }]) {
    assert.equal(decodeSnapshot(raw({ ...createSnapshot(), settings })), null);
  }
});

test('session ID, phase and phase specific duration are validated independently of settings', () => {
  for (const invalidSession of [null, [], {}, { ...session, id: '' }, { ...session, id: ' \t\n' },
    { ...session, id: 1 }, { ...session, phase: 'unknown' }, { ...session, phase: null },
    { ...session, durationMs: '60000' }, { ...session, durationMs: minute + 1 },
    { ...session, durationMs: 0 }, { ...session, durationMs: 181 * minute },
    { ...session, phase: 'rest', durationMs: 61 * minute }]) {
    assert.equal(decodeSnapshot(raw({ ...running(), timer: { ...running().timer, session: invalidSession } })), null);
  }
  for (const [phase, durationMs] of [['focus', 180 * minute], ['rest', 60 * minute], ['rest', minute]] as const) {
    const saved = snapshot({ status: 'paused', session: { ...session, phase, durationMs }, elapsedMs: 0 });
    assert.deepEqual(decodeSnapshot(raw(saved)), saved);
  }
});

test('unknown or malformed states and missing required state fields are rejected', () => {
  for (const timer of [null, [], {}, { status: 'unknown' }, { status: 'running', session },
    { status: 'paused', session }, { status: 'completed', session }, { status: 'paused', elapsedMs: 0 },
    { status: 'completed', session, completedAtMs: 0 },
    { status: 'completed', session, dialogDismissed: false }]) {
    assert.equal(decodeSnapshot(raw({ ...createSnapshot(), timer })), null);
  }
});

test('elapsed values must be safe nonnegative integers strictly below duration', () => {
  for (const [base, key] of [[running(), 'elapsedBeforeRunMs'], [paused(), 'elapsedMs']] as const) {
    for (const value of [-1, 0.5, minute, minute + 1, Number.MAX_SAFE_INTEGER, '0', null, NaN, Infinity, -Infinity]) {
      assert.equal(decodeSnapshot(raw({ ...base, timer: { ...base.timer, [key]: value } })), null, `${key}: ${value}`);
    }
    for (const value of [0, minute - 1]) {
      const saved = { ...base, timer: { ...base.timer, [key]: value } };
      assert.deepEqual(decodeSnapshot(raw(saved)), saved);
    }
  }
});

test('timestamps reject negatives, fractions, strings, nonfinite and unsafe integers', () => {
  for (const [base, key] of [[running(), 'runStartedAtMs'], [completed(), 'completedAtMs']] as const) {
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null, NaN, Infinity, -Infinity]) {
      assert.equal(decodeSnapshot(raw({ ...base, timer: { ...base.timer, [key]: value } })), null, `${key}: ${value}`);
    }
    const zero = { ...base, timer: { ...base.timer, [key]: 0 } };
    assert.deepEqual(decodeSnapshot(raw(zero)), zero);
  }
  // JSON numeric overflow parses as Infinity rather than null.
  const overflow = raw(running()).replace('"runStartedAtMs":100000', '"runStartedAtMs":1e309');
  assert.equal(decodeSnapshot(overflow), null);
});

test('the calculated deadline must remain safe, including elapsed time in the calculation', () => {
  const lastStart = Number.MAX_SAFE_INTEGER - 50_000;
  const valid = snapshot({ status: 'running', session, elapsedBeforeRunMs: 10_000, runStartedAtMs: lastStart });
  assert.deepEqual(decodeSnapshot(raw(valid)), valid);
  const invalid = { ...valid, timer: { ...valid.timer, runStartedAtMs: lastStart + 1 } };
  assert.equal(decodeSnapshot(raw(invalid)), null);
  const restored = restoreSnapshot(raw(valid), Number.MAX_SAFE_INTEGER);
  assert.equal(restored.timer.status, 'completed');
  if (restored.timer.status === 'completed') assert.equal(restored.timer.completedAtMs, Number.MAX_SAFE_INTEGER);
});

test('completion dismissal must be a boolean and future timestamps remain valid', () => {
  for (const dialogDismissed of [undefined, null, 'false', 0, 1]) {
    assert.equal(decodeSnapshot(raw({ ...completed(), timer: { ...completed().timer, dialogDismissed } })), null);
  }
  for (const dialogDismissed of [true, false]) {
    const saved = snapshot({ status: 'completed', session, completedAtMs: Number.MAX_SAFE_INTEGER, dialogDismissed });
    assert.deepEqual(restoreSnapshot(raw(saved), 0), saved);
  }
});

test('decoding discards unknown fields at every level, including irrelevant state fields', () => {
  const saved = running();
  const extended = { ...saved, unknown: true, settings: { ...saved.settings, unknown: true },
    timer: { ...saved.timer, unknown: true, elapsedMs: minute,
      session: { ...session, unknown: true } } };
  assert.deepEqual(decodeSnapshot(raw(extended)), saved);
  assert.deepEqual(decodeSnapshot(raw({ ...createSnapshot(), timer: { status: 'idle', session, unknown: true } })), createSnapshot());
  for (const value of [paused(), completed()]) {
    assert.deepEqual(decodeSnapshot(raw({ ...value, timer: { ...value.timer, unknown: true,
      session: { ...session, unknown: true } } })), value);
  }
});

test('restoration reconciles overdue and exact deadline running sessions without starting another phase', () => {
  for (const now of [150_000, 150_001, 9_000_000]) {
    const result = restoreSnapshot(raw(running()), now);
    assert.deepEqual(result.timer, { status: 'completed', session, completedAtMs: 150_000, dialogDismissed: false });
    assert.deepEqual(result.settings, running().settings);
  }
  assert.deepEqual(restoreSnapshot(raw(running()), 149_999), running());
  assert.deepEqual(restoreSnapshot(raw(running()), 0), running());
});

test('paused, idle and dismissed completed snapshots survive restoration without effects', () => {
  for (const value of [createSnapshot(), paused(), completed()]) {
    for (const now of [0, 9_000_000]) assert.deepEqual(restoreSnapshot(raw(value), now), value);
  }
  const restored = restoreSnapshot(raw(paused()), 200_000);
  const resumed = transition(restored, { type: 'RESUME', sessionId: session.id }, 200_000);
  const done = transition(resumed, { type: 'TICK' }, 250_000);
  assert.deepEqual(done.timer, { status: 'completed', session, completedAtMs: 250_000, dialogDismissed: false });
});

test('missing and invalid saves restore independent default idle snapshots', () => {
  for (const value of [null, '{', '{}', raw({ ...running(), version: 2 })]) {
    const result = restoreSnapshot(value, 100);
    assert.deepEqual(result, createSnapshot());
    result.settings.focusMs = minute;
    assert.deepEqual(restoreSnapshot(value, 100), createSnapshot());
  }
});

test('reading distinguishes stored, missing, invalid and unavailable and uses the agreed key', () => {
  assert.equal(TIMER_STORAGE_KEY, 'ongi.timer.v1');
  for (const [value, source] of [[raw(running()), 'stored'], [null, 'missing'], ['', 'invalid'], ['{', 'invalid']] as const) {
    const result = readSnapshot({ getItem(key) { assert.equal(key, TIMER_STORAGE_KEY); return value; } }, 200_000);
    assert.equal(result.source, source);
    assert.deepEqual(result.snapshot, restoreSnapshot(value, 200_000));
  }
  assert.deepEqual(readSnapshot({ getItem() { throw new Error('denied'); } }, 0),
    { source: 'unavailable', snapshot: createSnapshot() });
});

test('invalid now throws for restore and read regardless of missing, invalid or inaccessible storage', () => {
  for (const now of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const value of [null, '{', raw(running())]) {
      assert.throws(() => restoreSnapshot(value, now), RangeError);
      assert.throws(() => readSnapshot({ getItem: () => value }, now), RangeError);
    }
    assert.throws(() => readSnapshot({ getItem() { throw new Error('denied'); } }, now), RangeError);
  }
});

test('save writes serializable snapshots to the agreed key and reports storage errors', () => {
  const saved = completed();
  const before = structuredClone(saved);
  let calls = 0;
  assert.equal(saveSnapshot({ setItem(key, value) {
    calls++;
    assert.equal(key, TIMER_STORAGE_KEY);
    assert.deepEqual(decodeSnapshot(value), saved);
  } }, saved), true);
  assert.equal(calls, 1);
  assert.deepEqual(saved, before);
  assert.equal(saveSnapshot({ setItem() { throw new Error('quota exceeded'); } }, saved), false);
});

test('save catches serialization failures before calling storage', () => {
  const circular = createSnapshot();
  Object.assign(circular, { circular });
  const throwsOnSerialize = Object.assign(createSnapshot(), { toJSON() { throw new Error('serialize'); } });
  let calls = 0;
  for (const saved of [circular, throwsOnSerialize]) {
    assert.equal(saveSnapshot({ setItem() { calls++; } }, saved), false);
  }
  assert.equal(calls, 0);
});

test('save and restore accept deeply frozen inputs without mutation', () => {
  const saved = running();
  if (saved.timer.status !== 'running') throw new Error('expected running');
  Object.freeze(saved.timer.session);
  Object.freeze(saved.timer);
  Object.freeze(saved.settings);
  Object.freeze(saved);
  const serialized = raw(saved);
  assert.equal(saveSnapshot({ setItem(_key, value) { assert.equal(value, serialized); } }, saved), true);
  restoreSnapshot(serialized, 200_000);
  assert.equal(raw(saved), serialized);
});
