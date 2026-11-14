// @ts-check
// The launcher page: which screen is up, what the keys do, and talking to the
// service. Drawing and fitting are in screens.js, boards.js and text.js; the
// shelf's family rows in shelf.js. Keys are D82's, so the Picade, the virtual
// cabinet's keyboard and a script all drive it the same way. The boards are the
// canvas's (D201, docs/design/arcade-ux-handoff.md); the board id is in each view.
import { createHost, integerScale } from "../../../runtime/src/host.js";
import { createGuestHost, fetchGuests, guestHowto, guestPostGame, guestRows, guestsChecking } from "./guests.js";
import { rgbaTable } from "../../../runtime/src/palette.js";
import { COLORS as C } from "../../../runtime/src/palette.js";
import { H, W, check } from "./text.js";
import { CHECK_TILES, Painter, draw, flow, planLines, questionText } from "./screens.js";
import {
  SHELF_HINT,
  bootBoard,
  resultItem,
  goneView,
  cardView,
  coinCheck,
  historyLines,
  howtoView,
  leaveView,
  stopConfirmView,
  notYours,
  offlineMake,
  unconnectedMake,
  postGame,
  potLimit,
  resting,
  resultView,
  whatToChange,
  whoView,
} from "./boards.js";
import { REDIRECT_ACTIONS, redirectBoard } from "./redirect.js";
import { checksFor, familyOfCart, gameRows } from "./shelf.js";
import { holdOverlay } from "./wifi.js";
import { WIFI_HINT, asEnt, createWifiFlow } from "./wifi-flow.js";
import { openKeys, sayKey } from "./say-keys.js";
import { listenForVolume } from "./volume.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("screen"));
const stage = /** @type {HTMLElement} */ (document.getElementById("stage"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
const image = ctx.createImageData(W, H);
const out32 = new Uint32Array(image.data.buffer);
const RGBA = rgbaTable();
const painter = new Painter();

const BUTTONS = new Set(["KeyZ", "KeyX", "KeyC", "KeyV", "KeyQ", "KeyE", "Enter"]);
/** COIN is the X HAT's F2 (D82). It opens the pot on the shelf, and only it starts spending (D205). */
const COIN = "F2";
/** D421: while ENT (F1) is held, the pink buttons are the volume (arcade-volkey does it), not "any button". */
const PINKS = new Set(["KeyQ", "KeyE"]);
let volumeChord = false;
const NAME_MAX = 16;
const WORDS_MAX = 300;

/** @type {any} */
let view = { screen: "boot", console: "" };
/** @type {any} */
let studio = { phase: "idle" };
let config = { console: "Arcade", players: 1, speech: "stub", keyboard: true };
/** @type {any[]} */
let makers = [];
/** Every maker's name, those not offered in "Who's making?" too (grown-ups, hidden names, D363). @type {Record<string, string>} */
let names = {};
/** The cabinet's Wi-Fi, where it has a helper (D414): { available, connected }. @type {any} */
let wifiNow = { available: false };
/** @type {any[]} */
let carts = [];
/** Downloaded games (D230), after the carts on the shelf. @type {any[]} */
let guests = [];
/** Follow the Studio's state on screen? Off once ESC has gone to the shelf (D187). */
let following = false;
/** @type {number | null} */
let followRun = null;
let seenRunning = false;
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
const answered = new Set();
/** The last play of each game: its score, the best before it, and its play record's post (D215). @type {Map<string, any>} */
const scoreOf = new Map();
/** The game just played: the next shelf opens on it, once (D194). @type {string | null} */
let returnTo = null;
/** Boards shown so far, for scripts and the report. @type {string[]} */
const boardsSeen = [];

// ---------- service ----------

/** @param {string} url @param {object} [body] */
async function post(url, body = {}) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  const out = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!out.ok) throw Object.assign(new Error(out.error ?? `HTTP ${r.status}`), { why: out.why, status: r.status, redirect: out.redirect });
  return out;
}
/** @param {string} url */
const get = (url) => fetch(url).then((r) => r.json());

const pot = () => studio.pot ?? null;
const nameOf = (/** @type {string} */ id) => makers.find((m) => m.id === id)?.name ?? names[id] ?? id;
/** The pot with names on its makers. */
const namedPot = () => {
  const p = pot();
  if (!p) return null;
  const named = (/** @type {any[]} */ l) => l.map((m) => ({ ...m, name: nameOf(m.maker) }));
  return { ...p, makers: named(p.makers), last_month: p.last_month ? { ...p.last_month, makers: named(p.last_month.makers) } : null };
};
const usual = () => pot()?.usual ?? { new: 6, change: 3 };

async function refresh() {
  carts = (await get("/api/carts")).carts;
  ({ makers, names = {} } = await get("/api/makers"));
  guests = await fetchGuests();
  wifiNow = await get("/api/wifi").catch(() => wifiNow);
}

// ---------- moving between screens ----------

/** @param {any} v */
function show(v) {
  view = v;
  armed = ![...held].some((c) => BUTTONS.has(c));
  const id = v.board ?? v.screen;
  if (boardsSeen.at(-1) !== id) boardsSeen.push(id);
}

/** The Wi-Fi screens (D413, D414): a grown-up holds ENT and COIN on the shelf. */
const wifi = createWifiFlow({ show, view: () => view, get, post, exit: () => void showShelf() });

const offline = () => show({ screen: "notice", board: "E4", title: "Just a moment", message: "The cabinet is restarting.", restarting: true });

/** A board with what each tile does. @param {any} v @param {string[]} actions @param {object} [extra] */
const showBoard = (v, actions, extra = {}) => show({ ...v, actions, ...extra });

