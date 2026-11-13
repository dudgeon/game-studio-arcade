// Kid words on the plan screen (D304): the agent sometimes writes a rule's timing in
// frames or milliseconds, the way the code counts it. The brief asks for seconds; this
// makes sure the screen never shows "frames" either way. The runtime runs at 60 frames
// a second (D10), so N frames is N/60 seconds.

const FPS = 60;

/** "half a second", "1.5 seconds", "a split second". @param {number} s */
export function seconds(s) {
  if (s < 0.2) return "a split second";
  if (Math.abs(s - 0.5) < 0.05) return "half a second";
  if (Math.abs(s - 1) < 0.05) return "1 second";
  const r = s < 10 ? Math.round(s * 10) / 10 : Math.round(s);
  return `${r} seconds`;
}

/**
 * The same words with frame and millisecond counts as seconds, and per-frame speeds per second.
 * @param {string} text
 * @returns {{ text: string, changed: boolean }}
 */
export function kidWords(text) {
  let t = String(text ?? "");
  const before = t;
  // "3.5 pixels per frame" -> "210 pixels a second"
  t = t.replace(/(\d+(?:\.\d+)?)\s*(pixels?|px|cells?|rows?)\s*(?:per|a|each|every)\s*frame\b/gi, (_, n, unit) => `${Math.round(Number(n) * FPS)} ${unit.toLowerCase() === "px" ? "pixels" : unit} a second`);
  // "every 3 frames" -> "every split second"; "90 frames" -> "1.5 seconds"
  t = t.replace(/(\d+(?:\.\d+)?)\s*frames?\b/gi, (_, n) => seconds(Number(n) / FPS));
  // "500 ms", "500 milliseconds" -> "half a second"
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:ms|milliseconds?)\b/gi, (_, n) => seconds(Number(n) / 1000));
  // "60 fps" -> "smoothly"
  t = t.replace(/\b\d+\s*fps\b/gi, "smoothly");
  // Any "frame" left: "each frame" -> "all the time"; "a frame" -> "a moment".
  t = t.replace(/\b(each|every|per)\s+frame\b/gi, "all the time").replace(/\bframes?\b/gi, (w) => (w.toLowerCase() === "frames" ? "moments" : "moment"));
  // "every a split second" reads oddly: "every split second".
  t = t.replace(/\bevery a split second\b/gi, "every split second").replace(/\bevery (\d)/gi, "every $1");
  return { text: t, changed: t !== before };
}
