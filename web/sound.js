/* Iconland soundscapes: generative music + nature ambience for every theme, synthesized live with Web Audio
   (no recordings, nothing downloaded).

   - Music: a slow chord progression per theme; pads, bass, arpeggios, strums and a melody that comes and goes.
     A slowly wandering "energy" decides which parts play, so the arrangement breathes and never loops exactly.
     Plucked strings are Karplus-Strong, mallets / steel drum / bells are additive partials (pre-rendered per note
     and cached), pads / flute / reed / bass are live oscillators.
   - Ambience: waves, open sea, wind, leaves, birds, gulls, crickets, frogs, water drips, ship's bell, hooves...
     each an event scheduler with randomized timing.

   Host protocol (wallpaper page only): {t:'sound', on: bool, vol: 0..1}. Anything else is ignored.
   Debug: ?soundtest=<theme>&secs=30 renders offline and leaves a base64 WAV in window.__wav.
*/
(function () {
  'use strict';

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  const chance = p => Math.random() < p;

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    pentMajor: [0, 2, 4, 7, 9], pentMinor: [0, 3, 5, 7, 10],
  };

  /* ====================================================================================================
     Theme presets
     prog: chord roots as scale degrees (0 = I); each chord lasts `per` bars.
     Melody rhythms are note onsets in beats within one bar.
     ==================================================================================================== */
  // bus trims per theme (music, ambience), measured from offline renders so every theme plays at a similar level
  const TRIM = { beach: [0.73, 1.2], archipelago: [0.88, 2.4], meadow: [1, 2.75], woods: [1.26, 1.6], highsea: [0.75, 1.3],
                 pond: [3.4, 6.8], cloudsky: [3.5, 5], oldmap: [1.74, 2.4], oldland: [2.4, 3.6] };
  function presets(hour) {
    const all = presetTable(hour);
    for (const k in all) { all[k].mg = TRIM[k][0]; all[k].ag = TRIM[k][1]; }
    return all;
  }
  function presetTable(hour) {
    const night = hour >= 21 || hour < 6, dusk = !night && (hour >= 18 || hour < 8);
    return {
      beach: {
        music: {
          bpm: 86, beats: 4, swing: 0.1, root: 53, scale: 'major', per: 1,
          progs: [[0, 5, 3, 4], [0, 3, 0, 4], [3, 4, 2, 5], [0, 4, 5, 3]],
          pad: { vol: 0.07, center: 62, att: 0.9, rel: 1.6, cut: 1300 },
          bass: { vol: 0.22, pat: [0, 1.5, 2, 3.5], minE: 0.25 },
          strum: { vol: 0.09, beats: [0.5, 1.5, 2.5, 3.5], minE: 0.15, center: 64 },
          arp: { inst: 'marimba', vol: 0.06, steps: 2, pat: [0, -1, 1, 2, -1, 1, 2, 1], oct: 72, prob: 0.6, minE: 0.55 },
          mel: { inst: 'steel', vol: 0.17, scale: 'pentMajor', oct: 77, prob: 0.75, minE: 0.3,
                 rhythms: [[0, 1, 1.5, 2.5], [0, 0.5, 1, 2], [0.5, 1.5, 2, 3], [0, 1.5, 3], [0, 0.5, 1.5, 2, 3]] },
        },
        amb: [
          ['waves', { vol: 0.42, min: 6.5, max: 11, cut: 520, fizz: 1 }],
          ['gulls', { vol: 0.06, min: 18, max: 45 }],
          ['wind', { vol: 0.04, f0: 500, f1: 1100 }],
        ],
      },
      archipelago: {
        music: {
          bpm: 98, beats: 4, swing: 0.06, root: 58, scale: 'major', per: 1,
          progs: [[0, 4, 5, 3], [0, 3, 4, 3], [5, 3, 0, 4]],
          pad: { vol: 0.06, center: 63, att: 0.6, rel: 1.4, cut: 1400 },
          bass: { vol: 0.2, pat: [0, 0.75, 2, 2.75], minE: 0.25 },
          arp: { inst: 'marimba', vol: 0.09, steps: 2, pat: [0, -1, -1, 1, -1, 2, 1, -1], oct: 70, prob: 0.85, minE: 0.1 },
          strum: { vol: 0.06, beats: [1, 3], minE: 0.45, center: 66 },
          mel: { inst: 'steel', vol: 0.15, scale: 'pentMajor', oct: 77, prob: 0.6, minE: 0.4,
                 rhythms: [[0, 0.75, 1.5, 2.5], [0, 1, 1.75, 2.5, 3], [0.5, 1.5, 2.5], [0, 0.75, 1.5, 3]] },
        },
        amb: [
          ['waves', { vol: 0.24, min: 8, max: 14, cut: 420, fizz: 0.6 }],
          ['gulls', { vol: 0.05, min: 25, max: 55 }],
          ['shipbell', { vol: 0.05, min: 50, max: 110 }],
          ['wind', { vol: 0.04, f0: 400, f1: 900 }],
        ],
      },
      meadow: {
        music: {
          bpm: 132, beats: 3, swing: 0, root: 55, scale: 'major', per: 2,
          progs: [[0, 3, 0, 4], [0, 5, 3, 4], [3, 0, 1, 4]],
          pad: { vol: 0.07, center: 62, att: 1.4, rel: 2.2, cut: 1100 },
          bass: { vol: 0.17, pat: [0], minE: 0.2 },
          arp: { inst: 'harp', vol: 0.11, steps: 2, pat: [0, 1, 2, 3, 2, 1], oct: 67, prob: 0.9, minE: 0.1 },
          mel: { inst: 'flute', vol: 0.1, scale: 'major', oct: 79, prob: 0.6, minE: 0.35,
                 rhythms: [[0, 1, 2], [0, 2], [0, 1.5, 2], [0, 1, 1.5, 2], [0]] },
        },
        amb: [
          ['wind', { vol: 0.08, f0: 350, f1: 900 }],
          ['leaves', { vol: 0.025 }],
          ['birds', { vol: 0.07, min: 2.5, max: 9, kinds: ['lark', 'lark', 'tit', 'robin'] }],
          ['crickets', { vol: 0.012, n: 2, f: 5600 }],
        ],
      },
      woods: {
        music: {
          bpm: 64, beats: 4, swing: 0, root: 50, scale: 'dorian', per: 1,
          progs: [[0, 3, 0, 6], [0, 2, 6, 0], [0, 6, 3, 3]],
          pad: { vol: 0.08, center: 60, att: 1.8, rel: 2.6, cut: 950 },
          bass: { vol: 0.16, pat: [0, 2.5], minE: 0.3 },
          arp: { inst: 'kalimba', vol: 0.11, steps: 2, pat: [0, 2, 1, 3, 2, 1, 2, -1], oct: 69, prob: 0.8, minE: 0.1 },
          mel: { inst: 'flute', vol: 0.085, scale: 'dorian', oct: 74, prob: 0.5, minE: 0.4,
                 rhythms: [[0, 1.5, 2], [0, 2, 3], [0, 1, 2.5], [0, 3]] },
        },
        amb: [
          ['leaves', { vol: 0.035 }],
          ['wind', { vol: 0.035, f0: 250, f1: 600 }],
          ['birds', { vol: 0.08, min: 1.5, max: 6, kinds: ['robin', 'blackbird', 'tit', 'warbler', 'blackbird'] }],
          ['cuckoo', { vol: 0.05, min: 40, max: 90 }],
          ['woodpecker', { vol: 0.07, min: 35, max: 80 }],
        ],
      },
      highsea: {
        music: {
          bpm: 54, beats: 4, swing: 0, root: 45, scale: 'minor', per: 2,
          progs: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0]],
          pad: { vol: 0.1, center: 60, att: 3, rel: 4, cut: 900 },
          bass: { vol: 0.16, pat: [0], minE: 0.2, long: true },
          arp: { inst: 'bell', vol: 0.045, steps: 1, pat: [0, -1, 2, -1], oct: 76, prob: 0.5, minE: 0.45 },
          mel: { inst: 'bell', vol: 0.07, scale: 'pentMinor', oct: 81, prob: 0.35, minE: 0.5,
                 rhythms: [[0, 2], [0, 1.5, 3], [1, 3]] },
        },
        amb: [
          ['sea', { vol: 0.34 }],
          ['wind', { vol: 0.09, f0: 300, f1: 800 }],
          ['gulls', { vol: 0.035, min: 40, max: 90 }],
        ],
      },
      pond: {
        music: {
          bpm: 72, beats: 4, swing: 0, root: 52, scale: 'major', per: 1,
          progs: [[0, 2, 3, 0], [3, 4, 0, 5], [0, 5, 3, 4]],
          pad: { vol: 0.07, center: 63, att: 1.5, rel: 2.4, cut: 1000 },
          bass: { vol: 0.14, pat: [0, 2], minE: 0.35 },
          arp: { inst: 'marimba', vol: 0.08, steps: 2, pat: [0, 1, 2, 1, 3, 1, 2, 1], oct: 68, prob: 0.75, minE: 0.1 },
          mel: { inst: 'kalimba', vol: 0.12, scale: 'pentMajor', oct: 76, prob: 0.55, minE: 0.35,
                 rhythms: [[0, 1, 2], [0, 0.5, 1, 2.5], [0, 2, 2.5], [1, 2, 3]] },
        },
        amb: [
          ['lap', { vol: 0.07 }],
          ['drips', { vol: 0.05, min: 1.5, max: 6 }],
          ['frogs', { vol: 0.06, min: 12, max: 35 }],
          ['crickets', { vol: 0.015, n: 2, f: 4700 }],
          ['birds', { vol: 0.04, min: 6, max: 16, kinds: ['blackbird', 'tit'] }],
        ],
      },
      cloudsky: {
        music: {
          bpm: night ? 52 : 62, beats: 4, swing: 0, root: 48, scale: 'lydian', per: 2,
          progs: [[0, 1, 0, 1], [0, 1, 5, 2], [3, 1, 0, 0]],
          pad: { vol: 0.09, center: 67, att: 2.5, rel: 3.5, cut: 1500 },
          bass: { vol: 0.1, pat: [0], minE: 0.5, long: true },
          arp: { inst: 'harp', vol: 0.07, steps: 2, pat: [0, 1, 2, 3, 4, 3, 2, 1], oct: 72, prob: 0.6, minE: 0.3 },
          mel: { inst: 'bell', vol: night ? 0.06 : 0.08, scale: 'lydian', oct: 84, prob: 0.45, minE: 0.3,
                 rhythms: [[0, 1, 2], [0, 2], [0, 0.5, 2], [1, 2, 3]] },
        },
        amb: night
          ? [['wind', { vol: 0.05, f0: 300, f1: 700 }], ['crickets', { vol: 0.025, n: 3, f: 4400 }]]
          : [['wind', { vol: 0.11, f0: 500, f1: 1400 }], ['birds', { vol: 0.03, min: 8, max: 20, kinds: dusk ? ['blackbird'] : ['lark', 'tit'] }]],
      },
      oldmap: {
        music: {   // a sea shanty in 6/8: two groups of three eighths per bar
          bpm: 168, beats: 6, swing: 0, root: 50, scale: 'dorian', per: 1,
          progs: [[0, 0, 6, 6], [0, 2, 6, 0], [0, 6, 0, 4]],
          reed: { vol: 0.045, beats: [0, 3], len: 2.2, center: 62, minE: 0.2 },
          bass: { vol: 0.17, pat: [0, 3], minE: 0.2 },
          arp: { inst: 'lute', vol: 0.1, steps: 1, pat: [0, 1, 2, 0, 1, 2], oct: 62, prob: 0.85, minE: 0.1 },
          mel: { inst: 'whistle', vol: 0.07, scale: 'dorian', oct: 79, prob: 0.55, minE: 0.4,
                 rhythms: [[0, 2, 3, 5], [0, 1, 2, 3], [0, 3, 4], [0, 2, 3, 4, 5]] },
        },
        amb: [
          ['waves', { vol: 0.2, min: 7, max: 12, cut: 380, fizz: 0.5 }],
          ['creak', { vol: 0.05, min: 9, max: 22 }],
          ['gulls', { vol: 0.04, min: 30, max: 70 }],
          ['shipbell', { vol: 0.04, min: 60, max: 140 }],
        ],
      },
      oldland: {
        music: {
          bpm: 120, beats: 3, swing: 0, root: 43, scale: 'mixolydian', per: 2,
          progs: [[0, 6, 0, 6], [0, 3, 6, 0], [3, 0, 6, 0]],
          pad: { vol: 0.07, center: 55, att: 2, rel: 3, cut: 800, fifths: true },
          bass: { vol: 0.12, pat: [0], minE: 0.3 },
          arp: { inst: 'lute', vol: 0.11, steps: 2, pat: [0, 2, 1, 2, 3, 2], oct: 62, prob: 0.85, minE: 0.1 },
          mel: { inst: 'flute', vol: 0.085, scale: 'mixolydian', oct: 74, prob: 0.55, minE: 0.35,
                 rhythms: [[0, 1, 2], [0, 2], [0, 0.5, 1, 2], [0, 1.5, 2]] },
        },
        amb: [
          ['wind', { vol: 0.06, f0: 300, f1: 700 }],
          ['birds', { vol: 0.045, min: 4, max: 12, kinds: ['blackbird', 'lark', 'tit'] }],
          ['hooves', { vol: 0.07, min: 35, max: 75 }],
          ['cuckoo', { vol: 0.035, min: 60, max: 140 }],
        ],
      },
    };
  }

  /* ====================================================================================================
     Engine
     ==================================================================================================== */
  class Scape {
    constructor(ctx, preset, dest) {
      this.ctx = ctx;
      this.cache = new Map();
      this.noises = {};
      // out -> compressor -> dest; music and ambience buses, a shared reverb
      this.out = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
      this.out.connect(comp); comp.connect(dest);
      this.verb = ctx.createConvolver();
      this.verb.buffer = this.impulse(3.2);
      const vg = ctx.createGain(); vg.gain.value = 0.55;
      this.verb.connect(vg); vg.connect(this.out);
      this.music = ctx.createGain(); this.music.gain.value = preset.mg || 1; this.music.connect(this.out);
      this.amb = ctx.createGain(); this.amb.gain.value = preset.ag || 1; this.amb.connect(this.out);
      this.musicSend = ctx.createGain(); this.musicSend.gain.value = 0.45 * (preset.mg || 1); this.musicSend.connect(this.verb);
      this.ambSend = ctx.createGain(); this.ambSend.gain.value = 0.3 * (preset.ag || 1); this.ambSend.connect(this.verb);
      this.seq = preset.music ? new Sequencer(this, preset.music) : null;
      this.layers = (preset.amb || []).map(([k, o]) => new AMB[k](this, o)).filter(Boolean);
    }
    start(t) { this.t0 = t; if (this.seq) this.seq.next = t + 0.6; this.layers.forEach(l => l.start && l.start(t)); }
    scheduleUntil(T) { if (this.seq) this.seq.until(T); for (const l of this.layers) l.until(T); }

    // ---------- buffers ----------
    impulse(sec) {
      const sr = this.ctx.sampleRate, n = Math.floor(sr * sec), b = this.ctx.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c); let lp = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr, k = 0.25 + 0.7 * Math.exp(-t * 1.2);           // darker as the tail goes on
          lp += ((Math.random() * 2 - 1) - lp) * k;
          d[i] = lp * Math.exp(-t * 2.1) * (t < 0.015 ? t / 0.015 : 1);
        }
      }
      return b;
    }
    noise(kind) {
      if (this.noises[kind]) return this.noises[kind];
      const sr = this.ctx.sampleRate, n = sr * 6, b = this.ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, br = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.1; }
        else { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.2; }
      }
      // crossfade the loop seam
      const f = Math.floor(sr * 0.05);
      for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
      return (this.noises[kind] = b);
    }
    noiseSrc(kind, t) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise(kind); s.loop = true;
      s.start(t, Math.random() * 5);
      return s;
    }
    // Karplus-Strong plucked string; returned with the playback rate that corrects the integer delay length
    pluck(midi, bright, decay, dur) {
      const key = `p${midi}|${bright}|${decay}`;
      let e = this.cache.get(key);
      if (e) return e;
      const sr = this.ctx.sampleRate, f = mtof(midi);
      const N = Math.max(2, Math.round(sr / f - 0.5)), rate = f / (sr / (N + 0.5));
      const len = Math.ceil(sr * dur), b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
      let lp = 0, mean = 0;
      for (let i = 0; i < N; i++) { lp += ((Math.random() * 2 - 1) - lp) * (0.15 + 0.8 * bright); d[i] = lp; mean += lp; }
      mean /= N; for (let i = 0; i < N; i++) d[i] -= mean;
      for (let i = N; i < len; i++) d[i] = decay * 0.5 * (d[i - N] + d[i - N - 1 < 0 ? 0 : i - N - 1]);
      this.finish(d, sr);
      e = { buf: b, rate };
      this.cache.set(key, e);
      return e;
    }
    // additive partials [ratio, amp, decay seconds]
    mallet(midi, kind) {
      const key = `m${midi}|${kind}`;
      let e = this.cache.get(key);
      if (e) return e;
      const K = MALLETS[kind], sr = this.ctx.sampleRate, f = mtof(midi);
      const len = Math.ceil(sr * K.dur), b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
      const low = f < 260 ? 1.4 : f > 1000 ? 0.7 : 1;
      for (const [r, a, tau] of K.p) {
        const fr = f * r;
        if (fr > sr * 0.45) continue;
        const w = 2 * Math.PI * fr / sr, cw = Math.cos(w), sw = Math.sin(w), dk = Math.exp(-1 / (sr * tau * low));
        let x = 0, y = 1, amp = a;            // rotating phasor: cheap sine
        for (let i = 0; i < len; i++) {
          d[i] += x * amp;
          const nx = x * cw + y * sw; y = y * cw - x * sw; x = nx;
          amp *= dk;
        }
      }
      const att = Math.floor(sr * K.att);
      for (let i = 0; i < att; i++) d[i] *= i / att;
      if (K.click) { for (let i = 0; i < sr * 0.004; i++) d[i] += (Math.random() * 2 - 1) * K.click * (1 - i / (sr * 0.004)); }
      this.finish(d, sr);
      e = { buf: b, rate: 1 };
      this.cache.set(key, e);
      return e;
    }
    finish(d, sr) {
      let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      const g = pk > 0 ? 0.9 / pk : 1, fo = Math.floor(sr * 0.08);
      for (let i = 0; i < d.length; i++) d[i] *= g * (i > d.length - fo ? (d.length - i) / fo : 1);
    }

    // ---------- voices ----------
    chain(node, vol, pan, bus, send) {
      const g = this.ctx.createGain(); g.gain.value = vol;
      const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      node.connect(g); g.connect(p); p.connect(bus === 'amb' ? this.amb : this.music);
      if (send) { const s = this.ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(bus === 'amb' ? this.ambSend : this.musicSend); }
      return g;
    }
    playBuf(e, t, vol, pan, bus = 'music', send = 0.5, detune = 1) {
      const s = this.ctx.createBufferSource();
      s.buffer = e.buf; s.playbackRate.value = e.rate * detune;
      this.chain(s, vol, pan, bus, send);
      s.start(t);
      return s;
    }
    note(inst, t, midi, dur, vol, pan = 0) {
      switch (inst) {
        case 'harp': return this.playBuf(this.pluck(midi, 0.45, 0.997, 3), t, vol, pan, 'music', 0.6);
        case 'lute': return this.playBuf(this.pluck(midi, 0.55, 0.995, 2.2), t, vol, pan, 'music', 0.4);
        case 'uke': return this.playBuf(this.pluck(midi, 0.7, 0.993, 1.4), t, vol, pan, 'music', 0.3);
        case 'flute': return this.flute(t, midi, dur, vol, pan, false);
        case 'whistle': return this.flute(t, midi, dur, vol, pan, true);
        default: return this.playBuf(this.mallet(midi, inst), t, vol, pan, 'music', inst === 'bell' ? 0.8 : 0.45);
      }
    }
    pad(t, midis, dur, o, vol) {
      const ctx = this.ctx, lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.4;
      lp.frequency.setValueAtTime(o.cut * 0.55, t);
      lp.frequency.linearRampToValueAtTime(o.cut, t + o.att + 0.5);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vol, t + o.att);
      env.gain.setValueAtTime(vol, t + dur);
      env.gain.setTargetAtTime(0, t + dur, o.rel / 3);
      lp.connect(env);
      const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.2, 0.2);
      env.connect(pan); pan.connect(this.music);
      const s = ctx.createGain(); s.gain.value = 0.8; pan.connect(s); s.connect(this.musicSend);
      const end = t + dur + o.rel * 2;
      midis.forEach((m, i) => {
        for (const [type, det, a] of [['triangle', 0, 0.6], ['sawtooth', 7, 0.16], ['sawtooth', -7, 0.16]]) {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = type; osc.frequency.value = mtof(m); osc.detune.value = det + rnd(-2, 2);
          g.gain.value = a / Math.sqrt(midis.length);
          osc.connect(g); g.connect(lp);
          osc.start(t); osc.stop(end);
        }
      });
    }
    reed(t, midis, dur, vol) {   // concertina-ish: detuned saws, a little bellows swell
      const ctx = this.ctx, lp = ctx.createBiquadFilter(), env = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.6;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vol, t + 0.06);
      env.gain.linearRampToValueAtTime(vol * 0.75, t + dur * 0.6);
      env.gain.setTargetAtTime(0, t + dur, 0.06);
      lp.connect(env); this.chain(env, 1, rnd(-0.15, 0.15), 'music', 0.35);
      for (const m of midis) for (const det of [-6, 6]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        g.gain.value = 0.3 / midis.length; o.connect(g); g.connect(lp);
        o.start(t); o.stop(t + dur + 0.5);
      }
    }
    bass(t, midi, dur, vol, long) {
      const ctx = this.ctx, f = mtof(midi), env = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 500;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vol, t + (long ? 0.5 : 0.015));
      env.gain.setTargetAtTime(vol * 0.55, t + 0.05, long ? 2 : 0.35);
      env.gain.setTargetAtTime(0, t + dur, long ? 0.6 : 0.08);
      lp.connect(env); env.connect(this.music);
      for (const [type, mul, a] of [['sine', 1, 1], ['triangle', 2, 0.18]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f * mul; g.gain.value = a;
        o.connect(g); g.connect(lp); o.start(t); o.stop(t + dur + (long ? 3 : 0.6));
      }
    }
    flute(t, midi, dur, vol, pan, whistle) {
      const ctx = this.ctx, f = mtof(midi), env = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = whistle ? 5000 : 2800;
      const att = whistle ? 0.03 : 0.07, rel = whistle ? 0.08 : 0.18;
      dur = Math.max(dur, 0.12);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(vol, t + att);
      env.gain.setValueAtTime(vol, t + Math.max(dur - rel, att));
      env.gain.linearRampToValueAtTime(vol * 0.8, t + dur);
      env.gain.setTargetAtTime(0, t + dur, rel / 2);
      lp.connect(env); this.chain(env, 1, pan, 'music', 0.6);
      const vib = ctx.createOscillator(), vg = ctx.createGain();
      vib.frequency.value = rnd(4.6, 5.4);
      vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.5, dur));
      vib.connect(vg);
      const end = t + dur + 1;
      for (const [type, mul, a] of [['sine', 1, 1], ['triangle', 1, 0.22], ['sine', 2, 0.08]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f * mul; g.gain.value = a;
        vg.connect(o.frequency);
        o.connect(g); g.connect(lp); o.start(t); o.stop(end);
      }
      const br = this.noiseSrc('white', t), bp = ctx.createBiquadFilter(), bg = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f * 1.5; bp.Q.value = 1.2;
      bg.gain.setValueAtTime(whistle ? 0.08 : 0.14, t);
      bg.gain.setTargetAtTime(whistle ? 0.03 : 0.05, t + att, 0.08);
      br.connect(bp); bp.connect(bg); bg.connect(lp);
      br.stop(end); vib.start(t); vib.stop(end);
    }
  }

  const MALLETS = {
    marimba: { dur: 1.6, att: 0.002, click: 0.15, p: [[1, 1, 0.55], [3.93, 0.28, 0.1], [9.2, 0.07, 0.03]] },
    kalimba: { dur: 2.6, att: 0.002, click: 0.08, p: [[1, 1, 0.9], [3.0, 0.05, 0.25], [5.9, 0.14, 0.07], [1.006, 0.2, 1.1]] },
    steel: { dur: 2.6, att: 0.006, click: 0.04, p: [[1, 1, 0.9], [2, 0.6, 0.6], [3, 0.28, 0.4], [4.02, 0.14, 0.25], [5.03, 0.06, 0.15], [0.5, 0.06, 0.5]] },
    bell: { dur: 5, att: 0.003, click: 0, p: [[1, 1, 1.9], [1.003, 0.45, 1.9], [2.0, 0.35, 1.2], [2.76, 0.28, 0.8], [5.4, 0.12, 0.35], [8.9, 0.05, 0.2]] },
    shipbell: { dur: 6, att: 0.002, click: 0.05, p: [[0.5, 0.5, 2.6], [1, 1, 2.2], [1.19, 0.45, 1.8], [1.5, 0.35, 1.5], [2, 0.3, 1.2], [2.52, 0.18, 0.8], [3.01, 0.12, 0.6]] },
  };

  /* ---------------------------------------------------------------------------------------------------
     Music sequencer
     --------------------------------------------------------------------------------------------------- */
  class Sequencer {
    constructor(sc, c) {
      this.sc = sc; this.c = c;
      this.B = 60 / c.bpm;
      this.bar = 0; this.next = 0;
      this.prog = c.progs[0]; this.energy = 0.3; this.target = 0.5;
      this.scale = SCALES[c.scale];
      this.mel = { left: 0, idx: null, motif: null, bars: 0 };
      this.melScale = c.mel ? SCALES[c.mel.scale] : null;
    }
    until(T) {
      while (this.next < T) {
        this.playBar(this.next);
        this.next += this.c.beats * this.B;
        this.bar++;
      }
    }
    deg(i) { const s = this.scale, o = Math.floor(i / s.length); return this.c.root + s[((i % s.length) + s.length) % s.length] + 12 * o; }
    chordTones(d, seventh) { const r = [this.deg(d), this.deg(d + 2), this.deg(d + 4)]; if (seventh) r.push(this.deg(d + 6)); return r; }
    near(m, center) { while (m < center - 6) m += 12; while (m > center + 6) m -= 12; return m; }
    playBar(t0) {
      const c = this.c, B = this.B, sc = this.sc, per = c.per;
      const cycleLen = this.prog.length * per;
      if (this.bar % cycleLen === 0 && this.bar > 0 && chance(0.4)) this.prog = pick(c.progs);
      // energy wanders every 8 bars; now and then it drops away to let the ambience breathe
      if (this.bar % 8 === 0) {
        this.target = chance(0.12) && this.bar > 0 ? 0 : clamp(this.target + rnd(-0.35, 0.4), 0.15, 1);
        if (this.bar === 0) this.target = 0.35;
      }
      this.energy += (this.target - this.energy) * 0.35;
      const e = this.energy;
      const ci = Math.floor(this.bar / per) % this.prog.length, d = this.prog[ci];
      const newChord = this.bar % per === 0;
      const tones = this.chordTones(d, false);
      const barLen = c.beats * B;
      const H = x => x + rnd(-0.008, 0.008);
      const sw = (pos) => pos + (c.swing && (pos % 1) >= 0.49 && (pos % 1) <= 0.51 ? c.swing : 0);

      if (c.pad && newChord && e > 0.02) {
        let v = (c.pad.fifths ? [this.deg(d), this.deg(d) + 7, this.deg(d) + 12] : this.chordTones(d, chance(0.5)))
          .map(m => this.near(m, c.pad.center)).sort((a, b) => a - b);
        sc.pad(t0, v, barLen * per - 0.05, c.pad, c.pad.vol * (0.55 + 0.45 * e));
      }
      if (c.reed && e > c.reed.minE) {
        const v = tones.map(m => this.near(m, c.reed.center)).sort((a, b) => a - b);
        for (const b of c.reed.beats) sc.reed(H(t0 + b * B), v, c.reed.len * B, c.reed.vol * (0.6 + 0.4 * e));
      }
      if (c.bass && e > c.bass.minE) {
        const root = this.near(this.deg(d), 40);
        c.bass.pat.forEach((b, i) => {
          const m = i > 0 && chance(0.3) ? root + 7 : root;
          const len = c.bass.long ? barLen * per : Math.min(B * 0.9, (c.bass.pat[i + 1] ?? c.beats) * B - b * B);
          if (c.bass.long && !newChord) return;
          sc.bass(H(t0 + sw(b) * B), m, len, c.bass.vol * (0.6 + 0.4 * e), c.bass.long);
        });
      }
      if (c.strum && e > c.strum.minE) {
        const v = this.chordTones(d, false).concat([this.deg(d) + 12]).map(m => this.near(m, c.strum.center)).sort((a, b) => a - b);
        c.strum.beats.forEach((b, i) => {
          const order = i % 2 ? v.slice().reverse() : v, tt = t0 + sw(b) * B;
          order.forEach((m, k) => sc.note('uke', H(tt + k * 0.014), m, 0.3, c.strum.vol * (i % 2 ? 0.75 : 1) * (0.7 + 0.3 * e), (k - 1.5) * 0.12));
        });
      }
      if (c.arp && e > c.arp.minE) {
        const a = c.arp, n = c.beats * a.steps;
        const pool = [0, 1, 2, 3, 4].map(k => this.near(tones[k % 3] + 12 * Math.floor(k / 3), a.oct) + (k >= 3 ? 12 : 0));
        for (let s = 0; s < n; s++) {
          const k = a.pat[s % a.pat.length];
          if (k < 0 || !chance(a.prob * (0.6 + 0.4 * e))) continue;
          const pos = s / a.steps;
          sc.note(a.inst, H(t0 + sw(pos) * B), pool[k], B / a.steps, a.vol * (s % a.steps ? 0.75 : 1) * rnd(0.85, 1.05), rnd(-0.35, 0.35));
        }
      }
      if (c.mel) this.melody(t0, d, tones, e);
    }
    melody(t0, d, tones, e) {
      const c = this.c, m = c.mel, M = this.mel, B = this.B, sc = this.sc, S = this.melScale;
      const toMidi = i => m.oct - 7 + c.root % 12 + S[((i % S.length) + S.length) % S.length] + 12 * Math.floor(i / S.length);
      if (M.left <= 0) {
        if (e < m.minE || !chance(m.prob * (0.5 + 0.5 * e))) { M.idx = null; return; }
        M.left = pick([2, 4, 4]); M.bars = 0; M.motif = null;
      }
      const pcs = tones.map(x => ((x % 12) + 12) % 12);
      const isChord = i => pcs.includes(((toMidi(i) % 12) + 12) % 12);
      if (M.idx === null) { M.idx = S.length + 1; while (!isChord(M.idx)) M.idx++; }
      const closestChord = i => { for (let k = 0; k < 6; k++) { if (isChord(i + k)) return i + k; if (isChord(i - k)) return i - k; } return i; };
      // phrase: bar 0 invents a motif, bar 2 answers with the same rhythm and contour from a new chord tone
      let rhythm, steps;
      if (M.bars % 2 === 0 && M.motif && M.bars === 2) { rhythm = M.motif.r; steps = M.motif.s; }
      else {
        rhythm = pick(m.rhythms); steps = rhythm.map(() => pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]));
        if (M.bars === 0) M.motif = { r: rhythm, s: steps };
      }
      const last = M.left === 1;
      rhythm.forEach((pos, k) => {
        let i = M.idx + steps[k];
        if (pos % 2 === 0 || (last && k === rhythm.length - 1)) i = closestChord(i);
        i = clamp(i, S.length - 2, S.length * 2 + 3);
        if (i > S.length * 2) i -= 2;
        M.idx = i;
        const next = rhythm[k + 1] ?? c.beats;
        const dur = (last && k === rhythm.length - 1 ? c.beats - pos : next - pos) * B * 0.92;
        sc.note(m.inst, t0 + pos * B + rnd(-0.01, 0.01), toMidi(i), dur, m.vol * rnd(0.85, 1.05) * (0.75 + 0.25 * e), rnd(-0.15, 0.15));
      });
      M.bars++; M.left--;
    }
  }

  /* ---------------------------------------------------------------------------------------------------
     Ambience layers: each has until(T) and schedules its own events up to T
     --------------------------------------------------------------------------------------------------- */
  class Every {   // helper base: call fire(t) at random intervals
    constructor(sc, o, first = 0.3) { this.sc = sc; this.o = o; this.ctx = sc.ctx; this.first = first; }
    start(t) { this.next = t + rnd(this.o.min || 1, this.o.max || 2) * this.first; }
    until(T) { while (this.next < T) { this.fire(this.next); this.next += rnd(this.o.min, this.o.max); } }
    out(node, vol, pan, send = 0.6, lpHz = 0) {
      let n = node;
      if (lpHz) { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpHz; n.connect(lp); n = lp; }
      return this.sc.chain(n, vol, pan, 'amb', send);
    }
  }

  class Waves extends Every {
    constructor(sc, o) {
      super(sc, Object.assign({}, o), 0.1);
      const ctx = this.ctx;
      this.ch = [0, 1].map(() => {
        const lp = ctx.createBiquadFilter(), g = ctx.createGain(), fz = ctx.createBiquadFilter(), fg = ctx.createGain(), p = ctx.createStereoPanner();
        lp.type = 'lowpass'; lp.frequency.value = o.cut * 0.5; lp.Q.value = 0.3;
        fz.type = 'bandpass'; fz.frequency.value = 2600; fz.Q.value = 0.5;
        g.gain.value = 0; fg.gain.value = 0;
        lp.connect(g); fz.connect(fg); g.connect(p); fg.connect(p); p.connect(sc.amb);
        const s = ctx.createGain(); s.gain.value = 0.25; p.connect(s); s.connect(sc.ambSend);
        return { lp, g, fz, fg, p };
      });
      this.k = 0;
    }
    start(t) {
      super.start(t);
      const ctx = this.ctx;
      for (const c of this.ch) { this.sc.noiseSrc('brown', t).connect(c.lp); this.sc.noiseSrc('pink', t).connect(c.fz); }
      // a constant low murmur so the sea never goes silent between waves
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      this.sc.noiseSrc('brown', t).connect(lp);
      this.out(lp, this.o.vol * 0.35, 0, 0.2);
    }
    fire(t) {
      const c = this.ch[this.k ^= 1], o = this.o, A = o.vol * rnd(0.55, 1);
      const rise = rnd(1.8, 3), wash = rnd(2.5, 4.5), crash = t + rise;
      c.g.gain.setTargetAtTime(A, t, rise * 0.4);
      c.g.gain.setTargetAtTime(A * 0.08, crash, wash * 0.35);
      c.lp.frequency.setTargetAtTime(o.cut * 1.8, t, rise * 0.5);
      c.lp.frequency.setTargetAtTime(o.cut * 0.45, crash, wash * 0.4);
      c.fg.gain.setTargetAtTime(A * 0.04, t, rise * 0.6);
      c.fg.gain.setTargetAtTime(A * 0.55 * o.fizz, crash - 0.2, 0.12);
      c.fg.gain.setTargetAtTime(0, crash + 0.3, wash * 0.3);
      c.fz.frequency.setTargetAtTime(3400, crash - 0.2, 0.2);
      c.fz.frequency.setTargetAtTime(1500, crash + 0.3, wash * 0.4);
      c.p.pan.setTargetAtTime(rnd(-0.45, 0.45), t, 1);
    }
  }

  class Sea extends Every {   // open ocean: long deep swells, no breaking surf
    constructor(sc, o) { super(sc, Object.assign({ min: 5, max: 9 }, o), 0.1); }
    start(t) {
      super.start(t);
      const ctx = this.ctx;
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 300; this.lp.Q.value = 0.5;
      this.g = ctx.createGain(); this.g.gain.value = this.o.vol * 0.5;
      this.sc.noiseSrc('brown', t).connect(this.lp); this.lp.connect(this.g);
      this.out(this.g, 1, 0, 0.3);
      this.hp = ctx.createBiquadFilter(); this.hp.type = 'bandpass'; this.hp.frequency.value = 1200; this.hp.Q.value = 0.4;
      this.hg = ctx.createGain(); this.hg.gain.value = 0;
      this.sc.noiseSrc('pink', t).connect(this.hp); this.hp.connect(this.hg);
      this.out(this.hg, 1, 0.2, 0.4);
    }
    fire(t) {
      const A = this.o.vol * rnd(0.55, 1), up = rnd(2, 3.5);
      this.g.gain.setTargetAtTime(A, t, up * 0.4);
      this.g.gain.setTargetAtTime(this.o.vol * 0.4, t + up, 1.6);
      this.lp.frequency.setTargetAtTime(rnd(380, 520), t, up * 0.5);
      this.lp.frequency.setTargetAtTime(240, t + up, 1.5);
      this.hg.gain.setTargetAtTime(A * 0.12, t + up * 0.7, 0.4);
      this.hg.gain.setTargetAtTime(0, t + up + 0.6, 1.2);
    }
  }

  class Wind extends Every {
    constructor(sc, o) { super(sc, Object.assign({ min: 1.5, max: 4 }, o), 0); }
    start(t) {
      super.start(t);
      const ctx = this.ctx;
      this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 0.8; this.bp.frequency.value = this.o.f0;
      this.g = ctx.createGain(); this.g.gain.value = this.o.vol * 0.5;
      this.sc.noiseSrc('pink', t).connect(this.bp); this.bp.connect(this.g);
      this.pan = this.out(this.g, 1, 0, 0.3);
    }
    fire(t) {
      const o = this.o, gust = rnd(0.25, 1);
      this.g.gain.setTargetAtTime(o.vol * gust, t, rnd(0.8, 2));
      this.bp.frequency.setTargetAtTime(o.f0 + (o.f1 - o.f0) * (0.3 * Math.random() + 0.7 * gust), t, 1.5);
    }
  }

  class Leaves extends Every {   // rustle: bright noise with a fluttering tremolo, swelling in gusts
    constructor(sc, o) { super(sc, Object.assign({ min: 1.5, max: 5 }, o), 0); }
    start(t) {
      super.start(t);
      const ctx = this.ctx, hp = ctx.createBiquadFilter(), am = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 2400;
      this.g = ctx.createGain(); this.g.gain.value = 0;
      am.gain.value = 0.6; lfo.frequency.value = 6.3; lg.gain.value = 0.4;
      lfo.connect(lg); lg.connect(am.gain); lfo.start(t);
      this.sc.noiseSrc('white', t).connect(hp); hp.connect(am); am.connect(this.g);
      this.out(this.g, 1, rnd(-0.3, 0.3), 0.4, 7000);
    }
    fire(t) { this.g.gain.setTargetAtTime(this.o.vol * Math.pow(Math.random(), 1.5) * 1.6, t, rnd(0.6, 1.5)); }
  }

  // birdsong: one oscillator per song, syllables drawn with frequency + gain automation
  const BIRDS = {
    tit(r) { const hi = rnd(5800, 7000), lo = hi * rnd(0.62, 0.72), s = []; const n = 2 + Math.floor(rnd(1, 4));
      for (let i = 0; i < n; i++) s.push([hi, hi * 0.95, 0.09], [0, 0, 0.04], [lo, lo, 0.11], [0, 0, 0.09]); return s; },
    warbler() { const s = [], n = 8 + Math.floor(rnd(0, 8)), f = rnd(4200, 5600);
      for (let i = 0; i < n; i++) s.push([f * rnd(1.05, 1.2), f * rnd(0.7, 0.8), 0.045], [0, 0, 0.025]); s.push([f * 1.3, f * 0.9, 0.12]); return s; },
    robin() { const s = [], n = 4 + Math.floor(rnd(0, 5));
      for (let i = 0; i < n; i++) { const a = rnd(2600, 6500); s.push([a, a * rnd(0.8, 1.25), rnd(0.07, 0.22)], [0, 0, rnd(0.03, 0.12)]); } return s; },
    blackbird() { const s = [], n = 3 + Math.floor(rnd(0, 4)), base = rnd(1700, 2300);
      for (let i = 0; i < n; i++) { const a = base * pick([1, 1.125, 1.25, 1.5, 1.33]); s.push([a, a * rnd(0.95, 1.08), rnd(0.12, 0.3)], [0, 0, rnd(0.04, 0.1)]); }
      s.push([base * 2.4, base * 2, 0.1]); return s; },
    lark() { const s = [], n = 18 + Math.floor(rnd(0, 20));
      for (let i = 0; i < n; i++) { const a = rnd(3200, 6000); s.push([a, a * rnd(0.85, 1.2), rnd(0.03, 0.08)], [0, 0, rnd(0.01, 0.04)]); } return s; },
  };
  class Birds extends Every {
    fire(t) {
      const ctx = this.ctx, kind = pick(this.o.kinds), syl = BIRDS[kind](), dist = Math.random();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; g.gain.value = 0;
      let x = t;
      for (const [f0, f1, d] of syl) {
        if (f0 > 0) {
          o.frequency.setValueAtTime(f0, x); o.frequency.exponentialRampToValueAtTime(f1, x + d);
          g.gain.setValueAtTime(0, x); g.gain.linearRampToValueAtTime(1, x + Math.min(0.012, d * 0.3));
          g.gain.setValueAtTime(1, x + d * 0.7); g.gain.linearRampToValueAtTime(0, x + d);
        }
        x += d;
      }
      o.connect(g); o.start(t); o.stop(x + 0.1);
      this.out(g, this.o.vol * (1 - 0.75 * dist) * (kind === 'blackbird' ? 1.2 : 0.8), rnd(-0.8, 0.8), 0.3 + 0.6 * dist, 9000 - 5000 * dist);
      // a second bird answers sometimes
      if (chance(0.25)) this.next = Math.min(this.next, x + rnd(0.3, 1.2));
    }
  }

  class Gulls extends Every {
    fire(t) {
      const ctx = this.ctx, n = 2 + Math.floor(rnd(0, 4)), f = rnd(1000, 1350), pan = rnd(-0.8, 0.8), far = Math.random();
      const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.6; g.gain.value = 0;
      let x = t;
      for (let i = 0; i < n; i++) {
        const d = i === 0 ? rnd(0.35, 0.5) : rnd(0.16, 0.24), ff = f * (1 - i * 0.04);
        o.frequency.setValueAtTime(ff * 0.8, x); o.frequency.linearRampToValueAtTime(ff * 1.15, x + d * 0.3); o.frequency.linearRampToValueAtTime(ff * 0.7, x + d);
        g.gain.setValueAtTime(0, x); g.gain.linearRampToValueAtTime(1, x + 0.03); g.gain.setValueAtTime(1, x + d * 0.6); g.gain.linearRampToValueAtTime(0, x + d);
        x += d + rnd(0.08, 0.16);
      }
      o.connect(bp); bp.connect(g); o.start(t); o.stop(x + 0.1);
      this.out(g, this.o.vol * (1 - 0.6 * far), pan, 0.5 + 0.4 * far, 4200);
    }
  }

  class Crickets extends Every {
    constructor(sc, o) { super(sc, Object.assign({ min: 0.5, max: 0.9 }, o), 0); }
    start(t) {
      super.start(t);
      this.cr = [];
      for (let i = 0; i < this.o.n; i++) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.value = this.o.f * rnd(0.94, 1.06); g.gain.value = 0;
        o.connect(g); o.start(t);
        this.out(g, this.o.vol * rnd(0.5, 1), rnd(-0.8, 0.8), 0.4);
        this.cr.push({ g, next: t + rnd(0, 1), per: rnd(0.5, 0.9) });
      }
      this.next = Infinity;
    }
    until(T) {
      for (const c of this.cr) while (c.next < T) {
        const pulses = 3 + Math.floor(rnd(0, 2)), pw = 0.018;
        for (let p = 0; p < pulses; p++) {
          const x = c.next + p * pw * 2;
          c.g.gain.setValueAtTime(0, x); c.g.gain.linearRampToValueAtTime(1, x + 0.004);
          c.g.gain.setValueAtTime(1, x + pw - 0.004); c.g.gain.linearRampToValueAtTime(0, x + pw);
        }
        c.next += c.per * rnd(0.9, 1.1) + (chance(0.1) ? rnd(1, 4) : 0);
      }
    }
  }

  class Frogs extends Every {
    fire(t) {
      const ctx = this.ctx, f = rnd(150, 260), pan = rnd(-0.7, 0.7), calls = 1 + Math.floor(rnd(0, 4));
      const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; bp.type = 'bandpass'; bp.frequency.value = f * 3.2; bp.Q.value = 3; g.gain.value = 0;
      let x = t;
      for (let c = 0; c < calls; c++) {
        const pulses = 4 + Math.floor(rnd(0, 6));
        for (let p = 0; p < pulses; p++) {
          g.gain.setValueAtTime(0, x); g.gain.linearRampToValueAtTime(1, x + 0.006); g.gain.linearRampToValueAtTime(0, x + 0.03);
          x += 0.042;
        }
        o.frequency.setValueAtTime(f * rnd(0.95, 1.05), x);
        x += rnd(0.25, 0.6);
      }
      o.connect(bp); bp.connect(g); o.start(t); o.stop(x + 0.1);
      this.out(g, this.o.vol, pan, 0.4, 2500);
    }
  }

  class Drips extends Every {
    fire(t) {
      const ctx = this.ctx, f = rnd(700, 1400), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(1.8, 2.6), t + 0.05);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.003); g.gain.setTargetAtTime(0, t + 0.01, 0.03);
      o.connect(g); o.start(t); o.stop(t + 0.3);
      this.out(g, this.o.vol * rnd(0.4, 1), rnd(-0.8, 0.8), 0.9);
      if (chance(0.3)) this.next = Math.min(this.next, t + rnd(0.15, 0.4));
    }
  }

  class Lap extends Every {   // small water lapping at the banks
    constructor(sc, o) { super(sc, Object.assign({ min: 0.6, max: 2.2 }, o), 0); }
    start(t) {
      super.start(t);
      const ctx = this.ctx;
      this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 500; this.bp.Q.value = 1.2;
      this.g = ctx.createGain(); this.g.gain.value = 0;
      this.sc.noiseSrc('pink', t).connect(this.bp); this.bp.connect(this.g);
      this.out(this.g, 1, rnd(-0.3, 0.3), 0.4);
    }
    fire(t) {
      const a = this.o.vol * rnd(0.3, 1), d = rnd(0.3, 0.8);
      this.g.gain.setTargetAtTime(a, t, d * 0.3); this.g.gain.setTargetAtTime(this.o.vol * 0.08, t + d, d * 0.5);
      this.bp.frequency.setTargetAtTime(rnd(350, 800), t, 0.1);
    }
  }

  class Cuckoo extends Every {
    fire(t) {
      const ctx = this.ctx, n = 2 + Math.floor(rnd(0, 4)), f = rnd(620, 700), pan = rnd(-0.8, 0.8);
      const o = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0; let x = t;
      for (let i = 0; i < n; i++) {
        o.frequency.setValueAtTime(f, x); g.gain.setValueAtTime(0, x); g.gain.linearRampToValueAtTime(1, x + 0.04); g.gain.linearRampToValueAtTime(0, x + 0.2);
        o.frequency.setValueAtTime(f * 0.8, x + 0.3); g.gain.setValueAtTime(0, x + 0.3); g.gain.linearRampToValueAtTime(0.9, x + 0.35); g.gain.linearRampToValueAtTime(0, x + 0.62);
        x += 1.1;
      }
      o.connect(g); o.start(t); o.stop(x);
      this.out(g, this.o.vol, pan, 0.9, 2500);
    }
  }

  class Woodpecker extends Every {
    fire(t) {
      const ctx = this.ctx, src = this.sc.noiseSrc('white', t), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = rnd(900, 1400); bp.Q.value = 4; g.gain.value = 0;
      const n = 14 + Math.floor(rnd(0, 8)); let x = t, gap = 0.055;
      for (let i = 0; i < n; i++) {
        g.gain.setValueAtTime(0, x); g.gain.linearRampToValueAtTime(1 - i / n * 0.5, x + 0.002); g.gain.setTargetAtTime(0, x + 0.003, 0.006);
        x += gap; gap *= 1.012;
      }
      src.connect(bp); bp.connect(g); src.stop(x + 0.1);
      this.out(g, this.o.vol, rnd(-0.8, 0.8), 0.8);
    }
  }

  class ShipBell extends Every {
    fire(t) {
      const e = this.sc.mallet(rnd(0, 1) < 0.5 ? 83 : 81, 'shipbell'), pan = rnd(-0.7, 0.7), n = pick([2, 2, 4]);
      for (let i = 0; i < n; i++) this.sc.playBuf(e, t + Math.floor(i / 2) * 1.6 + (i % 2) * 0.45, this.o.vol * (i % 2 ? 0.8 : 1), pan, 'amb', 1.2);
    }
  }

  class Creak extends Every {   // ship's timbers / rope: a slow, rough friction tone
    fire(t) {
      const ctx = this.ctx, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), d = rnd(0.5, 1.1);
      const f = rnd(70, 110);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
      for (let x = 0; x < d; x += 0.04) o.frequency.linearRampToValueAtTime(f * (1 + 0.25 * x / d) * rnd(0.9, 1.1), t + x);
      bp.type = 'bandpass'; bp.frequency.value = rnd(600, 1000); bp.Q.value = 5;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + d * 0.3); g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(bp); bp.connect(g); o.start(t); o.stop(t + d + 0.1);
      this.out(g, this.o.vol, rnd(-0.5, 0.5), 0.5);
    }
  }

  class Hooves extends Every {   // a horse and carriage passes by: clip-clop moving across the stereo field
    fire(t) {
      const ctx = this.ctx, src = this.sc.noiseSrc('white', t), bp = ctx.createBiquadFilter(), g = ctx.createGain(), env = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2.5; g.gain.value = 0;
      const dur = rnd(7, 11), dir = chance(0.5) ? 1 : -1;
      for (let x = 0; x < dur; x += 0.62) {
        for (const [o, a] of [[0, 1], [0.13, 0.7], [0.31, 0.9], [0.44, 0.6]]) {
          const y = t + x + o + rnd(-0.01, 0.01);
          g.gain.setValueAtTime(0, y); g.gain.linearRampToValueAtTime(a, y + 0.003); g.gain.setTargetAtTime(0, y + 0.004, 0.012);
        }
      }
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + dur * 0.45); env.gain.linearRampToValueAtTime(0, t + dur);
      src.connect(bp); bp.connect(g); g.connect(env); src.stop(t + dur + 0.2);
      const p = this.out(env, this.o.vol, 0, 0.5, 3500);
      const pan = p.context.createStereoPanner && p;   // panner is after the gain inside chain(); sweep via a new one
      void pan;
      const sp = ctx.createStereoPanner(); sp.pan.setValueAtTime(-0.8 * dir, t); sp.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
      g.disconnect(); g.connect(sp); sp.connect(env);
    }
  }

  const AMB = { waves: Waves, sea: Sea, wind: Wind, leaves: Leaves, birds: Birds, gulls: Gulls, crickets: Crickets,
                frogs: Frogs, drips: Drips, lap: Lap, cuckoo: Cuckoo, woodpecker: Woodpecker, shipbell: ShipBell,
                creak: Creak, hooves: Hooves };

  /* ====================================================================================================
     Live player + host glue
     ==================================================================================================== */
  const PAGE_THEME = { 'flat.html': 'beach', 'meadow.html': 'meadow', 'woods.html': 'woods', 'highsea.html': 'highsea',
    'pond.html': 'pond', 'cloudsky.html': 'cloudsky', 'archipelago.html': 'archipelago', 'oldmap.html': 'oldmap', 'oldland.html': 'oldland' };
  const theme = PAGE_THEME[location.pathname.split('/').pop()] || 'beach';

  const live = { ctx: null, scape: null, master: null, timer: 0, on: false, vol: 0.5, offT: 0 };
  const level = v => 1.6 * v * v;          // perceptual-ish volume curve
  function setSound(on, vol) {
    live.vol = clamp(+vol || 0, 0, 1);
    if (on) {
      if (!live.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        live.ctx = new Ctx();
        live.master = live.ctx.createGain(); live.master.gain.value = 0; live.master.connect(live.ctx.destination);
        live.scape = new Scape(live.ctx, presets(new Date().getHours())[theme], live.master);
        live.scape.start(live.ctx.currentTime + 0.1);
      }
      clearTimeout(live.offT);
      const ctx = live.ctx;
      const go = () => {
        const t = ctx.currentTime;
        live.master.gain.cancelScheduledValues(t);
        live.master.gain.setValueAtTime(live.master.gain.value, t);
        live.master.gain.linearRampToValueAtTime(level(live.vol), t + (live.on ? 0.3 : 3));
        live.on = true;
        if (!live.timer) live.timer = setInterval(() => live.scape.scheduleUntil(ctx.currentTime + 1.2), 250);
        live.scape.scheduleUntil(ctx.currentTime + 1.2);
      };
      if (ctx.state !== 'running') ctx.resume().then(go, go); else go();
    } else if (live.ctx && live.on) {
      live.on = false;
      const ctx = live.ctx, t = ctx.currentTime;
      live.master.gain.cancelScheduledValues(t);
      live.master.gain.setValueAtTime(live.master.gain.value, t);
      live.master.gain.linearRampToValueAtTime(0, t + 1.2);
      live.offT = setTimeout(() => { if (!live.on) { clearInterval(live.timer); live.timer = 0; ctx.suspend(); } }, 1400);
    }
  }

  const host = window.chrome && window.chrome.webview;
  if (host && /[?&]wallpaper=1/.test(location.search)) {
    host.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || !ev.data.startsWith('{"t":"sound"')) return;
      try { const m = JSON.parse(ev.data); setSound(!!m.on, m.vol); } catch (e) { console.error(e); }
    });
  }

  // offline render for testing / previews
  async function renderWav(name, secs, sr = 44100, hour = 13) {
    const ctx = new OfflineAudioContext(2, Math.floor(sr * secs), sr);
    const m = ctx.createGain(); m.gain.value = level(0.6); m.connect(ctx.destination);
    const pr = Object.assign({}, presets(hour)[name]);
    const only = new URLSearchParams(location.search).get('only');
    if (only === 'music') pr.amb = []; else if (only === 'amb') pr.music = null;
    const sc = new Scape(ctx, pr, m);
    sc.start(0.05);
    sc.scheduleUntil(secs);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
    const out = new DataView(new ArrayBuffer(44 + n * 4));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true);
    out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      out.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true);
      out.setInt16(46 + i * 4, clamp(R[i], -1, 1) * 32767, true);
    }
    const bytes = new Uint8Array(out.buffer);
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  window.IconlandSound = { setSound, renderWav, theme, presets };
  const QS = new URLSearchParams(location.search);
  window.IconlandSound.live = live;
  if (QS.has('soundon')) setSound(true, 0.5);          // debug: play without the host
  if (QS.has('soundtest')) {
    renderWav(QS.get('soundtest') || theme, +(QS.get('secs') || 30), 44100, +(QS.get('hour') || 13))
      .then(b => { window.__wav = b; }, e => { window.__wav = 'ERR ' + e; });
  }
})();
