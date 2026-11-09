// @ts-check
// The launcher page: which screen is up, what the keys do, and talking to the
// service. Drawing and fitting are in screens.js and text.js. Keys are D82's, so
// the Picade, the virtual cabinet's keyboard and a script all drive it the same way.
import { createHost, integerScale } from "../../../runtime/src/host.js";
import { rgbaTable } from "../../../runtime/src/palette.js";
import { H, W, check } from "./text.js";
import { CHECK_TILES, LEAVE_TILES, Painter, draw, flow, planLines, questionText } from "./screens.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("screen"));
const stage = /** @type {HTMLElement} */ (document.getElementById("stage"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
const image = ctx.createImageData(W, H);
const out32 = new Uint32Array(image.data.buffer);
const RGBA = rgbaTable();
const painter = new Painter();

const BUTTONS = new Set(["KeyZ", "KeyX", "KeyC", "KeyV", "KeyQ", "KeyE", "Enter"]);
const NAME_MAX = 16;
const WORDS_MAX = 300;

/** @type {any} */
let view = { screen: "notice", message: "Waking up..." };
/** @type {any} */
let studio = { phase: "idle" };
let config = { console: "Arcade", players: 1, speech: "stub" };
/** Follow the Studio's state on screen? Off once ESC has gone to the shelf (D187). */
let following = false;
/** The make being followed. Once it's no longer running, there's a result for it, or it's gone (D188, D189, D192). */
/** @type {number | null} */
let followRun = null;
/** Seen it running on the stream? Only then does "idle" with no result mean it's gone. */
let seenRunning = false;
/** The event stream is down. */
let offlineSince = 0;
let lastStillHere = 0;
/** A button down when a screen opened does nothing until it's let go (D182). */
let armed = true;
let tick = 0;
/** @type {Set<string>} */
const held = new Set();
/** @type {Set<string>} */
const faults = new Set();
/** @type {any} */
let playing = null;
/** Questions already answered: an event sent before the answer arrived can still come in after it. */
const answered = new Set();
/** The game just played: the next shelf opens on it, once (D194). */
/** @type {string | null} */
let returnTo = null;

// ---------- service ----------

/** @param {string} url @param {object} [body] */
async function post(url, body = {}) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  const out = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!out.ok) throw new Error(out.error ?? `HTTP ${r.status}`);
  return out;
}
/** @param {string} url */
const get = (url) => fetch(url).then((r) => r.json());

// ---------- moving between screens ----------

/** @param {any} v */
function show(v) {
  view = v;
  armed = ![...held].some((c) => BUTTONS.has(c));
}

const offline = () => show({ screen: "notice", title: "Just a moment", message: "The cabinet is restarting.", restarting: true });

async function showShelf() {
  following = false;
  let carts = [];
  try {
    carts = (await get("/api/carts")).carts;
    const makers = (await get("/api/makers")).makers;
    const nameOf = (/** @type {string} */ id) => makers.find((/** @type {any} */ m) => m.id === id)?.name ?? id;
    // Make, then how makes ended until someone has seen (D192), then the games.
    const ended = (studio.results ?? []).map((/** @type {any} */ r) => ({ kind: "result", result: r, title: r.ok ? "New game ready!" : "A new game didn't finish", by: r.maker_name ?? r.maker, note: r.ok ? r.title : undefined, urgent: true }));
    const items = [makeTile(), ...ended, ...carts.map((/** @type {any} */ c) => ({ kind: "cart", cart: c, title: c.title, by: c.maker ? nameOf(c.maker) : undefined, note: toCheck(c) }))];
    // The highlight stays on what it was on, whatever arrives above it.
    const keyOf = (/** @type {any} */ it) => it.cart?.id ?? (it.result ? `r${it.result.id}` : "tile");
    const lit = view.screen === "shelf" ? keyOf(view.items[view.sel]) : (returnTo ?? "tile");
    returnTo = null;
    const v = { screen: "shelf", console: config.console, count: carts.length, items, sel: Math.max(0, items.findIndex((it) => keyOf(it) === lit)) };
    if (view.screen === "shelf") view = v;
    else show(v);
  } catch {
    offline();
  }
}

const toCheck = (/** @type {any} */ c) => (c.youCheck?.length && !c.answered ? `${c.youCheck.length} to check` : undefined);

/** The Make tile, or the way back to a game being made (D87, D187). */
function makeTile() {
  if (studio.phase === "idle") return { kind: "make", title: "Make a new game", note: studio.notice?.short ?? "Tell Claude your idea", urgent: !!studio.notice };
  const asking = !!studio.pending;
  return { kind: "back", title: "Back to your game", note: asking ? "Claude has a question for you!" : "Still making it...", urgent: asking };
}

