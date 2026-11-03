import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { TimerActions, TimerView } from './controller';

type Props = { view: TimerView; actions: TimerActions; resetSessionId: string | null; onCancelReset(): void };

export function TimerDialogs({ view, actions, resetSessionId, onCancelReset }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const timer = view.snapshot.timer;
  const completion = timer.status === 'completed' && !timer.dialogDismissed;
  const reset = timer.status !== 'idle' && timer.status !== 'completed' && timer.session.id === resetSessionId;
  // A dismissed completion may also be explicitly reset from the panel.
  const completedReset = timer.status === 'completed' && timer.dialogDismissed && timer.session.id === resetSessionId;
  const kind = completion ? 'completion' : reset || completedReset ? 'reset' : null;
  const sessionId = timer.status === 'idle' ? null : timer.session.id;
  const focusCompletion = timer.status === 'completed' && timer.session.phase === 'focus';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !kind) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = previous?.closest('.ongi-timer')?.querySelector<HTMLButtonElement>('.ongi-timer-toggle');
    if (!dialog.open) dialog.showModal();
    initialRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (previous?.isConnected && !previous.closest('[hidden], [inert]')) previous.focus();
      else if (fallback?.isConnected) fallback.focus();
    };
  }, [kind, sessionId]);

  if (typeof document === 'undefined') return null;
  const dismiss = () => {
    if (completion && timer.status === 'completed') actions.dismissCompletion(timer.session.id);
    else onCancelReset();
  };
  return createPortal(<dialog className="ongi-timer-dialog" ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="ongi-timer-heading">
      <h2 id={`${id}-title`}>{kind === 'completion' ? `${focusCompletion ? '집중' : '휴식'} 시간이 끝났어요` : '타이머를 초기화할까요?'}</h2>
      <button type="button" className="ongi-timer-close" aria-label={kind === 'completion' ? '완료 안내 닫기' : '초기화 취소'} onClick={dismiss}>×</button>
    </div>
    <p id={`${id}-description`}>{kind === 'completion' ? (focusCompletion ? '수고하셨어요. 준비가 되면 휴식을 시작하거나 다시 집중해 보세요.' : '잠시 쉬어 갔어요. 준비가 되면 다시 집중해 보세요.') : '진행 중인 시간을 지우고 준비 상태로 돌아가요. 설정한 시간은 유지돼요.'}</p>
    <div className="ongi-timer-actions">
      {kind === 'completion' ? <>
        {focusCompletion && <button type="button" ref={initialRef} onClick={() => actions.startRest()}>휴식 시작</button>}
        <button type="button" ref={focusCompletion ? undefined : initialRef} onClick={() => actions.startFocus()}>다시 집중하기</button>
        <button type="button" className="ongi-timer-secondary" onClick={dismiss}>닫기</button>
      </> : <>
        <button type="button" ref={initialRef} onClick={onCancelReset}>취소</button>
        <button type="button" className="ongi-timer-secondary" onClick={() => {
          if (sessionId !== null && sessionId === resetSessionId) actions.confirmReset(sessionId);
          onCancelReset();
        }}>초기화</button>
      </>}
    </div>
  </dialog>, document.body);
}
