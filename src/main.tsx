import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { scene } from './scene';
import { SceneLayer, usePersonalScene } from './PersonalScene';
import { CustomizeControls } from './CustomizeControls';
import { FocusTimer } from './timer/FocusTimer';
import { SeasonalParticles } from './SeasonalParticles.tsx';
import './style.css';

function useSystemMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function Atmosphere() {
  return <svg className="atmosphere" viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden="true">
    <defs>
      <radialGradient id="warm-glow">
        <stop offset="0" stopColor="#ffb24b" stopOpacity=".42" />
        <stop offset=".4" stopColor="#ff9c39" stopOpacity=".2" />
        <stop offset="1" stopColor="#ff9834" stopOpacity="0" />
      </radialGradient>
      <clipPath id="fire-opening"><path d={scene.fireOpening} /></clipPath>
      <radialGradient id="fire-core">
        <stop offset="0" stopColor="#fff0b0" stopOpacity=".8" />
        <stop offset=".45" stopColor="#ffd36a" stopOpacity=".5" />
        <stop offset="1" stopColor="#ff9630" stopOpacity="0" />
      </radialGradient>
      <filter id="soft-steam" x="-100%" y="-40%" width="300%" height="180%">
        <feGaussianBlur stdDeviation="2.5" />
      </filter>
    </defs>
    <circle className="fire-glow" cx={scene.fire.x} cy={scene.fire.y} r={scene.fire.radius} fill="url(#warm-glow)" />
    <g clipPath="url(#fire-opening)">
      <ellipse className="fire-core" cx={scene.fire.x} cy={scene.fire.y} rx="90" ry="100" fill="url(#fire-core)" />
    </g>
    <g transform={`translate(${scene.cup.x} ${scene.cup.y})`} fill="none" stroke="#fff4e0" strokeWidth="12" strokeLinecap="round" filter="url(#soft-steam)">
      {[0, 1, 2].map(i => <path key={i} className="steam" d={`M ${-35 + i * 31} -14 C ${-53 + i * 31} -35, ${-12 + i * 31} -48, ${-30 + i * 31} -70 S ${-42 + i * 31} -93, ${-20 + i * 31} -112`}
        style={{ animationDelay: `${-i * scene.steamSeconds / 3}s` }} />)}
    </g>
  </svg>;
}