async function showWho() {
  try {
    const { makers } = await get("/api/makers");
    show({ screen: "who", makers, sel: 0 });
  } catch {
    offline();
  }
}

/**
 * The talk screen (D87): hold a button, talk, let go, confirm. F1 types (D184).
 * @param {{ purpose: string, prompt?: string, typing?: boolean, max?: number, pendingId?: number, back: () => void, done: (text: string) => void }} o
 */
function showSay(o) {
  show({ screen: "say", ...o, phase: o.typing ? "typing" : "idle", typed: "", transcript: "", sel: 0, max: o.max ?? WORDS_MAX });
}

/** Where the Studio's state says the screen should be, when following it. */
function followStudio() {
  if (!following) return;
  if (studio.phase !== "idle") {
    followRun = studio.run_id;
    seenRunning = true;
  }
  const ended = followRun === null ? null : (studio.results ?? []).find((/** @type {any} */ r) => r.run_id === followRun);
  if (ended) {
    if (view.resultId !== ended.id) showResult(ended);
    return;
  }
  if (studio.phase === "idle") {
    if (seenRunning) showGone();
    return;
  }
  const p = studio.pending && !answered.has(studio.pending.id) ? studio.pending : null;
  if (p) {
    if (view.pendingId === p.id) return; // already on it, or in its reader or talk screen
    if (p.kind === "question") show({ screen: "question", pendingId: p.id, ...p, maker: studio.maker_name, sel: 0 });
    else show({ screen: "plan", pendingId: p.id, ...p, maker: studio.maker_name, flowed: planLines(p), top: 0, sel: 0 });
    return;
  }
  if (studio.phase === "running") {
    if (view.screen === "progress") view.lines = studio.lines;
    else show({ screen: "progress", lines: studio.lines, maker: studio.maker_name });
  }
}

/** How a make ended, whoever's it was. @param {any} r */
function showResult(r) {
  show({ screen: "result", resultId: r.id, ok: r.ok, title: r.title, by: r.maker_name ?? r.maker, message: r.message, note: r.note, cartId: r.cart_id, tiles: r.ok ? ["Play it now", "Back to the shelf"] : ["Back to the shelf"], sel: 0 });
}

/** Seen: the entry leaves the shelf (D192). @param {number} id */
function resultSeen(id) {
  following = false;
  followRun = null;
  seenRunning = false;
  post("/api/studio/result-seen", { id }).catch(() => {});
  studio = { ...studio, results: (studio.results ?? []).filter((/** @type {any} */ r) => r.id !== id) };
}

/** The make being followed has gone: a timeout or a restart. Say so, then the shelf (D188, D189). */
function showGone() {
  following = false;
  followRun = null;
  seenRunning = false;
  const n = studio.notice;
  show({ screen: "result", ok: false, message: n?.message ?? "This game stopped being made. Tell me your idea again!", tiles: ["Back to the shelf"], sel: 0, afterPlay: true, noticeId: n?.id });
}

/** Leave a message screen for the shelf. @param {any} v */
function leaveMessage(v) {
  if (v.noticeId) {
    post("/api/studio/notice-seen", { id: v.noticeId }).catch(() => {});
    studio = { phase: studio.phase };
  }
  showShelf();
}

/** @param {string} choice @param {string} [said] */
async function answer(choice, said) {
  const id = view.pendingId;
  answered.add(id);
  show({ screen: "progress", lines: studio.lines ?? [], maker: studio.maker_name });
  // State comes only from the event stream, which is in order. A response can
  // land after the next question has come in, and must not overwrite it.
  await post("/api/studio/answer", { id, choice, said }).catch(() => {});
}

/** @param {string} maker @param {string} request */
async function startMake(maker, request) {
  show({ screen: "progress", lines: [], maker: "" });
  followRun = null;
  seenRunning = false;
  try {
    following = true;
    // Only its id: state comes from the stream, but this may land after a quick ending.
    followRun = (await post("/api/studio/start", { maker, request })).state.run_id ?? followRun;
    followStudio();
  } catch {
    following = false;
    offline();
  }
}

// ---------- play ----------

