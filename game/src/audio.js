// audio.js - every sound is synthesised with WebAudio; no audio files, no
// network. One job: turn game events into short, recognisable sounds. All
// calls are safe before the first user gesture: the context is created lazily
// and every method no-ops when audio is unavailable (headless, muted).

export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch (_e) {
      ctx = null;
    }
    return ctx;
  }

  // A short oscillator blip with an exponential decay envelope.
  function tone(freq, dur, type, vol, slideTo) {
    const c = ensure();
    if (!c || !master) return;
    try {
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(vol || 0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (_e) { /* audio is cosmetic; never break the game */ }
  }

  // Filtered noise burst (gunshots, explosions, footsteps).
  function noise(dur, vol, freq) {
    const c = ensure();
    if (!c || !master) return;
    try {
      const t0 = c.currentTime;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq || 1200;
      const g = c.createGain();
      g.gain.setValueAtTime(vol || 0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t0);
    } catch (_e) { /* cosmetic only */ }
  }

  return {
    // Unlock the context from a user gesture (click to play).
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'Longshot-7') { noise(0.22, 0.9, 900); tone(140, 0.18, 'sawtooth', 0.35, 55); }
      else if (kind === 'Raptor-9') { noise(0.08, 0.55, 1800); tone(320, 0.06, 'square', 0.22, 140); }
      else if (kind === 'P9 Sparrow') { noise(0.07, 0.5, 2200); tone(420, 0.05, 'square', 0.18, 180); }
      else { noise(0.11, 0.7, 1500); tone(240, 0.09, 'square', 0.28, 110); }
    },
    enemyShot(dist) {
      const v = Math.max(0.08, 0.5 - dist * 0.008);
      noise(0.09, v, 1400);
    },
    dryFire() { tone(900, 0.04, 'square', 0.2); },
    reload() { tone(520, 0.05, 'square', 0.2); setTimeout(() => tone(760, 0.05, 'square', 0.2), 140); },
    hit() { tone(1250, 0.05, 'sine', 0.4); },
    kill() { tone(1250, 0.05, 'sine', 0.4); setTimeout(() => tone(1650, 0.07, 'sine', 0.4), 70); },
    hurt() { tone(180, 0.12, 'sawtooth', 0.35, 90); },
    step() { noise(0.05, 0.12, 500); },
    grenadeThrow() { noise(0.12, 0.3, 900); },
    explosion() { noise(0.6, 1.0, 320); tone(70, 0.5, 'sine', 0.7, 32); },
    plantBeep(fast) { tone(fast ? 1400 : 980, 0.09, 'sine', 0.45); },
    plantDone() { tone(880, 0.12, 'sine', 0.4); setTimeout(() => tone(1320, 0.18, 'sine', 0.4), 120); },
    buy() { tone(660, 0.06, 'sine', 0.35); setTimeout(() => tone(990, 0.08, 'sine', 0.35), 70); },
    roundWin() {
      tone(523, 0.14, 'triangle', 0.4);
      setTimeout(() => tone(659, 0.14, 'triangle', 0.4), 140);
      setTimeout(() => tone(784, 0.22, 'triangle', 0.45), 280);
    },
    roundLose() {
      tone(392, 0.16, 'triangle', 0.4);
      setTimeout(() => tone(311, 0.16, 'triangle', 0.4), 160);
      setTimeout(() => tone(233, 0.3, 'triangle', 0.45), 320);
    },
  };
}
