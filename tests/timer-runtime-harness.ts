import { createTimerController } from '../src/timer/controller.ts';
import type { RuntimeDeps } from '../src/timer/controller.ts';
import type { TimerSnapshot } from '../src/timer/model.ts';

export function harness(stored?: TimerSnapshot | string, failure?: 'read' | 'write' | 'missing') {
  let now = 1000, visible = true, sequence = 0;
  let raw = typeof stored === 'string' ? stored : stored ? JSON.stringify(stored) : null;
  const jobs = new Set<() => void>();
  const lifecycle = new Set<(event: 'hidden' | 'visible' | 'pageshow' | 'focus') => void>();
  const audio = { prepared: 0, played: 0, cancelled: 0 };
  let writes = 0;
  const deps: RuntimeDeps = {
    now: () => now, isVisible: () => visible, createSessionId: () => `session-${++sequence}`,
    storage: failure === 'missing' ? null : {
      getItem() { if (failure === 'read') throw Error('read'); return raw; },
      setItem(_key, value) { writes++; if (failure === 'write') throw Error('write'); raw = value; },
    },
    schedule(callback) { jobs.add(callback); return () => { jobs.delete(callback); }; },
    onLifecycle(callback) { lifecycle.add(callback); return () => { lifecycle.delete(callback); }; },
    notification: {
      prepare() { audio.prepared++; }, play() { audio.played++; }, cancel() { audio.cancelled++; },
    },
  };
  const controller = createTimerController(deps);
  return {
    controller, deps, jobs, lifecycle, audio,
    get writes() { return writes; }, get raw() { return raw; },
    setNow(value: number) { now = value; },
    tick(value: number) { now = value; const callbacks = [...jobs]; jobs.clear(); callbacks.forEach(fn => fn()); },
    event(event: 'hidden' | 'visible' | 'pageshow' | 'focus', value = now) {
      now = value;
      if (event === 'hidden') visible = false;
      if (event === 'visible') visible = true;
      for (const fn of [...lifecycle]) fn(event);
    },
    begin() { controller.start(); controller.actions.setSettings({ focusMs: 60000, restMs: 60000 }); controller.actions.startFocus(); },
  };
}
export const running: TimerSnapshot = {
  version: 1, settings: { focusMs: 60000, restMs: 60000 },
  timer: { status: 'running', session: { id: 'stored', phase: 'focus', durationMs: 60000 }, elapsedBeforeRunMs: 0, runStartedAtMs: 0 },
};