const newId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** @param {any} cart */
function startPlay(cart) {
  stage.replaceChildren();
  stage.hidden = false;
  canvas.hidden = true;
  const startedAt = new Date().toISOString();
  const host = createHost({
    container: stage,
    cartUrl: cart.url,
    players: config.players,
    onStar: () => endPlay("star"),
    onError: () => {
      if (playing) playing.errors++;
    },
  });
  playing = { cart, host, playId: newId(), startedAt, t0: performance.now(), errors: 0, sides: new Set(), ended: false };
  show({ screen: "play", cart });
  host.ready.catch(() => {
    if (playing) playing.failed = true;
    endPlay("back");
  });
}

/** @param {"star" | "back"} ended */
async function endPlay(ended) {
  const p = playing;
  if (!p || p.ended) return;
  p.ended = true;
  playing = null;
  returnTo = p.cart.id;
  const duration = (performance.now() - p.t0) / 1000;
  const ticks = p.host.ticks;
  p.host.destroy();
  stage.hidden = true;
  stage.replaceChildren();
  canvas.hidden = false;
  post("/api/plays", { cart_id: p.cart.id, play_id: p.playId, started_at: p.startedAt, duration_s: duration, ticks, sides: [...p.sides], ended, errors: p.errors }).catch(() => {});
  if (p.failed) {
    show({ screen: "result", ok: false, message: `"${p.cart.title}" wouldn't start. It's saved, and a grown-up can look at it.`, tiles: ["Back to the shelf"], sel: 0, afterPlay: true });
    return;
  }
  if (p.cart.youCheck?.length && !p.cart.answered) {
    show({ screen: "check", cart: p.cart, playId: p.playId, title: p.cart.title, i: 0, n: p.cart.youCheck.length, rule: p.cart.youCheck[0].text, answers: [], sel: 0 });
    return;
  }
  await showShelf();
}

async function finishCheck() {
  const v = view;
  if (v.answers.length) {
    await post("/api/you-check", { cart_id: v.cart.id, play_id: v.playId, checker: v.cart.maker ?? null, answers: v.answers }).catch(() => {});
  }
  await showShelf();
}

// ---------- keys ----------

/** @param {any} v @param {number} d @param {number} n */
const moveSel = (v, d, n) => {
  v.sel = (v.sel + d + n) % n;
};

/** Is a box a kid must read cut on this frame? Then stick right opens the reader (D181). */
const somethingCut = () => painter.boxes.some((b) => b.cut && b.onCut === "reader");

