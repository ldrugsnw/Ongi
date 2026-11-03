import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, createSnapshot, formatRemaining, reconcile, remainingMs, transition, validateSettings,
} from '../src/timer/model.ts';
import type { TimerEvent, TimerSnapshot, TimerState } from '../src/timer/model.ts';

const minute = 60_000;
const start = (nowMs = 1000): TimerSnapshot => transition(
  { version: 1, settings: { focusMs: minute, restMs: 2 * minute }, timer: { status: 'idle' } },
  { type: 'START_FOCUS', sessionId: 'focus-1' }, nowMs,
);
const act = (snapshot: TimerSnapshot, type: 'PAUSE' | 'RESUME' | 'CONFIRM_RESET' | 'DISMISS_COMPLETION',
  nowMs: number, sessionId = 'focus-1') => transition(snapshot, { type, sessionId }, nowMs);
const tick = (snapshot: TimerSnapshot, nowMs: number) => transition(snapshot, { type: 'TICK' }, nowMs);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('defaults are frozen and snapshots have independent settings and timer values', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { focusMs: 25 * minute, restMs: 5 * minute });
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  assert.throws(() => Object.assign(DEFAULT_SETTINGS, { focusMs: minute }), TypeError);
  const first = createSnapshot();
  const second = createSnapshot();
  assert.notEqual(first.settings, second.settings);
  assert.notEqual(first.timer, second.timer);
  first.settings.focusMs = minute;
  assert.equal(second.settings.focusMs, 25 * minute);
});

test('settings accept exact integer minutes at both range boundaries and copy known fields', () => {
  for (const settings of [{ focusMs: minute, restMs: minute }, { focusMs: 180 * minute, restMs: 60 * minute }]) {
    const result = validateSettings({ ...settings, ignored: true });
    assert.deepEqual(result, settings);
    assert.notEqual(result, settings);
  }
});

test('settings reject wrong shapes, types, fractional minutes and out of range values', () => {
  for (const input of [null, undefined, [], 'settings', 1, {}, { focusMs: minute }]) {
    assert.equal(validateSettings(input), null);
  }
  for (const key of ['focusMs', 'restMs']) {
    for (const value of ['60000', NaN, Infinity, -Infinity, 0, -minute, minute - 1, minute + 1, minute + 0.5,
      key === 'focusMs' ? 181 * minute : 61 * minute]) {
      assert.equal(validateSettings({ focusMs: minute, restMs: minute, [key]: value }), null, `${key}: ${value}`);
    }
  }
});

test('settings change only in idle and are copied before a focus session starts', () => {
  const settings = { focusMs: 3 * minute, restMs: 4 * minute };
  const idle = transition(createSnapshot(), { type: 'SET_SETTINGS', settings }, 0);
  settings.focusMs = minute;
  assert.equal(idle.settings.focusMs, 3 * minute);
  const running = transition(idle, { type: 'START_FOCUS', sessionId: 'new' }, 10);
  assert.deepEqual(running.timer, { status: 'running', session: { id: 'new', phase: 'focus', durationMs: 3 * minute },
    elapsedBeforeRunMs: 0, runStartedAtMs: 10 });
  for (const snapshot of [running, act(running, 'PAUSE', 11, 'new'), tick(running, 3 * minute + 10)]) {
    assert.equal(transition(snapshot, { type: 'SET_SETTINGS', settings }, 3 * minute + 10).settings, idle.settings);
  }
  assert.equal(transition(idle, { type: 'SET_SETTINGS', settings: { focusMs: 0, restMs: minute } }, 0), idle);
});

test('remaining time reaches zero at the exact deadline and reconcile records that deadline', () => {
  const running = start();
  assert.equal(remainingMs(running.timer, 1000), minute);
  assert.equal(remainingMs(running.timer, 60_999), 1);
  assert.equal(remainingMs(running.timer, 61_000), 0);
  assert.equal(reconcile(running.timer, 60_999), running.timer);
  const completed = reconcile(running.timer, 90_000);
  assert.deepEqual(completed, { status: 'completed', session: { id: 'focus-1', phase: 'focus', durationMs: minute },
    completedAtMs: 61_000, dialogDismissed: false });
  assert.equal(remainingMs(completed, 100_000), 0);
  assert.equal(remainingMs({ status: 'idle' }, 0), 0);
});

