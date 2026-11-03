import { useEffect, useId, useState } from 'react';
import type { TimerActions, TimerView } from './controller';
import { formatRemaining } from './model';

type Props = { view: TimerView; actions: TimerActions; onRequestReset(sessionId: string): void };

function minutes(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

export function TimerPanel({ view, actions, onRequestReset }: Props) {
  const { settings, timer } = view.snapshot;
  const [focus, setFocus] = useState(String(settings.focusMs / 60000));
  const [rest, setRest] = useState(String(settings.restMs / 60000));
  const id = useId();
  useEffect(() => { setFocus(String(settings.focusMs / 60000)); setRest(String(settings.restMs / 60000)); }, [settings.focusMs, settings.restMs]);
  const focusMinutes = minutes(focus, 180);
  const restMinutes = minutes(rest, 60);
  const valid = focusMinutes !== null && restMinutes !== null;
  const idle = timer.status === 'idle';
  const phase = idle || timer.session.phase === 'focus' ? '집중' : '휴식';
  const status = { idle: '준비', running: '진행 중', paused: '일시정지', completed: '완료' }[timer.status];
  const commitSettings = () => {
    if (idle && focusMinutes !== null && restMinutes !== null) actions.setSettings({ focusMs: focusMinutes * 60000, restMs: restMinutes * 60000 });
  };

  return <>
    <p className="ongi-timer-phase">{phase} · {status}</p>
    <div className="ongi-timer-clock" role="timer" aria-live="off" aria-label={`${phase} 남은 시간`}>{formatRemaining(idle ? settings.focusMs : view.remainingMs)}</div>
    <fieldset className="ongi-timer-settings" disabled={!idle}>
      <legend>시간 설정 <span>(분)</span></legend>
      <div className="ongi-timer-inputs">
        <label htmlFor={`${id}-focus`}>집중<input id={`${id}-focus`} type="number" inputMode="numeric" min="1" max="180" step="1" value={focus} onChange={event => setFocus(event.target.value)} onBlur={commitSettings} aria-invalid={focusMinutes === null} aria-describedby={`${id}-focus-help`} /></label>
        <label htmlFor={`${id}-rest`}>휴식<input id={`${id}-rest`} type="number" inputMode="numeric" min="1" max="60" step="1" value={rest} onChange={event => setRest(event.target.value)} onBlur={commitSettings} aria-invalid={restMinutes === null} aria-describedby={`${id}-rest-help`} /></label>
      </div>
      <p id={`${id}-focus-help`} className={focusMinutes === null ? 'ongi-timer-error' : 'ongi-timer-hint'}>{focusMinutes === null ? '집중 시간은 1~180 사이의 정수로 입력해 주세요.' : '집중 1~180분'}</p>
      <p id={`${id}-rest-help`} className={restMinutes === null ? 'ongi-timer-error' : 'ongi-timer-hint'}>{restMinutes === null ? '휴식 시간은 1~60 사이의 정수로 입력해 주세요.' : '휴식 1~60분'}</p>
    </fieldset>
    {!idle && <p className="ongi-timer-hint">시간은 초기화한 뒤 변경할 수 있어요.</p>}
    <div className="ongi-timer-actions">
      {idle && <button type="button" disabled={!valid} onClick={() => { commitSettings(); actions.startFocus(); }}>집중 시작</button>}
      {timer.status === 'running' && <button type="button" onClick={() => actions.pause(timer.session.id)}>일시정지</button>}
      {timer.status === 'paused' && <button type="button" onClick={() => actions.resume(timer.session.id)}>재개</button>}
      {timer.status === 'completed' && <>
        {timer.session.phase === 'focus' && <button type="button" onClick={() => actions.startRest()}>휴식 시작</button>}
        <button type="button" onClick={() => actions.startFocus()}>다시 집중하기</button>
      </>}
      {!idle && <button type="button" className="ongi-timer-secondary" onClick={() => onRequestReset(timer.session.id)}>초기화</button>}
    </div>
    {!view.persistenceAvailable && <p className="ongi-timer-notice" role="status">타이머를 저장하지 못했어요. 페이지를 닫으면 진행 상황이 사라질 수 있어요.</p>}
  </>;
}