async function showShelf() {
  following = false;
  const from = view.screen;
  const fromWifi = wifi.on();
  try {
    await refresh();
    // A refresh the shelf asked for itself (a Studio event, a guest still being checked) can land after someone has
    // moved on, to the pot or a game: it mustn't pull them back. The same for the Wi-Fi screens, which a grown-up
    // can open while ESC from the pot is still on its way to the shelf. Leaving them asks for the shelf itself.
    if ((from === "shelf" && view.screen !== "shelf") || (wifi.on() && !fromWifi)) return;
    const ended = (studio.results ?? []).map(resultItem); // how makes ended, until someone has seen (D192)
    const games = gameRows(carts, nameOf).map((r) => ({ ...r, hasCard: true }));
    const items = [...makeTiles(), ...ended, ...games, ...guestRows(guests, nameOf)];
    const keyOf = (/** @type {any} */ it) => it.cart?.id ?? (it.result ? `r${it.result.id}` : it.kind === "waiting" ? "waiting" : "tile");
    const lit = view.screen === "shelf" ? keyOf(view.items[view.sel]) : (returnTo ?? "tile");
    returnTo = null;
    const v = { screen: "shelf", board: studio.phase === "running" ? "S2" : studio.unconnected ? "E11" : studio.offline ? "E1" : "S1", console: config.console, pot: pot()?.coins ?? null, offline: !!studio.offline, unconnected: !!studio.unconnected, items, sel: Math.max(0, items.findIndex((it) => keyOf(it) === lit)), hint: SHELF_HINT };
    // D415: on Wi-Fi but Claude can't be reached is "No internet"; a real drop says how a grown-up fixes it (D413).
    if (v.offline && !v.unconnected && wifiNow.available) Object.assign(v, wifiNow.connected ? { offlineWord: "No internet" } : { hint: WIFI_HINT });
    if (view.screen === "shelf") view = v;
    else show(v);
    // A downloaded game still being checked joins the shelf when it passes (D310): look again shortly.
    if (guestsChecking > 0) setTimeout(() => void (view.screen === "shelf" && showShelf()), 2000);
  } catch {
    offline();
  }
}

/** The Make row, or the way back to a game being made (D87, D187, D201). */
function makeTiles() {
  const cost = usual().new;
  if (studio.phase === "idle" && studio.collecting) return [{ kind: "busy", title: "Make a new game", note: "Finishing the last game first", cost }];
  if (studio.phase === "idle" && studio.unconnected) return [{ kind: "unconnected", title: "Make a new game", note: "Not connected to Claude yet", urgent: true }];
  if (studio.phase === "idle" && studio.offline) return [{ kind: "offline", title: "Make a new game", note: "Needs Wi-Fi right now", urgent: true }];
  if (studio.phase === "idle" && studio.resting) return [{ kind: "resting", title: "Make a new game", note: "Claude is resting until the 1st" }];
  if (studio.phase === "idle") return [{ kind: "make", title: "Make a new game", note: studio.notice?.short ?? "Tell Claude your idea", urgent: !!studio.notice, cost }];
  const who = studio.maker_name ?? "someone";
  const asking = !!studio.pending;
  const stepLine = (studio.lines ?? []).at(-1) ?? "Getting ready";
  return [
    { kind: "back", title: asking ? `Claude is waiting for ${who}` : `${studio.kind === "change" ? "Changing" : "Making"} ${who}'s game`, note: asking ? "Claude has a question!" : stepLine, urgent: asking },
    { kind: "waiting", title: "Make a new game", note: `After ${who}'s game is done` },
  ];
}

// ---------- boot (B1-B4) ----------

async function boot() {
  let b = { intro: false, new_month: false };
  await refresh().catch(() => {}); // names for B4's totals
  try {
    b = await get("/api/boot");
  } catch {}
  if (b.intro) return showBoard(bootBoard("controls", namedPot()), ["intro-next"]);
  if (b.new_month) return showBoard(bootBoard("month", namedPot()), ["month-done"]);
  await showShelf();
}

// ---------- making: who, coin check, tell me ----------

/** @param {{ cart: any } | undefined} [change] */
async function showWho(change = undefined) {
  try {
    await refresh();
    show({ ...whoView({ makers, pot: namedPot(), change }), board: change ? "R1" : "M1" });
  } catch {
    offline();
  }
}

/** What stops a make before the coin check: no Wi-Fi, resting, or the pot (L1, L2, L5, E2). @param {"new" | "change"} kind */
function blocker(kind) {
  if (studio.unconnected) return () => showBoard(unconnectedMake(), ["shelf"]);
  if (studio.offline) return () => showBoard(offlineMake(), ["shelf"]);
  if (studio.resting) return () => showBoard(resting(), ["shelf"]);
  const p = namedPot();
  if (!p) return null;
  const need = kind === "change" ? p.usual.change : p.usual.new;
  if (p.coins <= 0 || p.coins < need) return () => showLimit(kind, p.coins <= 0 ? "empty" : "low");
  return null;
}

/** @param {"new" | "change"} kind @param {"low" | "empty"} why */
function showLimit(kind, why) {
  const v = potLimit({ kind, pot: /** @type {any} */ (namedPot()), why });
  showBoard(v, v.board === "L1" ? ["shelf", "pot", "shelf"] : ["shelf"]);
}

/**
 * The coin check (M3, R3): only COIN starts it (D205).
 * @param {{ maker: any, kind: "new" | "change", parent?: any, request?: string, fix?: any, back: () => void }} o
 */
function showCoinCheck(o) {
  const stop = blocker(o.kind);
  if (stop) return stop();
  showBoard(coinCheck({ kind: o.kind, pot: /** @type {any} */ (namedPot()), maker: o.maker.name, parentVersion: o.parent?.version }), ["coin", "back"], { make: o });
}

/** COIN pressed on the coin check. @param {any} v */
function coinPressed(v) {
  const o = v.make;
  if (o.request) return confirmIdea(o, o.request);
  if (o.kind === "change") return showBoard(whatToChange({ noRule: o.fix, makerName: o.maker.name }), whatToChange({ noRule: o.fix, makerName: o.maker.name }).actions, { make: o });
  askRequest(o);
}

