import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, running } from './timer-runtime-harness.ts';
import { createBrowserRuntimeDeps } from '../src/timer/useFocusTimer.ts';
import { createTimerController } from '../src/timer/controller.ts';

test('view reference changes only with observable state; no-op settings do not write', () => {
  const h = harness();
  let updates = 0;
  const unsubscribe = h.controller.subscribe(() => { updates++; });
  const initial = h.controller.getView();
  h.controller.start();
  h.controller.actions.setSettings({ focusMs: 1500000, restMs: 300000 });
  assert.equal(h.controller.getView(), initial);
  assert.equal(h.writes, 0);
  h.controller.actions.startFocus();
  const started = h.controller.getView();
  assert.equal(started, h.controller.getView());
  h.tick(1250);
  assert.notEqual(h.controller.getView(), started);
  assert.equal(h.writes, 1);
  assert.equal(updates, 2);
  unsubscribe();
  h.tick(1500);
  assert.equal(updates, 2);
});

test('start/dispose/start retains state and subscriptions with one lifecycle and scheduler', () => {
  const h = harness(); h.begin();
  let updates = 0;
  const off = h.controller.subscribe(() => updates++);
  const stale = [...h.jobs][0];
  h.controller.start();
  assert.equal(h.lifecycle.size, 1); assert.equal(h.jobs.size, 1);
  h.controller.dispose(); h.controller.dispose();
  assert.equal(h.lifecycle.size, 0); assert.equal(h.jobs.size, 0);
  h.setNow(2000); stale();
  assert.equal(updates, 0);
  h.controller.start();
  assert.equal(updates, 1);
  assert.equal(h.lifecycle.size, 1); assert.equal(h.jobs.size, 1);
  off(); h.controller.dispose();
  assert.equal(h.lifecycle.size, 0); assert.equal(h.jobs.size, 0);
});

test('running restore counts epoch time; expired restore is silent', () => {
  const h = harness(running);
  assert.equal(h.controller.getView().remainingMs, 59000);
  h.setNow(70000); h.controller.start();
  assert.equal(h.controller.getView().snapshot.timer.status, 'completed');
  assert.equal(h.audio.played, 0);
  assert.equal(h.writes, 1);
  assert.equal(h.jobs.size, 0);
});

test('paused and dismissed completed restore without schedules or notifications', () => {
  const session = running.timer.status === 'running' ? running.timer.session : null!;
  for (const timer of [
    { status: 'paused' as const, session, elapsedMs: 12345 },
    { status: 'completed' as const, session, completedAtMs: 60000, dialogDismissed: true },
  ]) {
    const h = harness({ ...running, timer }); h.controller.start(); h.tick(999999);
    assert.deepEqual(h.controller.getView().snapshot.timer, timer);
    assert.equal(h.jobs.size, 0); assert.equal(h.audio.played, 0); assert.equal(h.writes, 0);
  }
});

test('invalid storage falls back and read/write failures stay in memory with unavailable flag', () => {
  const invalid = harness('{broken'); invalid.controller.start();
  assert.equal(invalid.controller.getView().snapshot.timer.status, 'idle');
  for (const failure of ['read', 'write', 'missing'] as const) {
    const h = harness(undefined, failure); h.begin(); h.tick(1500);
    assert.equal(h.controller.getView().persistenceAvailable, false);
    assert.equal(h.controller.getView().remainingMs, 59500);
    h.controller.actions.pause('session-1');
    assert.equal(h.writes, failure === 'write' ? 1 : 0);
  }
});

