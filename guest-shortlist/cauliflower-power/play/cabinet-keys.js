// The cabinet's keys (D82) for TIC-80's first gamepad. TIC-80 reads the arrows and Z, X, A, S
// as the stick and A, B, X, Y; the cabinet sends Z X C V. So C and V reach the player as A and S,
// and every other key stops here: nothing on the cabinet can open TIC-80's own menu.
(() => {
  const PASS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyZ", "KeyX"]);
  const AS = { KeyC: { code: "KeyA", key: "a", keyCode: 65 }, KeyV: { code: "KeyS", key: "s", keyCode: 83 } };
  const on = (e) => {
    if (e.cabinet) return;
    e.preventDefault();
    if (PASS.has(e.code)) return;
    e.stopImmediatePropagation();
    const to = AS[e.code];
    if (!to || e.repeat) return;
    const out = new KeyboardEvent(e.type, { ...to, which: to.keyCode, bubbles: true, cancelable: true });
    Object.defineProperty(out, "cabinet", { value: true });
    (e.target ?? window).dispatchEvent(out);
  };
  addEventListener("keydown", on, { capture: true });
  addEventListener("keyup", on, { capture: true });
  addEventListener("load", () => document.getElementById("canvas")?.focus());
})();