/** M4, M5: tell me your idea, with the AI disclosure (D87). @param {any} o */
function askRequest(o) {
  showSay({
    purpose: o.kind === "change" ? "change" : "request",
    prompt: o.kind === "change" ? "What should change? Hold a button and tell me." : "Hi! I'm Claude, an AI. What game should we make?",
    back: () => showCoinCheck(o),
    done: (request) => startMake(o, request),
  });
}

/** M6 with words already in hand (a retry, or a fix). @param {any} o @param {string} words */
function confirmIdea(o, words) {
  showSay({ purpose: o.kind === "change" ? "change" : "request", back: () => showShelf(), done: (request) => startMake(o, request) });
  view = { ...view, board: "M6", phase: "confirm", transcript: words, sel: 0 };
}

/**
 * The talk screen (D87): hold a button, talk, let go, confirm. F1 (the Picade's ENT) types (D184): on a
 * keyboard where the cabinet has one, and with the stick on the grid keyboard either way (D430, D431).
 * Typed words get the same confirm step as spoken ones (D201).
 * @param {{ purpose: string, prompt?: string, typing?: boolean, max?: number, pendingId?: number, back: () => void, done: (text: string) => void }} o
 */
function showSay(o) {
  const v = { screen: "say", board: o.purpose === "name" ? "M2" : o.purpose === "answer" ? "M8" : o.purpose === "change" ? "R4" : "M4", ...o, phase: "idle", typed: "", transcript: "", sel: 0, max: o.max ?? WORDS_MAX, typeKey: config.keyboard ? "F1" : "ENT" };
  show(o.typing ? typeIt(v) : v);
}

/** Can this cabinet hear? Not with the stub, nor with no speech engine set up. */
const canHear = () => config.speech !== "stub" && config.speech !== "none";

/** A talk screen turned to typing: a keyboard's own keys where the cabinet has one, else the stick's (D430). @param {any} v */
const typeIt = (v) => (config.keyboard ? { ...v, phase: "typing", typed: "", transcript: "", added: "", sel: 0 } : { ...openKeys(v), transcript: "", added: "", sel: 0 });

/** @param {any} o @param {string} request @param {boolean} [offered] it's the alternative E10 offered */
async function startMake(o, request, offered = false) {
  show({ screen: "progress", board: o.kind === "change" ? "R7" : "M10", kind: o.kind, lines: [], maker: o.maker.name, step: 0, used_cents: 0, usual: o.kind === "change" ? usual().change : usual().new });
  followRun = null;
  seenRunning = false;
  try {
    following = true;
    followRun = (await post("/api/studio/start", { maker: o.maker.id, request, parent: o.parent?.id ?? null, offered })).state.run_id ?? followRun;
    followStudio();
  } catch (/** @type {any} */ e) {
    following = false;
    // E10: the closest safe version of their idea, no coins used (D270-D275).
    if (e.why === "redirect") {
      const alt = e.redirect.alternative;
      return showBoard(redirectBoard({ ...e.redirect, answer: false }), REDIRECT_ACTIONS, { onTake: () => startMake(o, alt, true), onAgain: () => askRequest(o), onBack: () => showShelf() });
    }
    if (e.why === "low" || e.why === "empty") return showLimit(o.kind, e.why);
    if (e.why === "resting") return showBoard(resting(), ["shelf"]);
    if (e.why === "offline") return showBoard(studio.unconnected ? unconnectedMake() : offlineMake(), ["shelf"]);
    if (e.status === 409) return showBoard({ screen: "board", board: "busy", title: "One at a time", blocks: [{ text: "Another game is being made right now. Try again when it's done!", rows: 3 }], tiles: [{ text: "Back to the shelf", hue: C.green, center: true }], sel: 0 }, ["shelf"]);
    offline();
  }
}

// ---------- following the Studio ----------

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
  // The coins used so far, in the header (M7, M9).
  const usedCoins = Math.round((studio.used_cents ?? 0) / 10);
  const right = `${usedCoins} used`; // with a coin before it; the maker is on the screens before
  if (p) {
    if (view.pendingId === p.id) return;
    const change = studio.kind === "change";
    if (p.kind === "question") show({ screen: "question", board: change ? "R5" : "M7", pendingId: p.id, ...p, maker: right, makerCoin: true, sel: 0 });
    else show({ screen: "plan", board: change ? "R6" : "M9", mode: change ? "change" : "new", pendingId: p.id, ...p, right, rightCoin: true, usual: usual(), parentVersion: studio.parent?.version, cartControls: [], flowed: planLines(p), sel: 0 });
    return;
  }
  if (studio.phase === "running") {
    const kind = studio.kind === "change" ? "change" : "new";
    const mins = pot()?.minutes?.[kind] ?? (kind === "change" ? 4 : 7);
    const v = { screen: "progress", board: kind === "change" ? "R7" : "M10", kind, lines: studio.lines, maker: studio.maker_name, step: studio.step ?? 0, used_cents: studio.used_cents ?? 0, usual: kind === "change" ? usual().change : usual().new, minutesLeft: Math.ceil(mins - (studio.working_s ?? 0) / 60) };
    if (view.screen === "progress") Object.assign(view, v);
    else show(v);
  }
}

/** How a make ended, whoever's it was (M11, R8, L3, L4, E3). @param {any} r */
function showResult(r) {
  const v = resultView(r, namedPot());
  const actions = v.board === "E3" ? ["retry", "shelf"] : v.tiles.length === 2 && r.ok ? ["play-new", "shelf"] : ["shelf"];
  showBoard(v, actions);
}

