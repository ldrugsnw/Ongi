import { createSnapshot, remainingMs, transition } from './model.ts';
import type { Settings, TimerEvent, TimerSnapshot } from './model.ts';
import { readSnapshot, saveSnapshot } from './persistence.ts';

export type TimerView = { snapshot: TimerSnapshot; remainingMs: number; persistenceAvailable: boolean };
export type TimerActions = {
  setSettings(settings: Settings): void;
  startFocus(): void;
  startRest(): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  confirmReset(sessionId: string): void;
  dismissCompletion(sessionId: string): void;
};
export type RuntimeDeps = {
  now(): number;
  createSessionId(): string;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  schedule(callback: () => void, delayMs: number): () => void;
  isVisible(): boolean;
  onLifecycle(callback: (event: 'hidden' | 'visible' | 'pageshow' | 'focus') => void): () => void;
  notification: { prepare(): void; play(): void; cancel(): void };
};
export type TimerController = {
  getView(): TimerView;
  subscribe(listener: () => void): () => void;
  start(): void;
  dispose(): void;
  actions: TimerActions;
};

const CADENCE_MS = 250;
const LIVE_GAP_MS = 1500;

export function createTimerController(deps: RuntimeDeps): TimerController {
  const restored = deps.storage ? readSnapshot(deps.storage, deps.now()) : null;
  let snapshot = restored?.snapshot ?? createSnapshot();
  let persistenceAvailable = !!deps.storage && restored?.source !== 'unavailable';
  const makeView = (now: number): TimerView => ({ snapshot,
    remainingMs: snapshot.timer.status === 'idle' ? snapshot.settings.focusMs : remainingMs(snapshot.timer, now),
    persistenceAvailable });
  let view = makeView(deps.now());
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let cancelSchedule: (() => void) | undefined;
  let unsubscribeLifecycle: (() => void) | undefined;
  let visibleSince: number | null = null;
  let previousCallbackAt: number | null = null;
  const notified = new Set<string>();

  function clearSchedule() {
    generation++;
    cancelSchedule?.();
    cancelSchedule = undefined;
  }
  function publish(now: number) {
    const next = makeView(now);
    if (next.snapshot === view.snapshot && next.remainingMs === view.remainingMs &&
      next.persistenceAvailable === view.persistenceAvailable) return;
    view = next;
    for (const listener of [...listeners]) listener();
  }
  function apply(event: TimerEvent, now: number, live = false) {
    const before = snapshot;
    let next = transition(before, event, now);
    // The model accepts equal settings; avoid a write/notification for a domain no-op.
    if (next.timer === before.timer && next.settings.focusMs === before.settings.focusMs &&
      next.settings.restMs === before.settings.restMs) next = before;
    snapshot = next;
    if (next !== before) {
      deps.notification.cancel();
      if (persistenceAvailable && deps.storage && !saveSnapshot(deps.storage, next)) persistenceAvailable = false;
      if (before.timer.status === 'running' && next.timer.status === 'completed') {
        const { session, completedAtMs } = next.timer;
        const fresh = !notified.has(session.id);
        // Record the decision before invoking an adapter, including blocked/silent attempts.
        notified.add(session.id);
        if (fresh && live && deps.isVisible() && visibleSince !== null && visibleSince <= completedAtMs &&
          previousCallbackAt !== null && previousCallbackAt <= completedAtMs &&
          now >= previousCallbackAt && now - previousCallbackAt <= LIVE_GAP_MS &&
          now - completedAtMs <= LIVE_GAP_MS) deps.notification.play();
      }
    }
    publish(now);
  }
  function scheduleNext() {
    clearSchedule();
    if (!active || !deps.isVisible() || snapshot.timer.status !== 'running') return;
    const token = generation;
    cancelSchedule = deps.schedule(() => {
      if (!active || token !== generation) return;
      cancelSchedule = undefined;
      const now = deps.now();
      if (!deps.isVisible()) {
        visibleSince = previousCallbackAt = null;
        deps.notification.cancel();
        return;
      }
      apply({ type: 'TICK' }, now, true);
      previousCallbackAt = now;
      scheduleNext();
    }, Math.min(CADENCE_MS, Math.max(1, remainingMs(snapshot.timer, deps.now()))));
  }
  function dispatch(event: TimerEvent, prepare = false) {
    if (prepare) deps.notification.prepare();
    const now = deps.now();
    apply(event, now);
    // An action can create a new live interval, but must not rehabilitate a suspended old run.
    if (snapshot.timer.status === 'running' &&
      (event.type === 'START_FOCUS' || event.type === 'START_REST' || event.type === 'RESUME') &&
      snapshot.timer.runStartedAtMs === now && deps.isVisible() && active) {
      visibleSince = previousCallbackAt = now;
    }
    scheduleNext();
  }
  const actions: TimerActions = {
    setSettings: settings => dispatch({ type: 'SET_SETTINGS', settings }),
    startFocus: () => dispatch({ type: 'START_FOCUS', sessionId: deps.createSessionId() }, true),
    startRest: () => dispatch({ type: 'START_REST', sessionId: deps.createSessionId() }, true),
    pause: sessionId => dispatch({ type: 'PAUSE', sessionId }),
    resume: sessionId => dispatch({ type: 'RESUME', sessionId }, true),
    confirmReset: sessionId => dispatch({ type: 'CONFIRM_RESET', sessionId }),
    dismissCompletion: sessionId => dispatch({ type: 'DISMISS_COMPLETION', sessionId }),
  };
  return {
    getView: () => view,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    actions,
    start() {
      if (active) return;
      active = true;
      const now = deps.now();
      visibleSince = previousCallbackAt = deps.isVisible() ? now : null;
      apply({ type: 'TICK' }, now);
      unsubscribeLifecycle = deps.onLifecycle(event => {
        if (!active) return;
        clearSchedule();
        deps.notification.cancel();
        const now = deps.now();
        const visible = event !== 'hidden' && deps.isVisible();
        visibleSince = previousCallbackAt = visible ? now : null;
        apply({ type: 'TICK' }, now);
        scheduleNext();
      });
      scheduleNext();
    },
    dispose() {
      active = false;
      clearSchedule();
      unsubscribeLifecycle?.();
      unsubscribeLifecycle = undefined;
      visibleSince = previousCallbackAt = null;
      deps.notification.cancel();
    },
  };
}
