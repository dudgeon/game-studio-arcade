// Seeded random numbers (D10): sfc32, seeded through splitmix32 so nearby
// seeds give unrelated streams.

function splitmix32(a) {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** @param {number} seed */
export function createRng(seed) {
  const mix = splitmix32(Math.floor(Number(seed)) || 0);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();
  /** A float in [0, 1). */
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up.
  for (let i = 0; i < 12; i++) next();
  return next;
}
