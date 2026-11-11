// Guest games in the launcher (D230–D232). The shelf lists them after the carts;
// playing one opens its page full screen in an iframe on the guest port, with
// focus, so the game reads the keys itself. The guest page's escape script
// (served by the service) posts {gsa: "star"} on Escape, and the play ends.

/** The guests, as shelf entries shaped like carts (`guest: true`). Never throws: no guests is fine. */
export async function fetchGuests() {
  try {
    const r = await fetch("/api/guests");
    if (!r.ok) return [];
    return (await r.json()).guests.filter((/** @type {any} */ g) => g.url);
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
  const onMessage = (/** @type {MessageEvent} */ e) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    if (e.data?.gsa === "star") opts.onStar?.();
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
    destroy() {
      removeEventListener("message", onMessage);
      removeEventListener("focus", refocus);
      clearTimeout(timer);
      iframe.remove();
      window.focus();
    },
  };
}
