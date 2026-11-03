import { useEffect, useId, useRef, useState } from 'react';
import { useFocusTimer } from './useFocusTimer';
import { TimerPanel } from './TimerPanel';
import { TimerDialogs } from './TimerDialogs';
import './timer.css';

type Props = { open: boolean; onOpenChange(open: boolean): void };

export function FocusTimer({ open, onOpenChange }: Props) {
  const timer = useFocusTimer();
  const [resetSessionId, setResetSessionId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const state = timer.snapshot.timer;
  const sessionId = state.status === 'idle' ? null : state.session.id;

  useEffect(() => {
    setResetSessionId(current => state.status === 'completed' || sessionId !== current ? null : current);
  }, [state.status, sessionId]);

  useEffect(() => {
    if (!open) {
      if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
      return;
    }
    if (!document.querySelector('dialog[open]')) panelRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
        onOpenChange(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onOpenChange]);

  const phase = state.status === 'idle' || state.session.phase === 'focus' ? '집중' : '휴식';
  const announcement = state.status === 'idle' ? '집중할 준비가 되었어요.'
    : `${phase} ${state.status === 'running' ? '진행 중이에요.' : state.status === 'paused' ? '일시정지했어요.' : '시간이 끝났어요.'}`;

  return <>
    <section className="ongi-timer" ref={rootRef} aria-label="집중 타이머"
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault(); event.stopPropagation(); onOpenChange(false); toggleRef.current?.focus();
        }
      }}>
      <div id={panelId} className="ongi-timer-panel" ref={panelRef} hidden={!open} tabIndex={-1} role="region" aria-label="집중 타이머 설정과 조작">
        <div className="ongi-timer-heading"><h2>집중 타이머</h2><button type="button" className="ongi-timer-close" aria-label="타이머 패널 닫기" onClick={() => { onOpenChange(false); toggleRef.current?.focus(); }}>×</button></div>
        <TimerPanel view={timer} actions={timer} onRequestReset={setResetSessionId} />
      </div>
      <button type="button" className="ongi-timer-toggle" ref={toggleRef} aria-expanded={open} aria-controls={panelId}
        aria-label={open ? '집중 타이머 닫기' : '집중 타이머 열기'} onClick={() => onOpenChange(!open)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6M12 2v3M18 6l2-2" /></svg>
      </button>
    </section>
    <p className="ongi-timer-sr" role="status" aria-atomic="true">{announcement}</p>
    <TimerDialogs view={timer} actions={timer} resetSessionId={resetSessionId} onCancelReset={() => setResetSessionId(null)} />
  </>;
}
