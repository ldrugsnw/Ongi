import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimerNotification } from '../src/timer/notification.ts';

function audioHarness(state = 'running') {
  let visible = true, now = 1000, resumes = 0, constructed = 0;
  let resolveResume: (() => void) | undefined;
  const voices: { stopped: number; disconnected: number; started: number[]; gains: number[]; gainDisconnected: number }[] = [];
  const audio = {
    state, currentTime: 10, destination: {},
    resume() { resumes++; return new Promise<void>(resolve => { resolveResume = () => { audio.state = 'running'; resolve(); }; }); },
    createOscillator() {
      const voice = { stopped: 0, disconnected: 0, started: [] as number[], gains: [] as number[], gainDisconnected: 0 };
      voices.push(voice);
      return {
        type: '', frequency: { setValueAtTime() {} }, connect() {}, onended: null,
        start(at: number) { voice.started.push(at); },
        stop() { voice.stopped++; }, disconnect() { voice.disconnected++; },
      };
    },
    createGain() {
      const voice = voices[voices.length - 1];
      return { gain: {
        setValueAtTime(value: number) { voice.gains.push(value); },
        linearRampToValueAtTime(value: number) { voice.gains.push(value); },
        exponentialRampToValueAtTime(value: number) { voice.gains.push(value); },
      }, connect() {}, disconnect() { voice.gainDisconnected++; } };
    },
  };
  const notification = createTimerNotification({
    now: () => now, isVisible: () => visible,
    createContext() { constructed++; return audio as unknown as AudioContext; },
  });
  return { notification, audio, voices,
    get resumes() { return resumes; }, get constructed() { return constructed; },
    hide() { visible = false; }, setNow(value: number) { now = value; },
    async resolve() { resolveResume?.(); await Promise.resolve(); },
  };
}

test('context is lazy; gesture prepare resumes synchronously without starting voices', async () => {
  const h = audioHarness('suspended');
  assert.equal(h.constructed, 0);
  h.notification.prepare();
  assert.equal(h.resumes, 1); assert.equal(h.voices.length, 0);
  await h.resolve();
  assert.equal(h.voices.length, 0);
  h.notification.play();
  assert.equal(h.constructed, 1); assert.equal(h.voices.length, 2);
});

test('chime uses short independent low-gain synth voices and cancel disconnects all', () => {
  const h = audioHarness(); h.notification.play();
  assert.equal(h.voices.length, 2);
  assert.deepEqual(h.voices.map(v => v.started), [[10], [10.16]]);
  for (const voice of h.voices) assert.ok(Math.max(...voice.gains) <= 0.035);
  h.notification.cancel(); h.notification.cancel();
  for (const voice of h.voices) {
    assert.equal(voice.stopped, 2); // One scheduled end plus cancellation.
    assert.equal(voice.disconnected, 1); assert.equal(voice.gainDisconnected, 1);
  }
});

test('late resume after hide or cancellation never creates voices', async () => {
  for (const reason of ['hide', 'cancel'] as const) {
    const h = audioHarness('suspended'); h.notification.play();
    if (reason === 'hide') h.hide(); else h.notification.cancel();
    await h.resolve(); assert.equal(h.voices.length, 0);
  }
});

test('hide/cancel invalidates old pending play even after new prepare', async () => {
  const h = audioHarness('suspended'); h.notification.play();
  h.notification.cancel(); await h.resolve();
  h.notification.prepare();
  assert.equal(h.voices.length, 0);
});

test('resume delayed beyond lateness guard or clock reversal remains silent', async () => {
  for (const now of [2501, 500]) {
    const h = audioHarness('suspended'); h.notification.play(); h.setNow(now);
    await h.resolve(); assert.equal(h.voices.length, 0);
  }
});

test('hidden playback does not instantiate audio and denied audio does not throw', async () => {
  const h = audioHarness(); h.hide(); h.notification.play();
  assert.equal(h.constructed, 0);
  for (const createContext of [() => null, () => { throw Error('denied'); },
    () => ({ state: 'suspended', resume: () => Promise.reject(Error('blocked')) }) as unknown as () => AudioContext]) {
    const notification = createTimerNotification({ now: () => 1000, isVisible: () => true, createContext });
    assert.doesNotThrow(() => { notification.prepare(); notification.play(); notification.cancel(); });
  }
  await Promise.resolve(); await Promise.resolve();
});
