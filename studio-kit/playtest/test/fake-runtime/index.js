// @ts-nocheck
// A small stand-in for the house runtime's headless() (runtime/headless.js),
// used only by the harness's own tests until the real runtime merges. It
// follows runtime/test-hook.d.ts: fixed 60 Hz frames, seeded g.rand, an input
// queue, palette-indexed pixels, sounds and saves. Drawing is simplified
// (text draws nothing); that's enough to test the harness, not carts.
// Plain browser-safe JS: the browser test serves this file to a page too.

export const W = 320;
export const H = 256;
export const BUTTONS = ["up", "down", "left", "right", "a", "b", "x", "y", "start"];
const NAMES = ["black", "night", "slate", "gray", "silver", "white", "maroon", "red", "coral", "pink", "brown", "orange", "tan", "peach", "gold", "yellow", "forest", "green", "lime", "mint", "teal", "aqua", "navy", "blue", "sky", "ice", "indigo", "purple", "lilac", "plum", "magenta", "rose"];
export const COLORS = Object.freeze(Object.fromEntries(NAMES.map((n, i) => [n, i])));
export const PALETTE = Object.freeze(NAMES.map((_, i) => "#" + [i * 8, 255 - i * 8, (i * 37) % 256].map((v) => v.toString(16).padStart(2, "0")).join("")));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv(pixels) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) { h ^= pixels[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

const held = (h) => new Set(typeof h === "string" ? h.split(/\s+/).filter(Boolean) : h ?? []);

export async function headless(cart, opts = {}) {
  const mod = typeof cart === "object" && !(cart instanceof URL) ? { default: cart } : await import(String(cart));
  const c = mod.default;
  if (!c || typeof c.init !== "function" || typeof c.update !== "function" || typeof c.draw !== "function") {
    throw new Error("game.js must export default { init, update, draw }");
  }
  let saved = opts.save ?? null;
  let st;
  const boot = (seed) => {
    const fb = new Uint8Array(W * H);
    const rand = mulberry32(seed);
    st = { fb, rand, frame: 0, queue: [], now: [new Set(), new Set()], prev: [new Set(), new Set()], sounds: [], cam: [0, 0] };
    const put = (x, y, col) => {
      x = Math.floor(x - st.cam[0]); y = Math.floor(y - st.cam[1]);
      if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = col;
    };
    const p = (n) => (n ?? 1) - 1;
    const g = {
      W, H, colors: COLORS, palette: PALETTE,
      get frame() { return st.frame; },
      btn: (b, n) => st.now[p(n)].has(b),
      btnp: (b, n) => st.now[p(n)].has(b) && !st.prev[p(n)].has(b),
      btnr: (b, n) => !st.now[p(n)].has(b) && st.prev[p(n)].has(b),
      cls: (col = 0) => fb.fill(col),
      pset: put,
      pget: (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? fb[Math.floor(y) * W + Math.floor(x)] : 0),
      line: (x0, y0, x1, y1, col) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col); },
      rect: (x, y, w, h, col) => { for (let i = 0; i < w; i++) { put(x + i, y, col); put(x + i, y + h - 1, col); } for (let j = 0; j < h; j++) { put(x, y + j, col); put(x + w - 1, y + j, col); } },
      rectfill: (x, y, w, h, col) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, col); },
      circ: (x, y, r, col) => { for (let a = 0; a < 64; a++) put(x + r * Math.cos(a / 10), y + r * Math.sin(a / 10), col); },
      circfill: (x, y, r, col) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) put(x + i, y + j, col); },
      text: (s) => String(s).length * 6,
      textWidth: (s, sc = 1) => String(s).length * 6 * sc,
      sprite: (rows) => ({ w: rows[0].length, h: rows.length, data: Int8Array.from(rows.join(""), (ch) => (ch === "." || ch === " " ? -1 : parseInt(ch, 32))) }),
      spr: (s, x, y) => { for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) { const v = s.data[j * s.w + i]; if (v >= 0) put(x + i, y + j, v); } },
      camera: (x = 0, y = 0) => { st.cam = [x, y]; },
      clip: () => {},
      rand: () => st.rand(),
      rnd: (n) => Math.floor(st.rand() * n),
      pick: (a) => a[Math.floor(st.rand() * a.length)],
      tone: (t = {}) => st.sounds.push({ frame: st.frame, kind: "tone", voice: t.voice ?? 0 }),
      sfx: (name, o = {}) => st.sounds.push({ frame: st.frame, kind: name, voice: o.voice ?? 0 }),
      stop: () => {},
      save: (d) => { const j = JSON.stringify(d); if (j === undefined || j.length > 4096) throw new Error("g.save: not JSON or over 4 KB"); saved = JSON.parse(j); },
      load: () => (saved == null ? null : JSON.parse(JSON.stringify(saved))),
    };
    st.g = g;
    st.s = c.init(g);
  };
  boot(opts.seed ?? 1);
  const initialSave = saved;

  return {
    async step(n = 1) {
      for (let i = 0; i < n; i++) {
        const cur = st.queue[0];
        st.prev = st.now;
        st.now = cur ? [held(cur.p1), held(cur.p2)] : [new Set(), new Set()];
        if (cur && --cur.left <= 0) st.queue.shift();
        st.frame += 1;
        c.update(st.g, st.s);
        if (i === n - 1) c.draw(st.g, st.s);
      }
    },
    async input(script) {
      for (const s of script) st.queue.push({ ...s, left: s.frames });
    },
    async probe() {
      if (typeof c.probe !== "function") return null;
      return JSON.parse(JSON.stringify(c.probe(st.g, st.s) ?? null));
    },
    async frame() {
      return { frame: st.frame, width: W, height: H, pixels: st.fb.slice(), hash: fnv(st.fb) };
    },
    async sounds() { return st.sounds.slice(); },
    async reset(o = {}) {
      if (!o.keepSave) saved = initialSave;
      boot(o.seed ?? 1);
    },
  };
}
