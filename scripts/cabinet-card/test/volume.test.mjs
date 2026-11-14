// D420: every card starts quiet (30%, stored), a stored level is never reset, and the cabinet's own steps stop
// at the cap. arcade-volume runs here against stand-ins for amixer, aplay and alsactl.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TOOL = path.join(REPO, "cabinet/provision/files/arcade-volume");
const PROFILE = path.join(REPO, "cabinet/provision/profiles/picade.sh");

/** A pretend cabinet: `level` holds the control's percent (no file: the control isn't there until aplay runs). */
function cabinet({ card = true, level = null, stored = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vol-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const levelFile = path.join(root, "level");
  const state = path.join(root, "asound.state");
  const sh = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  sh("aplay", card ? `if [ "$1" = -l ]; then echo "card 0: sndrpihifiberry [snd_rpi_hifiberry_dac]"; exit 0; fi\n[ -f "${levelFile}" ] || echo 100 > "${levelFile}"` : `[ "$1" = -l ] && echo "card 1: Mic [USB Mic]"; exit 0`);
  sh("amixer", `[ -f "${levelFile}" ] || exit 1\ncase "$*" in\n  *sget*) echo "  Mono: Playback 77 [$(cat "${levelFile}")%]" ;;\n  *sset*) for a; do v="$a"; done; echo "\${v%\\%}" > "${levelFile}" ;;\nesac`);
  sh("alsactl", `printf "state.Mic {\\n\\tcontrol.1 {\\n\\t\\tname 'PCM Playback Volume'\\n\\t}\\n}\\nstate.sndrpihifiberry {\\n\\tcontrol.1 {\\n\\t\\tiface MIXER\\n\\t\\tname PCM\\n\\t\\tvalue $(cat "${levelFile}")\\n\\t}\\n}\\n" > "${state}"`);
  sh("timeout", `shift; exec "$@"`);
  if (level != null) fs.writeFileSync(levelFile, `${level}\n`);
  if (stored != null) fs.writeFileSync(state, stored);
  const run = (...args) => {
    const r = spawnSync("/bin/bash", [TOOL, ...args], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, ARCADE_ALSA_STATE: state, ARCADE_ALSACTL: path.join(bin, "alsactl") } });
    return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout.trim().split("\n").pop()) : null };
  };
  return { run, level: () => Number(fs.readFileSync(levelFile, "utf8")), storedText: () => (fs.existsSync(state) ? fs.readFileSync(state, "utf8") : null) };
}

test("a new card: the default makes the control, sets 30% and stores it", () => {
  const c = cabinet();
  const r = c.run("default");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, { speaker: true, percent: 30, cap: 60 });
  assert.equal(c.level(), 30);
  assert.match(c.storedText(), /state\.sndrpihifiberry[^]*value 30/);
});

test("a stored level is someone's choice: the default never resets it, at a boot or an update", () => {
  const c = cabinet();
  c.run("default");
  c.run("set", "85"); // the Manager's slider
  for (let i = 0; i < 3; i++) assert.deepEqual(c.run("default").out, { speaker: true, percent: 85, cap: 60, kept: true });
  assert.equal(c.level(), 85);
});

test("another card's stored PCM control (the mic) doesn't count as a stored speaker level", () => {
  const c = cabinet({ stored: "state.Mic {\n\tcontrol.1 {\n\t\tname 'PCM Playback Volume'\n\t}\n}\n" });
  assert.equal(c.run("default").out.percent, 30);
});

test("no DAC yet (a first boot before its restart, or the virtual cabinet): nothing is set, nothing fails", () => {
  const c = cabinet({ card: false });
  const r = c.run("default");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, { speaker: false });
  assert.equal(c.storedText(), null);
});

test("the cabinet's steps: down to 0, up to the cap and no further, each one stored", () => {
  const c = cabinet({ level: 30 });
  const walk = (dir, n) => Array.from({ length: n }, () => c.run(dir).out.percent);
  assert.deepEqual(walk("up", 5), [40, 50, 60, 60, 60]);
  assert.match(c.storedText(), /value 60/);
  assert.deepEqual(walk("down", 8), [50, 40, 30, 20, 10, 0, 0, 0]);
  assert.match(c.storedText(), /value 0/);
});

test("a level between steps snaps to the next step; one above the cap only comes down", () => {
  const c = cabinet({ level: 33 });
  assert.equal(c.run("up").out.percent, 40);
  c.run("set", "33");
  assert.equal(c.run("down").out.percent, 30);
  c.run("set", "85");
  assert.equal(c.run("up").out.percent, 85);
  assert.equal(c.run("down").out.percent, 80);
});

test("set takes 0 to 100 and nothing else", () => {
  const c = cabinet({ level: 30 });
  for (const bad of ["101", "-1", "loud", "", "3.5"]) assert.equal(c.run("set", bad).code, 2, bad);
  assert.equal(c.level(), 30);
  assert.equal(c.run("set", "100").out.percent, 100);
});