const STICK = { ArrowUp: "up",ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** @param {"up" | "down" | "left" | "right"} dir */
function onStick(dir) {
  const v = view;
  const ud = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  switch (v.screen) {
    case "shelf":
      if (ud) v.sel = Math.max(0, Math.min(v.items.length - 1, v.sel + ud));
      break;
    case "who":
      if (ud) v.sel = Math.max(0, Math.min(v.makers.length, v.sel + ud));
      break;
    case "question":
      if (ud) moveSel(v, ud, 4);
      else if (dir === "right" && somethingCut()) show({ screen: "reader", title: "Claude asks", flowed: questionText(v), top: 0, back: v, pendingId: v.pendingId });
      break;
    case "reader":
      if (ud) v.top += ud;
      else if (dir === "left") view = v.back;
      break;
    case "plan":
      if (ud) v.top += ud;
      else moveSel(v, 1, 2);
      break;
    case "say":
      if (v.phase === "confirm") {
        if (ud) moveSel(v, ud, 2);
        else if (dir === "right" && somethingCut()) show({ screen: "reader", title: "I heard", flowed: flow(v.transcript), top: 0, back: v, pendingId: v.pendingId });
      }
      break;
    case "result":
      if (ud) moveSel(v, ud, v.tiles.length);
      break;
    case "leave":
      if (ud) moveSel(v, ud, LEAVE_TILES.length);
      break;
    case "check":
      if (ud) moveSel(v, ud, CHECK_TILES.length);
      else if (dir === "right" && somethingCut()) show({ screen: "reader", title: "You check", flowed: flow(v.rule), top: 0, back: v });
      break;
  }
}

function onButton() {
  const v = view;
  switch (v.screen) {
    case "shelf": {
      const it = v.items[v.sel];
      if (it.kind === "make") showWho();
      else if (it.kind === "back") {
        following = true;
        followStudio();
      } else if (it.kind === "result") showResult(it.result);
      else startPlay(it.cart);
      break;
    }
    case "who":
      if (v.sel < v.makers.length) askRequest(v.makers[v.sel]);
      else
        showSay({
          purpose: "name",
          typing: true, // D184: names by typing for now; hold-to-talk comes with real speech.
          max: NAME_MAX,
          back: () => showWho(),
          done: async (name) => {
            try {
              const { maker } = await post("/api/makers", { name });
              askRequest(maker);
            } catch {
              showWho();
            }
          },
        });
      break;
    case "question":
      if (v.sel === 0) answer("A");
      else if (v.sel === 1) answer("B");
      else if (v.sel === 3) answer("D");
      else
        showSay({
          purpose: "answer",
          prompt: v.question,
          pendingId: v.pendingId,
          back: () => show({ ...v }),
          done: (said) => {
            view = { ...view, pendingId: v.pendingId };
            answer("C", said);
          },
        });
      break;
    case "reader":
      view = v.back;
      armed = false;
      break;
    case "plan":
      if (v.sel === 0) answer("build");
      else
        showSay({
          purpose: "change",
          prompt: "What should be different?",
          pendingId: v.pendingId,
          back: () => show({ ...v }),
          done: (said) => {
            view = { ...view, pendingId: v.pendingId };
            answer("change", said);
          },
        });
      break;
    case "say":
      if (v.phase === "confirm") {
        if (v.sel === 0) v.done(v.transcript);
        else show({ ...v, phase: "idle", transcript: "", sel: 0 });
      }
      break;
    case "result":
      if (v.afterPlay) leaveMessage(v);
      else {
        resultSeen(v.resultId);
        if (v.ok && v.sel === 0) pickUpNewGame(v.cartId);
        else showShelf();
      }
      break;
    case "check":
      onCheck();
      break;
    case "leave":
      if (v.sel === 0) {
        view = v.back;
        armed = false;
      } else if (v.sel === 1) showShelf(); // D187: the shelf's tile comes back here.
      else {
        // D188. The stream brings "idle", but following has stopped by then.
        following = false;
        post("/api/studio/stop").catch(() => {});
        studio = { phase: "idle" };
        showShelf();
      }
      break;
  }
}

/** @param {any} maker */
function askRequest(maker) {
  showSay({
    purpose: "request",
    back: () => showWho(),
    done: (request) => startMake(maker.id, request),
  });
}

/** @param {string} id */
async function pickUpNewGame(id) {
  try {
    const { carts } = await get("/api/carts");
    const cart = carts.find((/** @type {any} */ c) => c.id === id);
    if (cart) return startPlay(cart);
  } catch {}
  await showShelf();
}

function onCheck() {
  const v = view;
  if (v.sel === 3) return void finishCheck(); // later: anything answered so far is kept; it asks again next play
  const rule = v.cart.youCheck[v.i];
  v.answers.push({ rule: rule.id, answer: ["yes", "no", "not_sure"][v.sel] });
  if (v.i + 1 >= v.n) return void finishCheck();
  show({ ...v, i: v.i + 1, rule: v.cart.youCheck[v.i + 1].text, sel: 0 });
}

function onBack() {
  const v = view;
  switch (v.screen) {
    case "who":
      showShelf();
      break;
    case "reader":
      view = v.back;
      break;
    case "say":
      if (v.phase === "listening") cancelTalk(v);
      else if (v.phase === "typing" && !v.startedTyping) v.back();
      else if (v.phase === "typing") show({ ...v, phase: "idle", typed: "" });
      else v.back();
      break;
    case "question":
    case "plan":
      show({ screen: "leave", sel: 0, back: v, pendingId: v.pendingId, maker: v.maker }); // D188
      break;
    case "leave":
      view = v.back;
      break;
    case "progress":
      showShelf(); // D187: the make carries on, and the shelf offers a way back.
      break;
    case "result":
      if (v.afterPlay) leaveMessage(v);
      else {
        resultSeen(v.resultId);
        showShelf();
      }
      break;
    case "check":
      finishCheck();
      break;
  }
}

// ---------- hold to talk (D87) ----------

/** @param {any} v */
async function beginTalk(v) {
  v.phase = "listening";
  v.talking = post("/api/speech/start").catch(() => {});
}

/** @param {any} v */
async function endTalk(v) {
  v.phase = "hearing";
  await v.talking;
  let text = "";
  try {
    text = String((await post("/api/speech/stop")).text ?? "").trim();
  } catch {}
  if (view !== v) return;
  if (text) show({ ...v, phase: "confirm", transcript: text, sel: 0 });
  else v.phase = "silence";
}

/** @param {any} v */
async function cancelTalk(v) {
  v.phase = "idle";
  await v.talking;
  post("/api/speech/stop").catch(() => {});
}

const anyButtonHeld = () => [...held].some((c) => BUTTONS.has(c));

// ---------- key events ----------

/** Someone's at the cabinet, so a waiting question's clock starts again (D188). */
function noteActivity() {
  if (!studio.pending) return;
  const t = Date.now();
  if (!studio.pending.warn && t - lastStillHere < 5000) return;
  lastStillHere = t;
  post("/api/studio/still-here").catch(() => {});
}

addEventListener("keydown", (e) => {
  noteActivity();
  if (view.screen === "play") {
    if (e.code === "Escape" && !e.repeat) endPlay("star");
    else if (playing && !e.repeat && (e.code in STICK || BUTTONS.has(e.code))) playing.sides.add("p1");
    return;
  }
  e.preventDefault();
  if (!e.repeat) held.add(e.code);
  const v = view;
  if (v.screen === "say" && v.phase === "typing") return onTyping(e, v);
  if (e.code in STICK) return onStick(STICK[e.code]);
  if (e.code === "Escape") return void (e.repeat || onBack());
  if (e.code === "F1" && !e.repeat && v.screen === "say" && ["idle", "silence"].includes(v.phase)) {
    v.phase = "typing";
    v.startedTyping = true;
    return;
  }
  if (!BUTTONS.has(e.code) || e.repeat) return;
  if (!armed) return;
  if (v.screen === "say" && ["idle", "silence"].includes(v.phase)) return void beginTalk(v);
  onButton();
});

addEventListener("keyup", (e) => {
  held.delete(e.code);
  if (!anyButtonHeld()) {
    armed = true;
    if (view.screen === "say" && view.phase === "listening") endTalk(view);
  }
});

addEventListener("blur", () => {
  held.clear();
  armed = true;
  if (view.screen === "say" && view.phase === "listening") endTalk(view);
});

/** @param {KeyboardEvent} e @param {any} v */
function onTyping(e, v) {
  if (e.code === "Escape") return void (e.repeat || onBack());
  if (e.code === "Enter") {
    if (e.repeat) return;
    const text = v.typed.trim();
    if (text) {
      // Typed words need no "I heard" check: they're on screen already.
      v.done(text);
    }
    return;
  }
  if (e.code === "Backspace") v.typed = v.typed.slice(0, -1);
  else if (e.key.length === 1 && e.key >= " " && e.key <= "~" && v.typed.length < v.max) v.typed += e.key;
}

// ---------- frame ----------

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const k = integerScale(window.innerWidth, window.innerHeight, dpr);
  canvas.style.width = `${(W * k) / dpr}px`;
  canvas.style.height = `${(H * k) / dpr}px`;
}
addEventListener("resize", fitCanvas);
fitCanvas();

