export type NotificationDeps = {
  createContext(): AudioContext | null;
  isVisible(): boolean;
  now(): number;
};

// Separate context and gain graph: ambient audio is never read or changed.
export function createTimerNotification(deps: NotificationDeps) {
  let context: AudioContext | null = null;
  let generation = 0;
  const voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  function getContext() { return context ??= deps.createContext(); }
  function cancel() {
    generation++;
    for (const { oscillator, gain } of voices) {
      try { oscillator.stop(); } catch { /* Already ended. */ }
      try { oscillator.disconnect(); gain.disconnect(); } catch { /* Best effort cleanup. */ }
    }
    voices.clear();
  }
  return {
    prepare() {
      try {
        const audio = getContext();
        if (audio && audio.state !== 'running') void audio.resume().catch(() => {});
      } catch { /* Browser policy or unavailable Web Audio. */ }
    },
    play() {
      const token = generation;
      const requestedAt = deps.now();
      const synth = () => {
        if (token !== generation || !deps.isVisible() || deps.now() - requestedAt > 1500 ||
          deps.now() < requestedAt || !context || context.state !== 'running') return;
        const audio = context;
        try {
          const start = audio.currentTime;
          for (const [offset, frequency] of [[0, 660], [0.16, 880]]) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            const voice = { oscillator, gain };
            voices.add(voice);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, start + offset);
            gain.gain.setValueAtTime(0, start + offset);
            gain.gain.linearRampToValueAtTime(0.035, start + offset + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.28);
            oscillator.connect(gain);
            gain.connect(audio.destination);
            oscillator.onended = () => {
              oscillator.disconnect(); gain.disconnect(); voices.delete(voice);
            };
            oscillator.start(start + offset);
            oscillator.stop(start + offset + 0.3);
          }
        } catch { cancel(); }
      };
      try {
        if (!deps.isVisible()) return;
        const audio = getContext();
        if (!audio) return;
        if (audio.state === 'running') synth();
        else void audio.resume().then(synth).catch(() => {});
      } catch { /* Notification is best effort and never retried. */ }
    },
    cancel,
  };
}
