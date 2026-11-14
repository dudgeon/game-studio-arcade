#!/usr/bin/env node
// Writes the Picade's microSD card on the mini (D250-D252): the pinned Raspberry Pi OS Lite image (the same file
// and SHA-256 as the virtual cabinet), then a seed on its FAT partition, so the Pi boots unattended, joins the home
// Wi-Fi and runs provision.sh with the picade profile.
//
// The card also carries what makes the cabinet ready the moment it's switched on (D320-D323): before touching the
// card, flash reads the Picade's own identity (set up and proven by scripts/cabinet-card/picade-key.sh, D329) and
// copies the Groq key from the virtual cabinet. Nothing about keys is typed at the flash. First boot puts both into
// the cabinet's service.json and wipes them from the card. Do the pre-flash steps in docs/cabinet-bring-up.md first.
//
// Run it yourself, in a Terminal window on the mini (not with Claude Code's `!`, so the Wi-Fi password stays out of chats):
//
//   node scripts/cabinet-card/flash.mjs --list          the disks it could write, and why the others are refused
//   node scripts/cabinet-card/flash.mjs --disk disk4    write the card in disk4, after showing what it erases
//   node scripts/cabinet-card/flash.mjs --check [--day-one FILE]   what the flash gathers, checked against the virtual
//                                                       cabinet (and a day-one file's ids); writes nothing
//
// The Wi-Fi is asked for, unless ~/.config/game-studio-arcade/wifi.json exists: {"ssid": "...", "password": "..."}
// (or "psk"), mode 0600, owned by you (D327).
//
// Options: --country US (Wi-Fi country), --timezone Area/City (default: the mini's), --locale en_US.UTF-8,
// --day-one FILE gives the card Geoff's clean start (D356-D358: a full pot, chosen shelf, hidden makers; never with
// --from-backup). --no-seed leaves the twin's data off the card (D324); --twin-dir DIR takes it from a folder (rehearsals, image files only);
// --from-backup takes it from the mini's hourly backup of the Picade instead of the twin: the card died (D354);
// The identity comes from scripts/cabinet-card/picade-key.sh, run once before (D329); --prepare-identity asks for the
// key here instead (repair). --no-identity writes a card that starts offline; --no-groq leaves Groq off (Moonshine only);
// --cabinet-config-from FILE puts throwaway values on an image file, for rehearsals and tests (never a card).
// --no-speech-on-card leaves speech's wheels and model for first boot to download (D257),
// --wpa3 for a WPA3-only network: its passphrase goes on the card instead of the WPA key (still erased at first boot).
//
//   node scripts/cabinet-card/flash.mjs --image-file OUT.img
//
// writes the same bytes to an image file instead of a card, through the same steps, with no sudo. Tests use it,
// and so can anyone who wants to look at a card before writing one. With no terminal it reads the Wi-Fi name and
// password from stdin, one per line; a card is only ever written from a terminal.
//
// The Wi-Fi password is asked for with no echo and kept in memory. Only its WPA key (a hash of the password and
// the network's name) is written, and only to the card, which replaces it on first boot (D251). Nothing is
// written to the repo, the mini's disk or a log. Needs a clean checkout: the card records the commit it came from.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync, cpSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { makeBundle, makeProvisionTar, miniTimezone } from "../virtual-cabinet/lib.mjs";
import { PICADE_HOST, PICADE_KEY_NAME, picadeDir } from "./picade.mjs";
import { backupDir, cabinetEnd, folderEnd, seed as twinSeed } from "../twin.mjs";
import { IDENTITY_FILE, lockWorkspace, readIdentity } from "./picade-key.mjs";
import { applyDayOne, parseDayOne, planDayOne } from "./day-one.mjs";
import { CARD_CONFIG, SecretsError, cabinetConfigText, configFromFile, groqFromVirtual, identityFromConnect } from "./secrets.mjs";
import { ADMIN, PROFILE, SEED_FILES, confirmPhrase, describe, lockedWheels, wifiFromFile, metaData, networkConfig, profileHostname, refusals, sameDisk, userData, wifiPsk } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const VM_ROOT = process.env.GSA_VM_DIR || join(homedir(), "game-studio-data/vm");
const DL = join(VM_ROOT, "dl"); // the virtual cabinet's downloads: the same pinned files, checked by hash
const CABINET_DIR = picadeDir();
const SSH_DIR = join(CABINET_DIR, "ssh");
const KEY_NAME = PICADE_KEY_NAME;
const BLOCK = 4 * 2 ** 20;

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const flag = (n) => args.includes(n);
const lock = JSON.parse(readFileSync(join(REPO, "cabinet/provision/lock.json"), "utf8"));
const say = (m) => console.log(`[card] ${m}`);
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { encoding: "utf8", maxBuffer: 2 ** 26, ...o });
const plist = (a) => JSON.parse(run("plutil", ["-convert", "json", "-o", "-", "-"], { input: run("diskutil", a) }));
class Stop extends Error {}
const stop = (m) => {
  throw new Stop(m);
};

