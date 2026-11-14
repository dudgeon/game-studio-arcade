// @ts-check
// The Wi-Fi screens' keys and steps (D413, D414): the hold that opens them, the list, the keyboard, joining,
// and the result. app.js hands it keys while a Wi-Fi screen is up; drawing is wifi.js. Pure but for the three
// things it's given: how to show a view, how to ask the service, and how to go back to the shelf.
import { ACTIONS, KEY_COLS, KEY_ROWS, PAGES, PASS_MAX, PASS_MIN } from "./wifi.js";

/** The two utility buttons a grown-up holds together (D413): ENT is F1, COIN is F2 (D82). */
export const HOLD_KEYS = Object.freeze(["F1", "F2"]);
export const HOLD_MS = 3000;
/** Left alone this long, the Wi-Fi screens go back to the shelf. */
export const IDLE_MS = 120_000;
/** The shelf's bottom line while the Wi-Fi is down: the one place the hold is written. */
export const WIFI_HINT = "No Wi-Fi. Grown-up: hold ENT and COIN";
/** Where the hold works: the shelf, and what COIN or Make may have put over it. */
const HOLD_SCREENS = new Set(["shelf", "pot", "history"]);

/** Which action key is under each grid column, and the column above each action key. */
const ACTION_UNDER = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4];
const COL_OVER = [0, 3, 5, 7, 9];

/** The last column of a row that holds a key (the symbols page ends early). @param {number} page @param {number} row */
const lastCol = (page, row) => {
  const keys = PAGES[page].keys.slice(row * KEY_COLS, (row + 1) * KEY_COLS);
  return Math.max(0, keys.trimEnd().length - 1);
};

/**
 * Move on the keyboard. Rows 0-3 are keys, row 4 the action row. Left and right wrap; up and down stop.
 * @param {{ page: number, row: number, col: number }} v @param {"up" | "down" | "left" | "right"} dir
 */
export function moveKey(v, dir) {
  let { row, col } = v;
  if (row === KEY_ROWS) {
    if (dir === "left") col = (col + ACTIONS.length - 1) % ACTIONS.length;
    else if (dir === "right") col = (col + 1) % ACTIONS.length;
    else if (dir === "up") (row = KEY_ROWS - 1), (col = Math.min(COL_OVER[col], lastCol(v.page, row)));
    return { row, col };
  }
  const last = lastCol(v.page, row);
  if (dir === "left") col = col === 0 ? last : col - 1;
  else if (dir === "right") col = col >= last ? 0 : col + 1;
  else if (dir === "up" && row > 0) row -= 1;
  else if (dir === "down") {
    if (row === KEY_ROWS - 1) return { row: KEY_ROWS, col: ACTION_UNDER[col] };
    row += 1;
    col = Math.min(col, lastCol(v.page, row));
  }
  return { row, col };
}

/**
 * @param {{
 *   show: (v: any) => void,
 *   view: () => any,
 *   get: (url: string) => Promise<any>,
 *   post: (url: string, body?: object) => Promise<any>,
 *   exit: () => void,
 *   now?: () => number,
 * }} o
 */
