// @ts-check
// The local player page (D70, D71): the cart list, play through the runtime's
// host, then the you-check questions. Menus take the keyboard and gamepads
// through the runtime's own input map, so they work the way the cabinet will.

// Loaded from the server at run time; typed from the repo files.
const RT = "/runtime/src/";
const hostMod = /** @type {typeof import("../../../runtime/src/host.js")} */ (await import(RT + "host.js"));
const inputMod = /** @type {typeof import("../../../runtime/src/input.js")} */ (await import(RT + "input.js"));
const { DEFAULT_KEYMAP, gamepadToMask, BIT } = inputMod;

/**
 * @typedef {{ id: string, text: string }} Rule
 * @typedef {{
 *   id: string, title: string, version: number, maker: string | null, with: string | null, source: string,
 *   url: string, youCheck: Rule[], autoRules: number, plays: number,
 *   answered: { at: string, by: string | null, answers: { rule: string, answer: string }[] } | null,
 * }} Cart
 * @typedef {ReturnType<typeof hostMod.createHost>} Host
 * @typedef {{ cart: Cart, host: Host, playId: string, t0: number, startedAt: string, sides: Set<string>, ended: boolean, failed: boolean }} Playing
 * @typedef {{ cart: Cart, playId: string | null, i: number, answers: { rule: string, answer: string, said: string }[] }} Checking
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const views = { list: $("list"), play: $("play"), check: $("check") };

/** @type {Cart[]} */
let carts = [];
let selected = 0;
/** @type {"list" | "play" | "check"} */
let view = "list";
/** @type {Playing | null} */
let playing = null;
/** @type {Checking | null} */
let checking = null;

// ---------- server ----------

async function loadCarts() {
  const r = await fetch("/api/carts");
  const body = await r.json();
  carts = body.carts;
  return body;
}

/** @param {string} url @param {object} body */
async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  const out = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!out.ok) throw new Error(out.error ?? `HTTP ${r.status}`);
  return out;
}

const newId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ---------- views ----------

/** @param {"list" | "play" | "check"} v */
function show(v) {
  view = v;
  for (const [k, el] of Object.entries(views)) el.hidden = k !== v;
  swallowPads();
}

let toastTimer = 0;
/** @param {string} text */
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2500);
}

async function showList() {
  try {
    const body = await loadCarts();
    $("list-sub").textContent = `${carts.length} game${carts.length === 1 ? "" : "s"} · checking as ${body.checker ?? "nobody"}`;
  } catch (e) {
    $("list-sub").textContent = `Couldn't load the games: ${/** @type {Error} */ (e).message}`;
  }
  const ol = $("carts");
  ol.replaceChildren(
    ...carts.map((c, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.cart = c.id;
      const who = [c.maker, c.with].filter(Boolean).join(" + ");
      const meta = [who && `by ${who}`, `v${c.version}`, `${c.plays} play${c.plays === 1 ? "" : "s"}`, c.source === "example" ? "example" : ""].filter(Boolean);
      b.innerHTML = `<span class="t"></span><span class="m"></span>`;
      /** @type {HTMLElement} */ (b.querySelector(".t")).textContent = c.title;
      /** @type {HTMLElement} */ (b.querySelector(".m")).textContent = meta.join(" · ");
      if (c.youCheck.length) {
        const badge = document.createElement("span");
        badge.className = c.answered ? "badge done" : "badge";
        badge.textContent = c.answered ? "checked" : `${c.youCheck.length} to check`;
        b.append(badge);
      }
      b.addEventListener("click", () => startPlay(c));
      b.addEventListener("focus", () => (selected = i));
      li.append(b);
      return li;
    }),
  );
  $("empty").hidden = carts.length > 0;
  show("list");
  selected = Math.min(selected, Math.max(0, carts.length - 1));
  focusables()[selected]?.focus();
}

/** The buttons the stick moves between in the current view. */
function focusables() {
  if (view === "list") return /** @type {HTMLElement[]} */ ([...$("carts").querySelectorAll("button")]);
  if (view === "check") return /** @type {HTMLElement[]} */ ([...views.check.querySelectorAll(".answers button"), $("check-later")]);
  if (errorShown()) return [$("play-back")];
  return [];
}

// ---------- play ----------

