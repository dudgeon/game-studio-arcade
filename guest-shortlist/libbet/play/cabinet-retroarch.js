// A homebrew ROM in RetroArch's web build, on the cabinet (D382). game.json says which
// libretro core plays it and which cabinet keys are which pad buttons. RetroArch gets its
// own small config: the pad on the cabinet's keys (D82), and none of its hotkeys or menus,
// so nothing a kid presses can leave the game. Escape never gets here: the cabinet's own
// script takes it and goes back to the shelf (D232).
// RetroArch asks the browser to keep the screen awake and doesn't catch a "no". The kiosk
// never sleeps, so the answer is always a quiet yes.
try {
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => ({ release: async () => {}, addEventListener() {}, removeEventListener() {} }) } });
} catch {}

const canvas =/** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const game = await (await fetch("game.json")).json();

const HOME = "/home/web_user/retroarch";
const USER = `${HOME}/userdata`;
const SAVES = `${USER}/saves`;
const CORE = `${HOME}/cores/${game.core}_libretro.core`;
const ROM = `${USER}/content/${game.rom_name}`;
/** This game's battery save, kept in the page's own storage between plays. */
const SAVE_KEY = `gsa-save:${game.id}`;

const PAD = ["up", "down", "left", "right", "a", "b", "x", "y", "l", "r", "start", "select"];
const HOTKEYS = [
  "menu_toggle", "exit_emulator", "toggle_fullscreen", "toggle_fast_forward", "hold_fast_forward", "toggle_slowmotion",
  "hold_slowmotion", "rewind", "pause_toggle", "frame_advance", "reset", "save_state", "load_state", "state_slot_increase",
  "state_slot_decrease", "screenshot", "mute", "volume_up", "volume_down", "shader_next", "shader_prev", "cheat_toggle",
  "grab_mouse_toggle", "game_focus_toggle", "fps_toggle", "desktop_menu_toggle", "recording_toggle", "streaming_toggle",
  "netplay_game_watch", "enable_hotkey", "osk_toggle", "ai_service", "close_content", "disk_eject_toggle",
];
const keys = { up: "up", down: "down", left: "left", right: "right", ...game.keys };
const config = [
  'input_driver = "rwebinput"',
  'input_joypad_driver = "null"',
  "input_autodetect_enable = false",
  ...PAD.map((b) => `input_player1_${b} = "${keys[b] ?? "nul"}"`),
  ...PAD.flatMap((b) => [`input_player1_${b}_btn = "nul"`, `input_player1_${b}_axis = "nul"`]),
  ...HOTKEYS.map((h) => `input_${h} = "nul"`),
  'menu_driver = "rgui"',
  "menu_show_start_screen = false",
  "config_save_on_exit = false",
  "pause_nonactive = false",
  "video_font_enable = false",
  "video_smooth = false",
  "video_scale_integer = true",
  "video_vsync = true",
  "audio_enable = true",
  "savestate_auto_save = false",
  "savestate_auto_load = false",
  `savefile_directory = "${SAVES}"`,
  "sort_savefiles_enable = false",
  "sort_savefiles_by_content_enable = false",
  "rewind_enable = false",
  "fps_show = false",
  "notification_show_autoconfig = false",
  "notification_show_remap_load = false",
  "notification_show_config_override_load = false",
  "",
].join("\n");

const [{ default: core }, rom] = await Promise.all([import(`./${game.core}_libretro.js`), fetch(game.rom).then((r) => r.arrayBuffer())]);
const mod = await core({
  noInitialRun: true,
  canvas,
  corePath: CORE,
  preRun: [(/** @type {any} */ m) => (m.ENV.LIBRARY_PATH = CORE)],
  print: () => {},
  printErr: () => {},
});
const FS = mod.FS;
for (const d of [`${HOME}/cores`, `${USER}/content`, SAVES, `${USER}/states`, `${USER}/system`]) FS.mkdirTree(d);
FS.writeFile(CORE, new Uint8Array());
FS.writeFile(`${USER}/retroarch.cfg`, config);
FS.writeFile(ROM, new Uint8Array(rom));

// Battery saves: back in before the game starts, and kept every few seconds while it plays.
const fromB64 = (/** @type {string} */ s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (/** @type {Uint8Array} */ b) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));
try {
  const kept = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "{}");
  for (const [name, data] of Object.entries(kept)) FS.writeFile(`${SAVES}/${name}`, fromB64(String(data)));
} catch {}
let last = "";
const keepSaves = () => {
  try {
    mod._cmd_savefiles?.();
    /** @type {Record<string, string>} */
    const out = {};
    for (const name of FS.readdir(SAVES)) if (!name.startsWith(".")) out[name] = toB64(FS.readFile(`${SAVES}/${name}`));
    const json = JSON.stringify(out);
    if (json !== last && json !== "{}") localStorage.setItem(SAVE_KEY, (last = json));
  } catch {}
};
setInterval(keepSaves, 5000);

mod.callMain(["-c", `${USER}/retroarch.cfg`, ROM]);
canvas.focus();
