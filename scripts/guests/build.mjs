#!/usr/bin/env node
// Builds a guest game's play/ folder from its guest.json, for a game that needs a player
// (D380-D383): a TIC-80 cart in TIC-80's web player, or a homebrew ROM in RetroArch's web
// build. Run on the mini; the result is committed, so a cabinet never downloads anything.
//
//   node scripts/guests/build.mjs GUEST_DIR [--file PATH]
//
// guest.json says what to build:
//   "player":   { "name": "tic80", "script": "lua" }            the cart's language (lua, moon, js, fennel, ...)
//               { "name": "retroarch", "core": "gambatte" }     gambatte (GB, GBC), nestopia (NES), mgba (GBA)
//               "keys": { "select": "c" } changes which cabinet key is which pad button (retroarch only)
//               { "name": "pico8" }                             a PICO-8 cart, exported by Geoff's own PICO-8 (D386)
//   "upstream": { "file": { "name": "game.gb", "url": "...", "sha256": "...", "member": "path/in.zip" } }
// The game's file comes from --file, the cache, or its url, and must match its sha256. The
// players are pinned in players.lock.json, by version and sha256, and cached in
// ~/game-studio-data/guest-players (GSA_GUEST_PLAYERS). Same inputs, same play/ folder.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCK = JSON.parse(readFileSync(join(HERE, "players.lock.json"), "utf8"));
const CACHE = process.env.GSA_GUEST_PLAYERS || join(homedir(), "game-studio-data/guest-players");

const sha256 = (/** @type {string} */ file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const say = (/** @type {string} */ m) => console.log(`[guest] ${m}`);

/** A download checked by its hash, kept in the cache under `name`. @param {string} name @param {string} url @param {string} want */
function fetched(name, url, want) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  if (!existsSync(file)) {
    say(`downloading ${url}`);
    execFileSync("curl", ["-fsSL", "--retry", "3", "-o", `${file}.part`, url], { stdio: "inherit" });
    renameSync(`${file}.part`, file);
  }
  const have = sha256(file);
  if (have !== want) throw new Error(`${file} is ${have}, not the pinned ${want}`);
  return file;
}

/**
 * Which cabinet key is which pad button, by system (D382). The cabinet has A B X Y and START
 * (Z X C V, Enter: D82) and no SELECT, so the two-button systems get SELECT on X.
 * @type {Record<string, Record<string, string>>}
 */
export const KEYS = {
  gb: { a: "z", b: "x", select: "c", start: "enter" },
  gbc: { a: "z", b: "x", select: "c", start: "enter" },
  nes: { a: "z", b: "x", select: "c", start: "enter" },
  gba: { a: "z", b: "x", l: "c", r: "v", start: "enter" },
};

/** The player's files for this guest, checked against the lock. @param {any} player @returns {{ from: string, to: string }[]} */
function playerFiles(player) {
  if (player.name === "tic80") {
    const l = LOCK.tic80;
    const dir = join(CACHE, `tic80-${l.version}`);
    const script = player.script ?? "lua";
    if (!existsSync(join(dir, script, "tic80.js"))) {
      const tarball = fetched(l.name, l.url, l.sha256);
      mkdirSync(dir, { recursive: true });
      execFileSync("tar", ["-xzf", tarball, "-C", dir]);
    }
    if (!existsSync(join(dir, script, `tic80${script}.wasm`))) throw new Error(`TIC-80 ${l.version} has no player for "${script}" carts`);
    return [
      { from: join(dir, script, "tic80.js"), to: "tic80.js" },
      { from: join(dir, script, `tic80${script}.wasm`), to: `tic80${script}.wasm` },
    ];
  }
  if (player.name === "retroarch") {
    const l = LOCK.retroarch;
    const core = l.cores[player.core];
    if (!core) throw new Error(`no pinned core "${player.core}" (have ${Object.keys(l.cores).join(", ")})`);
    const dir = join(CACHE, `retroarch-${l.version}`);
    const files = /** @type {const} */ (["js", "wasm"]).map((ext) => ({ ext, name: `${player.core}_libretro.${ext}` }));
    if (files.some((f) => !existsSync(join(dir, f.name)) || sha256(join(dir, f.name)) !== core[f.ext])) {
      const archive = fetched(l.name, l.url, l.sha256);
      mkdirSync(dir, { recursive: true });
      say(`unpacking the ${player.core} core from ${basename(archive)}`);
      // bsdtar (macOS's tar) reads 7z. The members sit under retroarch/.
      execFileSync("tar", ["-xf", archive, "-C", dir, "--strip-components", "1", ...files.map((f) => `retroarch/${f.name}`)]);
    }
    for (const f of files) if (sha256(join(dir, f.name)) !== core[f.ext]) throw new Error(`${f.name} doesn't match the lock`);
    return files.map((f) => ({ from: join(dir, f.name), to: f.name }));
  }
  if (player.name === "pico8") return []; // PICO-8 writes its own player: see pico8Export
  throw new Error(`guest.json's player.name must be "tic80", "retroarch" or "pico8", not ${JSON.stringify(player.name)}`);
}

