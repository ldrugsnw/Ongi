export type Settings = { focusMs: number; restMs: number };
export type Phase = 'focus' | 'rest';
export type Session = { id: string; phase: Phase; durationMs: number };
export type TimerState =
  | { status: 'idle' }
  | { status: 'running'; session: Session; elapsedBeforeRunMs: number; runStartedAtMs: number }
  | { status: 'paused'; session: Session; elapsedMs: number }
  | { status: 'completed'; session: Session; completedAtMs: number; dialogDismissed: boolean };
export type TimerSnapshot = { version: 1; settings: Settings; timer: TimerState };
export type TimerEvent =
  | { type: 'SET_SETTINGS'; settings: Settings }
  | { type: 'START_FOCUS'; sessionId: string }
  | { type: 'START_REST'; sessionId: string }
  | { type: 'PAUSE'; sessionId: string }
  | { type: 'RESUME'; sessionId: string }
  | { type: 'CONFIRM_RESET'; sessionId: string }
  | { type: 'DISMISS_COMPLETION'; sessionId: string }
  | { type: 'TICK' };

const MINUTE_MS = 60_000;
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  focusMs: 25 * MINUTE_MS,
  restMs: 5 * MINUTE_MS,
});

export function validateSettings(input: unknown): Settings | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { focusMs, restMs } = input as Record<string, unknown>;
  const validDuration = (value: unknown, maxMinutes: number): value is number =>
    typeof value === 'number' && Number.isInteger(value) &&
    value >= MINUTE_MS && value <= maxMinutes * MINUTE_MS && value % MINUTE_MS === 0;
  return validDuration(focusMs, 180) && validDuration(restMs, 60) ? { focusMs, restMs } : null;
}

export function createSnapshot(): TimerSnapshot {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, timer: { status: 'idle' } };
}

function assertNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError('nowMs must be a nonnegative safe integer');
  }
}

export function remainingMs(state: TimerState, nowMs: number): number {
  assertNow(nowMs);
  switch (state.status) {
    case 'running':
      return Math.max(0, state.session.durationMs - state.elapsedBeforeRunMs -
        Math.max(0, nowMs - state.runStartedAtMs));
    case 'paused':
      return Math.max(0, state.session.durationMs - state.elapsedMs);
    default:
      return 0;
  }
}

export function reconcile(state: TimerState, nowMs: number): TimerState {
  assertNow(nowMs);
  if (state.status !== 'running' || remainingMs(state, nowMs) > 0) return state;
  return {
    status: 'completed',
    session: state.session,
    completedAtMs: state.runStartedAtMs + (state.session.durationMs - state.elapsedBeforeRunMs),
    dialogDismissed: false,
  };
}

export function transition(snapshot: TimerSnapshot, event: TimerEvent, nowMs: number): TimerSnapshot {
  const state = reconcile(snapshot.timer, nowMs);
  const current = state === snapshot.timer ? snapshot : { ...snapshot, timer: state };
  const withTimer = (timer: TimerState): TimerSnapshot => ({ ...current, timer });
  switch (event.type) {
    case 'SET_SETTINGS': {
      if (state.status !== 'idle') return current;
      const settings = validateSettings(event.settings);
      return settings ? { ...current, settings } : current;
    }
    case 'START_FOCUS':
    case 'START_REST': {
      const focus = event.type === 'START_FOCUS';
      const allowed = focus
        ? state.status === 'idle' || state.status === 'completed'
        : state.status === 'completed' && state.session.phase === 'focus';
      if (!allowed || typeof event.sessionId !== 'string' || !event.sessionId.trim() ||
        (state.status !== 'idle' && event.sessionId === state.session.id)) return current;
      return withTimer({
        status: 'running',
        session: {
          id: event.sessionId,
          phase: focus ? 'focus' : 'rest',
          durationMs: focus ? current.settings.focusMs : current.settings.restMs,
        },
        elapsedBeforeRunMs: 0,
        runStartedAtMs: nowMs,
      });
    }
    case 'PAUSE':
      return state.status === 'running' && event.sessionId === state.session.id
        ? withTimer({ status: 'paused', session: state.session,
          elapsedMs: state.session.durationMs - remainingMs(state, nowMs) }) : current;
    case 'RESUME':
      return state.status === 'paused' && event.sessionId === state.session.id
        ? withTimer({ status: 'running', session: state.session,
          elapsedBeforeRunMs: state.elapsedMs, runStartedAtMs: nowMs }) : current;
    case 'CONFIRM_RESET':
      return state.status !== 'idle' && event.sessionId === state.session.id
        ? withTimer({ status: 'idle' }) : current;
    case 'DISMISS_COMPLETION':
      return state.status === 'completed' && event.sessionId === state.session.id && !state.dialogDismissed
        ? withTimer({ ...state, dialogDismissed: true }) : current;
    case 'TICK':
      return current;
  }
}

export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms)) throw new RangeError('Remaining time must be finite');
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
