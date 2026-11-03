import { useEffect, useState, useSyncExternalStore } from 'react';
import { createTimerController } from './controller.ts';
import type { RuntimeDeps, TimerActions, TimerView } from './controller.ts';
import { createTimerNotification } from './notification.ts';

export function createBrowserRuntimeDeps(): RuntimeDeps {
  let storage: RuntimeDeps['storage'] = null;
  try { storage = window.localStorage; } catch { /* SecurityError: retain memory state. */ }
  const isVisible = () => document.visibilityState === 'visible';
  return {
    now: () => Date.now(),
    createSessionId: () => crypto.randomUUID(),
    storage,
    isVisible,
    schedule(callback, delayMs) {
      const id = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(id);
    },
    onLifecycle(callback) {
      const visibility = () => callback(isVisible() ? 'visible' : 'hidden');
      const pageshow = () => callback('pageshow');
      const focus = () => callback('focus');
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('pageshow', pageshow);
      window.addEventListener('focus', focus);
      return () => {
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('pageshow', pageshow);
        window.removeEventListener('focus', focus);
      };
    },
    notification: createTimerNotification({
      now: () => Date.now(), isVisible,
      createContext: () => typeof window.AudioContext === 'function' ? new window.AudioContext() : null,
    }),
  };
}

export function useFocusTimer(): TimerView & TimerActions {
  const [controller] = useState(() => createTimerController(createBrowserRuntimeDeps()));
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);
  return { ...view, ...controller.actions };
}
