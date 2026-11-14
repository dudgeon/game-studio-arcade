// D420: every card starts quiet (30%, stored), a stored level is never reset, and the cabinet's own steps stop
// at the cap. arcade-volume runs here against stand-ins for amixer, aplay and alsactl.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  sh("alsactl", `printf "state.Mic {\\n\\tcontrol.1 {\\n\\t\\tname 'PCM Playback Volume'\\n\\t}\\n}\\nstate.sndrpihifiberry {\\n\\tcontrol.1 {\\n\\t\\tname 'PCM Playback Volume'\\n\\t\\tvalue $(cat "${levelFile}")\\n\\t}\\n}\\n" > "${state}"`);
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
