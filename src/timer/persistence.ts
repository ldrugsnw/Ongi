import { createSnapshot, reconcile, validateSettings } from './model.ts';
import type { Session, TimerSnapshot, TimerState } from './model.ts';

export const TIMER_STORAGE_KEY = 'ongi.timer.v1';
export type RestoreResult = {
  snapshot: TimerSnapshot;
  source: 'stored' | 'missing' | 'invalid' | 'unavailable';
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeSession(value: unknown): Session | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id.trim() ||
    (value.phase !== 'focus' && value.phase !== 'rest')) return null;
  const maxMinutes = value.phase === 'focus' ? 180 : 60;
  const durationMs = value.durationMs;
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) ||
    durationMs < 60_000 || durationMs > maxMinutes * 60_000 || durationMs % 60_000 !== 0) return null;
  return { id: value.id, phase: value.phase, durationMs };
}

function decodeTimer(value: unknown): TimerState | null {
  if (!record(value)) return null;
  if (value.status === 'idle') return { status: 'idle' };
  const session = decodeSession(value.session);
  if (!session) return null;
  switch (value.status) {
    case 'running': {
      const { elapsedBeforeRunMs, runStartedAtMs } = value;
      if (!timestamp(elapsedBeforeRunMs) || elapsedBeforeRunMs >= session.durationMs ||
        !timestamp(runStartedAtMs) ||
        !Number.isSafeInteger(runStartedAtMs + (session.durationMs - elapsedBeforeRunMs))) return null;
      return { status: 'running', session, elapsedBeforeRunMs, runStartedAtMs };
    }
    case 'paused':
      return timestamp(value.elapsedMs) && value.elapsedMs < session.durationMs
        ? { status: 'paused', session, elapsedMs: value.elapsedMs } : null;
    case 'completed':
      return timestamp(value.completedAtMs) && typeof value.dialogDismissed === 'boolean'
        ? { status: 'completed', session, completedAtMs: value.completedAtMs,
          dialogDismissed: value.dialogDismissed } : null;
    default:
      return null;
  }
}

export function decodeSnapshot(raw: string | null): TimerSnapshot | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1) return null;
    const settings = validateSettings(value.settings);
    const timer = decodeTimer(value.timer);
    return settings && timer ? { version: 1, settings, timer } : null;
  } catch {
    return null;
  }
}

export function restoreSnapshot(raw: string | null, nowMs: number): TimerSnapshot {
  const snapshot = decodeSnapshot(raw) ?? createSnapshot();
  return { ...snapshot, timer: reconcile(snapshot.timer, nowMs) };
}

export function readSnapshot(storage: Pick<Storage, 'getItem'>, nowMs: number): RestoreResult {
  // Validate time outside the storage error boundary so caller errors remain explicit.
  const fallback = restoreSnapshot(null, nowMs);
  let raw: string | null;
  try {
    raw = storage.getItem(TIMER_STORAGE_KEY);
  } catch {
    return { snapshot: fallback, source: 'unavailable' };
  }
  const decoded = decodeSnapshot(raw);
  if (!decoded) return { snapshot: fallback, source: raw === null ? 'missing' : 'invalid' };
  return { snapshot: { ...decoded, timer: reconcile(decoded.timer, nowMs) }, source: 'stored' };
}

export function saveSnapshot(storage: Pick<Storage, 'setItem'>, snapshot: TimerSnapshot): boolean {
  try {
    storage.setItem(TIMER_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}