test('browser localStorage getter failure is contained without module-load browser access', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    get localStorage() { throw Error('security'); },
  } });
  try { assert.equal(createBrowserRuntimeDeps().storage, null); }
  finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('hide cancels pending callback, return reconciles expired time silently', () => {
  const h = harness(); h.begin(); const stale = [...h.jobs][0];
  h.event('hidden', 2000);
  assert.equal(h.jobs.size, 0);
  h.setNow(61000); stale();
  assert.equal(h.controller.getView().snapshot.timer.status, 'running');
  h.event('visible', 62000);
  assert.equal(h.controller.getView().snapshot.timer.status, 'completed');
  assert.equal(h.audio.played, 0); assert.equal(h.jobs.size, 0);
});

test('focus/pageshow expiry and focus-created visibility interval cannot produce sound', () => {
  for (const event of ['focus', 'pageshow'] as const) {
    const h = harness(); h.begin(); h.event(event, 61000);
    assert.equal(h.controller.getView().snapshot.timer.status, 'completed');
    assert.equal(h.audio.played, 0);
  }
  const h = harness(); h.begin(); h.event('hidden'); h.event('visible', 60900); h.tick(61000);
  assert.equal(h.audio.played, 1); // A new visible interval includes deadline and a live callback.
});

test('continuous visible callbacks play once and completion dismissal never retries', () => {
  const h = harness(); h.begin();
  for (let now = 1250; now <= 61000; now += 250) h.tick(now);
  assert.equal(h.audio.played, 1); assert.equal(h.writes, 3); // settings/start/completion
  h.controller.actions.dismissCompletion('session-1');
  h.event('focus'); h.controller.dispose(); h.controller.start();
  assert.equal(h.audio.played, 1);
  assert.equal(h.jobs.size, 0);
});

test('long suspension suppresses sound even if deadline lateness is zero', () => {
  const h = harness(); h.begin(); h.tick(61000);
  assert.equal(h.controller.getView().snapshot.timer.status, 'completed');
  assert.equal(h.audio.played, 0);
});

test('lateness guard suppresses sound and cancelled callback cannot act on a replacement', () => {
  const h = harness(); h.begin(); h.tick(60500); h.tick(63000);
  assert.equal(h.audio.played, 0);
  h.controller.actions.startFocus();
  const stale = [...h.jobs][0];
  h.controller.actions.confirmReset('session-2');
  h.controller.actions.startFocus();
  h.setNow(64000); stale();
  assert.equal(h.controller.getView().remainingMs, 60000);
  assert.equal(h.jobs.size, 1);
});

test('pause/resume/reset races preserve current session and user gesture prepare is synchronous', () => {
  const h = harness(); h.begin();
  assert.equal(h.audio.prepared, 1);
  h.setNow(2000); h.controller.actions.pause('session-1');
  assert.equal(h.jobs.size, 0);
  h.setNow(10000); h.controller.actions.resume('session-1');
  assert.equal(h.audio.prepared, 2);
  assert.equal(h.controller.getView().remainingMs, 59000);
  h.setNow(69000); h.controller.actions.pause('session-1');
  assert.equal(h.controller.getView().snapshot.timer.status, 'completed');
  assert.equal(h.audio.played, 0);
  h.controller.actions.startRest();
  h.controller.actions.confirmReset('session-1');
  const timer = h.controller.getView().snapshot.timer;
  assert.equal(timer.status, 'running');
  if (timer.status === 'running') assert.equal(timer.session.phase, 'rest');
  assert.equal(h.jobs.size, 1);
});

test('epoch clock reversal clamps elapsed and resume retains confirmed progress', () => {
  const h = harness(); h.begin(); h.tick(500);
  assert.equal(h.controller.getView().remainingMs, 60000);
  h.setNow(3000); h.controller.actions.pause('session-1');
  h.setNow(2000); h.controller.actions.resume('session-1'); h.tick(1500);
  assert.equal(h.controller.getView().remainingMs, 58000);
});

test('listener may dispatch a reset without leaving scheduler resources', () => {
  const h = harness(); h.begin();
  const off = h.controller.subscribe(() => {
    if (h.controller.getView().snapshot.timer.status === 'completed') h.controller.actions.confirmReset('session-1');
  });
  h.tick(62000);
  assert.equal(h.controller.getView().snapshot.timer.status, 'idle');
  assert.equal(h.jobs.size, 0); off(); h.controller.dispose();
});

