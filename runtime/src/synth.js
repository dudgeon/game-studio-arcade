// The 4-voice chip synth, WebAudio side (D21). Plays sound commands from the
// console machine. Lives on the host page (audio needs a user gesture there).
import { VOICES } from "./sound.js";

const FRAME_S = 1 / 60;
const MASTER = 0.25;

export class Synth {
  /** @param {AudioContext} [ctx] */
  constructor(ctx) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER;
    this.master.connect(this.ctx.destination);
    /** @type {{ nodes: AudioScheduledSourceNode[], gain: GainNode }[]} */
    this.voices = Array.from({ length: VOICES }, () => {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      return { nodes: [], gain };
    });
    this.noise = this._noiseBuffer();
    this.pulseWave = this._pulseWave(0.25);
  }

  /** Resume after a user gesture (browsers start audio suspended). */
  resume() {
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  _noiseBuffer() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let x = 0x2545f491;
    for (let i = 0; i < len; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
    }
    return buf;
  }

  _pulseWave(duty) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return this.ctx.createPeriodicWave(real, imag);
  }

  /** @param {number} [voice] all voices if omitted */
  stop(voice) {
    const list = voice === undefined ? this.voices : [this.voices[voice]];
    for (const v of list) {
      if (!v) continue;
      for (const n of v.nodes) {
        try {
          n.stop();
        } catch {}
      }
      v.nodes = [];
    }
  }

  /** @param {import("./sound.js").SoundCommand} cmd */
  play(cmd) {
    const v = this.voices[cmd.voice];
    if (!v) return;
    this.stop(cmd.voice);
    let at = this.ctx.currentTime + 0.005;
    for (const seg of cmd.segments) {
      const dur = seg.frames * FRAME_S;
      const env = this.ctx.createGain();
      env.connect(v.gain);
      const peak = seg.vol * (seg.wave === "noise" ? 0.8 : seg.wave === "triangle" ? 1 : 0.5);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + 0.004);
      env.gain.setValueAtTime(peak, Math.max(at + 0.004, at + dur - 0.02));
      env.gain.linearRampToValueAtTime(0, at + dur);

      /** @type {AudioScheduledSourceNode} */
      let src;
      const endRatio = 2 ** (seg.slide / 12);
      if (seg.wave === "noise") {
        const b = this.ctx.createBufferSource();
        b.buffer = this.noise;
        b.loop = true;
        const rate = Math.max(0.05, Math.min(4, seg.freq / 440));
        b.playbackRate.setValueAtTime(rate, at);
        if (seg.slide) b.playbackRate.exponentialRampToValueAtTime(Math.max(0.02, rate * endRatio), at + dur);
        src = b;
      } else {
        const o = this.ctx.createOscillator();
        if (seg.wave === "pulse") o.setPeriodicWave(this.pulseWave);
        else o.type = seg.wave === "saw" ? "sawtooth" : seg.wave;
        o.frequency.setValueAtTime(seg.freq, at);
        if (seg.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, seg.freq * endRatio), at + dur);
        src = o;
      }
      src.connect(env);
      src.start(at);
      src.stop(at + dur + 0.01);
      v.nodes.push(src);
      at += dur;
    }
  }
}
