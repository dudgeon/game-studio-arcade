// cabinet: teti on the arcade cabinet. Loaded by main.js when the URL has ?cabinet.
// The cabinet has a stick and buttons, no mouse (D82): arrows, Z X C V (A B X Y),
// Q E, and Enter (START). Escape belongs to the launcher (back to the shelf, D88),
// which catches it before this page sees it.
//
// This file adds: the cabinet's key map, a game picker, a pause screen and a
// game-over screen, all driven by stick and buttons. Teti's own mouse menus stay
// in the code but are never opened.

// Game is handed in by main.js (importing main.js here would deadlock its top-level await).
let Game;

const MODES = [
    { id: "marathon", name: "Marathon", line: "Clear lines. Every 10 lines it gets faster." },
    { id: "sprint", name: "Sprint", line: "Clear 40 lines as fast as you can." },
    { id: "ultra", name: "2 Minutes", line: "Score as much as you can in 2 minutes." },
    { id: "zen", name: "Zen", line: "Nothing falls on its own. Take your time." },
];

const KEYS = {
    leftKey: "ArrowLeft", rightKey: "ArrowRight", sdKey: "ArrowDown", hdKey: "ArrowUp",
    cwKey: "z", ccwKey: "x", holdKey: "c", rotate180Key: "v",
    // Keys the cabinet doesn't have, so these never fire.
    resetKey: "F9", editMenuKey: "F10", undoKey: "F11", redoKey: "F12", pauseReplayKey: "F8",
};
// The board fills more of the cabinet's 1024x768 screen than teti's default Board Size (100).
const BOARD_SIZE = 130; // the top of teti's own slider: the board is 580 px of 768, from 460
const PICK = new Set(["z", "x", "c", "v", "q", "e", "Enter"]);
const HELP = "Stick moves &middot; Up drops &middot; A / B turn &middot; X holds &middot; START pauses";

let screen = null; // null while playing; else { kind, items, sel, title, text }
let lastMode = "marathon";

const el = document.createElement("div");
el.id = "cabinetOverlay";
el.innerHTML = `<style>
#cabinetOverlay { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  background: rgba(8, 11, 12, 0.82); z-index: 1000; font-family: "Montserrat", sans-serif; color: #fff; }
#cabinetOverlay .cab-panel { width: 640px; text-align: center; }
#cabinetOverlay h1 { font-size: 64px; margin: 0 0 8px; letter-spacing: 4px; }
#cabinetOverlay .cab-text { font-size: 24px; margin: 0 0 28px; color: #cfd6dd; min-height: 30px; }
#cabinetOverlay .cab-item { font-size: 34px; padding: 12px 20px; margin: 8px auto; width: 460px; border-radius: 12px;
  border: 3px solid transparent; }
#cabinetOverlay .cab-item.cab-sel { border-color: #ffd23f; background: rgba(255, 210, 63, 0.15); }
#cabinetOverlay .cab-line { font-size: 22px; color: #ffd23f; margin-top: 24px; min-height: 28px; }
#cabinetOverlay .cab-help { font-size: 18px; color: #9aa0a8; margin-top: 36px; }
#updatetext, #nofocus { display: none !important; }
</style><div class="cab-panel"><h1></h1><div class="cab-text"></div><div class="cab-items"></div><div class="cab-line"></div><div class="cab-help"></div></div>`;

function render() {
    if (!screen) { el.style.display = "none"; return; }
    el.style.display = "flex";
    el.querySelector("h1").textContent = screen.title;
    el.querySelector(".cab-text").textContent = screen.text ?? "";
    el.querySelector(".cab-items").innerHTML = screen.items
        .map((it, i) => `<div class="cab-item${i === screen.sel ? " cab-sel" : ""}">${it.name}</div>`).join("");
    el.querySelector(".cab-line").textContent = screen.items[screen.sel].line ?? "";
    el.querySelector(".cab-help").innerHTML = HELP;
}

function show(next) {
    screen = next;
    Game.stopGameTimers();
    render();
}