test('multiple pause and resume cycles count only running intervals', () => {
  let snapshot = act(start(), 'PAUSE', 11_000);
  assert.equal(remainingMs(snapshot.timer, 100_000), 50_000);
  assert.equal(act(snapshot, 'PAUSE', 100_000), snapshot);
  snapshot = act(snapshot, 'RESUME', 100_000);
  assert.equal(act(snapshot, 'RESUME', 101_000), snapshot);
  snapshot = act(snapshot, 'PAUSE', 120_000);
  assert.deepEqual(snapshot.timer, { status: 'paused', session: { id: 'focus-1', phase: 'focus', durationMs: minute }, elapsedMs: 30_000 });
  snapshot = act(snapshot, 'RESUME', 200_000);
  assert.equal(remainingMs(snapshot.timer, 229_999), 1);
  assert.deepEqual(tick(snapshot, 999_999).timer, { status: 'completed',
    session: { id: 'focus-1', phase: 'focus', durationMs: minute }, completedAtMs: 230_000, dialogDismissed: false });
});

test('pause on or after expiration completes instead of capturing an invalid paused state', () => {
  for (const now of [61_000, 61_001, 100_000]) {
    const result = act(start(), 'PAUSE', now);
    assert.equal(result.timer.status, 'completed');
    if (result.timer.status === 'completed') assert.equal(result.timer.completedAtMs, 61_000);
  }
});

test('clock rollback clamps only the current run and preserves committed elapsed time', () => {
  const initial = start(10_000);
  assert.equal(remainingMs(initial.timer, 100), minute);
  const pausedBeforeStart = act(initial, 'PAUSE', 100);
  assert.equal(remainingMs(pausedBeforeStart.timer, 0), minute);
  const paused = act(initial, 'PAUSE', 20_000);
  const resumed = act(paused, 'RESUME', 30_000);
  assert.equal(remainingMs(resumed.timer, 5000), 50_000);
  assert.equal(reconcile(resumed.timer, 5000), resumed.timer);
  const pausedAgain = act(resumed, 'PAUSE', 5000);
  assert.equal(remainingMs(pausedAgain.timer, 1_000_000), 50_000);
  const restarted = act(pausedAgain, 'RESUME', 100);
  const completed = tick(restarted, 50_100);
  assert.equal(completed.timer.status, 'completed');
  if (completed.timer.status === 'completed') assert.equal(completed.timer.completedAtMs, 50_100);
});

test('completion never automatically starts another phase and dismissal survives ticks and clock rollback', () => {
  const completed = tick(start(), 61_000);
  assert.equal(tick(completed, 1_000_000), completed);
  assert.equal(act(completed, 'DISMISS_COMPLETION', 62_000, 'stale'), completed);
  const dismissed = act(completed, 'DISMISS_COMPLETION', 62_000);
  assert.deepEqual(dismissed.timer, { ...completed.timer, dialogDismissed: true });
  assert.equal(tick(dismissed, 0), dismissed);
  assert.equal(act(dismissed, 'DISMISS_COMPLETION', 0), dismissed);
  assert.equal(act(dismissed, 'RESUME', 0), dismissed);
  assert.equal(act(dismissed, 'PAUSE', 0), dismissed);
});

test('focus starts only from idle or completed; rest starts only from completed focus with a new ID', () => {
  const running = start();
  const paused = act(running, 'PAUSE', 2000);
  for (const snapshot of [createSnapshot(), running, paused]) {
    assert.equal(transition(snapshot, { type: 'START_REST', sessionId: 'rest' }, 2000), snapshot);
  }
  for (const snapshot of [running, paused]) {
    assert.equal(transition(snapshot, { type: 'START_FOCUS', sessionId: 'new' }, 2000), snapshot);
  }
  const completed = tick(running, 61_000);
  for (const type of ['START_FOCUS', 'START_REST'] as const) {
    for (const sessionId of ['', ' \t\n', 'focus-1', null, 123]) {
      assert.equal(transition(completed, { type, sessionId } as TimerEvent, 61_000), completed);
    }
  }
  const rest = transition(completed, { type: 'START_REST', sessionId: 'rest-1' }, 70_000);
  assert.deepEqual(rest.timer, { status: 'running', session: { id: 'rest-1', phase: 'rest', durationMs: 2 * minute },
    elapsedBeforeRunMs: 0, runStartedAtMs: 70_000 });
  const restCompleted = tick(rest, 190_000);
  assert.equal(transition(restCompleted, { type: 'START_REST', sessionId: 'rest-2' }, 190_000), restCompleted);
  assert.equal(transition(restCompleted, { type: 'START_FOCUS', sessionId: 'focus-2' }, 190_000).timer.status, 'running');
  assert.equal(transition(completed, { type: 'START_FOCUS', sessionId: 'focus-2' }, 70_000).timer.status, 'running');
});