/** Where Geoff's own PICO-8 goes on the mini (D386): never in git, never on a cabinet. */
export const PICO8_HOME = process.env.GSA_PICO8_DIR || join(homedir(), "game-studio-data/pico8");

/** Geoff's PICO-8 for macOS, if it's on the mini: PICO8, or the app unzipped in PICO8_HOME. @returns {string | null} */
export function findPico8() {
  if (process.env.PICO8) return existsSync(process.env.PICO8) ? process.env.PICO8 : null;
  const places = ["PICO-8.app/Contents/MacOS/pico8", "pico-8/PICO-8.app/Contents/MacOS/pico8"];
  return places.map((p) => join(PICO8_HOME, p)).find((p) => existsSync(p)) ?? null;
}

/**
 * PICO-8's own exported page, made fit for the cabinet (D389): it starts the cart at once (the kiosk lets
 * sound start without a press), hides PICO-8's start button and its on-screen menu buttons, and fills the
 * screen. Each change is checked, so a different PICO-8 shell fails here rather than on a cabinet.
 * @param {string} html @param {string} title
 */
export function pico8Page(html, title) {
  /** @type {[RegExp, string, string][]} */
  const edits = [
    [/var p8_autoplay = false;/, "var p8_autoplay = true;", "p8_autoplay"],
    [/var p8_allow_mobile_menu = true;/, "var p8_allow_mobile_menu = false;", "p8_allow_mobile_menu"],
    [/<title>[^<]*<\/title>/, `<title>${title.replace(/[<&]/g, "")}</title>`, "the title"],
    [/<head>/i, '<head><script src="cabinet-keys.js"></script>', "<head>"],
    [
      /<\/head>/i,
      "<style>/* the cabinet (D389) */ html,body,#p8_frame_0,#p8_frame,#p8_container,#p8_playarea{background:#000!important} html,body{margin:0;overflow:hidden;cursor:none}" +
        " #p8_start_button,#p8_menu_buttons,#p8_menu_buttons_touch{display:none!important}" +
        " #p8_frame_0,#p8_frame{max-width:none!important;width:100vw!important;max-height:none!important;height:100vh!important}</style></head>",
      "</head>",
    ],
  ];
  let out = html.replace(/^\uFEFF/, "");
  for (const [find, put, what] of edits) {
    if (!find.test(out)) throw new Error(`PICO-8's exported page has no ${what} to change: is this a different PICO-8?`);
    out = out.replace(find, put);
  }
  if (!out.includes('src = "game.js"')) throw new Error("PICO-8's exported page doesn't load game.js");
  return out;
}

/**
 * A PICO-8 cart as a web player: PICO-8's own HTML export, run headless on the mini ("-export", D389).
 * Writes play/game.js (the cart and PICO-8's web player, one file) and play/index.html (its page, made
 * fit by pico8Page). PICO-8 won't export a cart without a label image.
 * @param {string} cart @param {string} play @param {string} title
 */