async function sha256File(path) {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

/** A pinned file from dl/, downloaded if it's missing, and always checked by SHA-256. */
async function pinned({ name, url, sha256: want }) {
  mkdirSync(DL, { recursive: true });
  const path = join(DL, name);
  if (!existsSync(path) || (await sha256File(path)) !== want) {
    say(`downloading ${name}`);
    const r = await fetch(url);
    if (!r.ok) stop(`${url}: HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(/** @type {any} */ (r.body)), createWriteStream(`${path}.part`));
    if ((await sha256File(`${path}.part`)) !== want) stop(`${name} doesn't match its pinned SHA-256`);
    run("mv", [`${path}.part`, path]);
  }
  say(`ok ${name} ${want.slice(0, 12)}`);
  return path;
}

// ---- The disk ----

function bootWholeDisks() {
  const out = new Set();
  for (const vol of ["/", "/System/Volumes/Data"]) {
    try {
      const i = plist(["info", "-plist", vol]);
      if (i.ParentWholeDisk) out.add(i.ParentWholeDisk);
      for (const s of i.APFSPhysicalStores ?? []) {
        const store = typeof s === "string" ? s : s.APFSPhysicalStore;
        if (store) out.add(plist(["info", "-plist", store]).ParentWholeDisk);
      }
    } catch {
      /* a volume that isn't there can't be written to */
    }
  }
  return [...out];
}

const diskInfo = (id) => plist(["info", "-plist", id]);
function partitionsOf(id) {
  const l = plist(["list", "-plist", id]);
  return l.AllDisksAndPartitions?.[0]?.Partitions ?? [];
}

function listDisks() {
  const all = plist(["list", "-plist", "physical"]).WholeDisks ?? [];
  const boot = bootWholeDisks();
  if (!all.length) say("no physical disks found");
  for (const id of all) {
    const info = diskInfo(id);
    const why = refusals(info, { bootWholeDisks: boot });
    console.log(describe(info, partitionsOf(id)).join("\n"));
    console.log(why.length ? `  refused: ${why.join("; ")}\n` : `  can be written: node scripts/cabinet-card/flash.mjs --disk ${id}\n`);
  }
}

// ---- Asking ----

/** One line from the terminal, with or without echo. Prompts go to the terminal, never stdout. */
function ask(prompt, { secret = false } = {}) {
  const r = spawnSync("/bin/bash", ["-c", `printf '%s' "$1" >/dev/tty; IFS= read -r${secret ? "s" : ""} line </dev/tty; s=$?; ${secret ? "printf '\\n' >/dev/tty;" : ""} printf '%s' "$line"; exit $s`, "ask", prompt], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) stop("no answer");
  return r.stdout;
}

/** The WPA key, or with --wpa3 the checked passphrase itself: WPA3-only networks can't use a precomputed key. */
function keyFor(ssid, pass) {
  const psk = wifiPsk(ssid, pass);
  return flag("--wpa3") ? pass : psk;
}

/** An optional Wi-Fi file on the mini (D327); GSA_WIFI_FILE moves it, for tests. */
const WIFI_FILE = process.env.GSA_WIFI_FILE || join(homedir(), ".config/game-studio-arcade/wifi.json");
function wifiFromConfig() {
  let w;
  try {
    w = wifiFromFile(WIFI_FILE, { uid: process.getuid?.() ?? -1, stat: (f) => statSync(f), read: (f) => readFileSync(f, "utf8") });
  } catch (e) {
    stop(`the Wi-Fi file: ${/** @type {Error} */ (e).message}`);
  }
  if (flag("--wpa3")) stop("--wpa3 needs the password typed: the Wi-Fi file holds only its WPA key. Move the file aside for this flash.");
  say(`Wi-Fi: "${w.ssid}", from ${WIFI_FILE}`);
  return w;
}

/** The Wi-Fi: stdin for an image file with no terminal (tests), else the file if there is one, else asked. */
function wifiNow() {
  if (!opt("--disk") && !process.stdin.isTTY) return wifiFromStdin();
  if (existsSync(WIFI_FILE)) return wifiFromConfig();
  return wifiFromTerminal();
}

function wifiFromTerminal() {
  const ssid = ask("Home Wi-Fi network name: ");
  const pass = ask("Its password (nothing will show): ", { secret: true });
  return { ssid, psk: keyFor(ssid, pass) };
}

function wifiFromStdin() {
  const [ssid, pass] = readFileSync(0, "utf8").split("\n");
  if (!ssid || pass === undefined) stop("with no terminal, stdin must hold the Wi-Fi name and password, one per line");
  return { ssid, psk: keyFor(ssid, pass) };
}


// ---- What goes on the card ----

/** The cabinet's own SSH key on the mini, never one of the mini's existing keys (D123, D254). */
function cabinetKey() {
  mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
  const key = join(SSH_DIR, KEY_NAME);
  if (!existsSync(key)) run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", `${PROFILE}-cabinet-admin`, "-f", key]);
  return readFileSync(`${key}.pub`, "utf8").trim();
}

function repoCommit() {
  const dirty = run("git", ["status", "--porcelain"], { cwd: REPO }).trim();
  if (dirty && !flag("--allow-dirty")) stop("the checkout has changes. Flash from a clean checkout of main (or pass --allow-dirty to try one out).");
  return `${run("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO }).trim()}${dirty ? "-dirty" : ""}`;
}

/** The seed folder, built on the mini: the same contents a virtual cabinet's seed has, for the picade profile (D143). */
function buildSeed(dir, { hostname, authorizedKey, nodeTarball, commit, timezone }) {
  const prov = join(REPO, "cabinet/provision");
  makeProvisionTar(REPO, join(dir, "provision.tar.gz"));
  say(`bundle.tar.gz: ${makeBundle(REPO, join(dir, "bundle.tar.gz"))} files`);
  writeFileSync(join(dir, "commit"), `${commit}\n`);
  cpSync(nodeTarball, join(dir, lock.node.name));
  cpSync(join(prov, "files/firstboot.sh"), join(dir, "firstboot.sh"));
  cpSync(join(prov, "files/arcade-seed.service"), join(dir, "arcade-seed.service"));
  writeFileSync(join(dir, "profile"), `${PROFILE}\n`);
  writeFileSync(join(dir, "hostname"), `${hostname}\n`);
  writeFileSync(join(dir, "timezone"), `${timezone}\n`); // provision keeps it (D246), as cloud-init sets it first
  writeFileSync(join(dir, "authorized_keys"), `${authorizedKey}\n`);
  for (const f of [...SEED_FILES, lock.node.name]) if (!existsSync(join(dir, f))) stop(`the seed is missing ${f}`);
}

/** A file into the cache once, checked by SHA-256 every time. */
async function cached(dir, name, url, want) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  if (existsSync(path) && (await sha256File(path)) === want) return path;
  const r = await fetch(url);
  if (!r.ok) stop(`${url}: HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(/** @type {any} */ (r.body)), createWriteStream(`${path}.part`));
  if ((await sha256File(`${path}.part`)) !== want) stop(`${name} doesn't match its pinned SHA-256`);
  run("mv", [`${path}.part`, path]);
  return path;
}

/**
 * Speech's wheels and model on the card (D257), so first boot needn't download them. speech.sh already reads
 * $PAYLOAD/speech/wheels and speech/models; each file is the one its lock pins, by SHA-256.
 */
async function speechPayload(seedDir) {
  const src = join(REPO, "cabinet/service/speech");
  const cache = join(DL, "speech");
  const wheels = join(seedDir, "speech/wheels");
  const models = join(seedDir, "speech/models");
  mkdirSync(wheels, { recursive: true });
  mkdirSync(models, { recursive: true });
  for (const w of lockedWheels(readFileSync(join(src, "requirements.lock"), "utf8"))) {
    const r = await fetch(`https://pypi.org/pypi/${w.name}/${w.version}/json`);
    if (!r.ok) stop(`PyPI: ${w.name} ${w.version}: HTTP ${r.status}`);
    const file = (/** @type {any} */ (await r.json())).urls.find((u) => u.digests?.sha256 === w.sha256);
    if (!file) stop(`PyPI has no ${w.name} ${w.version} file with the pinned hash`);
    cpSync(await cached(join(cache, "wheels"), file.filename, file.url, w.sha256), join(wheels, file.filename));
  }
  const m = JSON.parse(readFileSync(join(src, "models.lock.json"), "utf8"));
  for (const [name, sha] of Object.entries(m.files)) cpSync(await cached(join(cache, "models", m.dir), name, `${m.base_url}/${name}`, String(sha)), join(models, name));
  say(`speech: ${readdirSync(wheels).length} wheels and the ${m.arch} model on the card`);
}

/** Bytes in a folder, all the way down. */
function folderBytes(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? folderBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}

/**
 * The twin's data at flash time, for the card (D324): the twin's own seed (D295), into an empty folder standing in
 * for the Picade, so the same rules apply (D291, D292: never keys, config or Manager token). Packed for the card.
 * @param {string} work a private temp folder, removed after the flash
 */
function twinSnapshot(work) {
  const dir = join(work, "twin-data");
  mkdirSync(dir, { mode: 0o700 });
  const from = opt("--twin-dir");
  if (from && opt("--disk")) stop("--twin-dir is for rehearsals and tests: image files only, never a card.");
  // A dead card is rebuilt from the backup folder: a pure copy of the Picade, without the twin's own test makes (D354).
  if (flag("--from-backup") && !existsSync(join(backupDir(), "carts"))) stop(`--from-backup: there's no backup at ${backupDir()} (scripts/twin-backup/run.mjs makes it).`);
  const twin = from ? folderEnd(resolve(from)) : flag("--from-backup") ? folderEnd(backupDir()) : cabinetEnd(undefined);
  let r;
  try {
    r = twinSeed(folderEnd(dir), twin, new Date());
  } catch (e) {
    stop(`couldn't take the twin's data for the card: ${/** @type {Error} */ (e).message}. Or flash with --no-seed.`);
  }
  // D356-D358: Geoff's clean start, on this copy only. Never on a restore: a rebuilt card comes back as it was (D354).
  const dayOne = opt("--day-one");
  if (dayOne) {
    if (flag("--from-backup")) stop("--day-one is a clean start; --from-backup brings a card back as it was. Use one or the other.");
    const spec = parseDayOne(readFileSync(resolve(dayOne), "utf8"));
    const guestIds = existsSync(join(REPO, "guests")) ? readdirSync(join(REPO, "guests")).filter((g) => existsSync(join(REPO, "guests", g, "guest.json"))) : [];
    const d = applyDayOne(dir, spec, { guestIds });
    if (d.unknownGames.length || d.unknownMakers.length) {
      stop(`the day-one file names ${[...d.unknownGames.map((g) => `game "${g}"`), ...d.unknownMakers.map((m) => `maker "${m}"`)].join(", ")}, which the twin's data doesn't have. Check the ids; nothing was written.`);
    }
    say(`day-one: pot ${spec.pot === "full" ? "full (the twin's test ledger left off)" : "as it is"}; ${d.hidden.length} makers off "Who's making?" (${d.hidden.join(", ") || "none"}); ${d.shelf ? `${d.shelf.length} games on the shelf (${d.shelf.join(", ")}), ${d.offShelf.length} carried off it` : "shelf as it is"}`);
  }
  const tgz = join(work, "twin-data.tar.gz");
  run("tar", ["-czf", tgz, "--no-xattrs", "--no-mac-metadata", "-C", dir, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  rmSync(dir, { recursive: true, force: true });
  say(`the twin's data: ${r.copied} files, ${(statSync(tgz).size / 2 ** 20).toFixed(1)} MiB, from ${twin.name}`);
  return tgz;
}

// ---- Writing ----

/** xz -dc image | [sudo] dd of=target. Returns the image's bytes and SHA-256, hashed on the way through. */
async function writeImage(image, target, { sudo }) {
  const h = createHash("sha256");
  let bytes = 0;
  const xz = spawn("xz", ["-dc", image], { stdio: ["ignore", "pipe", "inherit"] });
  const ddArgs = [`of=${target}`, `bs=${BLOCK}`];
  const dd = sudo ? spawn("sudo", ["dd", ...ddArgs], { stdio: ["pipe", "ignore", "pipe"] }) : spawn("dd", ddArgs, { stdio: ["pipe", "ignore", "pipe"] });
  let ddErr = "";
  dd.stderr.on("data", (b) => (ddErr += b));
  const ddDone = new Promise((res) => dd.on("close", res));
  const tap = new Transform({
    transform(chunk, _e, cb) {
      h.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  await pipeline(xz.stdout, tap, dd.stdin);
  const code = await ddDone;
  if (code !== 0) stop(`dd failed: ${ddErr.trim().split("\n").pop()}`);
  return { bytes, sha256: h.digest("hex") };
}

/** Read the first `bytes` back from the target and hash them. */
async function readBack(target, bytes, { sudo }) {
  if (bytes % BLOCK) stop("the image isn't a whole number of 4 MiB blocks");
  const a = ["dd", `if=${target}`, `bs=${BLOCK}`, `count=${bytes / BLOCK}`];
  const dd = sudo ? spawn("sudo", a, { stdio: ["ignore", "pipe", "ignore"] }) : spawn(a[0], a.slice(1), { stdio: ["ignore", "pipe", "ignore"] });
  const h = createHash("sha256");
  await pipeline(dd.stdout, h);
  return h.digest("hex");
}

/** The FAT partition of what was written, mounted out of Finder's way. Returns its mount point and how to let go. */
function mountBoot(target, { file }) {
  if (file) {
    const root = mkdtempSync(join(tmpdir(), "card-mnt-"));
    const out = run("hdiutil", ["attach", "-imagekey", "diskimage-class=CRawDiskImage", "-nobrowse", "-mountrandom", root, "-plist", target]);
    const mounts = [...out.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]);
    const dev = out.match(/<key>dev-entry<\/key>\s*<string>(\/dev\/disk\d+)<\/string>/)?.[1];
    if (mounts.length !== 1) {
      if (dev) spawnSync("hdiutil", ["detach", "-force", dev]);
      stop(`expected only the FAT partition to mount, got: ${mounts.join(", ") || "none"}`);
    }
    return { mount: mounts[0], release: () => (run("hdiutil", ["detach", dev ?? mounts[0]]), rmSync(root, { recursive: true, force: true })) };
  }
  const disk = target.replace("/dev/rdisk", "disk");
  const part = `${disk}s1`;
  let info = diskInfo(part);
  if (!info.MountPoint) {
    run("diskutil", ["mount", part]);
    info = diskInfo(part);
  }
  if (!info.MountPoint || !/^(MS-DOS|FAT|msdos)/i.test(`${info.FilesystemType ?? ""}${info.FilesystemName ?? ""}`)) stop(`${part} didn't mount as FAT`);
  return { mount: info.MountPoint, release: () => run("diskutil", ["eject", disk]) };
}

/** Put the seed and the cloud-init files on the FAT, and check each one by reading it back. */
async function writeBoot(mount, seedDir, cloud) {
  const seed = join(mount, "seed");
  rmSync(seed, { recursive: true, force: true });
  const free = Number(run("df", ["-k", mount]).trim().split("\n").pop()?.split(/\s+/)[3]) * 1024;
  const need = folderBytes(seedDir) + 2 * 2 ** 20;
  if (!(free > need)) stop(`the seed needs ${(need / 2 ** 20).toFixed(0)} MiB and the boot partition has ${(free / 2 ** 20).toFixed(0)} MiB free. Try --no-speech-on-card.`);
  cpSync(seedDir, seed, { recursive: true });
  const want = new Map();
  const list = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(d, e.name)) : [join(d, e.name)]));
  for (const f of list(seedDir)) want.set(join(seed, f.slice(seedDir.length + 1)), await sha256File(f));
  for (const [name, text] of Object.entries(cloud)) {
    const path = join(mount, name);
    const fd = openSync(path, "w");
    writeSync(fd, text);
    closeSync(fd);
    want.set(path, createHash("sha256").update(text).digest("hex"));
  }
  // macOS leaves AppleDouble files beside anything with extended attributes on FAT.
  // Only the card's top level and our seed: macOS makes its own locked folders on a mounted card (.Spotlight-V100,
  // .fseventsd), which aren't ours to read. The first real flash stopped on one (2026-11-14).
  const sweep = (dir, deep) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith("._")) rmSync(join(dir, e.name), { force: true });
      else if (deep && e.isDirectory()) sweep(join(dir, e.name), true);
    }
  };
  sweep(mount, false);
  sweep(seed, true);
  run("sync", []);
  for (const [path, sha] of want) if ((await sha256File(path)) !== sha) stop(`${path} didn't read back as written`);
  say(`seed and cloud-init files written and read back (${want.size} files)`);
}

