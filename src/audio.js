// Tiny WebAudio sound module — everything is synthesized, no asset files.
// The AudioContext is created lazily and resumed on the first user gesture
// (browsers block audio until then).
let ctx = null;
let muted = false;

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', gain = 0.14, when = 0) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  click: () => tone(440, 0.05, 'square', 0.04),
  build: () => { tone(330, 0.12, 'triangle', 0.12); tone(495, 0.14, 'sine', 0.08, 0.04); },
  upgrade: () => { tone(523, 0.1, 'triangle', 0.11); tone(659, 0.12, 'sine', 0.1, 0.05); tone(784, 0.16, 'sine', 0.09, 0.1); },
  age: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, 'sine', 0.12, i * 0.1)),
  raid: () => { tone(140, 0.32, 'sawtooth', 0.13); tone(90, 0.42, 'sawtooth', 0.11, 0.06); },
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.45, 'triangle', 0.14, i * 0.12)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.42, 'sawtooth', 0.12, i * 0.15)),
};

export function play(name) { if (!muted) SOUNDS[name]?.(); }
export function resume() { ac(); }            // call on first user gesture
export function toggleMuted() { muted = !muted; return muted; }
export function isMuted() { return muted; }