/** Seen: the entry leaves the shelf (D192). @param {number} id */
function resultSeen(id) {
  following = false;
  followRun = null;
  seenRunning = false;
  post("/api/studio/result-seen", { id }).catch(() => {});
  studio = { ...studio, results: (studio.results ?? []).filter((/** @type {any} */ r) => r.id !== id) };
}

/** The make being followed has gone: a timeout or a restart (E5, E6, D188, D189). */
function showGone() {
  following = false;
  followRun = null;
  seenRunning = false;
  const n = studio.notice;
  const v = goneView(n, usual());
  showBoard(v, v.actions, { noticeId: n?.id, costShown: n?.cost_cents != null });
}

/** @param {string} choice @param {string} [said] @param {boolean} [offered] it's the alternative E10 offered */
async function answer(choice, said, offered = false) {
  const id = view.pendingId;
  answered.add(id);
  show({ screen: "progress", board: studio.kind === "change" ? "R7" : "M10", kind: studio.kind, lines: studio.lines ?? [], maker: studio.maker_name, step: studio.step ?? 0, used_cents: studio.used_cents ?? 0, usual: studio.kind === "change" ? usual().change : usual().new });
  await post("/api/studio/answer", { id, choice, said, offered }).catch((/** @type {any} */ e) => {
    if (e.why !== "redirect") return;
    // E10 for their own words (D270-D275): the question keeps waiting while they choose.
    following = false;
    const resume = () => {
      answered.delete(id);
      following = true;
      followStudio();
    };
    const again = () =>
      showSay({
        purpose: choice === "C" ? "answer" : "change",
        prompt: choice === "C" ? (studio.pending?.question ?? "") : "What should be different?",
        pendingId: id,
        back: resume,
        done: (/** @type {string} */ s) => {
          following = true;
          view = { ...view, pendingId: id };
          answer(choice, s);
        },
      });
    const alt = e.redirect.alternative;
    showBoard(redirectBoard({ ...e.redirect, answer: true }), REDIRECT_ACTIONS, {
      onTake: () => {
        following = true;
        view = { ...view, pendingId: id };
        answer(choice, alt, true);
      },
      onAgain: again,
      onBack: resume,
    });
  });
}

// ---------- play (G0-G5) ----------

const newId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** How often a play says it's still going; the service stops counting it after 30 s of silence (D310). */
const PLAY_BEAT_MS = 10_000;

/** G0: how to play, before every game. @param {any} cart */
function showHowTo(cart) {
  show({ ...(cart.guest ? guestHowto(cart) : howtoView(cart, nameOf)), board: "G0" });
}

/** @param {any} cart */
function startPlay(cart) {
  stage.replaceChildren();
  stage.hidden = false;
  canvas.hidden = true;
  const startedAt = new Date().toISOString();
  const host = (cart.guest ? createGuestHost : createHost)({
    container: stage,
    cartUrl: cart.url,
    players: config.players,
    onStar: () => endPlay("star"),
    onError: () => {
      if (playing) playing.errors++;
    },
  });
  playing = { cart, host, playId: newId(), startedAt, t0: performance.now(), errors: 0, sides: new Set(), ended: false };
  // The publish gate waits while a game is being played (D310): say so now, and every few seconds.
  const beat = () => post("/api/arcade/playing", { playing: true, what: cart.id }).catch(() => {});
  beat();
  playing.beat = setInterval(beat, PLAY_BEAT_MS);
  show({ screen: "play", board: "G1", cart });
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
  clearInterval(p.beat);
  post("/api/arcade/playing", { playing: false }).catch(() => {});
  returnTo = p.cart.id;
  const duration = (performance.now() - p.t0) / 1000;
  const ticks = p.host.ticks;
  p.host.destroy();
  stage.hidden = true;
  stage.replaceChildren();
  canvas.hidden = false;
  // This play's round scores go with its record, which the best comes from (D215). Logged before the post-game screen reads it.
  const scores = [...(p.host.scores ?? [])];
  p.score = scores.length ? Math.max(...scores) : null;
  p.bestBefore = (p.cart.guest ? guests : carts).find((c) => c.id === p.cart.id)?.best ?? p.cart.best ?? null;
  const logged = p.cart.guest
    ? post("/api/guest-plays", { guest_id: p.cart.id, play_id: p.playId, started_at: p.startedAt, duration_s: duration, ended, errors: p.errors, scores }).catch(() => {}) // D232, D235
    : post("/api/plays", { cart_id: p.cart.id, play_id: p.playId, started_at: p.startedAt, duration_s: duration, ticks, sides: [...p.sides], ended, errors: p.errors, scores }).catch(() => {});
  scoreOf.set(p.cart.id, { score: p.score, bestBefore: p.bestBefore, logged });
  if (p.failed) {
    showBoard({ screen: "board", board: "wont-start", title: "That didn't work", blocks: [{ text: `"${p.cart.title}" wouldn't start. It's saved, and a grown-up can look at it.`, rows: 5 }], tiles: [{ text: "Back to the shelf", hue: C.green, center: true }], sel: 0 }, ["shelf"]);
    return;
  }
  // You-check: two at most, things you can see (D207). Starters ask nothing (D193).
  const asks = checksFor(p.cart);
  if (asks.length) {
    show({ screen: "check", board: "G2", cart: p.cart, playId: p.playId, title: p.cart.title, i: 0, n: asks.length, asks, rule: asks[0].text, answers: [], sel: 0 });
    return;
  }
  showPostGame(p.cart, null);
}

async function finishCheck() {
  const v = view;
  if (v.answers.length) {
    await post("/api/you-check", { cart_id: v.cart.id, play_id: v.playId, checker: v.cart.maker ?? null, answers: v.answers }).catch(() => {});
  }
  const no = v.answers.find((/** @type {any} */ a) => a.answer === "no");
  showPostGame(v.cart, no ? v.asks.find((/** @type {any} */ r) => r.id === no.rule) : null);
}

