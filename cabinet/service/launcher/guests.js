// Guest games in the launcher (D230–D232). The shelf lists them after the carts;
// playing one opens its page full screen in an iframe on the guest port, with
// focus, so the game reads the keys itself. The guest page's escape script
// (served by the service) posts {gsa: "star"} on Escape, and the play ends.
import { COLORS as C } from "../../../runtime/src/palette.js";
import { scoreLine } from "./boards.js";

/** Guests the publish gate is still checking (D310): they join the shelf when they pass. A live binding. */
export let guestsChecking = 0;

/** The guests, as shelf entries shaped like carts (`guest: true`). Never throws: no guests is fine. */
export async function fetchGuests() {
  try {
    const r = await fetch("/api/guests");
    if (!r.ok) return [];
    const body = await r.json();
    guestsChecking = Number(body.checking ?? 0);
    return body.guests.filter((/** @type {any} */ g) => g.url);
  } catch {
    return [];
  }
}

/**
 * The same surface the launcher uses from runtime/src/host.js's createHost.
 * @param {{ container: HTMLElement, cartUrl: string, onStar?: () => void, onError?: () => void }} opts
 */
export function createGuestHost(opts) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "game");
  iframe.setAttribute("allow", "autoplay");
  iframe.style.cssText = "border:0;display:block;width:100vw;height:100vh;background:#000";
  const origin = new URL(opts.cartUrl, location.href).origin;
  /** @type {(v?: any) => void} */
  let markReady = () => {};
  /** @type {(e: Error) => void} */
  let markFailed = () => {};
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  /** Round scores the guest reported (D235), like a cart's `host.scores` (D215). @type {number[]} */
  const scores = [];
  const onMessage = (/** @type {MessageEvent} */ e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    if (e.data?.gsa === "star") opts.onStar?.();
    const n = e.data?.n;
    if (e.data?.gsa === "score" && Number.isInteger(n) && n >= 0 && n <= 999_999_999 && scores.length < 200) scores.push(n);
  };
  addEventListener("message", onMessage);
  iframe.addEventListener("load", () => {
    iframe.focus();
    markReady();
  });
  iframe.addEventListener("error", () => markFailed(new Error("the game didn't load")));
  // If the page never loads (the guest port is down), give up rather than sit on a black screen.
  const timer = setTimeout(() => markFailed(new Error("the game didn't load in time")), 20000);
  ready.finally(() => clearTimeout(timer)).catch(() => {});
  iframe.src = opts.cartUrl;
  opts.container.appendChild(iframe);
  // Keep focus in the game: a stray click or blur mustn't leave the keys going nowhere.
  const refocus = () => setTimeout(() => document.activeElement !== iframe && iframe.focus(), 0);
  addEventListener("focus", refocus);

  return {
    iframe,
    ready,
    ticks: null,
    scores,
    destroy() {
      removeEventListener("message", onMessage);
      removeEventListener("focus", refocus);
      clearTimeout(timer);
      iframe.remove();
      window.focus();
    },
  };
}

// ---------- guests on the arcade boards (D201; the proposal in docs/falling-blocks.md §5) ----------

/**
 * S1: a guest's shelf row: "by <author>", a "free game" tag, no card. Someone's own version of
 * a guest (D234) reads "by <maker>", as another maker's version of a game does (D206).
 * @param {any} g @param {(id: string) => string} [nameOf]
 */
export function guestRow(g, nameOf = (id) => id) {
  // A grown-up maker isn't in the "who's making" list (D236), so the version's own guest.json names them.
  // The shelf row is short: guest.json's by_short when the full credit doesn't fit there (D388).
  const by = g.maker ? `by ${g.maker_name ?? nameOf(g.maker)}` : g.by ? `by ${g.by_short ?? g.by}` : undefined;
  return { kind: "cart", cart: g, title: g.title, by, version: null, tags: [{ text: "free game", kind: "starter" }], hasCard: false, indent: 0 };
}

/**
 * The guests' shelf rows as family rows (D206, D234): each original, then the versions made
 * from it, indented under it. A version whose original isn't here stands on its own.
 * @param {any[]} guests @param {(id: string) => string} [nameOf]
 */
export function guestRows(guests, nameOf) {
  const ids = new Set(guests.map((g) => g.id));
  const isVersion = (/** @type {any} */ g) => g.parent && ids.has(g.parent);
  const rows = [];
  for (const g of guests.filter((x) => !isVersion(x))) {
    rows.push(guestRow(g, nameOf));
    for (const v of guests.filter((x) => isVersion(x) && x.parent === g.id)) rows.push({ ...guestRow(v, nameOf), indent: 1 });
  }
  return rows;
}

/**
 * G0: how to play, from guest.json's howToPlay. The header has no author: the header's
 * right side is short, so "by TitanPlayz100" was cut to "by...", and the shelf row says who made it.
 * @param {any} g
 */
export function guestHowto(g) {
  const h = g.howToPlay ?? {};
  const controls = Array.isArray(h.controls) && h.controls.length ? h.controls : ["Stick and buttons: try them and see!"];
  // The full credit goes under the title, where there's room for it (D388).
  return { screen: "howto", cart: g, title: g.title, by: "", credit: g.by ? `by ${g.by}` : null, goal: h.goal ?? null, controls };
}

/**
 * After a guest game: play again or back to the shelf. No change, no coins (D230). A guest that
 * reports a score shows "Score: N. Best: M." or "A new best!", as made games do (D215, D235).
 * @param {any} g @param {{ score?: number | null, best?: number | null, bestBefore?: number | null }} [played]
 */
export function guestPostGame(g, played = {}) {
  return {
    screen: "board",
    board: "G6",
    title: "Done playing",
    right: g.title,
    blocks: [{ text: "Nice game!", scale: 2, color: C.yellow, rows: 1, after: 4, onCut: "never" }, ...scoreLine(played), { text: "Playing is always free.", rows: 1, onCut: "never" }],
    tiles: [{ text: "Play again", note: "free" }, { text: "Back to the shelf", hue: C.green }],
    sel: 1,
    post: ["again", "shelf"],
  };
}
