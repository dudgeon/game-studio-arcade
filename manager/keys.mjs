// A browser's KeyboardEvent.code as a Linux key code, US layout (D282). arcade-keyd takes codes 1-119.

/** @type {Record<string, number>} */
export const LINUX = {
  Escape: 1, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Minus: 12, Equal: 13, Backspace: 14, Tab: 15,
  KeyQ: 16, KeyW: 17, KeyE: 18, KeyR: 19, KeyT: 20, KeyY: 21, KeyU: 22, KeyI: 23, KeyO: 24, KeyP: 25, BracketLeft: 26, BracketRight: 27,
  Enter: 28, ControlLeft: 29,
  KeyA: 30, KeyS: 31, KeyD: 32, KeyF: 33, KeyG: 34, KeyH: 35, KeyJ: 36, KeyK: 37, KeyL: 38, Semicolon: 39, Quote: 40, Backquote: 41,
  ShiftLeft: 42, Backslash: 43,
  KeyZ: 44, KeyX: 45, KeyC: 46, KeyV: 47, KeyB: 48, KeyN: 49, KeyM: 50, Comma: 51, Period: 52, Slash: 53, ShiftRight: 54,
  AltLeft: 56, Space: 57,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68,
  NumpadEnter: 96, ControlRight: 97, AltRight: 100,
  Home: 102, ArrowUp: 103, PageUp: 104, ArrowLeft: 105, ArrowRight: 106, End: 107, ArrowDown: 108, PageDown: 109, Delete: 111,
};

/** The cabinet's planned controls (D82, D88, D205) and the keys they send. */
export const CONTROLS = [
  { id: "up", label: "▲", code: "ArrowUp" },
  { id: "down", label: "▼", code: "ArrowDown" },
  { id: "left", label: "◀", code: "ArrowLeft" },
  { id: "right", label: "▶", code: "ArrowRight" },
  { id: "a", label: "A", code: "KeyZ", key: "Z" },
  { id: "b", label: "B", code: "KeyX", key: "X" },
  { id: "x", label: "X", code: "KeyC", key: "C" },
  { id: "y", label: "Y", code: "KeyV", key: "V" },
  { id: "start", label: "START", code: "Enter", key: "Enter" },
  { id: "esc", label: "ESC ★", code: "Escape", key: "Esc" },
  { id: "f1", label: "F1", code: "F1", key: "F1" },
  { id: "coin", label: "COIN", code: "F2", key: "F2" },
];

/** @param {unknown} codes @returns {number[]} the Linux codes, or throws */
export function toLinux(codes) {
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 8) throw new Error("keys: give 1-8 key codes");
  return codes.map((c) => {
    const n = typeof c === "string" ? LINUX[c] : undefined;
    if (!n) throw new Error(`keys: no such key ${String(c)}`);
    return n;
  });
}
