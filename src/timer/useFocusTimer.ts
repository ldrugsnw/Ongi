import { useEffect, useState, useSyncExternalStore } from 'react';
import { createTimerController } from './controller.ts';
import type { RuntimeDeps, TimerActions, TimerView } from './controller.ts';
import { createTimerNotification } from './notification.ts';

let fallbackSequence = 0;

function createSessionId(): string {
  const crypto = globalThis.crypto;
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* Continue if this context disallows randomUUID. */ }
  const sequence = (++fallbackSequence).toString(36);
  try {
    if (typeof crypto?.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return `ongi-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}-${sequence}`;
    }
  } catch { /* A timer can still run without a cryptographic ID source. */ }
  // The counter separates same-millisecond starts; time and randomness separate reloads.
  return `ongi-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2)}`;
}

export function createBrowserRuntimeDeps(): RuntimeDeps {
  let storage: RuntimeDeps['storage'] = null;
  try { storage = window.localStorage; } catch { /* SecurityError: retain memory state. */ }
  const isVisible = () => document.visibilityState === 'visible';
  return {
    now: () => Date.now(),
    createSessionId,
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
