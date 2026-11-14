// @ts-check
// A game's g.ai asks (D480): the runtime host hands each one here, and it goes to the
// cabinet service, which holds the key and makes the call. Any failure is "no answer":
// the game carries on with its own fallbacks.

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