test('construction of an already expired stored run is silent, including repeat lifecycle events', () => {
  const stored = { ...running, timer: running.timer.status === 'running'
    ? { ...running.timer, runStartedAtMs: 0, elapsedBeforeRunMs: 59999 } : running.timer };
  const h = harness(stored);
  assert.equal(h.controller.getView().snapshot.timer.status, 'completed');
  h.controller.start(); h.event('pageshow'); h.event('focus');
  assert.equal(h.audio.played, 0); assert.equal(h.jobs.size, 0); assert.equal(h.writes, 0);
});

test('browser adapter removes exact lifecycle handlers and cancels its timer', () => {
  const descriptors = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const events = new Map<string, () => void>();
  const timeouts = new Map<number, () => void>();
  const target = {
    addEventListener(type: string, fn: () => void) { events.set(type, fn); },
    removeEventListener(type: string, fn: () => void) { assert.equal(events.get(type), fn); events.delete(type); },
  };
  const document = { ...target, visibilityState: 'visible' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    ...target, localStorage: null,
    setTimeout(fn: () => void) { timeouts.set(1, fn); return 1; },
    clearTimeout(id: number) { timeouts.delete(id); },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  try {
    const deps = createBrowserRuntimeDeps();
    const received: string[] = [];
    const off = deps.onLifecycle(event => received.push(event));
    assert.equal(events.size, 3);
    document.visibilityState = 'hidden'; events.get('visibilitychange')!();
    document.visibilityState = 'visible'; events.get('visibilitychange')!();
    events.get('pageshow')!(); events.get('focus')!();
    assert.deepEqual(received, ['hidden', 'visible', 'pageshow', 'focus']);
    const cancel = deps.schedule(() => {}, 250);
    assert.equal(timeouts.size, 1); cancel(); assert.equal(timeouts.size, 0);
    off(); assert.equal(events.size, 0);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('browser adapter uses randomUUID when available', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const crypto = { randomUUID() { assert.equal(this, crypto); return 'native-uuid'; } };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: null } });
  try { assert.equal(createBrowserRuntimeDeps().createSessionId(), 'native-uuid'); }
  finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else Reflect.deleteProperty(globalThis, 'crypto');
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('browser Start works without randomUUID using getRandomValues and distinct replacement IDs', () => {
  let randomCalls = 0;
  verifyFallbackStarts({ getRandomValues(bytes: Uint8Array) { randomCalls++; bytes.fill(42); return bytes; } });
  assert.equal(randomCalls, 2);
});

test('browser Start works when crypto is absent or both crypto methods fail', () => {
  verifyFallbackStarts(undefined);
  verifyFallbackStarts({
    randomUUID() { throw Error('unavailable'); },
    getRandomValues() { throw Error('unavailable'); },
  });
});

function verifyFallbackStarts(crypto: unknown) {
  const descriptors = ['window', 'document', 'crypto'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const target = { addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    ...target, localStorage: null, setTimeout: () => 1, clearTimeout() {},
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { ...target, visibilityState: 'visible' } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  const controller = createTimerController(createBrowserRuntimeDeps());
  try {
    controller.start();
    assert.doesNotThrow(() => controller.actions.startFocus());
    const first = controller.getView().snapshot.timer;
    assert.equal(first.status, 'running');
    if (first.status !== 'running') assert.fail('Start must create a running session');
    assert.match(first.session.id, /^ongi-.+/);
    controller.actions.confirmReset(first.session.id);
    controller.actions.startFocus();
    const second = controller.getView().snapshot.timer;
    assert.equal(second.status, 'running');
    if (second.status === 'running') assert.notEqual(second.session.id, first.session.id);
  } finally {
    controller.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
