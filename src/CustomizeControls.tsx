import { useEffect, useRef } from 'react';
import { drinks, seasons, type LoadedScene, type Preferences } from './customization';

type Props = { current: LoadedScene; busy: boolean; loading: boolean; notice: string; choose: (value: Preferences) => void; open: boolean; onOpenChange(open: boolean): void };
export function CustomizeControls({ current, busy, loading, notice, choose, open, onOpenChange }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    if (!firstRef.current?.disabled) firstRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
        onOpenChange(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) { event.preventDefault(); onOpenChange(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, onOpenChange]);
  return <section className="controls customize-controls" ref={rootRef} aria-label="공간 꾸미기"
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false); }}>
    <div className="control-panel customize-panel" hidden={!open} id="customize-panel" role="region" aria-label="계절과 음료 선택" aria-busy={busy}>
      <fieldset disabled={busy}>
        <legend>계절</legend>
        <div className="choice-grid">{seasons.map((season, i) => <label className="choice" key={season.id}>
          <input ref={i === 0 ? firstRef : undefined} type="radio" name="season" value={season.id} checked={current.season === season.id}
            onChange={() => choose({ season: season.id, drink: current.drink })} />
          <span>{season.label}</span>
        </label>)}</div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>음료</legend>
        <div className="drink-choices">{drinks.map(drink => <label className="choice" key={drink.id}>
          <input type="radio" name="drink" value={drink.id} checked={current.drink === drink.id}
            onChange={() => choose({ season: current.season, drink: drink.id })} />
          <span>{drink.label}</span>
        </label>)}</div>
      </fieldset>
      <p className="customize-status" role="status">{loading ? '공간을 준비하고 있어요…' : notice}</p>
    </div>
    <button className="panel-toggle" ref={buttonRef} onClick={() => onOpenChange(!open)} aria-expanded={open} aria-controls="customize-panel" aria-label={open ? '공간 꾸미기 닫기' : '공간 꾸미기 열기'}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="#f3e4c9" /><circle cx="15" cy="17" r="3" fill="#f3e4c9" />
      </svg>
    </button>
  </section>;
}
