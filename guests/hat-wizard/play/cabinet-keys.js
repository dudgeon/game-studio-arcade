// Only the cabinet's own keys (D82) reach RetroArch: the stick, A B X Y (Z X C V) and START
// (Enter). Every other key stops here, so nothing on a keyboard can open RetroArch's menus.
// Escape never gets this far: the cabinet's script takes it first (D232).
(() => {
  const PASS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyZ", "KeyX", "KeyC", "KeyV", "Enter"]);
  const on = (/** @type {KeyboardEvent} */ e) => {
    e.preventDefault();
    if (!PASS.has(e.code)) e.stopImmediatePropagation();
  };
  addEventListener("keydown", on, { capture: true });
  addEventListener("keyup", on, { capture: true });
  addEventListener("keypress", on, { capture: true });
})();
