#!/usr/bin/env node
// Runs a .drive script on the virtual cabinet's own screens, from the mini, with no window (D154).
// Same verbs as cabinet/service/scripts/drive.js, which drives a headless browser. Here the keys
// go through uinput and the shots come from the compositor, so this is what a kid would see.
//
//   node cabinet/vm/flow.mjs --script FILE --out DIR
//
// More verbs here: `expect TEXT` fails unless TEXT is in a text box on screen now, `expect-sel N` fails unless
// the highlight is on item N, `repeat N` ... `end` repeats the steps between.
// Exit 0 only if every step worked with no fit faults and no page errors.
//
// The mini can lose the cabinet for a while (D156). A held connection usually just pauses, and the step finishes
// late. If it breaks, reads repeat and keys settle by id (D195), for up to ARCADE_RIDE_S seconds, default 300.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVE = path.join(HERE, "drive");
const GUEST = "/opt/arcade/current/cabinet/vm/guest/launcher.mjs";
const SETTLE_MS = 150; // a key's frame reaches the screen before the next step looks at it

const { values } = parseArgs({ options: { script: { type: "string" }, out: { type: "string" } } });
if (!values.script || !values.out) {
  console.error("usage: flow.mjs --script FILE --out DIR");
  process.exit(2);
}

const VM_ROOT = process.env.GSA_VM_DIR || path.join(os.homedir(), "game-studio-data/vm");
const hostFile = path.join(VM_ROOT, "host");
const HOST = process.env.ARCADE_HOST || (fs.existsSync(hostFile) ? fs.readFileSync(hostFile, "utf8").trim() : "arcade-virtual.local");
// One SSH connection for the whole flow, so a key takes milliseconds, not a new handshake.
const CONTROL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flow-")), "c");
const env = { ...process.env, ARCADE_HOST: HOST, ARCADE_SSH_CONTROL: CONTROL };
const sshArgs = ["-4", "-i", path.join(VM_ROOT, "ssh/arcade-virtual_ed25519"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", `UserKnownHostsFile=${path.join(VM_ROOT, "ssh/known_hosts")}`, "-o", "StrictHostKeyChecking=accept-new", "-S", CONTROL];
const target = `cabinet@${HOST}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RIDE_MS = Number(process.env.ARCADE_RIDE_S ?? 300) * 1000;
const SSH_FAILED = 255;
const master = () => run("ssh", [...sshArgs, "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=8", "-M", "-N", "-f", target], { timeout: 20000 });
// Every call has a limit: one SSH call once sat stuck for 29 hours. A call cut off is treated as SSH failing.
const LIMIT = { check: 10000, read: 60000, wait: 200000, drive: RIDE_MS + 120000 };
const transport = (e) => e.code === SSH_FAILED || e.killed || e.signal;

/** The held connection, opened again if it has died. One that's stuck is killed first. */
async function ensureMaster() {
  const alive = await run("ssh", [...sshArgs, "-O", "check", target], { timeout: LIMIT.check }).then(() => true, () => false);
  if (alive) return;
  await run("pkill", ["-f", `-S ${CONTROL} -o ServerAliveInterval`]).catch(() => {});
  await master().catch(() => {});
}

let keysSent = 0;
const drive = async (...a) => {
  await ensureMaster();
  if (["press", "hold", "down", "up", "type"].includes(a[0])) keysSent++;
  return run(DRIVE, a, { env, maxBuffer: 2 ** 26, timeout: LIMIT.drive });
};

/** What the key daemon has done: presses, and repeats it recognised and didn't press. */
async function keyLog() {
  const text = (await readOnly("sudo arcade-keyd log")).stdout;
  const lines = text.split("\n").filter(Boolean);
  const repeats = lines.filter((l) => l.endsWith("ALREADY-DONE"));
  const ids = lines.filter((l) => !l.endsWith("ALREADY-DONE")).map((l) => l.split(" ")[1]).filter((id) => id !== "-");
  return { pressed: lines.length - repeats.length, repeats: repeats.length, doubled: ids.length - new Set(ids).size };
}

async function readOnly(command) {
  const until = Date.now() + RIDE_MS;
  for (;;) {
    try {
      return await run("ssh", [...sshArgs, target, command], { maxBuffer: 2 ** 26, timeout: LIMIT.read });
    } catch (e) {
      if (!transport(e) || Date.now() > until) throw e;
      await sleep(3000);
      await ensureMaster();
    }
  }
}

/** A guest command that's safe to repeat: repeats while SSH itself is failing. */
async function guest(...a) {
  const until = Date.now() + RIDE_MS;
  for (;;) {
    try {
      return await run("ssh", [...sshArgs, target, "sudo", "-u", "arcade", "node", GUEST, ...a], { maxBuffer: 2 ** 26, timeout: a[0] === "wait" ? LIMIT.wait : LIMIT.read });
    } catch (e) {
      if (!transport(e) || Date.now() > until) throw e;
      await sleep(3000);
      await ensureMaster();
    }
  }
}

async function state() {
  return JSON.parse((await guest("state")).stdout);
}

function parseScript(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [verb, ...args] = l.split(/\s+/);
      return { verb, args, rest: l.slice(verb.length).trim(), line: l };
    });
}

/** Expands `repeat N` ... `end`. */
function flatten(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].verb !== "repeat") {
      out.push(steps[i]);
      continue;
    }
    const end = steps.findIndex((s, j) => j > i && s.verb === "end");
    if (end < 0) throw new Error("repeat with no end");
    const body = flatten(steps.slice(i + 1, end));
    for (let n = 0; n < Number(steps[i].args[0]); n++) out.push(...body);
    i = end;
  }
  return out;
}

async function step(s, out, shots) {
  const { verb, args, rest } = s;
  switch (verb) {
    case "press":
      await drive("press", args[0], args[1] ?? "60");
      await sleep(30);
      return;
    case "hold":
      await drive("hold", args[0], args[1]);
      await sleep(30);
      return;
    case "down":
    case "up":
      await drive(verb, args[0]);
      await sleep(30);
      return;
    case "type":
      await drive("type", rest);
      return;
    case "say": {
      // Once for this id, however many tries it takes (D195).
      const id = randomUUID().replace(/-/g, "");
      const until = Date.now() + RIDE_MS;
      for (;;) {
        const child = spawn("ssh", [...sshArgs, target, "sudo", "-u", "arcade", "node", GUEST, "say", id], { stdio: ["pipe", "ignore", "inherit"] });
        child.stdin.end(rest);
        const cut = setTimeout(() => child.kill(), LIMIT.read);
        const code = await new Promise((r) => child.on("close", (c, signal) => r(signal ? SSH_FAILED : c)));
        clearTimeout(cut);
        if (code === 0) return;
        if (code !== SSH_FAILED || Date.now() > until) throw new Error("say failed");
        await sleep(3000);
        await ensureMaster();
      }
    }
    case "wait":
      await guest("wait", args[0], args[1] ?? "-");
      await sleep(SETTLE_MS);
      return;
    case "sleep":
      await sleep(Number(args[0]));
      return;
    case "expect": {
      await sleep(SETTLE_MS);
      const st = await state();
      const words = st.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" ");
      // Long text wraps across lines, so spaces don't count.
      const flat = (t) => t.replace(/\s+/g, "");
      if (!flat(words).includes(flat(rest))) throw new Error(`expected "${rest}" on screen; ${st.screen} shows: ${words}`);
      return;
    }
    case "home": {
      // Up to the first item, looking after each press rather than counting.
      for (let i = 0; i < 40; i++) {
        await sleep(SETTLE_MS);
        const st = await state();
        if (st.sel === 0) return;
        await drive("press", "up", "60");
      }
      throw new Error("couldn't get back to the first item");
    }
    case "expect-sel": {
      await sleep(SETTLE_MS);
      const st = await state();
      if (st.sel !== Number(args[0])) throw new Error(`expected item ${args[0]} highlighted; ${st.screen} has ${st.sel}`);
      return;
    }
    case "shot": {
      await sleep(SETTLE_MS);
      const name = `${String(shots.length + 1).padStart(2, "0")}-${args[0]}`;
      await drive("screenshot", path.join(out, `${name}.png`));
      const st = await state();
      fs.writeFileSync(path.join(out, `${name}.fit.json`), `${JSON.stringify({ screen: st.screen, boxes: st.boxes }, null, 1)}\n`);
      shots.push({ name, screen: st.screen, boxes: st.boxes });
      return;
    }
    default:
      throw new Error(`unknown step: ${verb}`);
  }
}

async function main() {
  const steps = flatten(parseScript(fs.readFileSync(values.script, "utf8")));
  fs.mkdirSync(values.out, { recursive: true });
  const reachUntil = Date.now() + RIDE_MS;
  for (;;) {
    const up = await master().then(() => true, () => false);
    if (up) break;
    if (Date.now() > reachUntil) throw new Error(`can't reach the cabinet at ${HOST}`);
    await sleep(3000);
  }
  const errors = [];
  let watcherBreaks = 0;
  let finished = false;
  // Watches for page errors. It starts again if a gap cuts it off, and says how often that left it blind.
  const watch = () => {
    const child = spawn("ssh", [...sshArgs, target, "sudo", "-u", "arcade", "node", GUEST, "errors"], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (d) => errors.push(...d.toString().split("\n").filter(Boolean)));
    child.on("close", () => {
      if (finished) return;
      watcherBreaks++;
      setTimeout(async () => {
        await ensureMaster();
        watcher = watch();
      }, 3000);
    });
    return child;
  };
  let watcher = watch();
  await sleep(800);

  const shots = [];
  let failed = null;
  const keysBefore = await keyLog();
  const start = Date.now();
  const slow = [];
  for (const s of steps) {
    try {
      const began = Date.now();
      await step(s, values.out, shots);
      const took = Date.now() - began;
      const expected = s.verb === "sleep" ? Number(s.args[0]) : s.verb === "hold" ? Number(s.args[1]) : 0;
      if (took - expected > 8000 && s.verb !== "wait") slow.push({ step: s.line.slice(0, 40), seconds: Math.round(took / 1000) });
      console.log(`  ok   ${s.line.slice(0, 90)}${took - expected > 8000 ? `  (${Math.round(took / 1000)} s)` : ""}`);
    } catch (e) {
      failed = `"${s.line}": ${String(e.stderr || e.message).trim().slice(0, 400)}`;
      console.log(`  FAIL ${s.line.slice(0, 90)}`);
      break;
    }
  }
  const keysAfter = await keyLog().catch(() => null);
  const end = await state().catch(() => null);
  const faults = end?.faults ?? ["could not read the launcher at the end"];
  const cut = shots.flatMap((s) => s.boxes.filter((b) => b.cut).map((b) => `${s.name} ${b.id}: "${b.lines.at(-1)?.text}"`));
  finished = true;
  watcher.kill();
  await run("ssh", [...sshArgs, "-O", "exit", target]).catch(() => {});

  console.log(`\n${shots.length} shots in ${values.out}, ${((Date.now() - start) / 1000).toFixed(0)} s.`);
  console.log(`Fit faults: ${faults.length}`);
  faults.forEach((f) => console.log(`  ${f}`));
  console.log(`Cut text (deliberate): ${cut.length}`);
  cut.forEach((c) => console.log(`  ${c}`));
  const keys = keysAfter && { sent: keysSent, pressed: keysAfter.pressed - keysBefore.pressed, settled_as_already_done: keysAfter.repeats - keysBefore.repeats, ids_pressed_twice: keysAfter.doubled - keysBefore.doubled };
  console.log(`Keys: ${keys ? `${keys.sent} sent, ${keys.pressed} pressed, ${keys.settled_as_already_done} repeats recognised and not pressed, ${keys.ids_pressed_twice} pressed twice` : "couldn't read the key log"}`);
  if (!keys) failed ??= "couldn't read the key log";
  else if (keys.ids_pressed_twice || keys.pressed !== keys.sent) failed ??= `keys don't add up: ${JSON.stringify(keys)}`;
  console.log(`Steps slowed by a gap: ${slow.length}${watcherBreaks ? `; the page-error watcher was cut off ${watcherBreaks} times` : ""}`);
  console.log(`Page errors: ${errors.length}`);
  errors.forEach((e) => console.log(`  ${e}`));
  if (failed) console.log(`Stopped at ${failed}`);
  fs.writeFileSync(path.join(values.out, "report.json"), `${JSON.stringify({ host: "virtual", steps: steps.length, shots: shots.map((s) => s.name), keys, slow, watcherBreaks, faults, cut, errors, failed }, null, 1)}\n`);
  return failed || faults.length || errors.length ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`flow: ${e.message}`);
    process.exit(1);
  },
);