export function createWifiFlow(o) {
  const now = o.now ?? (() => Date.now());
  /** @type {number | null} */
  let holdFrom = null;
  let lastKey = 0;
  /** What the last scan found, so ESC from the keyboard needn't look again. @type {any} */
  let found = { networks: [], current: null };

  const on = () => String(o.view().screen).startsWith("wifi-");
  const touch = () => (lastKey = now());

  const list = (/** @type {object} */ extra = {}) => o.show({ screen: "wifi-list", board: "W1", current: found.current, networks: found.networks, sel: 0, ...extra });

  /** Look for networks. Quietly: behind whatever is showing, for the next time the list opens. */
  async function scan(quiet = false) {
    const v = o.view();
    if (v.screen === "wifi-list") v.scanning = true;
    else if (!quiet) list({ scanning: true, networks: [] });
    try {
      const r = await o.post("/api/wifi/scan");
      found = { networks: r.networks ?? [], current: r.current ?? null };
    } catch {
      // Keep what the last look found; the list shows it.
    }
    // The list keeps its place: the lit network stays lit when a look finishes under the stick.
    const now = o.view();
    if (now.screen !== "wifi-list") return;
    const lit = now.networks?.[now.sel]?.ssid;
    list({ sel: Math.max(0, found.networks.findIndex((/** @type {any} */ n) => n.ssid === lit)) });
  }

  /** @param {any} net @param {string | null} password */
  async function join(net, password) {
    o.show({ screen: "wifi-joining", board: "W3", ssid: net.ssid });
    /** @type {any} */
    let r;
    try {
      r = await o.post("/api/wifi/join", { ssid: net.ssid, password, security: net.kind === "sae" ? "WPA3" : net.kind === "open" ? "" : "WPA2" });
    } catch {
      r = { joined: false, why: "The cabinet's Wi-Fi helper didn't answer. Try again." };
    }
    touch();
    if (o.view().screen !== "wifi-joining") return;
    if (r.joined) {
      // Whether Claude can be reached shows a moment later, once the service has looked again.
      o.show({ screen: "wifi-result", board: "W4", ok: true, ssid: net.ssid, signal: r.signal ?? net.signal, address: r.address ?? null, name: r.host ? `${r.host}.local` : null, internet: null, sel: 0 });
    } else {
      o.show({ screen: "wifi-result", board: "W5", ok: false, ssid: net.ssid, why: r.why, back: r.back ?? null, net, sel: 0 });
    }
    scan(true).catch(() => {});
  }

  /** @param {any} net */
  const typePassword = (net) => o.show({ screen: "wifi-keys", board: "W2", ssid: net.ssid, net, text: "", page: 0, row: 1, col: 0, show: true });

  /** @param {any} net */
  function pick(net) {
    if (net.kind === "no") return o.show({ screen: "wifi-result", board: "W5", ok: false, ssid: net.ssid, why: "This cabinet can't join that kind of network (it asks for a username).", back: found.current, net: null, sel: 1 });
    if (net.saved || net.kind === "open") return void join(net, null);
    typePassword(net);
  }

  /** @param {any} v @param {"type" | "delete" | "page" | "join"} what */
  function keyboard(v, what) {
    if (what === "delete") v.text = v.text.slice(0, -1);
    else if (what === "page") {
      v.page = (v.page + 1) % PAGES.length;
      if (v.row < KEY_ROWS) v.col = Math.min(v.col, lastCol(v.page, v.row));
    } else if (what === "join") {
      if (v.text.length >= PASS_MIN) void join(v.net, v.text);
    } else if (v.row === KEY_ROWS) {
      const a = ACTIONS[v.col];
      if (a === "page") keyboard(v, "page");
      else if (a === "space") v.text.length < PASS_MAX && (v.text += " ");
      else if (a === "delete") keyboard(v, "delete");
      else if (a === "show") v.show = v.show === false;
      else keyboard(v, "join");
    } else {
      const ch = PAGES[v.page].keys[v.row * KEY_COLS + v.col];
      if (ch && ch !== " " && v.text.length < PASS_MAX) v.text += ch;
    }
  }

  function back() {
    const v = o.view();
    if (v.screen === "wifi-keys" || v.screen === "wifi-result") return list();
    if (v.screen === "wifi-joining") return; // it answers within a minute; leaving now would hide how it went
    o.exit();
  }

  return {
    on,
    /** Open the Wi-Fi screens. */
    open() {
      holdFrom = null;
      touch();
      void scan();
    },
    /**
     * A key went down. True if the Wi-Fi screens took it.
     * @param {{ code: string, repeat: boolean }} e @param {Set<string>} held
     */
    keydown(e, held) {
      const v = o.view();
      if (!on()) {
        // The hold: both keys down, on the shelf (or the pot COIN just opened). The second key starts it.
        if (HOLD_KEYS.includes(e.code) && HOLD_KEYS.every((k) => held.has(k)) && HOLD_SCREENS.has(v.screen)) {
          if (!e.repeat) holdFrom = now();
          return true;
        }
        // Any other key ends a hold: ENT with a pink button is the volume's (D421), never this.
        if (!HOLD_KEYS.includes(e.code)) holdFrom = null;
        return false;
      }
      touch();
      const dir = /** @type {Record<string, "up" | "down" | "left" | "right">} */ ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" })[e.code];
      if (e.code === "Escape") return e.repeat || back(), true;
      if (v.screen === "wifi-list") {
        const n = v.networks.length + 1;
        if (dir === "up") v.sel = Math.max(0, v.sel - 1);
        else if (dir === "down") v.sel = Math.min(n - 1, v.sel + 1);
        else if (!dir && !e.repeat && isButton(e.code) && !v.scanning) v.sel < v.networks.length ? pick(v.networks[v.sel]) : void scan();
      } else if (v.screen === "wifi-keys") {
        if (dir) Object.assign(v, moveKey(v, dir));
        else if (e.code === "KeyZ" || e.code === "KeyV" || e.code === "KeyQ" || e.code === "KeyE") keyboard(v, "type"); // A, and the spare buttons
        else if (e.code === "KeyX") keyboard(v, "delete"); // B; held, it keeps deleting
        else if (e.code === "KeyC" && !e.repeat) keyboard(v, "page"); // X
        else if (e.code === "Enter" && !e.repeat) keyboard(v, "join"); // 1UP
        // A grown-up with a keyboard plugged in can just type.
        else if (e.code === "Backspace") keyboard(v, "delete");
      } else if (v.screen === "wifi-result") {
        const n = v.ok ? 1 : 3;
        if (dir === "up") v.sel = Math.max(0, v.sel - 1);
        else if (dir === "down") v.sel = Math.min(n - 1, v.sel + 1);
        else if (!dir && !e.repeat && isButton(e.code)) {
          if (v.ok || v.sel === 2) o.exit();
          else if (v.sel === 0 && v.net) typePassword(v.net);
          else list();
        }
      }
      return true;
    },
    /** Each frame: how far through the hold (0-1) for the overlay, or null. Opens the screens when it's done, and leaves them when idle. */
    frame(/** @type {Set<string>} */ held) {
      if (on()) {
        if (o.view().screen !== "wifi-joining" && now() - lastKey > IDLE_MS) o.exit();
        return null;
      }
      if (holdFrom == null) return null;
      if (!HOLD_KEYS.every((k) => held.has(k)) || !HOLD_SCREENS.has(o.view().screen)) return (holdFrom = null);
      const f = (now() - holdFrom) / HOLD_MS;
      if (f >= 1) return this.open(), null;
      return f;
    },
    /** For a result that's up: tell it whether Claude can be reached now. @param {boolean} offline */
    internet(offline) {
      const v = o.view();
      if (v.screen === "wifi-result" && v.ok) v.internet = !offline;
    },
  };
}

const isButton = (/** @type {string} */ code) => ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyQ", "KeyE", "Enter"].includes(code);