/** @param {Cart} cart */
function startPlay(cart) {
  const stage = $("stage");
  stage.replaceChildren();
  $("play-error").hidden = true;
  $("play-error-text").textContent = "";
  const hint = $("play-hint");
  hint.classList.remove("gone");
  setTimeout(() => hint.classList.add("gone"), 3000);
  show("play");
  /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.();

  const host = hostMod.createHost({
    container: stage,
    cartUrl: cart.url,
    // Live play: a fresh seed each time (tests use the runtime's fixed seed).
    seed: 1 + Math.floor(Math.random() * 0x7ffffffe),
    onStar: () => endPlay("star"),
    onError: (e) => playError(`${e.where ?? "cart"} error at frame ${e.frame}: ${e.message}`),
  });
  host.ready.catch((e) => {
    if (playing?.host === host) playing.failed = true;
    playError(`The game didn't start: ${e.message}`);
  });
  playing = { cart, host, playId: newId(), t0: performance.now(), startedAt: new Date().toISOString(), sides: new Set(), ended: false, failed: false };
}

/** @param {string} text */
function playError(text) {
  const box = $("play-error");
  const p = $("play-error-text");
  p.textContent = p.textContent ? `${p.textContent}\n${text}` : text;
  box.hidden = false;
}

/** @param {Playing} p @param {string} ended */
function playRecord(p, ended) {
  return {
    cart_id: p.cart.id,
    play_id: p.playId,
    sides: [...p.sides],
    started_at: p.startedAt,
    duration_s: (performance.now() - p.t0) / 1000,
    ticks: p.host.ticks,
    ended,
    errors: p.host.errors.length,
  };
}

/** @param {"star" | "back"} ended */
async function endPlay(ended) {
  const p = playing;
  if (!p || p.ended) return;
  p.ended = true;
  playing = null;
  const rec = playRecord(p, ended);
  p.host.destroy();
  // Logged before the list reloads, so its play counts are current.
  await post("/api/plays", rec).catch((e) => toast(`Play not logged: ${e.message}`));
  // D71: ask the you-check rules after a play, until someone answers them.
  if (p.cart.youCheck.length && !p.cart.answered) startCheck(p.cart, p.playId);
  else showList();
}

addEventListener("pagehide", () => {
  if (!playing || playing.ended) return;
  playing.ended = true;
  const blob = new Blob([JSON.stringify(playRecord(playing, "left_page"))], { type: "application/json" });
  navigator.sendBeacon("/api/plays", blob);
});

// Which players took part: keys on this page, keys the cart frame forwards, pads.
/** @param {string} code */
function noteKey(code) {
  const m = DEFAULT_KEYMAP[code];
  if (playing && m && m[1] !== "star") playing.sides.add(`p${m[0]}`);
}
addEventListener("message", (e) => {
  if (playing && e.source === playing.host.iframe.contentWindow && e.data?.type === "key" && e.data.down) noteKey(e.data.code);
});

// ---------- you-check ----------

/** @param {Cart} cart @param {string | null} playId */
function startCheck(cart, playId) {
  if (!cart.youCheck.length) return toast("This game has no rules to check by eye.");
  checking = { cart, playId, i: 0, answers: [] };
  show("check");
  renderCheck();
}

function renderCheck() {
  const c = /** @type {Checking} */ (checking);
  const rule = c.cart.youCheck[c.i];
  $("check-step").textContent = `Check ${c.i + 1} of ${c.cart.youCheck.length} · ${rule.id}`;
  $("check-title").textContent = c.cart.title;
  $("check-rule").textContent = rule.text;
  /** @type {HTMLTextAreaElement} */ ($("check-note")).value = "";
  focusables()[0]?.focus();
}

/** @param {string} answer */
async function answer(answer) {
  const c = checking;
  if (!c) return;
  const note = /** @type {HTMLTextAreaElement} */ ($("check-note"));
  c.answers.push({ rule: c.cart.youCheck[c.i].id, answer, said: note.value });
  c.i++;
  if (c.i < c.cart.youCheck.length) return renderCheck();
  checking = null;
  try {
    await post("/api/you-check", { cart_id: c.cart.id, play_id: c.playId, answers: c.answers });
    toast("Thanks! Your answers are saved.");
  } catch (e) {
    toast(`Answers not saved: ${/** @type {Error} */ (e).message}`);
  }
  showList();
}

