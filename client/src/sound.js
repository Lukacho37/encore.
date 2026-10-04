// Effets sonores synthétisés avec la Web Audio API : aucun fichier audio, aucun droit à gérer.
import { storage } from './storage.js';

let ctx = null;
let master = null;
let muted = storage.get('albummania.muted') === '1';
const listeners = new Set();

function audio() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(c, seconds) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(c, { freq, type = 'sine', start = 0, dur = 0.25, gain = 0.25, attack = 0.005, glideTo, detune = 0 }) {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.detune.value = detune;
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(c, { start = 0, dur = 0.3, gain = 0.3, from = 4000, to = 400, q = 1.2, type = 'bandpass' }) {
  const t0 = c.currentTime + start;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.05);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Accords par rareté : plus la carte est rare, plus l'arpège monte et s'étoffe.
const REVEALS = {
  common: [72],
  uncommon: [72, 76],
  rare: [72, 76, 79],
  super: [72, 76, 79, 84],
  ultra: [72, 76, 79, 83, 86],
  legendary: [72, 76, 79, 84, 88, 91],
  promo: [74, 78, 81, 86, 90],
};

export const sound = {
  isMuted: () => muted,
  setMuted(value) {
    muted = value;
    storage.set('albummania.muted', value ? '1' : '0');
    if (muted && ctx) ctx.suspend();
    listeners.forEach((fn) => fn(muted));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** À appeler dans un geste utilisateur pour débloquer l'audio sur mobile. */
  unlock() {
    audio();
  },

  click() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: 880, type: 'triangle', dur: 0.06, gain: 0.08 });
  },
  shake() {
    const c = audio();
    if (!c) return;
    for (let i = 0; i < 4; i++) noise(c, { start: i * 0.07, dur: 0.06, gain: 0.12, from: 2500, to: 1200, q: 3 });
  },
  tear() {
    const c = audio();
    if (!c) return;
    noise(c, { dur: 0.45, gain: 0.55, from: 6000, to: 700, q: 0.9 });
    noise(c, { start: 0.05, dur: 0.3, gain: 0.25, from: 9000, to: 3000, q: 4, type: 'highpass' });
    tone(c, { freq: 180, type: 'sine', dur: 0.35, gain: 0.25, glideTo: 60 });
  },
  whoosh() {
    const c = audio();
    if (!c) return;
    noise(c, { dur: 0.28, gain: 0.18, from: 600, to: 3200, q: 0.8 });
  },
  flip() {
    const c = audio();
    if (!c) return;
    noise(c, { dur: 0.08, gain: 0.25, from: 5000, to: 2000, q: 2, type: 'highpass' });
    tone(c, { freq: 520, type: 'triangle', dur: 0.09, gain: 0.08, glideTo: 780 });
  },
  /** Petit son d'anticipation sur une carte rare encore face cachée. */
  tease(rarity) {
    const c = audio();
    if (!c) return;
    const rank = ['rare', 'super', 'ultra', 'legendary', 'promo'].indexOf(rarity);
    if (rank < 0) return;
    for (let i = 0; i <= rank; i++) tone(c, { freq: midi(84 + i * 2), type: 'sine', start: i * 0.06, dur: 0.18, gain: 0.05 });
  },
  reveal(rarity, holo = false) {
    const c = audio();
    if (!c) return;
    const notes = REVEALS[rarity] || REVEALS.common;
    const step = rarity === 'legendary' ? 0.085 : 0.065;
    notes.forEach((n, i) => {
      tone(c, { freq: midi(n), type: 'triangle', start: i * step, dur: 0.5, gain: 0.16 });
      tone(c, { freq: midi(n), type: 'sine', start: i * step, dur: 0.6, gain: 0.08, detune: 7 });
    });
    if (['ultra', 'legendary', 'promo'].includes(rarity)) {
      const end = notes.length * step;
      const chord = rarity === 'promo' ? [62, 66, 69, 74] : [60, 64, 67, 72];
      chord.forEach((n) => {
        tone(c, { freq: midi(n), type: 'sawtooth', start: end, dur: 1.4, gain: 0.05, attack: 0.05 });
        tone(c, { freq: midi(n + 12), type: 'sine', start: end, dur: 1.6, gain: 0.07, attack: 0.03 });
      });
      noise(c, { start: end, dur: 1.2, gain: 0.08, from: 12000, to: 6000, q: 0.7, type: 'highpass' });
    }
    if (holo) {
      for (let i = 0; i < 6; i++) tone(c, { freq: midi(96 + (i % 3) * 3), type: 'sine', start: 0.15 + i * 0.05, dur: 0.2, gain: 0.04 });
    }
  },
  newCard() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: midi(88), type: 'sine', dur: 0.25, gain: 0.07 });
  },
  coin() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: midi(83), type: 'square', dur: 0.08, gain: 0.05 });
    tone(c, { freq: midi(88), type: 'square', start: 0.07, dur: 0.22, gain: 0.05 });
  },
  complete() {
    const c = audio();
    if (!c) return;
    const melody = [67, 72, 76, 79, 84];
    melody.forEach((n, i) => tone(c, { freq: midi(n), type: 'triangle', start: i * 0.11, dur: 0.4, gain: 0.15 }));
    [60, 64, 67, 72, 76].forEach((n) => tone(c, { freq: midi(n), type: 'sawtooth', start: 0.55, dur: 1.8, gain: 0.04, attack: 0.08 }));
    noise(c, { start: 0.55, dur: 1.5, gain: 0.07, from: 12000, to: 5000, q: 0.6, type: 'highpass' });
  },
  correct() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: midi(76), type: 'triangle', dur: 0.15, gain: 0.14 });
    tone(c, { freq: midi(83), type: 'triangle', start: 0.1, dur: 0.3, gain: 0.14 });
  },
  wrong() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: midi(55), type: 'sawtooth', dur: 0.35, gain: 0.07, glideTo: midi(50) });
  },
  /** Craquements de vinyle en boucle pendant la lecture sur la platine. */
  crackle: (() => {
    let nodes = null;
    let timer = null;
    return {
      start() {
        const c = audio();
        if (!c || nodes) return;
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c, 2);
        src.loop = true;
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2500;
        const g = c.createGain();
        g.gain.value = 0.018;
        src.connect(hp).connect(g).connect(master);
        src.start();
        const hum = c.createOscillator();
        const hg = c.createGain();
        hum.frequency.value = 55;
        hg.gain.value = 0.012;
        hum.connect(hg).connect(master);
        hum.start();
        nodes = [src, hum];
        timer = setInterval(() => {
          if (Math.random() < 0.7) noise(c, { dur: 0.012 + Math.random() * 0.02, gain: 0.05 + Math.random() * 0.12, from: 6000, to: 2000, q: 1, type: 'highpass' });
        }, 140);
      },
      stop() {
        clearInterval(timer);
        timer = null;
        nodes?.forEach((n) => {
          try {
            n.stop();
          } catch {
            // déjà arrêté
          }
        });
        nodes = null;
      },
    };
  })(),
  tick() {
    const c = audio();
    if (!c) return;
    tone(c, { freq: 1200, type: 'square', dur: 0.03, gain: 0.03 });
  },
};