function pico8Export(cart, play, title) {
  const pico8 = findPico8();
  if (!pico8) {
    throw new Error(
      `PICO-8 isn't on this Mac. It's Geoff's own licensed copy: he downloads the macOS build from lexaloffle.com and unzips it into ${PICO8_HOME}, so that ${join(PICO8_HOME, "PICO-8.app")} exists (or set PICO8 to the pico8 binary). It never goes in git or on a cabinet.`,
    );
  }
  const work = join(CACHE, `pico8-export-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "home"), { recursive: true });
  try {
    const name = /\.p8\.png$/.test(cart) ? "cart.p8.png" : "cart.p8";
    copyFileSync(cart, join(work, name));
    const out = execFileSync(pico8, ["-home", join(work, "home"), "-root_path", work, name, "-export", "game.html"], { cwd: work, encoding: "utf8", timeout: 120000 });
    if (!existsSync(join(work, "game.js")) || !existsSync(join(work, "game.html"))) {
      const why = /capture a label/.test(out) ? ": the cart has no label image (PICO-8 asks for one before it exports)" : `: ${out.trim().split("\n").at(-1)}`;
      throw new Error(`PICO-8 didn't export ${basename(cart)}${why}`);
    }
    copyFileSync(join(work, "game.js"), join(play, "game.js"));
    writeFileSync(join(play, "index.html"), pico8Page(readFileSync(join(work, "game.html"), "utf8"), title));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The game's own file (a cart or a ROM), checked by its hash. @param {any} meta @param {string | null} given */
function gameFile(meta, given) {
  const f = meta.upstream?.file;
  if (!f?.name || !/^[0-9a-f]{64}$/.test(f.sha256 ?? "")) throw new Error("guest.json needs upstream.file with name and sha256");
  let file = given;
  if (!file) {
    if (!f.url) throw new Error("no --file, and upstream.file has no url");
    const cached = `${meta.id}-${f.sha256.slice(0, 12)}-${f.member ? basename(new URL(f.url).pathname) : f.name}`;
    // A zip is pinned by the hash of the member inside it; the zip itself only has to hold it.
    file = f.member ? fetchedAny(cached, f.url) : fetched(cached, f.url, f.sha256);
    if (f.member) {
      const out = join(CACHE, `${meta.id}-${f.sha256.slice(0, 12)}-${f.name}`);
      writeFileSync(out, execFileSync("unzip", ["-p", file, f.member], { maxBuffer: 2 ** 28 }));
      file = out;
    }
  }
  const have = sha256(file);
  if (have !== f.sha256) throw new Error(`${file} is ${have}, not guest.json's ${f.sha256}`);
  return file;
}

/** A download with no hash of its own (a zip whose member is the pinned thing). @param {string} name @param {string} url */
function fetchedAny(name, url) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  if (!existsSync(file)) {
    say(`downloading ${url}`);
    execFileSync("curl", ["-fsSL", "--retry", "3", "-o", `${file}.part`, url], { stdio: "inherit" });
    renameSync(`${file}.part`, file);
  }
  return file;
}