for (const b of views.check.querySelectorAll(".answers button")) {
  b.addEventListener("click", () => answer(/** @type {HTMLElement} */ (b).dataset.answer ?? "not_sure"));
}
$("check-later").addEventListener("click", () => {
  checking = null;
  toast("OK, I'll ask next time.");
  showList();
});
$("play-back").addEventListener("click", () => endPlay("back"));

// ---------- menu input: keyboard and gamepads ----------

// Only a cart that never started hands the buttons to the error box; a game
// that hit an error mid-play keeps them (the box shows, ★ still leaves).
const errorShown = () => view === "play" && !!playing?.failed;

/** @param {"up" | "down" | "left" | "right" | "pick" | "alt" | "back"} action */
function act(action) {
  if (view === "play") {
    // In play the cart has the buttons; only the error box takes A/START/B.
    if (errorShown() && (action === "pick" || action === "back")) endPlay("back");
    return;
  }
  const items = focusables();
  const at = Math.max(0, items.indexOf(/** @type {HTMLElement} */ (document.activeElement)));
  if (action === "up" || action === "left") items[Math.max(0, at - 1)]?.focus();
  else if (action === "down" || action === "right") items[Math.min(items.length - 1, at + 1)]?.focus();
  else if (action === "pick") (items[at] ?? items[0])?.click();
  else if (action === "alt" && view === "list" && carts[selected]) startCheck(carts[selected], null);
  else if (action === "back" && view === "check") $("check-later").click();
}

/** @type {Record<string, "up" | "down" | "left" | "right" | "pick" | "alt" | "back">} */
const BUTTON_ACTION = { up: "up", down: "down", left: "left", right: "right", a: "pick", start: "pick", x: "alt", b: "back", star: "back" };

addEventListener("keydown", (e) => {
  const m = DEFAULT_KEYMAP[e.code];
  if (view === "play") {
    // The host plays the cart; ★ (Escape) here also covers a cart that failed to start.
    noteKey(e.code);
    if (e.repeat || !m) return;
    if (m[1] === "star") endPlay("star");
    else if (errorShown()) act(BUTTON_ACTION[m[1]]);
    return;
  }
  const target = /** @type {HTMLElement} */ (e.target);
  if (target instanceof HTMLTextAreaElement) {
    if (e.code === "Escape") target.blur();
    return;
  }
  if (!m || e.repeat && !["up", "down", "left", "right"].includes(m[1])) return;
  e.preventDefault();
  act(BUTTON_ACTION[m[1]]);
});

// Gamepads: edge-triggered menu actions; during play, note which sides are used.
const PAD_ACTIONS = /** @type {const} */ ([
  ["up", "up"], ["down", "down"], ["left", "left"], ["right", "right"], ["a", "pick"], ["start", "pick"], ["x", "alt"], ["b", "back"],
]);
let prevMask = 0;
let prevStar = false;
function readPads() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let mask = 0;
  let star = false;
  for (let i = 0; i < 2; i++) {
    const r = gamepadToMask(pads[i]);
    if (r.mask && playing) playing.sides.add(`p${i + 1}`);
    mask |= r.mask;
    star ||= r.star;
  }
  return { mask, star };
}
/** After a view change, ignore buttons already held (the ★ that left the game, say). */
function swallowPads() {
  const r = readPads();
  prevMask = r.mask;
  prevStar = r.star;
}
function padLoop() {
  requestAnimationFrame(padLoop);
  const { mask, star } = readPads();
  if (view !== "play" || errorShown()) {
    const down = mask & ~prevMask;
    for (const [b, a] of PAD_ACTIONS) if (down & BIT[b]) act(a);
    if (star && !prevStar) act("back");
  }
  prevMask = mask;
  prevStar = star;
}
requestAnimationFrame(padLoop);

// ---------- start ----------

// For tests and the Manager's simulator later.
Object.assign(window, {
  player: {
    get view() {
      return view;
    },
    get host() {
      return playing?.host ?? null;
    },
    act,
  },
});

await showList();
const want = new URLSearchParams(location.search).get("cart");
const deep = want && carts.find((c) => c.id === want);
if (deep) startPlay(deep);