test('reset requires matching ID in every active state and retains chosen settings', () => {
  const running = start();
  for (const snapshot of [running, act(running, 'PAUSE', 2000), tick(running, 61_000)]) {
    const now = snapshot.timer.status === 'completed' ? 61_000 : 2000;
    assert.equal(act(snapshot, 'CONFIRM_RESET', now, 'stale'), snapshot);
    const reset = act(snapshot, 'CONFIRM_RESET', now);
    assert.deepEqual(reset.timer, { status: 'idle' });
    assert.equal(reset.settings, snapshot.settings);
  }
  const next = transition(tick(running, 61_000), { type: 'START_FOCUS', sessionId: 'focus-2' }, 70_000);
  assert.equal(act(next, 'CONFIRM_RESET', 70_000), next);
  const idle = createSnapshot();
  assert.equal(act(idle, 'CONFIRM_RESET', 0), idle);
});

test('stale or otherwise disallowed actions still reconcile expiration first', () => {
  for (const event of [
    { type: 'PAUSE', sessionId: 'stale' }, { type: 'RESUME', sessionId: 'focus-1' },
    { type: 'CONFIRM_RESET', sessionId: 'stale' }, { type: 'START_FOCUS', sessionId: 'focus-1' },
    { type: 'SET_SETTINGS', settings: { focusMs: minute, restMs: minute } },
  ] as TimerEvent[]) {
    const result = transition(start(), event, 100_000);
    assert.equal(result.timer.status, 'completed');
    assert.deepEqual(result.settings, start().settings);
  }
});

test('invalid now values throw RangeError for every time consuming API, including idle', () => {
  for (const now of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
    assert.throws(() => remainingMs({ status: 'idle' }, now as number), RangeError);
    assert.throws(() => reconcile({ status: 'idle' }, now as number), RangeError);
    assert.throws(() => transition(createSnapshot(), { type: 'TICK' }, now as number), RangeError);
  }
  assert.equal(remainingMs(start(0).timer, Number.MAX_SAFE_INTEGER), 0);
});

test('formatting rounds up partial seconds, clamps negatives and allows three digit minutes', () => {
  for (const [ms, formatted] of [[0, '00:00'], [-1, '00:00'], [0.1, '00:01'], [999, '00:01'],
    [1000, '00:01'], [1001, '00:02'], [59_001, '01:00'], [60_001, '01:01'], [180 * minute, '180:00']] as const) {
    assert.equal(formatRemaining(ms), formatted);
  }
  for (const ms of [NaN, Infinity, -Infinity]) assert.throws(() => formatRemaining(ms), RangeError);
});

test('transitions and time queries do not mutate frozen snapshots or events', () => {
  const running = freeze(start());
  const original = structuredClone(running);
  const events: TimerEvent[] = [
    { type: 'PAUSE', sessionId: 'focus-1' }, { type: 'CONFIRM_RESET', sessionId: 'focus-1' },
    { type: 'START_REST', sessionId: 'rest-1' }, { type: 'DISMISS_COMPLETION', sessionId: 'focus-1' },
    { type: 'SET_SETTINGS', settings: { focusMs: 2 * minute, restMs: minute } }, { type: 'TICK' },
  ];
  for (const event of events) {
    freeze(event);
    const before = structuredClone(event);
    transition(running, event, 2000);
    transition(running, event, 100_000);
    assert.deepEqual(event, before);
  }
  remainingMs(running.timer, 2000);
  reconcile(running.timer, 100_000);
  assert.deepEqual(running, original);
  const paused = freeze(act(running, 'PAUSE', 2000));
  act(paused, 'RESUME', 3000);
  const completed = freeze(tick(running, 61_000));
  act(completed, 'DISMISS_COMPLETION', 61_000);
  assert.equal((completed.timer as Extract<TimerState, { status: 'completed' }>).dialogDismissed, false);
});
