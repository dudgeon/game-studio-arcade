// Showing a glide picture cheaply (D517). The glide buffer is one byte a pixel: a palette index.
// Turning it into RGBA in JavaScript and handing the canvas 3 MB a frame is what made glide slow on
// the Pi. Here the bytes go to the GPU as they are, as a one-channel texture, and a tiny shader looks
// each one up in the palette. One draw call, one quad; nothing else is WebGL. The colors come out
// exactly as the 2D path's: the lookup is nearest-pixel on both textures, with no blending.
//
// If there's no WebGL here, or the context is lost, `createBlit` returns null or `show` returns false,
// and the frame falls back to the 2D path, which is slower and shows the same picture.

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D ix;
uniform sampler2D pal;
varying vec2 uv;
void main() {
  float i = floor(texture2D(ix, uv).r * 255.0 + 0.5);
  gl_FragColor = texture2D(pal, vec2((i + 0.5) / 32.0, 0.5));
}`;

/** Is this WebGL renderer a CPU pretending to be a GPU? */
export function isSoftware(/** @type {string} */ renderer) {
  return /llvmpipe|softpipe|swiftshader|software|swrast/i.test(renderer);
}

/**
 * @param {HTMLCanvasElement} canvas a canvas with no other context
 * @param {Uint32Array} rgba the palette as little-endian RGBA, 32 entries (palette.js rgbaTable)
 * @param {{ anyGl?: boolean }} [o] anyGl: use even a software GL (tests, to check the shader's colors)
 * @returns {{ show(pixels: Uint8Array, w: number, h: number): boolean, lost(): boolean } | null}
 */
export function createBlit(canvas, rgba, o = {}) {
  /** @type {WebGLRenderingContext | null} */
  let gl = null;
  try {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: /** @type {const} */ ("low-power") };
    gl = /** @type {WebGLRenderingContext | null} */ (canvas.getContext("webgl", opts));
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const g = gl;
  // A software GL (llvmpipe, SwiftShader) is slower than the 2D path, not faster: headless Chromium on
  // the Pi only ever gets one of those (D517). Only a real GPU is worth it.
  const dbg = g.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER));
  if (isSoftware(renderer) && !o.anyGl) return null;
  let dead = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    dead = true;
  });

  const shader = (/** @type {number} */ type, /** @type {string} */ src) => {
    const s = g.createShader(type);
    if (!s) return null;
    g.shaderSource(s, src);
    g.compileShader(s);
    return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(g.VERTEX_SHADER, VERT);
  const fs = shader(g.FRAGMENT_SHADER, FRAG);
  const prog = g.createProgram();
  if (!vs || !fs || !prog) return null;
  g.attachShader(prog, vs);
  g.attachShader(prog, fs);
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) return null;
  g.useProgram(prog);

  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(prog, "p");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

  const texture = (/** @type {number} */ unit) => {
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, g.createTexture());
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  };
  g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  texture(1);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, rgba.length, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length * 4));
  texture(0); // left bound: every upload after this goes to the index texture
  g.uniform1i(g.getUniformLocation(prog, "ix"), 0);
  g.uniform1i(g.getUniformLocation(prog, "pal"), 1);
  if (g.getError() !== g.NO_ERROR) return null;

  let tw = 0;
  let th = 0;
  return {
    /** Put a w x h picture of palette indices on the canvas. False if it couldn't: use the 2D path. */
    show(pixels, w, h) {
      if (dead || g.isContextLost()) return false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      if (tw !== w || th !== h) {
        g.viewport(0, 0, w, h);
        g.texImage2D(g.TEXTURE_2D, 0, g.LUMINANCE, w, h, 0, g.LUMINANCE, g.UNSIGNED_BYTE, pixels);
        tw = w;
        th = h;
      } else g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, w, h, g.LUMINANCE, g.UNSIGNED_BYTE, pixels);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    lost: () => dead || g.isContextLost(),
  };
}