/** After every game (D201). @param {any} cart @param {any} noRule */
async function showPostGame(cart, noRule) {
  const played = scoreOf.get(cart.id);
  await played?.logged;
  if (cart.guest) {
    // The score and best ever, for a guest that reports one (D235); logged first, so the best includes this play.
    try {
      await refresh();
    } catch {}
    const best = guests.find((x) => x.id === cart.id)?.best ?? null;
    const g = guestPostGame(cart, { score: played?.score ?? null, best, bestBefore: played?.bestBefore ?? null });
    return showBoard(g, g.post, { cart, noRule: null });
  }
  try {
    await refresh();
  } catch {}
  const fam = familyOfCart(carts, cart.id);
  const versions = fam ? [fam.family.main, ...fam.family.others].reduce((n, l) => n + l.carts.length, 0) : 1;
  const best = carts.find((c) => c.id === cart.id)?.best ?? null;
  const v = postGame({ cart, noRule, versions, usual: usual(), score: played?.score ?? null, best, bestBefore: played?.bestBefore ?? null });
  showBoard(v, v.post, { cart, noRule });
}

// ---------- changing a game (R1-R8) ----------

/** R1. @param {any} cart @param {any} [fix] */
async function startChange(cart, fix = null) {
  try {
    await refresh();
  } catch {}
  const v = whoView({ makers, pot: namedPot(), change: { cart } });
  show({ ...v, board: "R1", fix });
}

/** A maker was picked for a change. @param {any} maker @param {any} cart @param {any} fix */
function changeBy(maker, cart, fix) {
  const o = { maker, kind: /** @type {const} */ ("change"), parent: cart, fix, back: () => startChange(cart, fix) };
  if (cart.maker && cart.maker !== maker.id) return showBoard(notYours({ cart, makerName: maker.name, ownerName: nameOf(cart.maker) }), ["coin-check", "shelf"], { make: o });
  showCoinCheck(o);
}

/** "Look at the plan first" (R4): the game's rules, in the reader. @param {any} v */
function showRules(v) {
  const c = v.make.parent;
  const rules = c.rules ?? [...(c.youCheck ?? []).map((/** @type {any} */ r) => ({ ...r, kind: "you-check" }))];
  show({ screen: "reader", board: "R4-plan", title: c.title, flowed: [...flow(c.pitch ?? c.title), { text: "" }, ...flow("Controls:", C.yellow), ...(c.controls ?? []).flatMap((/** @type {string} */ l) => flow(l, C.ice)), { text: "" }, ...flow(rules.length ? "Things to check:" : "", C.yellow), ...rules.flatMap((/** @type {any} */ r) => flow(r.text, C.lilac))], top: 0, back: v });
}

// ---------- the pot (A1, A2) ----------

async function showPot() {
  const p = namedPot();
  if (!p) return;
  show({ screen: "pot", board: "A1", pot: p, back: view.screen === "board" ? view : null });
}

async function showHistory() {
  try {
    const { history } = await get("/api/pot");
    const titled = history.map((/** @type {any} */ e) => ({ ...e, title: e.cart_id ? carts.find((c) => c.id === e.cart_id)?.title : null }));
    show({ screen: "history", board: "A2", flowed: historyLines(titled), top: 0 });
  } catch {
    offline();
  }
}

// ---------- keys ----------

/** @param {any} v @param {number} d @param {number} n */
const moveSel = (v, d, n) => {
  // Every menu stops at its ends, like the shelf: no wrapping from the bottom tile to the top (D306).
  v.sel = Math.max(0, Math.min(n - 1, v.sel + d));
};

const somethingCut = () => painter.boxes.some((b) => b.cut && b.onCut === "reader");

const STICK = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** @param {"up" | "down" | "left" | "right"} dir */
function onStick(dir) {
  const v = view;
  const ud = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  switch (v.screen) {
    case "shelf":
      if (ud) v.sel = Math.max(0, Math.min(v.items.length - 1, v.sel + ud));
      else if (dir === "right" && v.items[v.sel]?.kind === "cart" && v.items[v.sel].hasCard) showCard(v.items[v.sel].cart);
      break;
    case "who":
      if (ud) v.sel = Math.max(0, Math.min(v.rows.length - 1, v.sel + ud));
      break;
    case "card":
      if (ud) {
        let s = v.sel;
        do s = Math.max(0, Math.min(v.rows.length - 1, s + ud));
        while (v.rows[s]?.label && s > 0 && s < v.rows.length - 1);
        v.sel = s;
      }
      break;
    case "question":
      if (ud) moveSel(v, ud, 4);
      else if (dir === "right" && somethingCut()) show({ screen: "reader", title: "Claude asks", flowed: questionText(v), top: 0, back: v, pendingId: v.pendingId });
      break;
    case "reader":
    case "history":
      if (ud) v.top += ud;
      else if (dir === "left" && v.back) view = v.back;
      break;
    case "plan":
      // Stick right: every rule, in the reader (D201). Up, down or left: choose.
      if (dir === "right") show({ screen: "reader", title: "All the rules", flowed: v.flowed, top: 0, back: v, pendingId: v.pendingId });
      else v.sel = dir === "down" ? 1 : 0; // up or left: Build it; down: Change it (D306)
      break;
    case "say":
      if (v.phase === "confirm") {
        if (ud) moveSel(v, ud, confirmTiles(v).length);
        else if (dir === "right" && somethingCut()) show({ screen: "reader", title: "I heard", flowed: flow(v.transcript), top: 0, back: v, pendingId: v.pendingId });
      }
      break;
    case "board":
      if (ud && v.tiles?.length) {
        // Stop at the ends, skipping tiles that can't be picked (D306).
        let s = v.sel + ud;
        while (s >= 0 && s < v.tiles.length && v.tiles[s]?.dim) s += ud;
        if (s >= 0 && s < v.tiles.length) v.sel = s;
      }
      break;
    case "check":
      if (ud) moveSel(v, ud, CHECK_TILES.length);
      else if (dir === "right" && somethingCut()) show({ screen: "reader", title: "You check", flowed: flow(v.rule), top: 0, back: v });
      break;
  }
}