function SoundIcon({ playing }: { playing: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4Z" />
    {playing ? <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 5 6m0-6-5 6" />}
  </svg>;
}

function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [volume, setVolume] = useState(35);
  const [message, setMessage] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [openPanel, setOpenPanel] = useState<'environment' | 'customize' | 'timer' | null>(null);
  const panelOpen = openPanel === 'environment';
  const setPanelOpen = useCallback((open: boolean) => setOpenPanel(current => open ? 'environment' : current === 'environment' ? null : current), []);
  const setCustomizeOpen = useCallback((open: boolean) => setOpenPanel(current => open ? 'customize' : current === 'customize' ? null : current), []);
  const setTimerOpen = useCallback((open: boolean) => setOpenPanel(current => open ? 'timer' : current === 'timer' ? null : current), []);
  const controlsRef = useRef<HTMLElement>(null);
  const panelButtonRef = useRef<HTMLButtonElement>(null);
  const soundButtonRef = useRef<HTMLButtonElement>(null);
  const systemMotion = useSystemMotion();
  const reduced = reduceMotion || systemMotion;
  const personal = usePersonalScene(reduced);

  useEffect(() => {
    if (!panelOpen) return;
    soundButtonRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlsRef.current?.contains(event.target)) {
        if (controlsRef.current?.contains(document.activeElement)) panelButtonRef.current?.focus();
        setPanelOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        setPanelOpen(false);
        panelButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [panelOpen, setPanelOpen]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  async function toggleSound() {
    const audio = audioRef.current;
    if (!audio || pendingRef.current) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    pendingRef.current = true;
    setLoading(true);
    setMessage('');
    try {
      // Only a user gesture starts sound. Missing or unsupported files are harmless.
      audio.volume = volume / 100;
      audio.load();
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setMessage('음원을 재생할 수 없어요. 그림은 그대로 즐겨주세요.');
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  }

  const style = {
    '--scene-ratio': `${scene.width} / ${scene.height}`,
    '--scene-width': `${scene.width / scene.height * 100}svh`,
    '--steam-duration': `${scene.steamSeconds}s`,
    '--fire-duration': `${scene.fireSeconds}s`,
  } as CSSProperties;

  return <main className={`teahouse${reduced ? ' reduced-motion' : ''}`} style={style}>
    <div className="scene">
      {personal.previous && <SceneLayer value={personal.previous} entering={false} />}
      <SceneLayer key={`${personal.current.background}-${personal.current.drinkImage}`} value={personal.current} entering={personal.previous ? true : undefined} />
      <SeasonalParticles season={personal.current.season} reduced={reduced} />
      <Atmosphere />
      <header className="identity">
        <svg className="identity-mark" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M8 7C5 5 10 4 7 2M13 7C10 5 15 4 12 2M18 7C15 5 20 4 17 2" strokeWidth="1.2" />
          <path d="M20 13h2a4 4 0 0 1 0 8h-2" />
          <path d="M6 11h13a1 1 0 0 1 1 1v7c0 4-3 6-7.5 6S5 23 5 19v-7a1 1 0 0 1 1-1Z" />
        </svg>
        <h1>온기</h1><span className="identity-note">겨울 찻집</span>
      </header>
    </div>
    <section className="controls" ref={controlsRef} aria-label="찻집 환경 설정"
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setPanelOpen(false);
      }}>
      <div hidden={!panelOpen} className="control-panel" id="environment-panel" role="region" aria-label="소리와 움직임 설정">
        <button ref={soundButtonRef} className="sound-toggle" onClick={toggleSound} aria-pressed={playing} disabled={loading}>
          <SoundIcon playing={playing} /><span>{loading ? '소리 준비 중' : playing ? '소리 끄기' : '소리 켜기'}</span>
        </button>
        <label className="volume-control">
          <span className="volume-heading"><span>볼륨</span><output>{volume}%</output></span>
          <input aria-label="모닥불 소리 볼륨" aria-valuetext={`${volume}%`} type="range" min="0" max="100" value={volume}
            style={{ '--volume': `${volume}%` } as CSSProperties} onChange={e => setVolume(Number(e.target.value))} />
        </label>
        <label className="motion-control"><span>움직임 줄이기</span><input type="checkbox" role="switch" checked={reduced} disabled={systemMotion} onChange={e => setReduceMotion(e.target.checked)} /></label>
        {systemMotion && <p className="system-note">기기의 움직임 줄이기 설정이 적용되어 있어요.</p>}
        {message && <p className="sound-message" role="status">{message}</p>}
      </div>
      <button ref={panelButtonRef} className={`panel-toggle${playing ? ' is-playing' : ''}`} onClick={() => setPanelOpen(!panelOpen)}
        aria-expanded={panelOpen} aria-controls="environment-panel"
        aria-label={`${panelOpen ? '환경 설정 닫기' : '환경 설정 열기'} · 소리 ${playing ? '켜짐' : '꺼짐'}`}>
        <SoundIcon playing={playing} />
        {playing && <span className="sound-indicator" aria-hidden="true" />}
      </button>
    </section>
    <CustomizeControls current={personal.current} busy={personal.busy} loading={personal.loading} notice={personal.notice} choose={personal.choose}
      open={openPanel === 'customize'} onOpenChange={setCustomizeOpen} />
    <FocusTimer open={openPanel === 'timer'} onOpenChange={setTimerOpen} />
    <audio ref={audioRef} src={scene.audio} loop preload="none" onPause={() => setPlaying(false)} onError={() => { setPlaying(false); }} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
