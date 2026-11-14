// @ts-check
// The volume bar (D421). Hold ENT and press a pink button: arcade-volkey on the cabinet changes the level and
// the service passes it here. The bar is its own element over the canvas and the game's frame, so it shows on
// every screen, guest games included, for a moment after each press.
const SHOW_MS = 1500;
const STEP = 10;

/** How many of the bar's blocks are lit. @param {number} percent @param {number} cap */
export function volumeBlocks(percent, cap) {
  const total = Math.max(1, Math.round(cap / STEP));
  return { total, lit: Math.min(total, Math.max(0, Math.ceil(percent / STEP))) };
}

export function listenForVolume() {
  const bar = document.createElement("div");
  bar.id = "volume";
  bar.hidden = true;
  bar.style.cssText = "position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);z-index:10;display:flex;align-items:center;gap:1.2vw;padding:1.6vh 2vw;background:#000d;border:0.5vh solid #fff;font:bold 4vh monospace;color:#fff";
  document.body.appendChild(bar);
  let timer = 0;
  (function connect() {
    const levels = new EventSource("/api/arcade/volume");
    levels.onmessage = (e) => {
      const l = JSON.parse(e.data);
      if (!Number.isFinite(l.percent)) return;
      const { total, lit } = volumeBlocks(l.percent, Math.max(l.cap ?? 100, l.percent));
      bar.replaceChildren(document.createTextNode(lit ? "VOL" : "VOL OFF"));
      for (let i = 0; i < total; i++) {
        const b = document.createElement("span");
        if (i < lit) b.dataset.lit = "1";
        b.style.cssText = `width:2.4vw;height:5vh;background:${i < lit ? "#7dffb0" : "#3a4170"}`;
        bar.appendChild(b);
      }
      bar.hidden = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => (bar.hidden = true), SHOW_MS);
    };
    levels.onerror = () => {
      if (levels.readyState === EventSource.CLOSED) setTimeout(connect, 1000);
    };
  })();
}