/** The confirm step's tiles (M6; names have two). @param {any} v */
export const confirmTiles = (v) => (v.purpose !== "name" ? ["Yes! That's it", "Say it again", "Add more"] : canHear() ? ["Yes, that's me", "Say it again", "Type it"] : ["Yes, that's me", "Type it again"]);

/** S3. @param {any} cart */
function showCard(cart) {
  const fam = familyOfCart(carts, cart.id);
  if (!fam) return;
  show({ ...cardView({ cart, family: fam.family, line: fam.line, nameOf, usual: usual() }), board: "S3" });
}

function onButton() {
  const v = view;
  switch (v.screen) {
    case "shelf": {
      const it = v.items[v.sel];
      // A make that ended while the kid was elsewhere (walked away, restart) says so first, with its cost and the
      // saved idea, before a new one (E5, D188, D300). Otherwise its board only shows to a kid still on the question.
      if (it.kind === "make") studio.notice ? showGone() : showWho();
      else if (it.kind === "back") {
        following = true;
        followStudio();
      } else if (it.kind === "result") showResult(it.result);
      else if (it.kind === "busy") showBoard({ screen: "board", board: "busy", title: "One at a time", blocks: [{ text: "The last game is still being finished. You can make a new one when it's done!", rows: 4 }], tiles: [{ text: "Back to the shelf", hue: C.green, center: true }], sel: 0 }, ["shelf"]);
      else if (it.kind === "waiting") showBoard({ screen: "board", board: "S2-wait", title: "One at a time", blocks: [{ text: `Claude is making ${studio.maker_name ?? "someone"}'s game. You can make one after it's done!`, rows: 4 }, { text: "Playing games is free, any time.", color: C.lime, rows: 1 }], tiles: [{ text: "Back to the shelf", hue: C.green, center: true }], sel: 0 }, ["shelf"]);
      else if (it.kind === "unconnected") showBoard(unconnectedMake(), ["shelf"]);
      else if (it.kind === "offline") showBoard(offlineMake(), ["shelf"]);
      else if (it.kind === "resting") showBoard(resting(), ["shelf"]);
      else showHowTo(it.cart);
      break;
    }
    case "howto":
      startPlay(v.cart);
      break;
    case "card": {
      const r = v.rows[v.sel];
      if (r.change) startChange(v.cart);
      else if (r.cart) showHowTo(carts.find((c) => c.id === r.cart.id) ?? r.cart);
      break;
    }
    case "who": {
      const r = v.rows[v.sel];
      const pick = (/** @type {any} */ maker) => (v.change ? changeBy(maker, v.change.cart, v.fix) : showCoinCheck({ maker, kind: "new", back: () => showWho() }));
      if (r.maker) pick(r.maker);
      else
        showSay({
          purpose: "name",
          typing: !canHear(), // D430: a name is said, like everything else (D87); typed only where the cabinet can't hear.
          max: NAME_MAX,
          back: () => (v.change ? startChange(v.change.cart, v.fix) : showWho()),
          done: async (name) => {
            try {
              const { maker } = await post("/api/makers", { name });
              pick(maker);
            } catch {
              showWho();
            }
          },
        });
      break;
    }
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
        if (v.sel === 0) v.done(v.added ? `${v.added} ${v.transcript}` : v.transcript);
        else if (v.sel === 1 && (v.purpose !== "name" || canHear())) show({ ...v, phase: "idle", transcript: "", typed: "", added: "", sel: 0 });
        else if (v.purpose === "name") show({ ...typeIt(v), startedTyping: canHear() }); // "Type it": ESC from there is back to the mic
        else show({ ...v, phase: "idle", added: [v.added, v.transcript].filter(Boolean).join(" "), transcript: "", sel: 0 }); // Add more: the next words join these
      }
      break;
    case "board":
      onBoard(v, v.actions?.[v.sel]);
      break;
    case "check":
      onCheck();
      break;
  }
}