function picker() {
    const sel = Math.max(0, MODES.findIndex((m) => m.id === lastMode));
    show({ kind: "picker", title: "teti", text: "Pick a game", sel, items: MODES.map((m) => ({ ...m, go: () => play(m.id) })) });
}

function pause() {
    show({ kind: "pause", title: "Paused", text: "", sel: 0, items: [
        { name: "Keep playing", go: resume },
        { name: "Start over", go: () => play(lastMode) },
        { name: "Pick another game", go: picker },
    ] });
}

function gameOver() {
    const reason = Game.elementReason.textContent;
    const lost = ["Topout", "Blockout", "Lockout"].includes(reason);
    show({ kind: "over", title: lost ? "Game over!" : "You did it!", text: lost ? `Lines: ${Game.stats.clearlines}  Score: ${Game.stats.score}` : `${reason}. ${Game.elementResult.textContent}`, sel: 0, items: [
        { name: "Play again", go: () => play(lastMode) },
        { name: "Pick another game", go: picker },
    ] });
}

function resume() {
    screen = null;
    render();
    if (Game.started && !Game.ended) Game.movement.startTimers();
    else if (!Game.started && Game.settings.game.readysetgo) Game.movement.startCountdown();
}

function play(mode) {
    lastMode = mode;
    screen = null;
    render();
    Game.menuactions.setGamemode(mode);
    Game.menuactions.saveSettings();
    Game.startGame(); // spawns the first piece and runs the ready-set-go countdown
    const song = Game.sounds.songs[Game.sounds.curSongIdx];
    if (song && song.paused) Game.sounds.startSong();
}

function onKey(e) {
    if (e.key === "Escape") return; // the launcher's
    if (!screen) {
        if (e.key === "Enter" && !e.repeat && Game.started && !Game.ended) { block(e); pause(); }
        return; // everything else is the game's
    }
    block(e);
    if (e.type !== "keydown" || e.repeat) return;
    const n = screen.items.length;
    if (e.key === "ArrowUp") screen.sel = (screen.sel + n - 1) % n;
    else if (e.key === "ArrowDown") screen.sel = (screen.sel + 1) % n;
    else if (PICK.has(e.key.length > 1 ? e.key : e.key.toLowerCase())) { Game.sounds.playSound("menuclick"); screen.items[screen.sel].go(); return; }
    else return;
    Game.sounds.playSound("menutap");
    render();
}

function block(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
}

export function start(game) {
    Game = game;
    const s = Game.settings;
    Object.assign(s.control, KEYS);
    s.game.competitiveMode = true; // each mode's own rules, not custom settings
    // Board size: teti's own setting (percent of its default, 60% of the screen's height).
    // ?board=N overrides it, for trying sizes.
    const board = Number(new URLSearchParams(location.search).get("board")) || BOARD_SIZE;
    Object.assign(s.display, { pauseNoFocus: false, outoffocus: false, boardHeight: board });
    Object.assign(s.volume, { sfxLevel: 600, audioLevel: 300 });
    Game.controls.menuKey = "F7"; // teti's own menus never open
    Game.menuactions.saveSettings();
    dispatchEvent(new Event("resize")); // teti redraws the board at the new size

    // Game over goes to the cabinet's screen instead of teti's dialog; teti's other dialogs stay shut.
    const openModal = Game.modals.openModal.bind(Game.modals);
    Game.modals.openModal = (id) => {
        if (id === "gameEnd") { Game.stopGameTimers(); setTimeout(gameOver); } // teti fills in the result just after opening its dialog
        else if (!["settingsPanel"].includes(id)) openModal(id);
    };

    document.body.appendChild(el);
    addEventListener("keydown", onKey, { capture: true });
    addEventListener("keyup", onKey, { capture: true });
    picker();
}

// For the cabinet's tests: what's on the cabinet screen right now.
window.cabinetState = () => (screen ? { kind: screen.kind, title: screen.title, sel: screen.sel, items: screen.items.map((i) => i.name) } : { kind: "playing", mode: lastMode, lines: Game.stats.clearlines, level: Game.stats.level, score: Game.stats.score });