// ---- Main ----

/**
 * D328: the flash's gather steps against the live virtual cabinet, writing nothing anywhere and printing no secret.
 * The Groq key: exit code and shape only. The twin: what seed() checks first (replay data, a make running), read
 * with the helper's read-only info and manifest, never seed() itself, which records the seed on the twin.
 */
async function check() {
  let ok = true;
  const line = (good, what) => {
    console.log(`  ${good ? "ok  " : "NO  "} ${what}`);
    if (!good) ok = false;
  };
  console.log("Checking what the flash will gather (nothing is written):");
  if (existsSync(WIFI_FILE)) {
    try {
      const w = wifiFromFile(WIFI_FILE, { uid: process.getuid?.() ?? -1, stat: (f) => statSync(f), read: (f) => readFileSync(f, "utf8") });
      line(true, `Wi-Fi: "${w.ssid}" from ${WIFI_FILE}`);
    } catch (e) {
      line(false, `Wi-Fi file: ${/** @type {Error} */ (e).message}`);
    }
  } else line(true, "Wi-Fi: asked at the flash (no Wi-Fi file)");
  try {
    const key = await groqFromVirtual({ drive: join(REPO, "cabinet/vm/drive") });
    line(/^gsk_[A-Za-z0-9_]+$/.test(key), "Groq key: the virtual cabinet answered with a key-shaped value (not shown)");
  } catch (e) {
    line(false, `Groq key: ${/** @type {Error} */ (e).message}`);
  }
  try {
    const twin = cabinetEnd(undefined);
    const ti = twin.call("info");
    const tm = twin.call("manifest");
    const files = Object.keys(tm.files);
    const carts = new Set(files.map((r) => r.match(/^carts\/([^/.][^/]*)\/cart\.json$/)?.[1]).filter(Boolean));
    line(!ti.replay.length, ti.replay.length ? `twin data: replay data (${ti.replay.join(", ")}) can't go to a live cabinet` : "twin data: no replay data");
    line(!ti.makeInFlight, ti.makeInFlight ? "twin data: a make is running or still to be collected on the virtual cabinet; flash once it's done" : "twin data: no make running");
    line(files.length > 0, `twin data: ${files.length} files to copy, ${carts.size} games, release ${ti.release}`);
    // D356: a day-one file, checked against the live twin's games and makers with the same planner the flash uses.
    const dayOne = opt("--day-one");
    if (dayOne) {
      const spec = parseDayOne(readFileSync(resolve(dayOne), "utf8"));
      const rels = [...carts].map((id) => `carts/${id}/cart.json`);
      const got = twin.call("read", { files: [...rels, "makers.json"].filter((r) => tm.files[r]).map((rel) => ({ rel })) });
      const json = (/** @type {string} */ rel) => {
        try {
          return JSON.parse(Buffer.from(got[rel].b64, "base64").toString("utf8"));
        } catch {
          return null;
        }
      };
      const guestIds = existsSync(join(REPO, "guests")) ? readdirSync(join(REPO, "guests")).filter((g) => existsSync(join(REPO, "guests", g, "guest.json"))) : [];
      const plan = planDayOne(spec, {
        carts: [...carts].map((id) => ({ id, branch: json(`carts/${id}/cart.json`)?.branch })),
        makerIds: (json("makers.json") ?? []).map((/** @type {any} */ m) => m.id),
        guestIds,
      });
      line(!plan.unknownGames.length, plan.unknownGames.length ? `day-one: no such game on the twin: ${plan.unknownGames.join(", ")}` : `day-one: on the shelf, ${plan.shelf?.length ?? "all"} lines: ${plan.shelf?.join(", ") ?? "(no shelf list)"}`);
      if (plan.shelf) console.log(`         off the shelf (carried, marked), ${plan.offShelf.length} lines: ${plan.offShelf.join(", ") || "none"}`);
      line(!plan.unknownMakers.length, plan.unknownMakers.length ? `day-one: no such maker on the twin: ${plan.unknownMakers.join(", ")}` : `day-one: off "Who's making?": ${plan.hidden.join(", ") || "nobody"}`);
      const ledger = tm.files["logs/coin_ledger.jsonl"];
      line(true, `day-one: pot ${spec.pot === "full" ? `full (the twin's ledger${ledger ? `, ${ledger.size} bytes,` : ""} stays on the mini)` : "as it is"}`);
    }
  } catch (e) {
    line(false, `twin data: ${/** @type {Error} */ (e).message}`);
  }
  for (const p of [lock.image, lock.node]) {
    const f = join(DL, p.name);
    const here = existsSync(f);
    const match = here && (await sha256File(f)) === p.sha256;
    line(!here || match, !here ? `${p.name}: not downloaded yet (the flash fetches it)` : match ? `${p.name}: here, SHA-256 matches its pin` : `${p.name}: here, but its SHA-256 doesn't match the pin (the flash fetches it again)`);
  }
  try {
    const id = readIdentity(IDENTITY_FILE);
    line(true, `the Picade's identity: ${IDENTITY_FILE}, agent version ${id.agent_version ?? "?"}, workspace ${lockWorkspace() ?? "? (no claude-lock.arcade.json)"} (scripts/cabinet-card/picade-key.sh --check proves it live)`);
  } catch (e) {
    line(false, `the Picade's identity: ${/** @type {Error} */ (e).message}`);
  }
  console.log(ok ? "Ready to flash." : "Not ready: see the NO lines.");
  process.exitCode = ok ? 0 : 1;
}

async function main() {
  if (flag("--list")) return listDisks();
  if (flag("--check")) return check();
  const diskId = opt("--disk");
  const imageFile = opt("--image-file");
  if (!!diskId === !!imageFile) stop("name one target: --disk diskN (a card), or --image-file PATH. --list shows the disks.");
  const country = opt("--country", "US");
  const timezone = opt("--timezone", miniTimezone());
  const locale = opt("--locale", "en_US.UTF-8");
  const hostname = profileHostname(readFileSync(join(REPO, "cabinet/provision/profiles/picade.sh"), "utf8"));

  // 1. The target, checked before anything is asked or built.
  let target;
  let confirmed = null;
  if (diskId) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) stop("write a card from a Terminal window on the mini, so its questions can be answered.");
    const info = diskInfo(diskId);
    const why = refusals(info, { bootWholeDisks: bootWholeDisks() });
    if (why.length) stop(`won't write ${diskId}: ${why.join("; ")}`);
    console.log("\nThis erases everything on:\n");
    console.log(describe(info, partitionsOf(diskId)).join("\n"));
    const phrase = confirmPhrase(info);
    console.log(`\nIt becomes the cabinet's card: Raspberry Pi OS Lite ${lock.image.name}, hostname ${hostname}, profile ${PROFILE}.`);
    // D394: a wrapper that already names this exact card (disk and size) can pass the phrase; any other card stops.
    const given = opt("--erase-confirmed");
    if (given !== undefined) {
      if (given !== phrase) stop(`--erase-confirmed says "${given}", but this card is "${phrase}". Nothing written.`);
      say(`erasing ${diskId} (${phrase.split(" ").pop()}), as confirmed`);
    } else {
      const typed = ask(`Type "${phrase}" to erase it, or anything else to stop: `);
      if (typed.trim() !== phrase) stop("nothing written.");
    }
    confirmed = info;
    target = `/dev/r${diskId}`;
  } else {
    target = resolve(imageFile);
    if (existsSync(target)) stop(`${target} exists; name a new file`);
  }

  // 2. Wi-Fi, in memory only.
  const wifi = wifiNow();

  // 3. What makes the cabinet ready the moment it's switched on (D320-D323): its own identity and the Groq key.
  // Gathered before the card is touched, so a stop here leaves the card as it was. In memory only.
  let cardConfig = null;
  const fromFile = opt("--cabinet-config-from");
  if (fromFile) {
    if (diskId) stop("--cabinet-config-from is for rehearsals and tests: image files only, never a card.");
    cardConfig = configFromFile(fromFile);
  } else if (!flag("--no-identity")) {
    // D329: the identity was set up and proven before the flash by picade-key.sh, so the flash asks nothing about keys.
    // --prepare-identity is the repair path: connect-cabinet.sh --prepare asks for the key here instead (D320).
    let identity;
    if (flag("--prepare-identity")) {
      if (!diskId && !process.stdin.isTTY) stop("--prepare-identity needs a terminal to paste the Picade's key in.");
      say("the Picade's own identity: connect-cabinet.sh asks for its key (D320)");
      identity = await identityFromConnect({
        script: join(REPO, "scripts/virtual-cabinet/connect-cabinet.sh"),
        env: { ...process.env, CABINET: "arcade", ARCADE_HOST: PICADE_HOST, ARCADE_SSH_DIR: join(CABINET_DIR, "ssh"), ARCADE_SSH_KEY_NAME: KEY_NAME, GSA_VM_DIR: CABINET_DIR },
      });
    } else {
      identity = readIdentity(IDENTITY_FILE);
      say(`the Picade's own identity: from ${IDENTITY_FILE} (agent version ${identity.agent_version ?? "?"}, workspace ${lockWorkspace() ?? "?"})`);
    }
    const groq = flag("--no-groq") ? null : await groqFromVirtual({ drive: join(REPO, "cabinet/vm/drive") });
    if (groq) say("the Groq key: copied from the virtual cabinet, held in memory");
    cardConfig = cabinetConfigText({ identity, groq });
  }
  if (!cardConfig) say("no identity on this card: the cabinet starts offline until connect-picade.sh (D252)");
  // The twin's data, also before the card is touched (D324). Geoff's yes, 2026-11-13.
  const snapWork = mkdtempSync(join(tmpdir(), "card-twin-"));
  // The kids' data never outlives the flash on the mini, whatever stops it.
  process.on("exit", () => rmSync(snapWork, { recursive: true, force: true }));
  const twinData = flag("--no-seed") ? null : twinSnapshot(snapWork);

  // 4. The pinned files and the seed, built in a temp folder that's removed at the end.
  const commit = repoCommit();
  const image = await pinned(lock.image);
  const nodeTarball = await pinned(lock.node);
  const authorizedKey = cabinetKey();
  const work = mkdtempSync(join(tmpdir(), "card-seed-"));
  try {
    const seedDir = join(work, "seed");
    mkdirSync(seedDir);
    buildSeed(seedDir, { hostname, authorizedKey, nodeTarball, commit, timezone });
    if (!flag("--no-speech-on-card")) await speechPayload(seedDir);
    if (twinData) cpSync(twinData, join(seedDir, "twin-data.tar.gz"));
    rmSync(snapWork, { recursive: true, force: true });
    say(`seed: ${(folderBytes(seedDir) / 2 ** 20).toFixed(0)} MiB`);
    const instance = `${hostname}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
    const cloud = {
      "user-data": userData({ hostname, timezone, locale, authorizedKey, country }),
      "meta-data": metaData(instance),
      "network-config": networkConfig({ ssid: wifi.ssid, psk: wifi.psk, country }),
    };
    wifi.psk = "";
    // Straight onto the card's FAT with the rest, never into the seed folder on the mini's disk (D322).
    if (cardConfig) cloud[CARD_CONFIG] = cardConfig;
    cardConfig = null;

    // 5. Write, read back, seed.
    if (confirmed) {
      if (!sameDisk(confirmed, diskInfo(diskId))) stop(`${diskId} isn't the card you confirmed any more. Nothing written.`);
      run("diskutil", ["unmountDisk", diskId]);
      say(`writing ${lock.image.name} to ${diskId}; sudo asks for the mini's password`);
    } else {
      say(`writing ${lock.image.name} to ${target}`);
    }
    const sudo = Boolean(confirmed);
    const written = await writeImage(image, target, { sudo });
    say(`wrote ${(written.bytes / 2 ** 30).toFixed(2)} GiB; reading it back`);
    if ((await readBack(target, written.bytes, { sudo })) !== written.sha256) stop("the card didn't read back as written. Try another card.");
    say("read back ok");
    if (confirmed) spawnSync("diskutil", ["mountDisk", diskId], { stdio: "ignore" });
    const boot = mountBoot(target, { file: !confirmed });
    try {
      await writeBoot(boot.mount, seedDir, cloud);
    } finally {
      boot.release();
    }
    for (const k of Object.keys(cloud)) cloud[k] = "";
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // 6. A new card is a new cabinet to SSH: forget the old host keys.
  if (confirmed) rmSync(join(SSH_DIR, "known_hosts"), { force: true });
  say(confirmed ? `done: ${diskId} is ejected. Put it in the Pi and follow docs/cabinet-bring-up.md, step 3.` : `done: ${target}`);
  say(`admin login once it's up: ARCADE_HOST=${hostname}.local ARCADE_SSH_DIR=${SSH_DIR} ARCADE_SSH_KEY_NAME=${KEY_NAME} cabinet/vm/drive ssh (user ${ADMIN})`);
}

main().catch((err) => {
  console.error(`[card] ${err instanceof Stop || err instanceof SecretsError ? "Stopped" : "FAILED"}: ${err.message}`);
  process.exit(1);
});