/** A tile on a generic board. @param {any} v @param {string | undefined} action */
function onBoard(v, action) {
  const leaveResult = () => v.resultId != null && resultSeen(v.resultId);
  switch (action) {
    case "coin":
    case "back":
      if (action === "coin") return; // only COIN starts spending (D205); a button on its tile does nothing
      return v.make.back();
    case "intro-next":
      return showBoard(bootBoard("pot", namedPot()), ["intro-done"]);
    case "intro-done":
      post("/api/boot/seen", { what: "intro" }).catch(() => {});
      return showShelf();
    case "month-done":
      post("/api/boot/seen", { what: "month" }).catch(() => {});
      return showShelf();
    case "shelf":
      leaveResult();
      return showShelf();
    case "notice-shelf":
      if (v.noticeId) {
        post("/api/studio/notice-seen", { id: v.noticeId }).catch(() => {});
        studio = { ...studio, notice: undefined };
      }
      return showShelf();
    case "pot":
      return showPot();
    case "play-new": {
      leaveResult();
      return void refresh().then(() => {
        const c = carts.find((x) => x.id === v.cartId);
        return c ? showHowTo(c) : showShelf();
      });
    }
    case "retry-notice":
    // Not marked seen: backing out of the coin check keeps the idea on Make, and a make that starts clears it (D316).
    // falls through: the same retry as E3's
    case "retry": {
      leaveResult();
      const r = v.retry;
      const maker = makers.find((m) => m.id === r.maker) ?? { id: r.maker, name: nameOf(r.maker) };
      const parent = r.parent ? carts.find((c) => c.id === r.parent) : null;
      return showCoinCheck({ maker, kind: r.kind, parent, request: r.request, back: () => showShelf() });
    }
    case "again":
      // The cart as it is now: answered checks aren't asked again, and the best is current (D215).
      return startPlay(carts.find((c) => c.id === v.cart.id) ?? v.cart);
    case "change":
      return startChange(v.cart);
    case "fix":
      if (v.make) return startMake(v.make, `Fix this: "${v.make.fix.text}". When I played, it wasn't true.`);
      return startChange(v.cart, v.noRule);
    case "versions":
      return showCard(v.cart);
    case "coin-check":
      return showCoinCheck(v.make);
    case "tell":
      return askRequest(v.make);
    case "plan":
      return showRules(v);
    case "keep":
      view = v.back;
      armed = false;
      return;
    case "later":
      return showShelf(); // D187: the shelf's tile comes back here.
    case "redirect-take":
      return v.onTake();
    case "redirect-again":
      return v.onAgain();
    case "redirect-back":
      return v.onBack();
    case "stop":
      // Are you sure? Keep going is lit, and it goes back to the question (E13, D315).
      return showBoard(stopConfirmView({ usedCents: studio.used_cents ?? 0 }), ["stop-yes", "stop-keep"], { back: v.back, pendingId: v.pendingId });
    case "stop-keep":
      view = v.back;
      armed = false;
      return;
    case "stop-yes":
      following = false;
      post("/api/studio/stop").catch(() => {});
      studio = { ...studio, phase: "idle", pending: null };
      return showShelf();
    case "new-idea":
      if (v.noticeId) {
        post("/api/studio/notice-seen", { id: v.noticeId }).catch(() => {});
        studio = { ...studio, notice: undefined };
      }
      return showWho();
  }
}

function onCheck() {
  const v = view;
  if (v.sel === 3) return void finishCheck(); // later: anything answered so far is kept; it asks again next play
  const rule = v.asks[v.i];
  v.answers.push({ rule: rule.id, answer: ["yes", "no", "not_sure"][v.sel] });
  if (v.i + 1 >= v.n) return void finishCheck();
  show({ ...v, i: v.i + 1, rule: v.asks[v.i + 1].text, sel: 0 });
}