/** NOTICE.md: where every file in play/ comes from, and its licence (D231). @param {any} meta @param {string[]} playFiles */
export function notice(meta, playFiles) {
  const u = meta.upstream ?? {};
  const p = meta.player;
  const l = LOCK[p.name] ?? {};
  const core = p.name === "retroarch" ? l.cores[p.core] : null;
  const game = p.name === "tic80" ? "play/cart.tic" : p.name === "pico8" ? "play/game.js" : "play/rom.bin";
  const rows = [
    `| \`${game}\` | ${meta.title} by ${meta.by}: \`${u.file.name}\`${u.file.url ? ` from ${u.file.url}` : ""}, ${p.name === "pico8" ? "exported as a web player by PICO-8 (the cart and PICO-8's player in one file)" : "unchanged"}, sha256 \`${u.file.sha256}\` | ${u.licence}${p.name === "pico8" ? "; PICO-8's exported player: Lexaloffle's terms for exports (\"You are free to distribute and use exported cartridges and data as you please, provided that you have permission from the cartridge author and contributors\")" : ""} |`,
    p.name === "pico8"
      ? null
      : p.name === "tic80"
      ? `| \`play/tic80.js\`, \`play/tic80${p.script ?? "lua"}.wasm\` | TIC-80 ${l.version}'s web player for ${p.script ?? "lua"} carts, from \`${l.name}\` (${l.url}, sha256 \`${l.sha256}\`), unchanged | ${l.licence} (${l.source}) |`
      : `| \`play/${p.core}_libretro.js\`, \`play/${p.core}_libretro.wasm\` | RetroArch ${l.version}'s web build with the ${p.core} core, from ${l.url} (sha256 \`${l.sha256}\`), unchanged | RetroArch: ${l.licence} (${l.source}); ${p.core}: ${core.licence} (${core.source}) |`,
    `| ${playFiles.filter((f) => /^(index\.html|cabinet-.*\.js|game\.json)$/.test(f)).map((f) => `\`play/${f}\``).join(", ")} | this repo (\`scripts/guests/${p.name}/\`): the page that starts the player with the cabinet's keys | this repo's |`,
  ].filter(Boolean);
  return [
    `# ${meta.title} on the cabinet: where every file comes from`,
    "",
    `Built by \`node scripts/guests/build.mjs\` from this folder's \`guest.json\`; the same inputs give the same files. Nothing loads from the network.`,
    "",
    "| Files | Origin | Licence |",
    "|---|---|---|",
    ...rows,
    "",
    `**The game's licence:** ${u.licence}. ${u.licence_note ?? ""}`.trim(),
    ...(u.licence_source ? ["", `**Where it's stated:** ${u.licence_source}`] : []),
    ...(u.source ? ["", `**Source:** ${u.source}`] : []),
    ...(meta.credits ? ["", `**Credits:** ${meta.credits}`] : []),
    "",
  ].join("\n");
}

/** Build GUEST_DIR/play. @param {string} dir @param {{ file?: string | null }} [o] */
export function build(dir, o = {}) {
  const meta = JSON.parse(readFileSync(join(dir, "guest.json"), "utf8"));
  if (meta.id !== basename(resolve(dir))) throw new Error(`guest.json's id is ${meta.id}, the folder is ${basename(resolve(dir))}`);
  const p = meta.player;
  if (!p?.name) throw new Error("guest.json has no player");
  const src = gameFile(meta, o.file ?? null);
  const files = playerFiles(p);
  const play = join(dir, "play");
  rmSync(play, { recursive: true, force: true });
  mkdirSync(play, { recursive: true });
  for (const f of files) copyFileSync(f.from, join(play, f.to));
  const shim = join(HERE, p.name);
  for (const name of readdirSync(shim)) {
    if (name === "index.html") writeFileSync(join(play, name), readFileSync(join(shim, name), "utf8").replace("@TITLE@", String(meta.title).replace(/[<&]/g, "")));
    else copyFileSync(join(shim, name), join(play, name));
  }
  if (p.name === "tic80") copyFileSync(src, join(play, "cart.tic"));
  else if (p.name === "pico8") pico8Export(src, play, String(meta.title));
  else {
    const system = extname(meta.upstream.file.name).slice(1).toLowerCase();
    if (!LOCK.retroarch.cores[p.core].plays.includes(system)) throw new Error(`the ${p.core} core doesn't play .${system}`);
    copyFileSync(src, join(play, "rom.bin"));
    const keys = Object.fromEntries(Object.entries({ ...KEYS[system], ...(p.keys ?? {}) }).filter(([, k]) => k));
    writeFileSync(join(play, "game.json"), `${JSON.stringify({ id: meta.id, core: p.core, rom: "rom.bin", rom_name: `game.${system}`, keys }, null, 2)}\n`);
  }
  writeFileSync(join(dir, "NOTICE.md"), notice(meta, readdirSync(play).sort()));
  say(`${meta.id}: play/ has ${readdirSync(play).sort().join(", ")}`);
  return meta;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--file");
  const file = at >= 0 ? args.splice(at, 2)[1] : null;
  if (args.length !== 1) {
    console.error("usage: build.mjs GUEST_DIR [--file PATH]");
    process.exit(2);
  }
  try {
    build(resolve(args[0]), { file: file ? resolve(file) : null });
  } catch (e) {
    console.error(`[guest] FAILED: ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }
}