function frame() {
  requestAnimationFrame(frame);
  tick++;
  if (view.screen === "play") return;
  view.tick = tick;
  view.warn = !!(studio.pending?.warn && view.pendingId === studio.pending.id);
  draw(painter, view);
  for (const f of check(painter.boxes)) faults.add(`${view.screen}: ${f}`);
  const px = painter.fb.pixels;
  for (let i = 0; i < px.length; i++) out32[i] = RGBA[px[i]];
  ctx.putImageData(image, 0, 0);
}

// ---------- start ----------

/** The state of the screen, for scripts (D186). */
const launcher = {
  screen: () => view.screen,
  phase: () => view.phase ?? null,
  sel: () => view.sel ?? null,
  boxes: () => painter.boxes,
  faults: () => [...faults],
  studio: () => studio,
  CHECK_TILES,
};
/** @type {any} */ (window).launcher = launcher;

config = await get("/api/config").catch(() => config);
studio = await get("/api/studio").catch(() => studio);
requestAnimationFrame(frame);
await showShelf();

/** Service gone for this long: say so, rather than let keys do nothing (D189). */
const OFFLINE_NOTICE_MS = 2500;

function connect() {
  const stream = new EventSource("/api/studio/events");
  stream.onmessage = (e) => {
    offlineSince = 0;
    studio = JSON.parse(e.data);
    if (view.screen === "shelf") showShelf();
    followStudio();
    if (view.screen === "notice" && view.restarting) showShelf();
  };
  stream.onerror = () => {
    offlineSince ||= Date.now();
    // Normally the browser retries by itself; a refused response ends the stream.
    if (stream.readyState === EventSource.CLOSED) setTimeout(connect, 1000);
  };
}
connect();

setInterval(() => {
  if (offlineSince && Date.now() - offlineSince >= OFFLINE_NOTICE_MS && view.screen !== "play" && !view.restarting) offline();
}, 500);
