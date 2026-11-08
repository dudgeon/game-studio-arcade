// Runs inside the sandbox: can the preinstalled Playwright drive headless
// Chromium offline, the way the playtest harness will? Writes chromium.json
// and a screenshot to /mnt/session/outputs/.
const fs = require("fs");
const path = require("path");
const OUT = "/mnt/session/outputs";
const result = { ok: false, steps: [] };
const step = (name, data) => { result.steps.push({ name, ...data }); };

(async () => {
  let pw;
  try {
    pw = require("playwright");
    const pkg = path.join(path.dirname(require.resolve("playwright")), "package.json");
    result.playwright = { resolved: require.resolve("playwright"), version: require(pkg).version };
  } catch (e) {
    step("require playwright", { error: String(e) });
    return finish();
  }
  const t0 = Date.now();
  const browser = await pw.chromium.launch({ headless: true });
  result.chromium = { version: browser.version(), launch_ms: Date.now() - t0 };
  const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // A stand-in for a house-runtime cart: 320×256 canvas, rAF loop, key input.
  await page.setContent(`<!doctype html><body style="margin:0;background:#000">
    <canvas id=c width=320 height=256 style="width:1280px;height:1024px;image-rendering:pixelated"></canvas>
    <script>
      const g = document.getElementById('c').getContext('2d');
      window.__frames = 0; window.__keys = [];
      addEventListener('keydown', e => __keys.push(e.code));
      (function loop(){ __frames++; g.fillStyle = '#1d2b53'; g.fillRect(0,0,320,256);
        g.fillStyle = '#ff004d'; g.fillRect((__frames*2)%320, 120, 16, 16);
        requestAnimationFrame(loop); })();
      window.__caps = { AudioContext: typeof AudioContext, OfflineAudioContext: typeof OfflineAudioContext,
        getGamepads: typeof navigator.getGamepads, OffscreenCanvas: typeof OffscreenCanvas,
        webgl: !!document.createElement('canvas').getContext('webgl') };
    </script>`);
  await page.waitForTimeout(1000);
  const frames1s = await page.evaluate(() => window.__frames);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("KeyZ");
  const keys = await page.evaluate(() => window.__keys);
  const caps = await page.evaluate(() => window.__caps);
  await page.screenshot({ path: `${OUT}/chromium-probe.png` });
  // Network must be blocked for pages too.
  let net;
  try { await page.goto("https://example.com", { timeout: 8000 }); net = "REACHED example.com"; }
  catch (e) { net = `blocked: ${String(e).split("\n")[0]}`; }
  await browser.close();
  Object.assign(result, { ok: true, raf_frames_in_1s: frames1s, keys_received: keys, capabilities: caps, page_errors: errors, page_network: net });
  finish();
})().catch((e) => { step("fatal", { error: String(e && e.stack || e) }); finish(); });

function finish() {
  fs.writeFileSync(`${OUT}/chromium.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