test("the picade profile runs the volume step after the sound is set up, and a unit runs it at each boot", () => {
  assert.match(fs.readFileSync(PROFILE, "utf8"), /hw_late\(\) \{[^}]*step_sound\s+step_volume/);
  const unit = fs.readFileSync(path.join(REPO, "cabinet/provision/files/arcade-volume-default.service"), "utf8");
  assert.match(unit, /After=.*alsa-restore\.service/);
  assert.match(unit, /ExecStart=\/usr\/local\/bin\/arcade-volume default/);
});

// ---------- D421: hold ENT and press a pink button ----------
const VOLKEY = path.join(REPO, "cabinet/provision/files/arcade-volkey");
const KEY = { q: 16, e: 18, f1: 59, f2: 60, z: 44, ent: 183 };

/** Linux input events (struct input_event, 64-bit): each step is [key, 1 down | 0 up | 2 repeat]. */
function events(steps) {
  const buf = Buffer.alloc(24 * steps.length);
  steps.forEach(([key, value], i) => {
    buf.writeUInt16LE(1, i * 24 + 16); // EV_KEY
    buf.writeUInt16LE(KEY[key], i * 24 + 18);
    buf.writeInt32LE(value, i * 24 + 20);
  });
  return buf;
}

/** Run the watcher over a recorded run of key events; returns the directions it asked for and the level it showed. */
async function watch(steps, { percent = 40 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volkey-"));
  const dev = path.join(root, "event0");
  const calls = path.join(root, "calls");
  const show = path.join(root, "run/level.json");
  const tool = path.join(root, "arcade-volume");
  fs.writeFileSync(dev, events(steps));
  fs.writeFileSync(calls, "");
  fs.writeFileSync(tool, `#!/bin/bash\necho "$1" >> "${calls}"\necho '{"speaker": true, "percent": ${percent}, "cap": 60}'\n`, { mode: 0o755 });
  const child = spawn("python3", [VOLKEY], { env: { PATH: process.env.PATH, ARCADE_VOLUME_CMD: tool, ARCADE_VOLUME_SHOW: show, ARCADE_VOLKEY_DEVICES: dev }, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  // It has read everything once it reports the file's end.
  for (let i = 0; i < 100 && !out.includes("lost "); i++) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  assert.match(out, /lost /, "the watcher read the events");
  return { calls: fs.readFileSync(calls, "utf8").split("\n").filter(Boolean), shown: fs.existsSync(show) ? JSON.parse(fs.readFileSync(show, "utf8")) : null };
}

test("the Picade's ENT is F13 (D433): held with a pink it's the volume, as F1 is on a driver keyboard", async () => {
  const r = await watch([["ent", 1], ["q", 1], ["q", 0], ["e", 1], ["e", 0], ["ent", 0], ["e", 1], ["e", 0], ["ent", 1], ["f2", 1], ["q", 1], ["q", 0]]);
  assert.deepEqual(r.calls, ["down", "up"]);
});

test("ENT held and a pink pressed: 5 is quieter, 6 is louder, one step a press, and the level is written for the bar", async () => {
  const r = await watch([["f1", 1], ["q", 1], ["q", 0], ["e", 1], ["e", 2], ["e", 2], ["e", 0], ["e", 1], ["e", 0], ["f1", 0]]);
  assert.deepEqual(r.calls, ["down", "up", "up"], "a held pink's repeats aren't more steps");
  assert.equal(r.shown.percent, 40);
  assert.equal(r.shown.cap, 60);
});

test("the pinks alone stay spare, ENT alone does nothing, and letting ENT go ends it", async () => {
  const r = await watch([["q", 1], ["q", 0], ["e", 1], ["e", 0], ["f1", 1], ["f1", 0], ["q", 1], ["q", 0], ["f1", 1], ["z", 1], ["z", 0], ["f1", 0]]);
  assert.deepEqual(r.calls, []);
  assert.equal(r.shown, null);
});

test("ENT with COIN held is the Wi-Fi screen's: a pink does nothing then, whichever went down first", async () => {
  const r = await watch([["f1", 1], ["f2", 1], ["q", 1], ["q", 0], ["e", 1], ["e", 0], ["f2", 0], ["f1", 0], ["f2", 1], ["f1", 1], ["e", 1], ["e", 0], ["f1", 0], ["f2", 0]]);
  assert.deepEqual(r.calls, []);
});

test("a pink already down when ENT is pressed isn't a volume press", async () => {
  const r = await watch([["q", 1], ["f1", 1], ["q", 0], ["f1", 0]]);
  assert.deepEqual(r.calls, []);
});

test("provisioning installs the watcher with the volume step", () => {
  const step = fs.readFileSync(path.join(REPO, "cabinet/provision/volume.sh"), "utf8");
  assert.match(step, /files\/arcade-volkey" \/usr\/local\/bin\/arcade-volkey/);
  assert.match(step, /enable arcade-volume-default arcade-volkey/);
});