function onBack() {
  const v = view;
  switch (v.screen) {
    case "who":
      if (v.change) showShelf();
      else showShelf();
      break;
    case "reader":
      view = v.back;
      break;
    case "card":
    case "howto":
    case "history":
      if (v.screen === "history") return void showPot();
      showShelf();
      break;
    case "pot":
      if (v.back) view = v.back;
      else showShelf();
      break;
    case "say":
      if (v.phase === "listening") cancelTalk(v);
      else if (v.phase === "keys" && v.fromTyping) show({ ...v, phase: "typing", typed: v.text }); // back to the keyboard's own keys
      else if ((v.phase === "typing" || v.phase === "keys") && !v.startedTyping) v.back();
      else if (v.phase === "typing" || v.phase === "keys") show({ ...v, phase: "idle", typed: "" });
      else v.back();
      break;
    case "question":
    case "plan":
      showBoard(leaveView({ usedCents: studio.used_cents ?? 0 }), ["keep", "later", "stop"], { back: v, pendingId: v.pendingId }); // D188
      break;
    case "progress":
      showShelf(); // D187: the make carries on, and the shelf offers a way back.
      break;
    case "board":
      if (v.board === "E8" || v.board === "E13") {
        view = v.back;
        break;
      }
      if (v.make && (v.coinCheck || v.board === "R2" || v.board === "R4")) return void v.make.back();
      if (v.post) {
        returnTo = v.cart?.id ?? returnTo;
        return void showShelf();
      }
      if (v.board === "B2" || v.board === "B3" || v.board === "B4") return void onBoard(v, v.actions?.[0]);
      if (v.board === "E10") return void v.onBack();
      if (v.board === "E14") return void showShelf(); // the idea stays saved on Make until a try again or a new idea (D315)
      onBoard(v, v.noticeId ? "notice-shelf" : "shelf");
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
  if (text) show({ ...v, board: "M6", phase: "confirm", transcript: text, sel: 0 });
  else {
    v.phase = "silence"; // E9
    v.board = "E9";
  }
}

/** @param {any} v */
async function cancelTalk(v) {
  v.phase = "idle";
  await v.talking;
  post("/api/speech/stop").catch(() => {});
}

const anyButtonHeld = () => [...held].some((c) => BUTTONS.has(c));

// ---------- key events ----------

function noteActivity() {
  if (!studio.pending) return;
  const t = Date.now();
  if (!studio.pending.warn && t - lastStillHere < 5000) return;
  lastStillHere = t;
  post("/api/studio/still-here").catch(() => {});
}

addEventListener("keydown", (ev) => {
  const e = asEnt(ev); // the Picade's ENT (F13) reads as F1 (D433)
  noteActivity();
  // Before anything else, and during a game too: no key at the cabinet is ever Chromium's (F1 is its Help, D433).
  e.preventDefault();
  if (view.screen === "play") {
    if (e.code === "Escape" && !e.repeat) endPlay("star");
    else if (playing && !e.repeat && (e.code in STICK || BUTTONS.has(e.code))) playing.sides.add("p1");
    return;
  }
  if (!e.repeat) held.add(e.code);
  if (wifiNow.available && wifi.keydown(e, held)) return;
  if (PINKS.has(e.code) && held.has("F1") && !held.has(COIN)) return void (volumeChord = true);
  const v = view;
  if (v.screen === "say" && v.phase === "typing") return onTyping(e, v);
  // The stick's keyboard (D431). The button that opened it types nothing until it's let go (D182).
  if (v.screen === "say" && v.phase === "keys" && e.code !== "Escape" && e.code !== "F1") return void ((armed || !BUTTONS.has(e.code)) && sayKey(e, v) && typed(v, v.text));
  if (e.code in STICK) return onStick(/** @type {any} */ (STICK)[e.code]);
  if (e.code === "Escape") return void (e.repeat || onBack());
  if (e.code === COIN && !e.repeat) {
    if (v.screen === "board" && v.coinCheck) return coinPressed(v); // D205: only COIN starts spending
    if (v.screen === "shelf") return void showPot();
    return;
  }
  // F1 types on letting go, and only if no pink was pressed meanwhile: holding it is the volume's (D421).
  if (e.code === "F1") return void (e.repeat || (volumeChord = false));
  if (!BUTTONS.has(e.code) || e.repeat) return;
  if (!armed) return;
  if (v.screen === "say" && ["idle", "silence"].includes(v.phase)) return void beginTalk(v);
  if (v.screen === "pot") return void showHistory();
  onButton();
});

addEventListener("keyup", (ev) => {
  const e = asEnt(ev);
  held.delete(e.code);
  if (e.code === "F1" && !volumeChord && view.screen === "say") {
    if (["idle", "silence"].includes(view.phase)) view = { ...typeIt(view), startedTyping: true };
    // With a keyboard, F1 again swaps its keys for the stick's and back, keeping the words (D431).
    else if (view.phase === "typing") view = { ...openKeys(view, view.typed), fromTyping: true };
    else if (view.phase === "keys" && view.fromTyping) view = { ...view, phase: "typing", typed: view.text };
  }
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

/** Typed words get the same "is this right?" step as spoken ones, so Enter can't start a build (D201). @param {any} v @param {string} words */
function typed(v, words) {
  const text = words.trim();
  if (text) show({ ...v, board: v.purpose === "name" ? "M2" : "M6", phase: "confirm", transcript: text, typed: "", sel: 0 });
}

/** @param {KeyboardEvent} e @param {any} v */
function onTyping(e, v) {
  if (e.code === "Escape") return void (e.repeat || onBack());
  if (e.code === "Enter") {
    if (e.repeat) return;
    return typed(v, v.typed);
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
  // On its question, and on the shelf after "Come back later", so a kid there is warned too (D315).
  const waiting = studio.pending?.warn && (view.pendingId === studio.pending.id || view.screen === "shelf");
  view.warn = !!waiting;
  // E7: the last minute counts down on the hint line (D188).
  view.warnLeft = waiting && studio.pending.warn_until ? Math.max(0, Math.ceil((studio.pending.warn_until - Date.now()) / 1000)) : null;
  if (view.screen === "say" && view.phase === "confirm") view.confirmTiles = confirmTiles(view);
  const holding = wifiNow.available ? wifi.frame(held) : null;
  draw(painter, view);
  if (holding != null) holdOverlay(painter, holding);
  for (const f of check(painter.boxes)) faults.add(`${view.board ?? view.screen}: ${f}`);
  const px = painter.fb.pixels;
  for (let i = 0; i < px.length; i++) out32[i] = RGBA[px[i]];
  ctx.putImageData(image, 0, 0);
}

// ---------- start ----------

/** The state of the screen, for scripts (D186). */
const launcher = {
  screen: () => view.screen,
  board: () => view.board ?? view.screen,
  boards: () => [...boardsSeen],
  phase: () => view.phase ?? null,
  sel: () => view.sel ?? null,
  boxes: () => painter.boxes,
  faults: () => [...faults],
  studio: () => studio,
  CHECK_TILES,
};
/** @type {any} */ (window).launcher = launcher;

requestAnimationFrame(frame);
config = await get("/api/config").catch(() => config);
view.console = config.console;
// B1 stays up a moment, so "Warming up..." can be read rather than flash by.
const warm = new Promise((r) => setTimeout(r, 1500));
studio = await get("/api/studio").catch(() => studio);
await warm;
await boot();

const OFFLINE_NOTICE_MS = 2500;

function connect() {
  const stream = new EventSource("/api/studio/events");
  stream.onmessage = (e) => {
    offlineSince = 0;
    studio = JSON.parse(e.data);
    if (view.screen === "shelf") showShelf();
    wifi.internet(!!studio.offline);
    followStudio();
    if (view.screen === "notice" && view.restarting) showShelf();
    // The walk-away's cost arrives a moment after the screen: show it when it does (D300).
    if (view.noticeId && studio.notice?.id === view.noticeId && studio.notice.cost_cents != null && !view.costShown) showGone();
  };
  stream.onerror = () => {
    offlineSince ||= Date.now();
    if (stream.readyState === EventSource.CLOSED) setTimeout(connect, 1000);
  };
}
connect();

// ---------- launch_on_cabinet (D344): the desktop asks for a game's how-to-play screen, only from the shelf ----------
(function listenForLaunches() {
  const launches = new EventSource("/api/arcade/launch");
  launches.onmessage = async (e) => {
    const l = JSON.parse(e.data);
    const answer = (/** @type {boolean} */ ok, /** @type {string} */ why = "") => post("/api/arcade/launch/answer", { launch: l.launch, ok, why }).catch(() => {});
    if (view.screen !== "shelf" || playing || studio.phase === "running") return answer(false, `the cabinet is on another screen (${view.board ?? view.screen})`);
    await refresh().catch(() => {});
    const cart = carts.find((c) => c.id === l.cart);
    if (!cart) return answer(false, "the shelf doesn't have that game");
    showHowTo(cart);
    answer(true);
  };
  launches.onerror = () => {
    if (launches.readyState === EventSource.CLOSED) setTimeout(listenForLaunches, 1000);
  };
})();

listenForVolume();

setInterval(() => {
  if (offlineSince && Date.now() - offlineSince >= OFFLINE_NOTICE_MS && view.screen !== "play" && !view.restarting) offline();
}, 500);
