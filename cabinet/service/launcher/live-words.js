// @ts-check
// Live words while a kid talks (D492, Geoff's D454): while the button is down, the talk screen asks the service
// what it has heard so far, a few times a second, and keeps it on the view as v.live for the screen to draw.
// Moonshine on the cabinet hears these; Groq still writes the final words when the button comes up.

const EVERY_MS = 250;

/**
 * Ask until the hold ends. `still()` says whether the view is still listening.
 * @param {any} v the talk screen's view
 * @param {() => boolean} still
 * @param {(url: string) => Promise<any>} get
 */
export function pollLive(v, still, get) {
  const t = setInterval(async () => {
    if (!still()) return void clearInterval(t);
    try {
      const r = await get("/api/speech/live");
      if (still()) v.live = r;
    } catch {}
  }, EVERY_MS);
}
