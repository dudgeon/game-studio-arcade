// @ts-check
// A game's g.ai asks (D480): the runtime host hands each one here, and it goes to the
// cabinet service, which holds the key and makes the call. Any failure is "no answer":
// the game carries on with its own fallbacks.

const postJson = (/** @type {string} */ url, /** @type {object} */ body = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });

/**
 * The cabinet's microphone for a game's voice asks (D489). The runtime host calls start while the game's
 * talk button is held and stop when it's let go; the service hears, and only one of the game's own actions
 * comes back. While the mic is on, the cabinet shows its own sign over the game, which a cart can't hide.
 * @param {string} cartId @param {string} playId @param {HTMLElement} stage
 */
export function voiceFor(cartId, playId, stage) {
  /** @type {HTMLElement | null} */
  let sign = null;
  /** @type {Promise<any>} */
  let started = Promise.resolve();
  const show = (/** @type {string | null} */ words) => {
    sign?.remove();
    sign = null;
    if (!words) return;
    sign = document.createElement("div");
    sign.textContent = words;
    sign.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:5;padding:6px 16px;background:#000;color:#fff;border:3px solid #e33;font:bold 22px monospace;letter-spacing:1px;pointer-events:none";
    stage.appendChild(sign);
  };
  return {
    start() {
      show("● LISTENING");
      started = postJson("/api/speech/start").catch(() => {});
    },
    /** @param {{ name: string, ask: string, actions: string[] }} v */
    async stop(v) {
      show("...");
      try {
        await started;
        const j = await (await postJson("/api/game-ai/voice", { cart_id: cartId, play_id: playId, name: v.name, ask: v.ask, actions: v.actions })).json();
        return { action: typeof j.action === "string" ? j.action : null };
      } catch {
        return { action: null };
      } finally {
        show(null);
      }
    },
    cancel() {
      show(null);
      // Thrown away in the service without being transcribed (the speech worker's cancel, D491).
      started.then(() => postJson("/api/game-ai/voice", { cancel: true })).catch(() => {});
    },
  };
}

/**
 * @param {string} cartId @param {string} playId
 * @returns {(ask: any) => Promise<{ ok: boolean, lines?: string[], pick?: string, stop?: boolean }>}
 */
export function gameAiFor(cartId, playId) {
  return async (ask) => {
    try {
      const r = await fetch("/api/game-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart_id: cartId, play_id: playId, kind: ask?.kind, name: ask?.name, ask: ask?.ask, max: ask?.max, options: ask?.options, facts: ask?.facts }),
      });
      const j = await r.json();
      // A game the service doesn't know (a starter example) or an ask it won't take: stop asking for this play.
      if (!r.ok) return { ok: false, stop: true };
      return { ok: j.ok === true, lines: j.lines, pick: j.pick, stop: j.stop === true };
    } catch {
      return { ok: false };
    }
  };
}
