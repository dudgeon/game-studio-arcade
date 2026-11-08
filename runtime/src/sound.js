// The 4-voice chip synth, pure side (D21): notes, presets and voice
// allocation. Carts produce sound events; a host plays them (synth.js).

export const VOICES = 4;
export const WAVES = Object.freeze(["square", "pulse", "triangle", "saw", "noise"]);

const NOTE_INDEX = { c: -9, d: -7, e: -5, f: -4, g: -2, a: 0, b: 2 };

/**
 * A note name ("A4", "C#5", "Bb3") or a frequency in Hz, to Hz.
 * @param {string | number | undefined} note
 */
export function noteToFreq(note) {
  if (note === undefined) return 440;
  if (typeof note === "number") {
    if (!(note > 0 && note < 20000)) throw new Error(`tone frequency ${note} Hz is out of range (1..20000)`);
    return note;
  }
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(String(note).trim());
  if (!m) throw new Error(`"${note}" isn't a note; use a name like "C4", "F#5" or "Bb3", or a frequency in Hz`);
  let semis = NOTE_INDEX[/** @type {keyof typeof NOTE_INDEX} */ (m[1].toLowerCase())];
  if (m[2] === "#") semis += 1;
  if (m[2] === "b") semis -= 1;
  semis += (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

/**
 * @typedef {{ freq: number, wave: Arcade.Wave, frames: number, vol: number, slide: number }} Segment
 * @typedef {{ frame: number, kind: "tone" | Arcade.Sfx, voice: number, segments: Segment[] }} SoundCommand
 */

/** @type {Readonly<Record<Arcade.Sfx, readonly Arcade.Tone[]>>} */
export const SFX = Object.freeze({
  blip: [{ note: "C5", wave: "square", frames: 4, vol: 0.4 }],
  select: [{ note: "E5", wave: "square", frames: 3, vol: 0.4 }, { note: "A5", wave: "square", frames: 5, vol: 0.4 }],
  jump: [{ note: "C4", wave: "square", frames: 10, vol: 0.4, slide: 12 }],
  coin: [{ note: "B5", wave: "square", frames: 4, vol: 0.4 }, { note: "E6", wave: "square", frames: 12, vol: 0.4 }],
  pop: [{ note: "G5", wave: "triangle", frames: 5, vol: 0.6, slide: 12 }],
  hit: [{ note: "C3", wave: "noise", frames: 6, vol: 0.5, slide: -5 }],
  explode: [{ note: "C4", wave: "noise", frames: 30, vol: 0.6, slide: -24 }],
  powerup: ["C5", "E5", "G5", "C6"].map((note) => ({ note, wave: /** @type {const} */ ("square"), frames: 4, vol: 0.4 })),
  lose: [
    { note: "G4", wave: "triangle", frames: 10, vol: 0.5 },
    { note: "E4", wave: "triangle", frames: 10, vol: 0.5 },
    { note: "C4", wave: "triangle", frames: 24, vol: 0.5, slide: -5 },
  ],
  win: [
    { note: "C5", wave: "pulse", frames: 5, vol: 0.4 },
    { note: "E5", wave: "pulse", frames: 5, vol: 0.4 },
    { note: "G5", wave: "pulse", frames: 5, vol: 0.4 },
    { note: "C6", wave: "pulse", frames: 16, vol: 0.4 },
  ],
});

/**
 * @param {Arcade.Tone} t
 * @param {number} [pitch] extra semitones
 * @param {number} [vol] overrides t.vol
 * @returns {Segment}
 */
export function toneToSegment(t, pitch = 0, vol) {
  const wave = t.wave ?? "square";
  if (!WAVES.includes(wave)) throw new Error(`unknown wave "${wave}" (use ${WAVES.join(", ")})`);
  const frames = Math.floor(t.frames ?? 8);
  if (!(frames >= 1 && frames <= 600)) throw new Error(`tone frames must be 1..600, got ${t.frames}`);
  const v = vol ?? t.vol ?? 0.5;
  return {
    freq: noteToFreq(t.note) * 2 ** (pitch / 12),
    wave,
    frames,
    vol: Math.max(0, Math.min(1, Number(v) || 0)),
    slide: Number(t.slide ?? 0) || 0,
  };
}

/** Deterministic voice allocation: free voice first, else the one started longest ago. */
export class Voices {
  constructor() {
    this.busyUntil = new Array(VOICES).fill(0);
    this.startedAt = new Array(VOICES).fill(-1);
    this.seq = 0;
  }

  /** @param {number} frame @param {number} length @param {number | undefined} want */
  take(frame, length, want) {
    let v;
    if (want !== undefined) {
      v = Math.floor(want);
      if (!(v >= 0 && v < VOICES)) throw new Error(`voice must be 0..${VOICES - 1}, got ${want}`);
    } else {
      v = this.busyUntil.findIndex((until) => until <= frame);
      if (v < 0) v = this.startedAt.indexOf(Math.min(...this.startedAt));
    }
    this.busyUntil[v] = frame + length;
    this.startedAt[v] = this.seq++;
    return v;
  }

  /** @param {number} [voice] */
  stop(voice) {
    if (voice === undefined) this.busyUntil.fill(0);
    else this.busyUntil[voice] = 0;
  }
}
