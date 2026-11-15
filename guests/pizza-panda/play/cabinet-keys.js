// Only the cabinet's own keys (D82) reach PICO-8's player: the stick, Z X C V and Enter.
// PICO-8 already reads Z and C as its O button and X and V as its X button, so the cabinet's
// A and X are O, and B and Y are X; START (Enter) opens PICO-8's own pause menu.
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
